import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { deleteThread, listThreads } from "../chat/history";
import { RECORDINGS_DIR } from "../gpu/trace";
import { t } from "../i18n";
import { supportPath } from "../lib/support";
import { currentSettings } from "./store";
import { cacheRoot, copyToClipboard, exe, trash } from "../lib/platform";
import { run } from "../lib/process";


export const PROJECTS_DIR = supportPath("projects");
export const THREADS_DIR = supportPath("threads");
export const DEFAULT_CACHE_DIR = join(cacheRoot(), "analysis");

export function cacheDir(): string {
  return currentSettings().cacheDir || DEFAULT_CACHE_DIR;
}

export function folderBytes(path: string): number {
  try {
    const info = statSync(path);
    if (!info.isDirectory()) return info.size;
    return readdirSync(path).reduce((sum, name) => sum + folderBytes(join(path, name)), 0);
  } catch {
    return 0;
  }
}

export function sizeText(bytes: number): string {
  if (bytes === 0) return t("settings.size.empty");
  if (bytes < 1000) return t("settings.size.bytes", { count: bytes });
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${unit >= 2 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function projectCount(): number {
  try {
    return readdirSync(PROJECTS_DIR).filter((name) => name.endsWith(".json") && name !== "index.json").length;
  } catch {
    return 0;
  }
}

export function clearFolder(path: string): void {
  if (!existsSync(path)) return;
  for (const name of readdirSync(path)) rmSync(join(path, name), { recursive: true, force: true });
}

export function deleteAllChats(): void {
  for (const thread of listThreads()) deleteThread(thread.id);
}

export function clearRecordings(): void {
  clearFolder(RECORDINGS_DIR);
}

/** Moves a file or folder to the Trash, so removing an engine can be undone from Finder. */
export async function moveToTrash(path: string): Promise<boolean> {
  try {
    return await trash(path);
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<void> {
  await copyToClipboard(text);
}

export type Release = { readonly version: string; readonly url: string };

/** The newest release of a GitHub project, or null when GitHub can't be reached. */
export async function latestRelease(repo: string, beta = false): Promise<Release | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases${beta ? "?per_page=1" : "/latest"}`, { headers: { accept: "application/vnd.github+json" } });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    const release: unknown = Array.isArray(json) ? json[0] : json;
    if (typeof release !== "object" || release === null) return null;
    const tag = "tag_name" in release && typeof release.tag_name === "string" ? release.tag_name : "";
    const url = "html_url" in release && typeof release.html_url === "string" ? release.html_url : `https://github.com/${repo}/releases`;
    const version = /\d+(\.\d+)+/.exec(tag)?.[0] ?? "";
    return version ? { version, url } : null;
  } catch {
    return null;
  }
}

export async function rizinVersion(program: string): Promise<string | null> {
  try {
    const { stdout } = await run(program, ["-v"]);
    return /\d+\.\d+(\.\d+)?/.exec(stdout)?.[0] ?? null;
  } catch {
    return null;
  }
}

export function ghidraVersion(folder: string): string | null {
  try {
    return /application\.version=(\S+)/.exec(readFileSync(join(folder, "Ghidra", "application.properties"), "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function javaVersion(home: string): Promise<string | null> {
  try {
    const { stderr } = await run(join(home, "bin", exe("java")), ["-version"]);
    return /version "(\d+)/.exec(stderr)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function reaVersion(program: string): Promise<string | null> {
  try {
    const { stdout } = await run(program, ["--version"]);
    return /\d+\.\d+\.\d+/.exec(stdout)?.[0] ?? null;
  } catch {
    return null;
  }
}
