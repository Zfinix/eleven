import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { activeEngine } from "../analysis/engines";
import { isRecord } from "../lib/guards";
import { type BundledRizin, cutterRizin } from "./cutter";
import { currentSettings, pathSetting } from "../settings/store";
import type { Caller, Fn, HexRow, Refs, TableRow } from "../workbench/model";
import type { CodeType } from "./codeTypes";
import { hexRowsOf } from "./hexRows";
import { start, stop } from "../lib/process";

export function rizinProgram(): string {
  return pathSetting("rizinPath", "ELEVEN_RIZIN") ?? "rizin";
}

export function radare2Program(): string {
  return pathSetting("radare2Path", "ELEVEN_RADARE2") ?? "r2";
}

export type PipeTool = "rizin" | "radare2";

/** The program a session runs: the one picked in Settings, else Cutter's rizin when Cutter is installed, since it carries rz-ghidra. */
function launchOf(tool: PipeTool): BundledRizin {
  if (tool === "radare2") return { program: radare2Program(), env: {}, setup: [] };
  if (currentSettings().rizinPath) return { program: currentSettings().rizinPath, env: {}, setup: [] };
  return cutterRizin() ?? { program: rizinProgram(), env: {}, setup: [] };
}

/** radare2 when it's the engine in use. Otherwise rizin, which also gives Ghidra its quick first look. */
export function pipeTool(): PipeTool {
  return activeEngine()?.id === "radare2" ? "radare2" : "rizin";
}

/** The command line that runs the tool by hand, for telling an agent how to read the file the same way. */
export function pipeCommand(path: string): string {
  return pipeTool() === "radare2" ? `${radare2Program()} -q -c "aaa; afl" ${path}` : `${rizinProgram()} -q -c "aaa; afl" ${path}`;
}

/**
 * A long-lived rizin or radare2 process for one file: it analyzes the binary once, then
 * answers many commands over the rzpipe protocol (each reply ends with NUL),
 * so opening function after function stays instant instead of re-analyzing.
 */
class RizinSession {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly waiters: ((out: string) => void)[] = [];
  private buffer = "";
  private readonly ready: Promise<void>;

  readonly setup: readonly string[];

  constructor(tool: PipeTool, path: string) {
    const launch = launchOf(tool);
    this.setup = launch.setup;
    this.proc = start(launch.program, ["-q0", "-e", "scr.color=0", path], { env: { ...process.env, ...launch.env } });
    this.proc.stderr.resume();
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.receive(chunk));
    this.ready = new Promise<void>((resolve) => this.waiters.push(() => resolve()));
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    for (let at = this.buffer.indexOf("\0"); at >= 0; at = this.buffer.indexOf("\0")) {
      const reply = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 1);
      this.waiters.shift()?.(reply);
    }
  }

  async cmd(command: string): Promise<string> {
    await this.ready;
    return new Promise<string>((resolve) => {
      this.waiters.push(resolve);
      this.proc.stdin.write(`${command}\n`);
    });
  }

  close(): void {
    stop(this.proc);
  }
}

type SessionStore = { sessions?: Map<string, Promise<RizinSession>> };
const store = globalThis as SessionStore;
const sessions = (store.sessions ??= new Map());
process.once("exit", () => sessions.forEach((p) => void p.then((s) => s.close())));

const light = new Set<string>();

/** Analyze this file with rizin's quick pass (symbols and calls) instead of the full one, for a first look at a large binary. */
export function rizinLightOn(path: string): void {
  light.add(path);
}

function sessionKey(tool: PipeTool, path: string): string {
  return `${tool}\0${path}`;
}

/** Ends the rizin session for a file once something better reads it. */
export async function rizinClose(path: string): Promise<void> {
  const pending = sessions.get(sessionKey("rizin", path));
  sessions.delete(sessionKey("rizin", path));
  light.delete(path);
  if (pending) (await pending).close();
}

const replays = new Map<string, () => readonly (readonly [string, CodeType])[]>();

/** What to mark again each time rizin analyzes the file, since it keeps nothing between runs. */
export function rizinReplayOn(path: string, saved: () => readonly (readonly [string, CodeType])[]): void {
  replays.set(path, saved);
}

/** The analyzed rizin session for a file, created and auto-analyzed once, then reused. */
function analyzed(path: string): Promise<RizinSession> {
  const tool = pipeTool();
  const key = sessionKey(tool, path);
  let pending = sessions.get(key);
  if (!pending) {
    pending = (async () => {
      const session = new RizinSession(tool, path);
      for (const command of session.setup) await session.cmd(command);
      await session.cmd(light.has(path) ? "aa" : "aaa");
      for (const [addr, type] of replays.get(path)?.() ?? []) {
        for (const command of rizinTypeCommands(addr, type, null)) await session.cmd(command);
      }
      return session;
    })();
    sessions.set(key, pending);
  }
  return pending;
}

async function json(path: string, command: string): Promise<unknown> {
  try {
    return JSON.parse(await (await analyzed(path)).cmd(command));
  } catch {
    return null;
  }
}

async function text(path: string, command: string): Promise<string> {
  return (await (await analyzed(path)).cmd(command)).replace(/^\n+|\n+$/g, "");
}

function hex(value: number): string {
  return `0x${value.toString(16)}`;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

const ENTRY_NAMES = ["main", "sym._main", "sym.main", "entry0"] as const;

/** Where reading starts: main when rizin names it, else the entry point, else the first real function. */
export function rizinEntry(fns: readonly Fn[]): Fn | null {
  const named = ENTRY_NAMES.flatMap((name) => fns.filter((fn) => fn.name === name));
  return named[0] ?? fns.find((fn) => fn.kind === "function") ?? null;
}

/** A function's start in `aflj`: rizin calls it `offset`, radare2 `addr`. */
function functionStart(item: Readonly<Record<string, unknown>>): number | null {
  const at = item.offset ?? item.addr;
  return typeof at === "number" ? at : null;
}

/** Every function rizin finds. Imports and thunks are marked so the UI dims them. */
export async function rizinFunctions(path: string): Promise<readonly Fn[]> {
  return array(await json(path, "aflj")).flatMap((item) => {
    const at = isRecord(item) ? functionStart(item) : null;
    if (!isRecord(item) || at === null || typeof item.name !== "string") return [];
    const kind = /^(sym\.imp|reloc|fcn\.imp)/.test(item.name) ? "thunk" : "function";
    return [{ addr: hex(at), name: item.name, kind }];
  });
}

export async function rizinStrings(path: string): Promise<readonly TableRow[]> {
  return array(await json(path, "izzj")).flatMap((item) => {
    if (!isRecord(item) || typeof item.vaddr !== "number" || typeof item.string !== "string") return [];
    return [{ a: hex(item.vaddr), b: item.string }];
  });
}

export async function rizinSegments(path: string): Promise<readonly TableRow[]> {
  return array(await json(path, "iSj")).flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.vaddr !== "number") return [];
    const size = typeof item.vsize === "number" ? item.vsize : 0;
    return [{ a: item.name, b: `${hex(item.vaddr)} · ${size} bytes` }];
  });
}

export async function rizinBytes(path: string, addr: string, length: number): Promise<readonly HexRow[]> {
  return hexRowsOf((await (await analyzed(path)).cmd(`p8 ${length} @ ${addr}`)).trim(), addr);
}


export function rizinDisassembly(path: string, addr: string): Promise<string> {
  return text(path, `pdf @ ${addr}`);
}

/** Who calls this function, and what it calls, from rizin's cross-references. */
export async function rizinRefs(path: string, addr: string): Promise<Refs> {
  const [to, from] = await Promise.all([json(path, `axtj @ ${addr}`), json(path, `afxj @ ${addr}`)]);
  const callers: Caller[] = array(to).flatMap((item) => (isRecord(item) && typeof item.from === "number" ? [{ addr: hex(item.from), at: hex(item.from) }] : []));
  const callees = array(from).flatMap((item) => (isRecord(item) && typeof item.to === "number" && item.type === "CALL" ? [hex(item.to)] : []));
  return { callers, callees };
}

/** The command a decompiler plugin adds, from the core plugins listed: Ghidra's pdg (rz-ghidra, r2ghidra), r2dec's pdd or jsdec's pdc. */
export function decompilerCommand(plugins: string): string | null {
  if (/ghidra|\bpdg\b/i.test(plugins)) return "pdg";
  if (/r2dec|\bpdd\b/i.test(plugins)) return "pdd";
  if (/jsdec|\bpdc\b/i.test(plugins)) return "pdc";
  return null;
}

async function decompiler(path: string): Promise<string | null> {
  return decompilerCommand(await (await analyzed(path)).cmd("Lc"));
}

/** Whether a decompiler plugin is installed for pseudocode. */
export async function rizinHasDecompiler(path: string): Promise<boolean> {
  return (await decompiler(path)) !== null;
}

/** Pseudocode for one function from the decompiler plugin; throws a plain message when none is installed. */
export async function rizinPseudocode(path: string, addr: string): Promise<string> {
  const command = await decompiler(path);
  if (command === null) {
    throw new Error(pipeTool() === "radare2"
      ? "radare2 needs a decompiler plugin for pseudocode. Install r2ghidra or r2dec, for example with r2pm -ci r2ghidra."
      : "This engine needs a decompiler plugin for pseudocode. Install rz-ghidra (pdg) or jsdec (pdc).");
  }
  return text(path, `${command} @ ${addr}`);
}

const DATA_SIZE: Readonly<Record<"byte" | "word" | "dword" | "qword", number>> = { byte: 1, word: 2, dword: 4, qword: 8 };

/** The rizin commands that mark an address as `next`, or read it as code again when `next` is null. */
export function rizinTypeCommands(addr: string, next: CodeType | null, previous: CodeType | null): readonly string[] {
  const clear = `C- @ ${addr}`;
  switch (next) {
    case null:
      return previous === "procedure" ? [clear, `af- @ ${addr}`] : [clear];
    case "code":
      return [clear];
    case "procedure":
      return [clear, `af @ ${addr}`];
    case "byte":
    case "word":
    case "dword":
    case "qword":
      return [clear, `Cd ${DATA_SIZE[next]} @ ${addr}`];
    case "cstring":
      return [clear, `Cs @ ${addr}`];
    case "undefined":
      return [clear, `Cd 1 @ ${addr}`];
    default: {
      const unhandled: never = next;
      return unhandled;
    }
  }
}

/** Marks an address in rizin's session; a function rizin refuses (one inside another) is reported plainly. */
export async function rizinRetype(path: string, addr: string, next: CodeType | null, previous: CodeType | null): Promise<void> {
  const session = await analyzed(path);
  for (const command of rizinTypeCommands(addr, next, previous)) await session.cmd(command);
  if (next !== "procedure") return;
  const starts = array(await json(path, "aflj")).some((item) => isRecord(item) && functionStart(item) === Number(addr));
  if (!starts) throw new Error(`${pipeTool() === "radare2" ? "radare2" : "Rizin"} can't start a function at ${addr} because it sits inside another one. Switch to Ghidra in Settings, Analysis to split it.`);
}
