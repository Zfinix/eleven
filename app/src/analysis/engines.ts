import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import { supportPath } from "../lib/support";
import { currentSettings } from "../settings/store";

export type ProviderId = "ghidra" | "hopper" | "ida";

export type EngineId = ProviderId | "rizin" | "r2ghidra" | "libghidra" | "ghidra-rs" | "ghidrust" | "sleigh";

export type EngineStatus = "ready" | "experimental";

/** How Eleven reads a binary with this engine: through REA's providers, or the native rizin backend. */
export type BackendId = "rea" | "rizin";

export type Engine = {
  readonly id: EngineId;
  readonly name: string;
  readonly blurb: string;
  readonly repo: string;
  /** ready = Eleven can read with it today; experimental = installable, not wired yet. */
  readonly status: EngineStatus;
  readonly backend: BackendId;
  /** The REA provider this maps to (REA backend only), else null. */
  readonly provider: ProviderId | null;
  readonly getHint: string;
  readonly installed: () => boolean;
};

function hopperInstalled(): boolean {
  const chosen = currentSettings().hopperPath;
  if (chosen) return existsSync(chosen);
  return [join(homedir(), "Applications"), "/Applications"].some((dir) => existsSync(join(dir, "Hopper Disassembler.app", "Contents", "MacOS", "hopper")));
}

export function rizinInstalled(): boolean {
  const chosen = currentSettings().rizinPath || process.env.ELEVEN_RIZIN;
  return chosen ? existsSync(chosen) : onPath("rizin");
}

function onPath(bin: string): boolean {
  const dirs = (process.env.PATH ?? "").split(delimiter).concat("/opt/homebrew/bin", "/usr/local/bin");
  return dirs.some((dir) => dir && existsSync(join(dir, bin)));
}

/** The engine store: backends Eleven can read binaries with. Each is a separate download; turn the ones you want on. */
export const ENGINES: readonly Engine[] = [
  { id: "ghidra", name: "Ghidra", blurb: "Open-source, every architecture, deep decompiler. Runs on the JVM, so it is slower to open.", repo: "https://ghidra-sre.org", status: "ready", backend: "rea", provider: "ghidra", getHint: "Download Ghidra and set GHIDRA_INSTALL_DIR to it.", installed: () => !!process.env.GHIDRA_INSTALL_DIR && existsSync(process.env.GHIDRA_INSTALL_DIR) },
  { id: "rizin", name: "Rizin", blurb: "Native, no JVM. Opens in under a second: functions, strings, segments, bytes, disassembly. Add rz-ghidra or jsdec for pseudocode.", repo: "https://rizin.re", status: "ready", backend: "rizin", provider: null, getHint: "Eleven ships with Rizin.", installed: rizinInstalled },
  { id: "hopper", name: "Hopper", blurb: "Native macOS, fast on Mach-O. A paid app you install yourself.", repo: "https://www.hopperapp.com", status: "ready", backend: "rea", provider: "hopper", getHint: "Install Hopper Disassembler into Applications.", installed: hopperInstalled },
  { id: "ida", name: "IDA", blurb: "Industry standard, deepest analysis. Needs your own license.", repo: "https://hex-rays.com/ida-pro", status: "ready", backend: "rea", provider: "ida", getHint: "Set REA_IDA_MCP_CONFIG to your IDA MCP registration.", installed: () => !!process.env.REA_IDA_MCP_CONFIG || (!!currentSettings().idaPath && existsSync(currentSettings().idaPath)) },
  { id: "r2ghidra", name: "r2ghidra", blurb: "Adds Ghidra's native decompiler (pdg) to Rizin for Ghidra-quality pseudocode, no JVM.", repo: "https://github.com/rizinorg/rz-ghidra", status: "experimental", backend: "rizin", provider: null, getHint: "Build rz-ghidra from the rizinorg tap.", installed: () => false },
  { id: "libghidra", name: "libghidra", blurb: "Embeds Ghidra's SLEIGH and decompiler natively. No Java, no network.", repo: "https://github.com/0xeb/libghidra", status: "experimental", backend: "rizin", provider: null, getHint: "Build libghidra from source.", installed: () => false },
  { id: "ghidra-rs", name: "Ghidra (Rust port)", blurb: "koute's pure-Rust port of the Ghidra decompiler.", repo: "https://github.com/koute/ghidra-decompiler", status: "experimental", backend: "rizin", provider: null, getHint: "Clone and cargo build the port.", installed: () => false },
  { id: "ghidrust", name: "Ghidrust", blurb: "From-scratch Rust: IR to SSA to typed C. No JVM.", repo: "https://github.com/oofz/Ghidrust", status: "experimental", backend: "rizin", provider: null, getHint: "Clone and cargo build Ghidrust.", installed: () => false },
  { id: "sleigh", name: "SLEIGH (Rust)", blurb: "Ghidra's SLEIGH in Rust via jingle_sleigh/libsla: disassembly and P-code, not pseudocode yet.", repo: "https://crates.io/crates/jingle_sleigh", status: "experimental", backend: "rizin", provider: null, getHint: "cargo add jingle_sleigh or libsla.", installed: () => false },
];

const ENGINE_IDS = new Set<string>(ENGINES.map((e) => e.id));

function enabledFile(): string {
  return supportPath("engines-enabled.json");
}

function defaultEnabled(): readonly EngineId[] {
  return ENGINES.filter((e) => e.status === "ready" && e.installed()).map((e) => e.id);
}

/** The engines the user has turned on. Defaults to every installed, ready engine until they choose. */
export function enabledEngines(): ReadonlySet<EngineId> {
  try {
    const saved: unknown = JSON.parse(readFileSync(enabledFile(), "utf8"));
    if (Array.isArray(saved)) return new Set(saved.filter((id): id is EngineId => typeof id === "string" && ENGINE_IDS.has(id)));
  } catch {
    // nothing saved yet
  }
  return new Set(defaultEnabled());
}

export function isEnabled(id: EngineId): boolean {
  return enabledEngines().has(id);
}

export function setEnabled(id: EngineId, on: boolean): void {
  const next = new Set(enabledEngines());
  if (on) next.add(id);
  else next.delete(id);
  mkdirSync(dirname(enabledFile()), { recursive: true });
  writeFileSync(enabledFile(), `${JSON.stringify([...next])}\n`);
}

function preferredFile(): string {
  return supportPath("engine-preferred.json");
}

function preferredEngine(): EngineId | null {
  try {
    const saved: unknown = JSON.parse(readFileSync(preferredFile(), "utf8"));
    return typeof saved === "string" && ENGINE_IDS.has(saved) ? ENGINES.find((e) => e.id === saved)?.id ?? null : null;
  } catch {
    return null;
  }
}

const engineListeners = new Set<() => void>();

/** Makes an engine the one Eleven reads with, turning it on, and tells open views to re-read. */
export function chooseEngine(id: EngineId): void {
  setEnabled(id, true);
  mkdirSync(dirname(preferredFile()), { recursive: true });
  writeFileSync(preferredFile(), `${JSON.stringify(id)}\n`);
  for (const listener of engineListeners) listener();
}

/** An engine Eleven just downloaded: turn it on and let open views read with it, unless you picked one yourself. */
export function engineArrived(id: EngineId): void {
  setEnabled(id, true);
  if (preferredEngine() !== null) return;
  for (const listener of engineListeners) listener();
}

export function onEngineChange(listener: () => void): () => void {
  engineListeners.add(listener);
  return () => {
    engineListeners.delete(listener);
  };
}

/** The engine Eleven reads with right now: the one you chose if it's usable, else the first turned-on, ready, installed one. */
export function activeEngine(): Engine | null {
  const on = enabledEngines();
  const usable = (e: Engine): boolean => e.status === "ready" && e.installed() && on.has(e.id);
  const chosen = ENGINES.find((e) => e.id === preferredEngine());
  return chosen && usable(chosen) ? chosen : (ENGINES.find(usable) ?? null);
}

export function activeProvider(): ProviderId | null {
  return activeEngine()?.provider ?? null;
}

export function activeBackend(): BackendId | null {
  return activeEngine()?.backend ?? null;
}
