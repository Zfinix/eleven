import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { reaLaunch } from "../engine/rea";
import { enginesDir, ghidraVersion, jdkVersion } from "../engine/toolchain";
import { ANALYZE_HEADLESS, cacheRoot, exe, jdkLocations, THIS_DEVICE } from "../lib/platform";
import { run } from "../lib/process";
import { newestFirst, versionIn } from "../lib/version";
import { hasDecompiler } from "./decompiler";

const HOME = homedir();
const MIN_JAVA = 21;

export type CheckStatus = "checking" | "ok" | "info" | "problem";

export type Check = { readonly key: string; readonly status: CheckStatus; readonly title: string; readonly detail: string };

const GHIDRA_PARENTS = [enginesDir(), join(HOME, ".local", "share"), join(HOME, "Applications"), HOME, "/Applications", "/opt", "/opt/homebrew/Caskroom/ghidra", "/usr/local/Caskroom/ghidra"] as const;

const JDK_HOMES = jdkLocations(enginesDir());

export const PENDING: readonly Check[] = [
  { key: "ghidra", status: "checking", title: "Ghidra", detail: `Looking on ${THIS_DEVICE}` },
  { key: "java", status: "checking", title: "Java", detail: `Looking on ${THIS_DEVICE}` },
  { key: "rea", status: "checking", title: "REA", detail: `Looking on ${THIS_DEVICE}` },
  cacheCheck(),
];

function children(dir: string): readonly string[] {
  try {
    return readdirSync(dir).map((name) => join(dir, name));
  } catch {
    return [];
  }
}

function tildify(path: string): string {
  return path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path;
}

export function ghidraHome(): string | null {
  const fromEnv = process.env.GHIDRA_INSTALL_DIR;
  if (fromEnv && existsSync(join(fromEnv, "support", ANALYZE_HEADLESS))) return fromEnv;
  const homes = GHIDRA_PARENTS.flatMap((parent) => children(parent).flatMap((dir) => [dir, ...children(dir)]));
  return homes.filter((dir) => /ghidra_[\d.]+_PUBLIC$/i.test(dir) && existsSync(join(dir, "support", ANALYZE_HEADLESS))).sort(newestFirst(ghidraVersion))[0] ?? null;
}

function ghidraCheck(): Check {
  const home = ghidraHome();
  if (!home) return { key: "ghidra", status: "problem", title: "Ghidra not found", detail: "Install Ghidra 12 or set GHIDRA_INSTALL_DIR, then restart Eleven." };
  const version = versionIn(ghidraVersion(home))?.version;
  const title = version ? `Ghidra ${version}` : "Ghidra";
  if (!hasDecompiler(home)) return { key: "ghidra", status: "problem", title, detail: `${tildify(home)} has no decompiler for ${THIS_DEVICE}, so code won't show. Install Ghidra in Setup to build it.` };
  return { key: "ghidra", status: "ok", title, detail: `${tildify(home)} with its decompiler` };
}

export function jdkHome(): string | null {
  const fromEnv = process.env.JAVA_HOME;
  if (fromEnv && existsSync(join(fromEnv, "bin", exe("java")))) return fromEnv;
  const homes = JDK_HOMES.flatMap(([parent, suffix]) => children(parent).map((dir) => join(dir, suffix)));
  return homes.filter((home) => existsSync(join(home, "bin", exe("java")))).sort(newestFirst(jdkVersion))[0] ?? null;
}

/** Java 8 and older report themselves as 1.x. */
function javaMajor(home: string): number | null {
  const version = versionIn(jdkVersion(home));
  if (version === null) return null;
  return version.major === 1 ? version.minor : version.major;
}

export function javaCheck(): Check {
  const home = jdkHome();
  if (!home) return { key: "java", status: "problem", title: "Java not found", detail: `Install a JDK ${MIN_JAVA} or newer, then restart Eleven.` };
  const major = javaMajor(home);
  const title = major === null ? "Java" : `Java ${major}`;
  if (major !== null && major < MIN_JAVA) return { key: "java", status: "problem", title, detail: `Ghidra needs Java ${MIN_JAVA} or newer. Install a newer JDK, then restart Eleven.` };
  if (!existsSync(join(home, "bin", exe("javac")))) return { key: "java", status: "problem", title, detail: "Only a Java runtime was found. Ghidra needs the full JDK." };
  return { key: "java", status: "ok", title, detail: "Full JDK found. Eleven will ship its own later." };
}

async function reaCheck(): Promise<Check> {
  const { command, args } = reaLaunch();
  try {
    const { stdout } = await run(command, [...args.filter((arg) => arg !== "mcp"), "--version"], { timeout: 15000 });
    const version = stdout.match(/\d+(\.\d+)+/)?.[0];
    return { key: "rea", status: "ok", title: version ? `REA ${version}` : "REA", detail: "Analysis tools ready" };
  } catch {
    return { key: "rea", status: "problem", title: "REA not found", detail: "Install it with npm install -g rea-agents, then restart Eleven." };
  }
}

function cacheCheck(): Check {
  return { key: "cache", status: "info", title: "Cache", detail: `${cacheRoot().replace(homedir(), "~")}. Files you opened before load instantly.` };
}

export async function runChecks(): Promise<readonly Check[]> {
  return [ghidraCheck(), javaCheck(), await reaCheck(), cacheCheck()];
}
