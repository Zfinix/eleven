import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";

import { findOnPath } from "../agents/detect";
import { reaLaunch } from "../engine/rea";
import { currentSettings, type PathKey, pathSetting } from "./store";
import { choosePath, openExternal, reveal } from "../lib/platform";
import packageJson from "../../package.json";

export type Found =
  | { readonly kind: "found"; readonly path: string; readonly source: string }
  | { readonly kind: "missing"; readonly fix: string };

export function tildePath(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export function showInFinder(path: string): void {
  reveal(path);
}

export function openLink(url: string): void {
  openExternal(url);
}

function fromEnv(key: PathKey, name: string, fix: string): Found {
  const path = pathSetting(key, name);
  if (path && existsSync(path)) return { kind: "found", path, source: currentSettings()[key] ? "Chosen in Settings" : "In use" };
  return { kind: "missing", fix };
}

export function findGhidraFolder(): Found {
  return fromEnv("ghidraDir", "GHIDRA_INSTALL_DIR", "Install Ghidra from Settings → Engines, or choose its folder here.");
}

export function findJavaFolder(): Found {
  return fromEnv("javaHome", "JAVA_HOME", "Install a Java 21 JDK, for example with brew install openjdk@21, or choose its folder here.");
}

function reaProgram(): string {
  const { command, args } = reaLaunch();
  return command === "node" ? (args[0] ?? command) : command;
}

export function findRea(): Found {
  const program = reaProgram();
  const source = currentSettings().reaPath ? "Chosen in Settings" : process.env.ELEVEN_REA ? "Set by ELEVEN_REA" : "Found on your PATH";
  const path = isAbsolute(program) ? (existsSync(program) ? program : null) : findOnPath(program);
  if (path) return { kind: "found", path, source };
  return { kind: "missing", fix: "Install REA so the rea command works in Terminal, or choose it here." };
}

/** Built into the app when it's compiled, so it's right on every system. */
export function appVersion(): string {
  return packageJson.version;
}


/** Asks for a folder or a file with the system's own dialog; null when you cancel. */
export function pickPath(kind: "folder" | "file", prompt: string): Promise<string | null> {
  return choosePath(kind, prompt);
}
