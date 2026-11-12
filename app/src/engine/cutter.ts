import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { isRecord } from "../lib/guards";
import { OS } from "../lib/platform";
import { run, startWith } from "../lib/process";
import { currentSettings, pathSetting } from "../settings/store";

const APP_NAME = "Cutter.app";
/** Cutter 2.4 was the first to bundle a rizin new enough for the commands Eleven sends. */
const OLDEST = [2, 4] as const;

/** The Cutter picked in Settings (the app on macOS, the program elsewhere), else Cutter.app in Applications. */
export function cutterApp(): string | null {
  const chosen = currentSettings().cutterPath;
  if (chosen) return existsSync(chosen) ? chosen : null;
  return [join(homedir(), "Applications", APP_NAME), join("/Applications", APP_NAME)].find(existsSync) ?? null;
}

function cutterVersion(app: string): readonly number[] {
  try {
    const plist = readFileSync(join(app, "Contents", "Info.plist"), "utf8");
    const version = /<key>CFBundleShortVersionString<\/key>\s*<string>(\d+(?:\.\d+)*)/.exec(plist)?.[1] ?? "";
    return version.split(".").map(Number);
  } catch {
    return [];
  }
}

function recentEnough(version: readonly number[]): boolean {
  const [major = 0, minor = 0] = version;
  return major > OLDEST[0] || (major === OLDEST[0] && minor >= OLDEST[1]);
}

/** A rizin and what it needs to run outside the app it came in. */
export type BundledRizin = { readonly program: string; readonly env: Readonly<Record<string, string>>; readonly setup: readonly string[] };

/** Cutter's own rizin, which carries rz-ghidra, so the Rizin engine gets pseudocode with no JVM. */
export function cutterRizin(): BundledRizin | null {
  const app = cutterApp();
  if (!app || !recentEnough(cutterVersion(app))) return null;
  const resources = join(app, "Contents", "Resources");
  const program = join(resources, "bin", "rizin");
  if (!existsSync(program)) return null;
  const sleigh = join(resources, "lib", "rizin", "plugins", "rz_ghidra_sleigh");
  return { program, env: { DYLD_LIBRARY_PATH: join(resources, "lib") }, setup: existsSync(sleigh) ? [`e ghidra.sleighhome=${sleigh}`] : [] };
}

/** Where Cutter looks for Python plugins. */
export function cutterPluginDir(): string {
  switch (OS) {
    case "mac":
      return join(homedir(), "Library", "Application Support", "rizin", "cutter", "plugins", "python");
    case "windows":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "rizin", "cutter", "plugins", "python");
    case "linux":
      return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "rizin", "cutter", "plugins", "python");
    default: {
      const unhandled: never = OS;
      return unhandled;
    }
  }
}

/** REA's Cutter plugin, which lets agents run commands in an open Cutter through REA's Cutter tools. */
function reaBridgePlugin(): string | null {
  const rea = pathSetting("reaPath", "ELEVEN_REA");
  if (!rea) return null;
  const plugin = join(dirname(dirname(rea)), "bridge", "cutter", "rea_bridge.py");
  return existsSync(plugin) ? plugin : null;
}

function installedPlugin(): string {
  return join(cutterPluginDir(), "rea_bridge.py");
}

/** Whether Cutter has REA's plugin, at the version this REA ships. */
export function cutterLinked(): boolean {
  const plugin = reaBridgePlugin();
  try {
    return plugin !== null && readFileSync(installedPlugin(), "utf8") === readFileSync(plugin, "utf8");
  } catch {
    return false;
  }
}

/** Where REA's plugin announces each Cutter it runs in, the same folder REA reads. */
function bridgeDir(): string {
  const configured = process.env.REA_CUTTER_BRIDGE_DIR;
  if (configured) return configured.replace(/^~(?=$|[/\\])/, homedir());
  if (OS === "windows" && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, "REA", "CutterBridge");
  return join(homedir(), ".cache", "rea", "cutter-bridge");
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** How many open Cutters REA's plugin is running in right now, from the sessions it announced. */
export function openCutterSessions(): number {
  try {
    return readdirSync(bridgeDir()).filter((name) => {
      const pid = Number(/^cutter-(\d+)-/.exec(name)?.[1]);
      return name.endsWith(".json") && pid > 0 && running(pid);
    }).length;
  } catch {
    return 0;
  }
}

/** Puts REA's plugin into Cutter, so an agent can work in the Cutter you have open. Cutter picks it up when it next starts. */
export function linkCutter(): void {
  const plugin = reaBridgePlugin();
  if (!plugin) throw new Error("Eleven can't find REA's Cutter plugin. Check REA in Settings, Engines.");
  mkdirSync(cutterPluginDir(), { recursive: true });
  copyFileSync(plugin, installedPlugin());
}

/** The rizin that writes and reads Cutter's projects: Cutter's own when it has one, so the format always matches. */
function projectRizin(): BundledRizin {
  return cutterRizin() ?? { program: pathSetting("rizinPath", "ELEVEN_RIZIN") ?? "rizin", env: {}, setup: [] };
}

/** One argument in rizin's command language. Single quotes keep `;` and `@` as text, and rizin reads `\\` and `\n` back as a backslash and a line break. */
export function rizinQuoted(text: string): string {
  return `'${text.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/'/g, `'"'"'`)}'`;
}

/** A comment as rizin lists it, which escapes backslashes and line breaks, back as plain text. */
export function rizinUnescaped(text: string): string {
  return text.replace(/\\(.)/g, (_, next: string) => (next === "n" ? "\n" : next === "t" ? "\t" : next));
}

/** A name rizin accepts as a flag: no spaces or punctuation it would read as syntax. */
export function rizinName(name: string): string {
  return name.replace(/[^\w.$:-]/g, "_");
}

/** Names and comments to carry between Eleven and Cutter, keyed by address. */
export type Annotations = { readonly names: ReadonlyMap<number, string>; readonly comments: ReadonlyMap<number, string> };

/** The rizin script that applies Eleven's names and comments, then saves the result as a Cutter project. */
export function projectScript(annotations: Annotations, out: string): string {
  const hex = (addr: number): string => `0x${addr.toString(16)}`;
  return [
    "aaa",
    ...[...annotations.names].map(([addr, name]) => `afn ${rizinName(name)} @ ${hex(addr)}`),
    ...[...annotations.comments].flatMap(([addr, text]) => [`CC- @ ${hex(addr)}`, `CC ${rizinQuoted(text)} @ ${hex(addr)}`]),
    `Ps ${rizinQuoted(out)}`,
    "",
  ].join("\n");
}

async function rizinScript(rizin: BundledRizin, args: readonly string[], script: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eleven-cutter-"));
  try {
    const file = join(dir, "script.rz");
    await writeFile(file, [...rizin.setup, script].join("\n"));
    const { stdout } = await run(rizin.program, ["-q", "-e", "scr.color=0", "-i", file, ...args], { env: { ...process.env, ...rizin.env }, maxBuffer: 256 << 20 });
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Writes the binary's analysis with Eleven's names and comments as a Cutter project (.rzdb). */
export async function writeCutterProject(binary: string, annotations: Annotations, out: string): Promise<string> {
  await rizinScript(projectRizin(), [binary], projectScript(annotations, out));
  if (!existsSync(out)) throw new Error("Rizin didn't write the Cutter project. Check that the file still opens in Rizin.");
  return out;
}

function lastJson(stdout: string): readonly unknown[] {
  const line = stdout.split("\n").reverse().find((candidate) => candidate.trim().startsWith("["));
  if (!line) return [];
  const parsed: unknown = JSON.parse(line);
  return Array.isArray(parsed) ? parsed : [];
}

async function readAnnotations(args: readonly string[], analyze: boolean): Promise<Annotations> {
  const rizin = projectRizin();
  const prefix = analyze ? "aaa\n" : "";
  const [functions, comments] = await Promise.all([rizinScript(rizin, args, `${prefix}aflj\n`), rizinScript(rizin, args, `${prefix}CClj\n`)]);
  const names = new Map<number, string>();
  for (const item of lastJson(functions)) {
    const at = isRecord(item) ? (item.offset ?? item.addr) : null;
    if (isRecord(item) && typeof at === "number" && typeof item.name === "string") names.set(at, item.name);
  }
  const notes = new Map<number, string>();
  for (const item of lastJson(comments)) {
    if (isRecord(item) && typeof item.offset === "number" && typeof item.name === "string") notes.set(item.offset, rizinUnescaped(item.name));
  }
  return { names, comments: notes };
}

/** What a Cutter project adds over a fresh analysis of the same binary: the names and comments someone set in Cutter. */
export function changedIn(project: Annotations, fresh: Annotations): Annotations {
  const differs = (map: ReadonlyMap<number, string>, base: ReadonlyMap<number, string>): ReadonlyMap<number, string> => new Map([...map].filter(([addr, value]) => base.get(addr) !== value));
  return { names: differs(project.names, fresh.names), comments: differs(project.comments, fresh.comments) };
}

/** Reads the names and comments from a Cutter project that differ from rizin's own analysis of the binary. */
export async function readCutterProject(project: string, binary: string): Promise<Annotations> {
  const [saved, fresh] = await Promise.all([readAnnotations(["-p", project], false), readAnnotations([binary], true)]);
  return changedIn(saved, fresh);
}

/** Opens a Cutter project in Cutter. */
export function openInCutter(project: string): void {
  const app = cutterApp();
  if (!app) throw new Error("Cutter isn't installed. Install it from cutter.re, or pick it in Settings, Engines.");
  const launch = OS === "mac" ? { file: "open", args: ["-n", "-a", app, "--args", "-p", project] } : { file: app, args: ["-p", project] };
  startWith(launch.file, launch.args, { detached: true, stdio: "ignore" }).unref();
}
