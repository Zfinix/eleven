import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { readCachedText } from "../agents/launch";
import { errorMessage, isRecord, recordField, stringField } from "../lib/guards";
import { SerialQueue } from "../lib/serial";
import { cacheDir } from "../settings/actions";
import { currentSettings, pathSetting, type Settings } from "../settings/store";
import { nodeCommand } from "./toolchain";
import { activeProvider } from "../analysis/engines";
import type { CodeType } from "./codeTypes";


const TIME_LIMITS: Readonly<Record<Settings["ghidraTimeout"], number>> = { "30 minutes": 30 * 60_000, "2 hours": 2 * 3_600_000, "6 hours": 6 * 3_600_000, "12 hours": 12 * 3_600_000 };
const RESPONSE_GRACE_MS = 5 * 60_000;
const MAX_TIMER_MS = 2_147_483_647 - RESPONSE_GRACE_MS;

/** How long REA lets Ghidra import and analyze a file: Settings → Analysis, or a valid REA_GHIDRA_STARTUP_TIMEOUT_MS. */
export function ghidraStartupMs(s: Settings = currentSettings()): number {
  const override = Number(process.env.REA_GHIDRA_STARTUP_TIMEOUT_MS);
  return Number.isSafeInteger(override) && override > 0 && override <= MAX_TIMER_MS ? override : TIME_LIMITS[s.ghidraTimeout];
}

/** Callers wait a little longer than Ghidra's own deadline, so its timeout error reaches them; progress keeps the call alive. */
export function reaCallOptions(s: Settings = currentSettings()): { readonly timeout: number; readonly resetTimeoutOnProgress: true } {
  return { timeout: ghidraStartupMs(s) + RESPONSE_GRACE_MS, resetTimeoutOnProgress: true };
}

const TIMEOUT_CODES: ReadonlySet<string> = new Set(["timeout", "provider_timeout"]);

/** A failed REA tool call, with REA's error code so callers can tell a timeout from a broken engine. */
export class ReaError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

export type OpenProblem = { readonly raw: string; readonly advice: string };

/** What to tell someone whose file didn't open, from the error that stopped it. */
export function openProblem(err: unknown): OpenProblem {
  const raw = errorMessage(err);
  if (!(err instanceof ReaError)) return { raw, advice: "Check that REA and Ghidra are installed in Setup, then open it again." };
  if (TIMEOUT_CODES.has(err.code)) return { raw, advice: "Ghidra ran out of time analyzing it. Pick a longer Analysis time limit in Settings, restart Eleven and open it again. For a big Swift app, turning off Demangle Swift names also helps." };
  return { raw, advice: "Ghidra couldn't finish reading it. The details below say what stopped it." };
}

export type CodeView = "pseudocode" | "assembly";

export type Opened = { readonly path: string; readonly sha256: string; readonly format: string; readonly architecture: string };

/** How to start REA: the bundled Node when Eleven ships one, otherwise the user's. */
export function reaLaunch(): { readonly command: string; readonly args: readonly string[] } {
  const rea = pathSetting("reaPath", "ELEVEN_REA") ?? "rea";
  return /\.m?js$/.test(rea) ? { command: nodeCommand(), args: [rea, "mcp"] } : { command: rea, args: ["mcp"] };
}

const STEP: Readonly<Record<string, string>> = {
  open_binary: "Opening the file",
  ghidra_startup: "Ghidra is analyzing the code",
  list_procedures: "Listing functions",
  list_strings: "Reading strings",
  list_segments: "Reading segments",
};

const stepListeners = new Set<(step: string) => void>();

/** Plain words for REA's "phase: message" progress, or null for phases nobody needs to see. */
export function stepOf(message: string): string | null {
  return STEP[message.split(":", 1)[0] ?? ""] ?? null;
}

/** Calls back with each step REA reports, such as Ghidra analyzing or functions being listed. */
export function onReaStep(listener: (step: string) => void): () => void {
  stepListeners.add(listener);
  return () => stepListeners.delete(listener);
}

function reportStep(message: string | undefined): void {
  const step = message ? stepOf(message) : null;
  if (step) for (const listener of stepListeners) listener(step);
}

function plainEnv(): Record<string, string> {
  return { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ...reaEnv() };
}

const MAXMEM: Readonly<Record<Settings["ghidraMemory"], string | null>> = { Automatic: null, "2 GB": "2G", "4 GB": "4G", "8 GB": "8G", "16 GB": "16G", "32 GB": "32G", "64 GB": "64G" };

/** Ghidra knobs from Settings → Analysis, as the environment REA reads when it starts Ghidra. */
export function reaEnv(s: Settings = currentSettings()): Record<string, string> {
  const memory = MAXMEM[s.ghidraMemory];
  const inherited = (process.env.REA_GHIDRA_DISABLED_ANALYZERS ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  const disabled = [...new Set([...inherited, ...(s.rebuildSwitches ? [] : ["Decompiler Switch Analysis"]), ...(s.swiftNames ? [] : ["Demangler Swift"])])];
  return {
    REA_GHIDRA_STARTUP_TIMEOUT_MS: String(ghidraStartupMs(s)),
    ...(memory ? { GHIDRA_MAXMEM: memory } : {}),
    ...(disabled.length > 0 ? { REA_GHIDRA_DISABLED_ANALYZERS: disabled.join(",") } : {}),
  };
}

export function reaTransport(): StdioClientTransport {
  const { command, args } = reaLaunch();
  return new StdioClientTransport({ command, args: [...args], env: plainEnv(), stderr: "ignore" });
}

/** REA's code, the step that failed and the engine's own diagnostics, so a failure says more than its summary. */
function errorFacts(code: string, details: Record<string, unknown> | undefined): string {
  const operation = stringField(details, "operation");
  const diagnostics = details?.diagnostics;
  return [code && `code ${code}`, operation && `during ${operation}`, diagnostics !== undefined && JSON.stringify(diagnostics)].filter(Boolean).join(", ");
}

function toolError(content: unknown): Error {
  const text = Array.isArray(content) ? content.map((block) => stringField(block, "text") ?? "").join("") : "";
  try {
    const parsed: unknown = JSON.parse(text);
    const error = recordField(parsed, "error");
    const details = error?.details;
    const issue = isRecord(details) && Array.isArray(details.issues) ? stringField(details.issues[0], "message") : undefined;
    const code = stringField(error, "code") ?? "";
    const message = issue ?? stringField(error, "message") ?? text;
    const facts = issue ? "" : errorFacts(code, isRecord(details) ? details : undefined);
    return new ReaError(facts ? `${message}\n${facts}` : message, code);
  } catch {
    return new Error(text || "REA couldn't do that.");
  }
}

function parseOpened(path: string, reply: unknown): Opened {
  const result = recordField(reply, "result");
  const sha256 = stringField(result, "sha256");
  if (!sha256) throw new Error("REA opened the file but didn't say what it was.");
  return { path, sha256, format: stringField(result, "format") ?? "", architecture: stringField(result, "architecture") ?? "" };
}

function cacheFile(target: Opened, procedure: string, view: CodeView): string {
  const name = procedure.replace(/[:/]/g, "_");
  return join(cacheDir(), target.sha256, "ghidra", view, `${name}.${view === "pseudocode" ? "c" : "s"}`);
}

/** Eleven's own REA session for the code canvas, separate from the agent's. */
type Session = { readonly path: string; readonly provider: string; readonly opened: Promise<Opened> };

class Rea {
  private client: Client | null = null;
  /** Shared by every caller, so concurrent requests on one file import it once instead of once each. */
  private session: Session | null = null;
  private readonly queue = new SerialQueue();
  private readonly replays = new Map<string, () => readonly (readonly [string, CodeType])[]>();

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const client = new Client({ name: "eleven", version: "0.1.0" });
    const transport = reaTransport();
    await client.connect(transport);
    process.once("exit", () => void transport.close());
    client.onclose = () => {
      if (this.client === client) this.client = null;
      this.session = null;
    };
    this.client = client;
    return client;
  }

  private call(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.queue.run(async () => {
      const result = await (await this.connect()).callTool({ name, arguments: args }, undefined, { ...reaCallOptions(), onprogress: ({ message }) => reportStep(message) });
      if (result.isError) throw toolError(result.content);
      return result.structuredContent ?? {};
    });
  }

  /** Opens the file unless it is already open, or being opened, with the chosen engine. */
  async open(path: string): Promise<Opened> {
    const provider = activeProvider();
    if (!provider) throw new Error("No analysis engine is on. Turn one on in Settings → Analysis.");
    const current = this.session;
    if (current && current.path === path && current.provider === provider) return current.opened;
    const opened = this.openBinary(path, provider);
    const session = { path, provider, opened };
    this.session = session;
    try {
      return await opened;
    } catch (err) {
      if (this.session === session) this.session = null;
      throw err;
    }
  }

  private async openBinary(path: string, provider: string): Promise<Opened> {
    const opened = parseOpened(path, await this.call("open_binary", { path, provider_id: provider }));
    for (const [address, type] of this.replays.get(path)?.() ?? []) {
      await this.call("set_code_type", { address, type }).catch(() => undefined);
    }
    return opened;
  }

  /** What to mark again each time Ghidra opens the file, since a fresh session starts from its own analysis. */
  replayOn(path: string, saved: () => readonly (readonly [string, CodeType])[]): void {
    this.replays.set(path, saved);
  }

  /** Marks the bytes at an address as a type, or reads them as code again when `type` is null. */
  async retype(path: string, address: string, type: CodeType | null): Promise<void> {
    await this.ensureOpen(path);
    if (type) {
      await this.call("set_code_type", { address, type });
      return;
    }
    await this.call("set_code_type", { address, type: "undefined" });
    await this.call("set_code_type", { address, type: "code" });
  }

  private async ensureOpen(path: string): Promise<void> {
    await this.open(path);
  }

  /** Any REA tool on a given file, returning its normalized result. */
  async tool(path: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureOpen(path);
    const reply = await this.call(name, args);
    return isRecord(reply) ? reply.normalized_result : undefined;
  }

  async listProcedures(path: string): Promise<readonly unknown[]> {
    await this.ensureOpen(path);
    const reply = await this.call("list_procedures", {});
    const normalized = isRecord(reply) ? reply.normalized_result : undefined;
    if (!Array.isArray(normalized)) throw new Error("REA couldn't list the functions in this file.");
    return normalized;
  }

  /** Ghidra's full dossier for one function: blocks, callers, callees, references, comments. Cached as JSON. */
  async analyze(target: Opened, procedure: string): Promise<unknown> {
    const file = join(cacheDir(), target.sha256, "ghidra", "dossier", `${procedure.replace(/[:/]/g, "_")}.json`);
    const cached = await readCachedText(file);
    if (cached !== null) return JSON.parse(cached);
    await this.ensureOpen(target.path);
    const reply = await this.call("analyze_function", { procedure });
    const value = recordField(recordField(reply, "raw_result"), "value") ?? null;
    if (!value) throw new Error("REA didn't describe this function.");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
    return value;
  }

  async code(target: Opened, procedure: string, view: CodeView): Promise<string> {
    const file = cacheFile(target, procedure, view);
    const cached = await readCachedText(file);
    if (cached !== null) return cached;
    await this.ensureOpen(target.path);
    const reply = await this.call(view === "pseudocode" ? "procedure_pseudo_code" : "procedure_assembly", { procedure });
    const normalized = isRecord(reply) ? reply.normalized_result : undefined;
    const code = (typeof normalized === "string" ? normalized : "").replace(/^\n+|\n+$/g, "");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, code);
    return code;
  }
}

/** Drops the cached assembly, pseudocode and dossiers of a file, so the next read sees a type change. */
export async function forgetCode(sha256: string): Promise<void> {
  const root = join(cacheDir(), sha256, "ghidra");
  await Promise.all(["assembly", "pseudocode", "dossier", "procedures.json", "strings.json", "segments.json"].map((name) => rm(join(root, name), { recursive: true, force: true })));
}

declare global {
  var elevenRea: Rea | undefined;
}

/** Kept on globalThis so `bun --hot` reloads reuse the running REA instead of leaking a Ghidra process each time. */
export const rea = (globalThis.elevenRea ??= new Rea());
