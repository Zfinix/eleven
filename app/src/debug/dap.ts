import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { isRecord } from "../lib/guards";
import { Decoder, frame } from "./wire";
import { start, stop } from "../lib/process";

export type DapEvent = { readonly event: string; readonly body: unknown };

type Pending = { readonly resolve: (body: unknown) => void; readonly reject: (err: Error) => void };

export type LaunchConfig = {
  readonly program: string;
  readonly args?: readonly string[];
  readonly stopOnEntry?: boolean;
};

export type StackFrame = { readonly id: number; readonly name: string; readonly line: number; readonly source: string | null };

export type Variable = { readonly name: string; readonly value: string; readonly reference: number };

export type Scope = { readonly name: string; readonly reference: number };

export type StepGranularity = "statement" | "instruction";

/**
 * A minimal Debug Adapter Protocol client for lldb-dap: it spawns the adapter,
 * correlates requests with responses by sequence number, and hands events to a
 * listener. One client drives one debug session.
 */
export class DapClient {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly decoder = new Decoder();
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(event: DapEvent) => void>();
  private seq = 1;

  constructor(command: string, args: readonly string[] = []) {
    this.proc = start(command, args);
    this.proc.stdout.on("data", (chunk: Buffer) => this.receive(chunk));
    this.proc.on("exit", () => this.failAll(new Error("The debugger stopped.")));
  }

  on(listener: (event: DapEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  once(name: string): Promise<DapEvent> {
    return new Promise((resolve) => {
      const off = this.on((event) => {
        if (event.event !== name) return;
        off();
        resolve(event);
      });
    });
  }

  private receive(chunk: Buffer): void {
    for (const message of this.decoder.push(chunk)) {
      if (!isRecord(message)) continue;
      if (message.type === "response" && typeof message.request_seq === "number") {
        const waiting = this.pending.get(message.request_seq);
        if (!waiting) continue;
        this.pending.delete(message.request_seq);
        if (message.success === false) waiting.reject(new Error(typeof message.message === "string" ? message.message : "The debugger refused that."));
        else waiting.resolve(message.body);
      } else if (message.type === "event" && typeof message.event === "string") {
        const event: DapEvent = { event: message.event, body: message.body };
        for (const listener of this.listeners) listener(event);
      }
    }
  }

  private failAll(err: Error): void {
    for (const waiting of this.pending.values()) waiting.reject(err);
    this.pending.clear();
  }

  request(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const seq = this.seq++;
    const payload = { seq, type: "request", command, arguments: args };
    return new Promise((resolve, reject) => {
      this.pending.set(seq, { resolve, reject });
      this.proc.stdin.write(frame(payload));
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", { adapterID: "lldb-dap", linesStartAt1: true, columnsStartAt1: true, pathFormat: "path" });
  }

  async launch(config: LaunchConfig): Promise<void> {
    await this.request("launch", { program: config.program, args: config.args ?? [], stopOnEntry: config.stopOnEntry ?? false });
  }

  async attach(pid: number): Promise<void> {
    await this.request("attach", { pid });
  }

  async setBreakpoints(path: string, lines: readonly number[]): Promise<void> {
    await this.request("setBreakpoints", { source: { path }, breakpoints: lines.map((line) => ({ line })) });
  }

  async setFunctionBreakpoints(names: readonly string[]): Promise<void> {
    await this.request("setFunctionBreakpoints", { breakpoints: names.map((name) => ({ name })) });
  }

  /** Breaks at exact instruction addresses; lldb launches without address randomization, so file addresses match. */
  async setInstructionBreakpoints(addresses: readonly string[]): Promise<void> {
    await this.request("setInstructionBreakpoints", { breakpoints: addresses.map((instructionReference) => ({ instructionReference })) });
  }

  async configurationDone(): Promise<void> {
    await this.request("configurationDone");
  }

  continue(threadId: number): Promise<unknown> {
    return this.request("continue", { threadId });
  }

  next(threadId: number, granularity?: StepGranularity): Promise<unknown> {
    return this.request("next", granularity ? { threadId, granularity } : { threadId });
  }

  stepIn(threadId: number, granularity?: StepGranularity): Promise<unknown> {
    return this.request("stepIn", granularity ? { threadId, granularity } : { threadId });
  }

  stepOut(threadId: number): Promise<unknown> {
    return this.request("stepOut", { threadId });
  }

  async stackTrace(threadId: number): Promise<readonly StackFrame[]> {
    const body = await this.request("stackTrace", { threadId });
    const frames = isRecord(body) && Array.isArray(body.stackFrames) ? body.stackFrames : [];
    return frames.flatMap((item) => {
      if (!isRecord(item) || typeof item.id !== "number") return [];
      const source = isRecord(item.source) && typeof item.source.path === "string" ? item.source.path : null;
      return [{ id: item.id, name: typeof item.name === "string" ? item.name : "", line: typeof item.line === "number" ? item.line : 0, source }];
    });
  }

  async scopes(frameId: number): Promise<readonly Scope[]> {
    const body = await this.request("scopes", { frameId });
    const scopes = isRecord(body) && Array.isArray(body.scopes) ? body.scopes : [];
    return scopes.flatMap((scope) => {
      if (!isRecord(scope) || typeof scope.name !== "string" || typeof scope.variablesReference !== "number") return [];
      return [{ name: scope.name, reference: scope.variablesReference }];
    });
  }

  async variables(reference: number): Promise<readonly Variable[]> {
    const body = await this.request("variables", { variablesReference: reference });
    const list = isRecord(body) && Array.isArray(body.variables) ? body.variables : [];
    return list.flatMap((item) => {
      if (!isRecord(item) || typeof item.name !== "string") return [];
      return [{ name: item.name, value: typeof item.value === "string" ? item.value : "", reference: typeof item.variablesReference === "number" ? item.variablesReference : 0 }];
    });
  }

  async disconnect(): Promise<void> {
    try {
      await this.request("disconnect", { terminateDebuggee: true });
    } catch {
      // the adapter may already be gone
    }
    stop(this.proc);
  }
}
