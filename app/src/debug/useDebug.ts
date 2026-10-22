import { useEffect, useRef, useState } from "react";

import { isRecord } from "../lib/guards";
import { currentSettings } from "../settings/store";
import { findLldbDap } from "./adapter";
import { splitArgs } from "./args";
import { claimDebug, type DebugAction } from "./live";
import { DapClient, type StackFrame, type Thread, type Variable } from "./dap";

export type OutputLine = { readonly kind: "program" | "error" | "asked" | "answer"; readonly text: string };

const OUTPUT_LIMIT = 2000;

export type LoadedScope = { readonly name: string; readonly reference: number; readonly vars: readonly Variable[] };

export type DebugStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "starting" }
  | { readonly kind: "running" }
  | { readonly kind: "stopped"; readonly reason: string; readonly thread: number; readonly frames: readonly StackFrame[]; readonly scopes: readonly LoadedScope[]; readonly threads: readonly Thread[] }
  | { readonly kind: "exited"; readonly code: number | null }
  | { readonly kind: "error"; readonly message: string; readonly problem: DebugProblem | null };

/** A problem Eleven recognised, so the view can say it in the reader's language while an agent still reads `message`. */
export type DebugProblem = "noDebugger" | "protected";

export type Debug = {
  readonly status: DebugStatus;
  /** What the program printed, and expressions you evaluated with their results. */
  readonly output: readonly OutputLine[];
  readonly launch: (program: string, breakAt: readonly string[]) => void;
  readonly attach: (pid: number, breakAt: readonly string[]) => void;
  readonly cont: () => void;
  readonly stepOver: () => void;
  readonly stepIn: () => void;
  readonly stepOut: () => void;
  readonly stepInstruction: () => void;
  readonly stop: () => void;
  readonly pause: () => void;
  /** Stops the session and starts it again the same way. */
  readonly restart: () => void;
  readonly evaluate: (expression: string) => void;
  /** Starts the last session again the same way, launched or attached. */
  readonly retry: () => void;
  /** Replaces the breakpoints of the running session, if there is one. */
  readonly syncBreakpoints: (breakAt: readonly string[]) => void;
  readonly loadVars: (reference: number) => Promise<readonly Variable[]>;
  /** Resolves when the session next stops, exits or fails, or after a while if it keeps running. */
  readonly settle: () => Promise<void>;
  /** The session as an agent reads it. */
  readonly describe: () => Promise<string>;
};

function stoppedReason(body: unknown): string {
  return isRecord(body) && typeof body.reason === "string" ? body.reason : "stopped";
}

function threadOf(body: unknown): number {
  return isRecord(body) && typeof body.threadId === "number" ? body.threadId : 1;
}

async function sendBreakpoints(dap: DapClient, breakAt: readonly string[]): Promise<void> {
  const addresses = breakAt.filter((at) => /^0x[0-9a-f]+$/i.test(at));
  await dap.setFunctionBreakpoints(breakAt.filter((at) => !addresses.includes(at)));
  await dap.setInstructionBreakpoints(addresses);
}

function outputOf(body: unknown): OutputLine | null {
  if (!isRecord(body) || typeof body.output !== "string") return null;
  if (body.category === "telemetry" || body.category === "console") return null;
  return { kind: body.category === "stderr" ? "error" : "program", text: body.output.replace(/\r?\n$/, "") };
}

function exitCode(body: unknown): number | null {
  return isRecord(body) && typeof body.exitCode === "number" ? body.exitCode : null;
}

const NO_DEBUGGER = "Eleven needs lldb-dap to debug. Install Xcode's command line tools, or choose lldb-dap in Settings.";

const PROTECTED = "macOS won't let the debugger run this program. System programs and apps with hardened runtime are protected. Try a copy you built, or one re-signed without hardened runtime.";

function startProblem(err: unknown): DebugStatus {
  const message = err instanceof Error ? err.message : String(err);
  if (/permission denied|not allowed|operation not permitted/i.test(message)) return { kind: "error", message: PROTECTED, problem: "protected" };
  return { kind: "error", message, problem: null };
}

const SETTLE_MS = 15_000;

function shown(vars: readonly Variable[], limit: number): string {
  return vars.slice(0, limit).map((v) => `  ${v.name} = ${v.value}`).join("\n") || "  (none)";
}

/** The session as an agent reads it: where it is paused, the stack, locals, registers and the newest output. */
export function describeSession(status: DebugStatus, output: readonly OutputLine[], registers: readonly Variable[]): string {
  const recent = output.slice(-20).map((line) => (line.kind === "asked" ? `> ${line.text}` : line.text)).join("\n");
  const tail = recent ? `\n\nOutput:\n${recent}` : "";
  switch (status.kind) {
    case "idle":
      return "No debug session. Start one with debug_start.";
    case "starting":
      return "The debugger is starting.";
    case "running":
      return `The program is running.${tail}`;
    case "exited":
      return `The program ${status.code === null ? "finished" : `exited with code ${status.code}`}.${tail}`;
    case "error":
      return `The debugger hit a problem: ${status.message}`;
    case "stopped": {
      const top = status.frames[0];
      const stack = status.frames.slice(0, 12).map((f) => `  ${f.name || "??"}${f.pc ? ` ${f.pc}` : ""}`).join("\n") || "  (none)";
      const locals = status.scopes.find((scope) => /local/i.test(scope.name))?.vars ?? [];
      return `Paused (${status.reason}) in ${top?.name ?? "an unknown frame"}${top?.pc ? ` at ${top.pc}` : ""}, thread ${status.thread}.\n\nCall stack:\n${stack}\n\nLocals:\n${shown(locals, 30)}\n\nRegisters:\n${shown(registers, 40)}${tail}`;
    }
  }
}

/** Drives one lldb-dap debug session for the workbench: launch, breakpoints, stepping, and the stack and locals when stopped. */
export function useDebug(): Debug {
  const [status, setStatus] = useState<DebugStatus>({ kind: "idle" });
  const [output, setOutput] = useState<readonly OutputLine[]>([]);
  const client = useRef<DapClient | null>(null);
  const alive = useRef(true);
  const last = useRef<(() => void) | null>(null);
  const now = useRef<DebugStatus>(status);
  const lastThread = useRef(1);
  const settled = useRef(new Set<() => void>());
  const printed = useRef<readonly OutputLine[]>([]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void client.current?.disconnect();
      client.current = null;
    };
  }, []);

  const set = (next: DebugStatus): void => {
    now.current = next;
    if (next.kind === "stopped") lastThread.current = next.thread;
    if (next.kind !== "running" && next.kind !== "starting") {
      for (const wake of settled.current) wake();
      settled.current.clear();
    }
    if (alive.current) setStatus(next);
  };
  const print = (line: OutputLine): void => {
    printed.current = [...printed.current, line].slice(-OUTPUT_LIMIT);
    if (alive.current) setOutput(printed.current);
  };

  const onStopped = (dap: DapClient, body: unknown): void => {
    const thread = threadOf(body);
    void (async (): Promise<void> => {
      try {
        const [frames, threads] = await Promise.all([dap.stackTrace(thread), dap.threads().catch(() => [])]);
        const scopeList = frames[0] ? await dap.scopes(frames[0].id) : [];
        const scopes = await Promise.all(scopeList.map(async (scope) => ({ name: scope.name, reference: scope.reference, vars: await dap.variables(scope.reference) })));
        if (client.current === dap) set({ kind: "stopped", reason: stoppedReason(body), thread, frames, scopes, threads });
      } catch {
        if (client.current === dap) set({ kind: "stopped", reason: stoppedReason(body), thread, frames: [], scopes: [], threads: [] });
      }
    })();
  };

  const begin = (startRequest: (dap: DapClient) => Promise<void>, breakAt: readonly string[]): void => {
    if (now.current.kind === "starting" || now.current.kind === "running") return;
    const adapter = findLldbDap();
    if (!adapter) {
      set({ kind: "error", message: NO_DEBUGGER, problem: "noDebugger" });
      return;
    }
    set({ kind: "starting" });
    printed.current = [];
    setOutput([]);
    void client.current?.disconnect();
    const dap = new DapClient(adapter);
    client.current = dap;
    dap.on((event) => {
      if (client.current !== dap) return;
      if (event.event === "stopped") onStopped(dap, event.body);
      else if (event.event === "output") {
        const line = outputOf(event.body);
        if (line) print(line);
      }
      else if (event.event === "exited") set({ kind: "exited", code: exitCode(event.body) });
      else if (event.event === "terminated" && now.current.kind !== "exited") set({ kind: "exited", code: null });
    });
    void (async (): Promise<void> => {
      try {
        const initialized = dap.once("initialized");
        await dap.initialize();
        const started = startRequest(dap);
        await Promise.race([initialized, started.then(() => initialized)]);
        await sendBreakpoints(dap, breakAt);
        await dap.configurationDone();
        await started;
        if (client.current === dap) set({ kind: "running" });
      } catch (err) {
        if (client.current === dap) set(startProblem(err));
      }
    })();
  };

  const launch = (program: string, breakAt: readonly string[]): void => {
    last.current = () => launch(program, breakAt);
    const { stopAtEntry, programArgs } = currentSettings();
    begin((dap) => dap.launch({ program, args: splitArgs(programArgs), stopOnEntry: stopAtEntry }), breakAt);
  };
  const attach = (pid: number, breakAt: readonly string[]): void => {
    last.current = () => attach(pid, breakAt);
    begin((dap) => dap.attach(pid), breakAt);
  };
  const retry = (): void => last.current?.();
  const syncBreakpoints = (breakAt: readonly string[]): void => {
    const dap = client.current;
    if (!dap || status.kind === "idle" || status.kind === "starting" || status.kind === "exited" || status.kind === "error") return;
    void sendBreakpoints(dap, breakAt).catch(() => undefined);
  };

  const step = (verb: "cont" | "over" | "in" | "out" | "instr"): void => {
    const dap = client.current;
    const at = now.current;
    if (!dap || at.kind !== "stopped") return;
    const thread = at.thread;
    set({ kind: "running" });
    const call =
      verb === "cont" ? dap.continue(thread)
      : verb === "over" ? dap.next(thread)
      : verb === "in" ? dap.stepIn(thread)
      : verb === "out" ? dap.stepOut(thread)
      : dap.next(thread, "instruction");
    void call.catch((err: unknown) => set({ kind: "error", message: err instanceof Error ? err.message : String(err), problem: null }));
  };

  const stop = (): void => {
    void client.current?.disconnect();
    client.current = null;
    set({ kind: "idle" });
  };

  const pause = (): void => {
    if (now.current.kind === "running") void client.current?.pause(lastThread.current).catch(() => undefined);
  };

  const restart = (): void => {
    void client.current?.disconnect();
    client.current = null;
    set({ kind: "idle" });
    retry();
  };

  const answer = async (expression: string): Promise<string> => {
    const dap = client.current;
    if (!dap || !expression.trim()) return "";
    print({ kind: "asked", text: expression });
    const at = now.current;
    const frameId = at.kind === "stopped" ? (at.frames[0]?.id ?? null) : null;
    try {
      const result = await dap.evaluate(expression, frameId);
      print({ kind: "answer", text: result });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      print({ kind: "error", text: message });
      throw new Error(message);
    }
  };
  const evaluate = (expression: string): void => {
    void answer(expression).catch(() => undefined);
  };

  const loadVars = (reference: number): Promise<readonly Variable[]> => client.current?.variables(reference) ?? Promise.resolve([]);

  const describe = async (): Promise<string> => {
    const at = now.current;
    const set = at.kind === "stopped" ? at.scopes.find((scope) => /register/i.test(scope.name))?.vars[0] : undefined;
    const registers = set && set.reference > 0 ? await loadVars(set.reference).catch(() => []) : [];
    return describeSession(now.current, printed.current, registers);
  };

  const settle = (): Promise<void> => new Promise((resolve) => {
    const timer = setTimeout(() => {
      settled.current.delete(wake);
      resolve();
    }, SETTLE_MS);
    const wake = (): void => {
      clearTimeout(timer);
      resolve();
    };
    settled.current.add(wake);
  });

  const act = async (action: DebugAction): Promise<string> => {
    const kind = now.current.kind;
    if (kind !== "stopped" && kind !== "running") return describe();
    if (action === "pause") {
      if (kind !== "running") return describe();
      const paused = settle();
      pause();
      await paused;
      return describe();
    }
    if (kind !== "stopped") throw new Error("The program is running. Pause it first.");
    const moved = settle();
    if (action === "continue") step("cont");
    else if (action === "step_over") step("over");
    else if (action === "step_into") step("in");
    else if (action === "step_out") step("out");
    else step("instr");
    await moved;
    return describe();
  };

  useEffect(() => {
    claimDebug({ describe, act, evaluate: async (expression) => (await answer(expression)) || "Nothing came back." });
    return () => claimDebug(null);
  }, []);

  return { status, output, launch, attach, cont: () => step("cont"), stepOver: () => step("over"), stepIn: () => step("in"), stepOut: () => step("out"), stepInstruction: () => step("instr"), stop, pause, restart, evaluate, retry, syncBreakpoints, loadVars, settle, describe };
}
