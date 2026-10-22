import { existsSync, mkdirSync, rmSync } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { findOnPath } from "../agents/detect";
import { pathSetting } from "../settings/store";
import { listOf, type PlainId, t, thisDevice } from "../i18n";
import { errorMessage, isRecord } from "../lib/guards";
import { engineArrived } from "../analysis/engines";
import { adoptToolchain, enginesDir } from "../engine/toolchain";
import { OS, unzip } from "../lib/platform";
import { ghidraHome, javaCheck, jdkHome } from "./checks";
import { buildDecompiler, hasDecompiler } from "./decompiler";
import { run, start } from "../lib/process";

const BREW_PATHS = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"] as const;
const RIZIN_PATHS = ["/opt/homebrew/bin/rizin", "/usr/local/bin/rizin"] as const;
const GHIDRA_RELEASE = "https://api.github.com/repos/NationalSecurityAgency/ghidra/releases/latest";
const ADOPTIUM_OS: Readonly<Record<typeof OS, string>> = { mac: "mac", linux: "linux", windows: "windows" };
const TEMURIN = `https://api.adoptium.net/v3/binary/latest/21/ga/${ADOPTIUM_OS[OS]}/${process.arch === "arm64" ? "aarch64" : "x64"}/jdk/hotspot/normal/eclipse`;

export type EngineId = "rizin" | "ghidra" | "java";

/** `repair` is set when the engine is here but a part of it is missing. */
export type Found = { readonly found: boolean; readonly where: string; readonly repair?: string };

export type Install =
  | { readonly phase: "idle" }
  | { readonly phase: "done" }
  | { readonly phase: "running"; readonly progress: number | null; readonly note: string }
  | { readonly phase: "failed"; readonly message: string };

export type RowState = "ready" | "missing" | "installing" | "failed";

export type Engine = {
  readonly id: EngineId;
  readonly name: string;
  readonly tag: PlainId | null;
  readonly megabytes: number;
  readonly about: PlainId;
  readonly logo: string | null;
  readonly needs: readonly EngineId[];
};

export const ENGINES: readonly Engine[] = [
  { id: "rizin", name: "Rizin", tag: "setup.engine.rizin.tag", megabytes: 38, about: "setup.engine.rizin", logo: "rizin.svg", needs: ["rizin"] },
  { id: "ghidra", name: "Ghidra 12.1", tag: null, megabytes: 512, about: "setup.engine.ghidra", logo: "ghidra.png", needs: ["ghidra", "java"] },
  { id: "java", name: "Java 21", tag: null, megabytes: 196, about: "setup.engine.java", logo: "java.svg", needs: ["java"] },
];

export function engineNames(ids: readonly EngineId[]): string {
  return listOf(ids.map((id) => engineNamed(id).name));
}

export function engineNamed(id: EngineId): Engine {
  const engine = ENGINES.find((item) => item.id === id);
  if (!engine) throw new Error(`Unknown engine ${id}`);
  return engine;
}

export function rowState(found: Found | null, install: Install): RowState {
  if (install.phase === "running") return "installing";
  if (found?.found) return "ready";
  return install.phase === "failed" ? "failed" : "missing";
}

/** Rizin is enough to start, so analysis is ready once either engine is. */
export function engineReady(found: Readonly<Record<EngineId, Found | null>>): boolean {
  return found.rizin?.found === true || (found.ghidra?.found === true && found.java?.found === true);
}

function brewPath(): string | null {
  return findOnPath("brew") ?? BREW_PATHS.find(existsSync) ?? null;
}

function rizinPath(): string | null {
  return pathSetting("rizinPath", "ELEVEN_RIZIN") ?? findOnPath("rizin") ?? RIZIN_PATHS.find(existsSync) ?? null;
}

function tilde(path: string): string {
  return path.replace(homedir(), "~");
}

export function detectEngine(id: EngineId): Found {
  switch (id) {
    case "rizin": {
      const path = rizinPath();
      return path ? { found: true, where: tilde(path) } : { found: false, where: "" };
    }
    case "ghidra": {
      const home = ghidraHome();
      if (!home) return { found: false, where: "" };
      return hasDecompiler(home) ? { found: true, where: tilde(home) } : { found: false, where: tilde(home), repair: t("setup.engine.repairNeeded", { device: thisDevice() }) };
    }
    case "java": {
      const home = jdkHome();
      return home && javaCheck().status === "ok" ? { found: true, where: tilde(home) } : { found: false, where: "" };
    }
    default: {
      const unhandled: never = id;
      return unhandled;
    }
  }
}

type Listener = () => void;

let installs: Readonly<Record<EngineId, Install>> = { rizin: { phase: "idle" }, ghidra: { phase: "idle" }, java: { phase: "idle" } };
const pending = new Map<EngineId, Promise<void>>();
const listeners = new Set<Listener>();

export function currentInstalls(): Readonly<Record<EngineId, Install>> {
  return installs;
}

export function subscribeInstalls(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function setInstall(id: EngineId, next: Install): void {
  installs = { ...installs, [id]: next };
  listeners.forEach((listener) => listener());
}

function lastLine(text: string): string | null {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? null;
}

async function brewInstall(id: EngineId, formula: string, note: string): Promise<void> {
  const brew = brewPath();
  if (!brew) throw new Error(t("setup.error.brew"));
  setInstall(id, { phase: "running", progress: null, note });
  const child = start(brew, ["install", formula], { env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: "1", HOMEBREW_NO_ENV_HINTS: "1" } });
  const watch = (chunk: Buffer): void => {
    const line = lastLine(chunk.toString());
    if (!line) return;
    setInstall(id, { phase: "running", progress: null, note: line.replace(/^==>\s*/, "") });
  };
  child.stdout.on("data", watch);
  child.stderr.on("data", watch);
  const code = await new Promise<number | null>((resolve) => {
    child.once("error", () => resolve(null));
    child.once("close", resolve);
  });
  if (code !== 0) throw new Error(t("setup.engine.stopped"));
}

async function ghidraAsset(): Promise<string> {
  const response = await fetch(GHIDRA_RELEASE, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(t("setup.engine.stopped"));
  const release: unknown = await response.json();
  const assets = isRecord(release) && Array.isArray(release.assets) ? release.assets : [];
  for (const asset of assets) {
    if (isRecord(asset) && typeof asset.name === "string" && typeof asset.browser_download_url === "string" && /^ghidra_.*_PUBLIC_.*\.zip$/.test(asset.name)) return asset.browser_download_url;
  }
  throw new Error(t("setup.error.noGhidraDownload"));
}

async function downloadTo(id: EngineId, url: string, file: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(t("setup.engine.stopped"));
  const total = Number(response.headers.get("content-length")) || 0;
  let received = 0;
  const out = await open(file, "w");
  const reader = response.body.getReader();
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      await out.write(chunk.value);
      received += chunk.value.length;
      setInstall(id, { phase: "running", progress: total > 0 ? Math.min(0.99, received / total) : null, note: t("setup.note.downloading") });
    }
  } finally {
    await out.close();
  }
}

/** Temurin's Java 21 JDK, straight from Adoptium into Eleven's own folder: no Homebrew, no password. */
async function installJava(): Promise<void> {
  const dir = enginesDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, OS === "windows" ? "java-download.zip" : "java-download.tar.gz");
  setInstall("java", { phase: "running", progress: null, note: t("setup.note.starting") });
  try {
    await downloadTo("java", TEMURIN, file);
    setInstall("java", { phase: "running", progress: null, note: t("setup.note.unpacking") });
    if (OS === "windows") await unzip(file, dir);
    else await run("tar", ["-xzf", file, "-C", dir], { timeout: 300000, maxBuffer: 1 << 24 });
  } finally {
    rmSync(file, { force: true });
  }
}

async function installGhidra(): Promise<void> {
  if (javaCheck().status !== "ok") await startInstall("java");
  if (javaCheck().status !== "ok") throw new Error(t("setup.error.javaMissing"));
  if (!ghidraHome()) await downloadGhidra();
  const home = ghidraHome();
  if (!home) throw new Error(t("setup.error.unpack"));
  if (hasDecompiler(home)) return;
  setInstall("ghidra", { phase: "running", progress: null, note: t("setup.note.building", { device: thisDevice() }) });
  await buildDecompiler(home);
}

async function downloadGhidra(): Promise<void> {
  setInstall("ghidra", { phase: "running", progress: null, note: t("setup.note.finding") });
  const url = await ghidraAsset();
  const dir = enginesDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "ghidra-download.zip");
  try {
    await downloadTo("ghidra", url, file);
    setInstall("ghidra", { phase: "running", progress: null, note: t("setup.note.unpacking") });
    await unzip(file, dir);
  } finally {
    rmSync(file, { force: true });
  }
}

async function installEngine(id: EngineId): Promise<void> {
  switch (id) {
    case "rizin":
      if (OS !== "mac") throw new Error(t("setup.error.rizinBundled"));
      return brewInstall("rizin", "rizin", t("setup.note.starting"));
    case "ghidra":
      return installGhidra();
    case "java":
      return installJava();
    default: {
      const unhandled: never = id;
      return unhandled;
    }
  }
}

async function runInstall(id: EngineId): Promise<void> {
  try {
    await installEngine(id);
    adoptToolchain();
    setInstall(id, { phase: "done" });
    if (id === "ghidra" || id === "rizin") engineArrived(id);
  } catch (err) {
    setInstall(id, { phase: "failed", message: errorMessage(err) });
  } finally {
    pending.delete(id);
  }
}

/** Runs on in the background after the screen moves on; the state lives here, not in a component. */
export function startInstall(id: EngineId): Promise<void> {
  const running = pending.get(id);
  if (running) return running;
  const next = runInstall(id);
  pending.set(id, next);
  return next;
}
