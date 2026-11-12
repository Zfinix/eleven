import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { findOnPath } from "../agents/detect";
import { ASSETS } from "../lib/assets";
import { isRecord } from "../lib/guards";
import { start, stop } from "../lib/process";
import { currentSettings } from "../settings/store";
import type { Fn, HexRow, Refs, TableRow } from "../workbench/model";
import type { CodeType } from "./codeTypes";
import { hexRowsOf } from "./hexRows";

const APP_NAME = "Binary Ninja.app";

/** The Binary Ninja app picked in Settings, else the one in Applications. */
export function binjaApp(): string | null {
  const chosen = currentSettings().binjaPath;
  if (chosen) return existsSync(chosen) ? chosen : null;
  return [join(homedir(), "Applications", APP_NAME), join("/Applications", APP_NAME)].find(existsSync) ?? null;
}

/** Where Binary Ninja keeps its `binaryninja` Python module. */
function binjaModule(app: string): string {
  return join(app, "Contents", "Resources", "python");
}

export function binjaInstalled(): boolean {
  const app = binjaApp();
  return app !== null && existsSync(binjaModule(app));
}

/** Binary Ninja's own Python when it bundles one, so the module's native parts match, else python3 from PATH. */
function python(app: string): string {
  const bundled = join(app, "Contents", "Frameworks", "Python.framework", "Versions", "Current", "bin", "python3");
  return existsSync(bundled) ? bundled : (findOnPath("python3", ["/opt/homebrew/bin", "/usr/local/bin"]) ?? "python3");
}

const HELPER = join(ASSETS, "binja", "eleven_binja.py");

/** How to read the file with Binary Ninja by hand, for telling an agent. */
export function binjaCommand(path: string): string {
  const app = binjaApp() ?? join("/Applications", APP_NAME);
  return `PYTHONPATH="${binjaModule(app)}" ${python(app)} -c "import binaryninja; bv = binaryninja.load('${path}'); print([f.name for f in bv.functions][:50])"`;
}

type Reply = { readonly ok: unknown } | { readonly error: string };

function replyOf(line: string): Reply {
  const parsed: unknown = JSON.parse(line);
  if (isRecord(parsed) && typeof parsed.error === "string") return { error: parsed.error };
  return { ok: isRecord(parsed) ? (parsed.ok ?? parsed.ready ?? null) : null };
}

/** One Binary Ninja helper for one file: it loads and analyzes the binary once, then answers one JSON request per line. */
class BinjaSession {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly waiters: ((reply: Reply) => void)[] = [];
  private buffer = "";
  readonly ready: Promise<void>;

  constructor(path: string) {
    const app = binjaApp();
    if (!app) throw new Error("Binary Ninja isn't installed. Install it into Applications or pick it in Settings, Engines.");
    this.proc = start(python(app), [HELPER, path], { env: { ...process.env, PYTHONPATH: binjaModule(app) } });
    this.proc.stderr.resume();
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.receive(chunk));
    this.proc.on("exit", () => this.fail("Binary Ninja stopped. Check that your license includes headless use (Commercial or Ultimate)."));
    this.ready = new Promise<void>((resolve, reject) => {
      this.waiters.push((reply) => ("error" in reply ? reject(new Error(plainLicense(reply.error))) : resolve()));
    });
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    for (let at = this.buffer.indexOf("\n"); at >= 0; at = this.buffer.indexOf("\n")) {
      const line = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 1);
      if (line.trim()) this.waiters.shift()?.(replyOf(line));
    }
  }

  private fail(message: string): void {
    for (const waiter of this.waiters.splice(0)) waiter({ error: message });
  }

  async ask(request: Readonly<Record<string, string | number | null>>): Promise<unknown> {
    await this.ready;
    const reply = await new Promise<Reply>((resolve) => {
      this.waiters.push(resolve);
      this.proc.stdin.write(`${JSON.stringify(request)}\n`);
    });
    if ("error" in reply) throw new Error(reply.error);
    return reply.ok;
  }

  close(): void {
    stop(this.proc);
  }
}

/** Binary Ninja's license refusal, in words that say what to do. */
function plainLicense(error: string): string {
  return /licen[sc]e/i.test(error) ? `Binary Ninja refused to run headless: ${error}. Its headless API needs a Commercial or Ultimate license.` : error;
}

const sessions = new Map<string, Promise<BinjaSession>>();
const live = new Set<BinjaSession>();
process.once("exit", () => live.forEach((session) => session.close()));

const replays = new Map<string, () => readonly (readonly [string, CodeType])[]>();

/** What to mark again each time Binary Ninja loads the file, since nothing is saved into a database between runs. */
export function binjaReplayOn(path: string, saved: () => readonly (readonly [string, CodeType])[]): void {
  replays.set(path, saved);
}

function opened(path: string): Promise<BinjaSession> {
  let pending = sessions.get(path);
  if (!pending) {
    pending = (async () => {
      try {
        const session = new BinjaSession(path);
        live.add(session);
        await session.ready;
        for (const [addr, type] of replays.get(path)?.() ?? []) await session.ask({ op: "retype", addr, type, previous: null });
        return session;
      } catch (err) {
        sessions.delete(path);
        throw err;
      }
    })();
    sessions.set(path, pending);
  }
  return pending;
}

async function ask(path: string, request: Readonly<Record<string, string | number | null>>): Promise<unknown> {
  return (await opened(path)).ask(request);
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function binjaFunctions(path: string): Promise<readonly Fn[]> {
  return array(await ask(path, { op: "functions" })).flatMap((item) => {
    if (!isRecord(item) || typeof item.addr !== "string" || typeof item.name !== "string") return [];
    return [{ addr: item.addr, name: item.name, kind: item.kind === "thunk" ? "thunk" : "function" }];
  });
}

export async function binjaStrings(path: string): Promise<readonly TableRow[]> {
  return array(await ask(path, { op: "strings" })).flatMap((item) => (isRecord(item) && typeof item.addr === "string" && typeof item.text === "string" ? [{ a: item.addr, b: item.text }] : []));
}

export async function binjaSegments(path: string): Promise<readonly TableRow[]> {
  return array(await ask(path, { op: "sections" })).flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.start !== "string") return [];
    return [{ a: item.name, b: `${item.start} · ${typeof item.length === "number" ? item.length : 0} bytes` }];
  });
}

export async function binjaCode(path: string, addr: string, view: "pseudo" | "asm"): Promise<string> {
  return text(await ask(path, { op: view === "pseudo" ? "pseudocode" : "disassembly", addr }));
}

export async function binjaBytes(path: string, addr: string, length: number): Promise<readonly HexRow[]> {
  return hexRowsOf(text(await ask(path, { op: "bytes", addr, length })), addr);
}

export async function binjaRefs(path: string, addr: string): Promise<Refs> {
  const found = await ask(path, { op: "refs", addr });
  if (!isRecord(found)) return { callers: [], callees: [] };
  const callers = array(found.callers).flatMap((item) => (isRecord(item) && typeof item.from === "string" && typeof item.at === "string" ? [{ addr: item.from, at: item.at }] : []));
  const callees = array(found.callees).flatMap((item) => (typeof item === "string" ? [item] : []));
  return { callers, callees };
}

export async function binjaRetype(path: string, addr: string, next: CodeType | null, previous: CodeType | null): Promise<void> {
  await ask(path, { op: "retype", addr, type: next, previous });
}

/** Ends Binary Ninja's session for a file. */
export async function binjaClose(path: string): Promise<void> {
  const pending = sessions.get(path);
  sessions.delete(path);
  if (!pending) return;
  const session = await pending;
  live.delete(session);
  session.close();
}
