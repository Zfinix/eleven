import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";

import { getLanguage, t } from "../i18n";
import { type RecentOpen, recentOpens } from "./store";
import { STARTER_FILES } from "../lib/platform";
import { runSync } from "../lib/process";

export type FileKind = "app" | "binary" | "gpu" | "model";

export type RecentFile = {
  readonly path: string;
  readonly name: string;
  readonly where: string;
  readonly kind: FileKind;
  readonly arch: string;
  readonly when: string;
};

const ROWS = 4;
const HOME = homedir();
const DAY_MS = 24 * 60 * 60 * 1000;
const HOST_SLICES = process.arch === "arm64" ? (["arm64e", "arm64"] as const) : (["x86_64h", "x86_64"] as const);
const STARTERS = STARTER_FILES;

function tool(command: string, args: readonly string[]): string {
  try {
    return runSync(command, [...args], { stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function isApp(path: string): boolean {
  try {
    return path.endsWith(".app") && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function kindOf(path: string): FileKind {
  if (isApp(path)) return "app";
  if (/\.(metallib|spv|air|ptx|cubin|fatbin|hipfb|hsaco|co)$/i.test(path)) return "gpu";
  if (/\.(mlmodelc|gguf|safetensors|onnx|pt|tflite)$/i.test(path)) return "model";
  return "binary";
}

function executableOf(path: string): string {
  if (!isApp(path)) return path;
  const name = tool("plutil", ["-extract", "CFBundleExecutable", "raw", join(path, "Contents", "Info.plist")]);
  return name ? join(path, "Contents", "MacOS", name) : path;
}

/** The architectures inside a Mach-O file or an app's main executable. Empty for anything else. */
export function archsOf(path: string): readonly string[] {
  return tool("lipo", ["-archs", executableOf(path)]).split(/\s+/).filter(Boolean);
}

export function hostSlice(archs: readonly string[]): string | null {
  return HOST_SLICES.find((arch) => archs.includes(arch)) ?? null;
}

function tildify(path: string): string {
  return path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path;
}

function whereOf(path: string): string {
  const inBundle = /\.app\//.test(path);
  const shown = inBundle ? dirname(path) : path;
  return tildify(shown.replace(/^\/Applications\//, ""));
}

function staticArch(kind: FileKind, path: string): string | null {
  switch (kind) {
    case "gpu":
      return "AIR";
    case "model":
      return extname(path).slice(1).toUpperCase();
    case "app":
    case "binary":
      return null;
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

function archLabel(kind: FileKind, path: string): string {
  const fixed = staticArch(kind, path);
  if (fixed !== null) return fixed;
  const archs = archsOf(path);
  if (archs.length > 1) return "Universal";
  return archs[0] ?? "Unknown";
}

export function ago(at: number, now: number): string {
  const days = Math.floor(new Date(now).setHours(0, 0, 0, 0) / DAY_MS) - Math.floor(new Date(at).setHours(0, 0, 0, 0) / DAY_MS);
  if (days <= 0) return t("setup.ago.today");
  if (days === 1) return t("setup.ago.yesterday");
  if (days < 7) return t("time.days", { count: days });
  const language = getLanguage();
  // English keeps the system's own date order, 3 Oct or Oct 3.
  return new Date(at).toLocaleDateString(language === "en" ? undefined : language, { day: "numeric", month: "short" });
}

function notReadyYet(kind: FileKind): boolean {
  return kind === "gpu" || kind === "model";
}

function fromRecent(open: RecentOpen, now: number): RecentFile {
  const kind = kindOf(open.path);
  const where = open.universal ? `${whereOf(open.path)} (${open.arch} slice)` : whereOf(open.path);
  return { path: open.path, name: basename(open.path), where, kind, arch: staticArch(kind, open.path) ?? open.arch, when: notReadyYet(kind) ? "Opens soon" : ago(open.at, now) };
}

function fromStarter(path: string): RecentFile {
  const kind = kindOf(path);
  return { path, name: basename(path), where: whereOf(path), kind, arch: archLabel(kind, path), when: notReadyYet(kind) ? "Opens soon" : "Never opened" };
}

function appResources(app: string): readonly string[] {
  const dir = join(app, "Contents", "Resources");
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".metallib")).sort().map((name) => join(dir, name));
  } catch {
    return [];
  }
}

function findShaderLibrary(): string | null {
  const preferred = "/Applications/Pixelmator Pro.app/Contents/Resources/default.metallib";
  if (existsSync(preferred)) return preferred;
  try {
    const apps = readdirSync("/Applications").filter((name) => name.endsWith(".app")).sort();
    return apps.flatMap((app) => appResources(join("/Applications", app)))[0] ?? null;
  } catch {
    return null;
  }
}

/** What the user opened before, topped up with files every Mac has, so the list is never empty. */
export function recentFiles(now: number): readonly RecentFile[] {
  const opened = recentOpens().filter((open) => existsSync(open.path)).map((open) => fromRecent(open, now));
  const shader = findShaderLibrary();
  const starters = [...STARTERS, ...(shader ? [shader] : [])].filter((path) => existsSync(path) && !opened.some((file) => file.path === path));
  const binaries = starters.filter((path) => kindOf(path) !== "gpu").map(fromStarter);
  const gpu = starters.filter((path) => kindOf(path) === "gpu").map(fromStarter);
  const top = [...opened, ...binaries].slice(0, gpu.length > 0 ? ROWS - 1 : ROWS);
  return [...top, ...gpu].slice(0, ROWS);
}
