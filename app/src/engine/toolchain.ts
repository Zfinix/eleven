import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { homedir, totalmem } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";

import { activeProvider } from "../analysis/engines";
import { ANALYZE_HEADLESS, exe, jdkLocations, OS } from "../lib/platform";
import { supportPath } from "../lib/support";
import { currentSettings, type Settings } from "../settings/store";
import { runSync } from "../lib/process";
import { newestFirst } from "../lib/version";

const HOME = homedir();

/** Where Eleven puts the Java and Ghidra it downloads for you. */
export function enginesDir(): string {
  return supportPath("engines");
}

const GHIDRA_PARENTS = [
  enginesDir(),
  join(HOME, ".local", "share"),
  join(HOME, "Applications"),
  HOME,
  "/Applications",
  "/opt",
  "/opt/homebrew/Caskroom/ghidra",
  "/usr/local/Caskroom/ghidra",
] as const;

const JDK_GLOBS = jdkLocations(enginesDir());

function children(dir: string): readonly string[] {
  try {
    return readdirSync(dir).map((name) => join(dir, name));
  } catch {
    return [];
  }
}

function readMatch(file: string, pattern: RegExp): string | null {
  try {
    return pattern.exec(readFileSync(file, "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Ghidra's version from its application.properties, else from its folder name (ghidra_12.1.4_PUBLIC). */
export function ghidraVersion(home: string): string | null {
  return readMatch(join(home, "Ghidra", "application.properties"), /application\.version=(\S+)/) ?? basename(home);
}

/** A JDK's version from its release file. Folder names mislead: java-17-openjdk-amd64 ends in 64. */
export function jdkVersion(home: string): string | null {
  return readMatch(join(home, "release"), /JAVA_VERSION="([^"]+)"/);
}

/** The home folder is searched one level deep only: listing Documents or Desktop makes macOS ask for access. */
function ghidraHomes(parent: string): readonly string[] {
  const dirs = parent === HOME ? children(parent) : children(parent).flatMap((dir) => [dir, ...children(dir)]);
  return dirs.filter((dir) => /ghidra_[\d.]+_PUBLIC$/i.test(dir) && existsSync(join(dir, "support", ANALYZE_HEADLESS)));
}

export function findGhidra(): string | null {
  return GHIDRA_PARENTS.flatMap(ghidraHomes).sort(newestFirst(ghidraVersion))[0] ?? null;
}

function findJdk(): string | null {
  const homes = JDK_GLOBS.flatMap(([parent, suffix]) => children(parent).map((dir) => (suffix ? join(dir, suffix) : dir)));
  return homes.filter((home) => existsSync(join(home, "bin", exe("java")))).sort(newestFirst(jdkVersion))[0] ?? null;
}

/** Bun formats dates in UTC unless TZ is set, so take the Mac's own zone from /etc/localtime. */
function localZone(): string | null {
  try {
    return /zoneinfo\/(.+)$/.exec(readlinkSync("/etc/localtime"))?.[1] ?? null;
  } catch {
    return null;
  }
}

const RESOURCES = join(dirname(process.execPath), "..", "Resources");

const BUNDLED_NODE = [join(RESOURCES, "node", "bin", exe("node")), join(RESOURCES, "node", exe("node"))].find((path) => existsSync(path)) ?? "";

const RIZINS = [join(RESOURCES, "rizin", "bin", exe("rizin")), "/opt/homebrew/bin/rizin", "/usr/local/bin/rizin", "/usr/bin/rizin"] as const;

/** The Rizin inside Eleven.app, else one already on this Mac. */
function findRizin(): string | null {
  return RIZINS.find((path) => existsSync(path)) ?? null;
}

const BUNDLED_NPX = [join(RESOURCES, "node", "lib", "node_modules", "npm", "bin", "npx-cli.js"), join(RESOURCES, "node", "node_modules", "npm", "bin", "npx-cli.js")].find((path) => existsSync(path)) ?? "";

/** How to run npx: the user's own, else the npm that ships inside Eleven, so npx agents start with nothing installed. */
export function npxCommand(): { readonly command: string; readonly args: readonly string[] } {
  const own = findOnPathOf(OS === "windows" ? "npx.cmd" : "npx");
  if (own || !BUNDLED_NPX) return { command: own ?? "npx", args: [] };
  return { command: nodeCommand(), args: [BUNDLED_NPX] };
}

function findOnPathOf(name: string): string | null {
  return (process.env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, name)).find((path) => existsSync(path)) ?? null;
}

/** The Node that runs REA: the one inside Eleven.app when it ships one, otherwise the user's. */
export function nodeCommand(): string {
  return BUNDLED_NODE || "node";
}

const MIN_REA_MAJOR = 6;

const REA_CHECKOUTS = [
  join(dirname(process.execPath), "..", "Resources", "rea", "scripts", "rea.mjs"),
  join(import.meta.dir, "..", "..", "..", "..", "rea", "scripts", "rea.mjs"),
] as const;

function reaMajor(command: string, args: readonly string[]): number {
  try {
    const version = runSync(command, [...args, "--version"], { timeout: 15000 }).trim();
    return Number(version.split(".")[0]) || 0;
  } catch {
    return 0;
  }
}

/** REA 6+ runs Ghidra on Apple Silicon; older `rea` builds on PATH refuse it, so a fork checkout wins over them. */
function findRea(): string | null {
  const checkout = REA_CHECKOUTS.find((path) => existsSync(path) && reaMajor(nodeCommand(), [path]) >= MIN_REA_MAJOR);
  if (checkout) return checkout;
  return reaMajor("rea", []) >= MIN_REA_MAJOR ? "rea" : null;
}

const DEFAULT_SKIPPED = ["Decompiler Parameter ID", "Decompiler Switch Analysis", "Aggressive Instruction Finder"] as const;

function ghidraMemory(choice: Settings["ghidraMemory"]): string | null {
  switch (choice) {
    case "Automatic":
      return null;
    case "2 GB":
      return "2G";
    case "4 GB":
      return "4G";
    case "8 GB":
      return "8G";
    case "16 GB":
      return "16G";
    case "32 GB":
      return "32G";
    case "64 GB":
      return "64G";
    default: {
      const unhandled: never = choice;
      return unhandled;
    }
  }
}

function skippedAnalyzers(settings: Settings): string | null {
  const wanted = [settings.findParameters, settings.rebuildSwitches, settings.hiddenCode];
  if (wanted.every((on) => !on)) return null;
  return DEFAULT_SKIPPED.filter((_name, ix) => !wanted[ix]).join(",");
}

/** Fills in GHIDRA_INSTALL_DIR, JAVA_HOME and ELEVEN_REA from the usual spots, so a Finder launch can still reach Ghidra. */
export function adoptToolchain(): void {
  const settings = currentSettings();
  const ghidra = settings.ghidraDir || INHERITED.GHIDRA_INSTALL_DIR || findGhidra();
  const jdk = settings.javaHome || INHERITED.JAVA_HOME || findJdk();
  setEnv("GHIDRA_INSTALL_DIR", ghidra);
  setEnv("JAVA_HOME", jdk);
  const zone = localZone();
  if (!process.env.TZ && zone) process.env.TZ = zone;
  const memory = ghidraMemory(currentSettings().ghidraMemory);
  if (memory) process.env.GHIDRA_HEADLESS_MAXMEM = memory;
  else if (!process.env.GHIDRA_HEADLESS_MAXMEM && !process.env.GHIDRA_MAXMEM) {
    const gb = Math.max(2, Math.min(4, Math.floor(totalmem() / 1024 ** 3 / 4)));
    process.env.GHIDRA_HEADLESS_MAXMEM = `${gb}G`;
  }
  const skipped = skippedAnalyzers(currentSettings());
  if (skipped !== null) process.env.REA_GHIDRA_DISABLED_ANALYZERS = skipped;
  else if (process.env.REA_GHIDRA_DISABLED_ANALYZERS === undefined) process.env.REA_GHIDRA_DISABLED_ANALYZERS = DEFAULT_SKIPPED.join(",");
  setEnv("REA_ANALYSIS_PROVIDER", activeProvider() ?? INHERITED.REA_ANALYSIS_PROVIDER ?? "ghidra");
  setEnv("ELEVEN_REA", settings.reaPath || INHERITED.ELEVEN_REA || findRea());
  setEnv("ELEVEN_RIZIN", settings.rizinPath || INHERITED.ELEVEN_RIZIN || findRizin());
  setEnv("ELEVEN_LLDB_DAP", settings.lldbDap || INHERITED.ELEVEN_LLDB_DAP);
  setEnv("ELEVEN_EXPORT_DIR", settings.exportDir || INHERITED.ELEVEN_EXPORT_DIR);
  if (BUNDLED_NODE && !(process.env.PATH ?? "").includes(dirname(BUNDLED_NODE))) process.env.PATH = [process.env.PATH, dirname(BUNDLED_NODE)].filter(Boolean).join(delimiter);
}

const INHERITED: Readonly<Record<string, string | undefined>> = { ...process.env };

/** Sets or clears a variable, so resetting a folder in Settings takes effect without a restart. */
function setEnv(name: string, value: string | null | undefined): void {
  if (value) process.env[name] = value;
  else delete process.env[name];
}
