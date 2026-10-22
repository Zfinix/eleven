import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { useEffect, useState } from "react";

import { findOnPath } from "../agents/detect";
import { rememberedAnswerProjects } from "../agents/remembered";
import { findLldbDap } from "../debug/adapter";
import { reaLaunch } from "../engine/rea";
import { RECORDINGS_DIR } from "../gpu/trace";
import { cacheDir, folderBytes, ghidraVersion, javaVersion, latestRelease, PROJECTS_DIR, projectCount, reaVersion, rizinVersion, sizeText, THREADS_DIR } from "./actions";
import { t } from "../i18n";
import { isNewer } from "../lib/version";
import type { Tone } from "./model";
import { currentSettings } from "./store";
import { appVersion } from "./system";

export type UpdateState =
  | { readonly kind: "unchecked" }
  | { readonly kind: "available"; readonly latest: string }
  | { readonly kind: "offline"; readonly at: string }
  | { readonly kind: "current"; readonly at: string };

export type AppUpdate = { readonly version: string; readonly state: UpdateState; readonly download: string | null };

export type ReaState = { readonly kind: "checking" | "missing" | "current" | "installed" } | { readonly kind: "outdated"; readonly latest: string };

export type Info = {
  readonly engines: {
    readonly rizin: { readonly path: string | null; readonly version: string | null };
    readonly ghidra: { readonly path: string | null; readonly version: string | null };
    readonly hopper: string | null;
    readonly ida: string | null;
  };
  readonly java: { readonly path: string | null; readonly version: string | null };
  readonly rea: { readonly version: string | null; readonly state: ReaState };
  readonly lldb: string | null;
  readonly sizes: { readonly projects: number | null; readonly apps: number; readonly chats: number | null; readonly cache: number | null; readonly recordings: number | null };
  readonly app: AppUpdate;
  readonly remembered: number;
};

const APPS = [join(homedir(), "Applications"), "/Applications"];

function existing(path: string): string | null {
  return path && existsSync(path) ? path : null;
}

function hopperPath(): string | null {
  return existing(currentSettings().hopperPath) ?? APPS.map((dir) => join(dir, "Hopper Disassembler.app")).find(existsSync) ?? null;
}

function idaPath(): string | null {
  const chosen = existing(currentSettings().idaPath);
  if (chosen) return chosen;
  for (const dir of APPS) {
    try {
      const app = readdirSync(dir).find((name) => /^IDA.*\.app$/i.test(name));
      if (app) return join(dir, app);
    } catch {
      continue;
    }
  }
  return null;
}

function reaProgram(): string | null {
  const { command, args } = reaLaunch();
  const program = command === "node" ? (args[0] ?? command) : command;
  return isAbsolute(program) ? existing(program) : findOnPath(program);
}

let checkedAt: Date | null = null;
let latest: { readonly version: string; readonly url: string } | null = null;
let offline = false;

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function appUpdate(): AppUpdate {
  const version = appVersion();
  if (latest && isNewer(latest.version, version)) return { version, state: { kind: "available", latest: latest.version }, download: latest.url };
  if (checkedAt === null) return { version, state: { kind: "unchecked" }, download: null };
  return { version, state: offline ? { kind: "offline", at: clock(checkedAt) } : { kind: "current", at: clock(checkedAt) }, download: null };
}

/** The update status under the version in Settings. */
export function updateLine(app: AppUpdate): string {
  const { state } = app;
  switch (state.kind) {
    case "available":
      return t("update.ready", { version: state.latest });
    case "unchecked":
      return t("update.unchecked");
    case "offline":
      return t("update.offline", { time: state.at });
    case "current":
      return t("update.current", { time: state.at });
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}

/** The same status in a few words, for the About page and the toast after a check. */
export function updateShort(app: AppUpdate): string {
  const { state } = app;
  switch (state.kind) {
    case "available":
      return t("update.out", { version: state.latest });
    case "unchecked":
      return t("update.unchecked");
    case "offline":
      return t("update.failed");
    case "current":
      return t("update.upToDate");
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}

export function reaStatus(state: ReaState): { readonly text: string; readonly tone: Tone } {
  switch (state.kind) {
    case "checking":
      return { text: t("settings.checking"), tone: "quiet" };
    case "missing":
      return { text: t("settings.notFound"), tone: "warn" };
    case "outdated":
      return { text: t("settings.rea.out", { version: state.latest }), tone: "warn" };
    case "current":
      return { text: t("settings.upToDate"), tone: "good" };
    case "installed":
      return { text: t("settings.installed"), tone: "good" };
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}

/** A folder size in the current language, or a word saying it is still being measured. */
export function measured(bytes: number | null): string {
  return bytes === null ? t("settings.measuring") : sizeText(bytes);
}

/** Asks GitHub for Eleven's newest release on the chosen channel. */
export async function checkAppUpdate(): Promise<AppUpdate> {
  const found = await latestRelease("Zfinix/eleven", currentSettings().updateChannel === "Beta");
  checkedAt = new Date();
  offline = found === null;
  latest = found;
  return appUpdate();
}

async function gather(): Promise<Info> {
  const rizinProgram = existing(currentSettings().rizinPath) ?? existing(process.env.ELEVEN_RIZIN ?? "") ?? findOnPath("rizin");
  const ghidraDir = existing(process.env.GHIDRA_INSTALL_DIR ?? "");
  const javaHome = existing(process.env.JAVA_HOME ?? "");
  const rea = reaProgram();
  const [rizin, java, reaV, reaLatest] = await Promise.all([
    rizinProgram ? rizinVersion(rizinProgram) : Promise.resolve(null),
    javaHome ? javaVersion(javaHome) : Promise.resolve(null),
    rea ? reaVersion(rea) : Promise.resolve(null),
    latestRelease("Zfinix/rea"),
  ]);
  const reaState = (): ReaState => {
    if (!rea) return { kind: "missing" };
    if (reaV && reaLatest && isNewer(reaLatest.version, reaV)) return { kind: "outdated", latest: reaLatest.version };
    return { kind: reaLatest ? "current" : "installed" };
  };
  return {
    engines: { rizin: { path: rizinProgram, version: rizin }, ghidra: { path: ghidraDir, version: ghidraDir ? ghidraVersion(ghidraDir) : null }, hopper: hopperPath(), ida: idaPath() },
    java: { path: javaHome, version: java },
    rea: { version: reaV, state: reaState() },
    lldb: findLldbDap(),
    sizes: {
      projects: folderBytes(PROJECTS_DIR),
      apps: projectCount(),
      chats: folderBytes(THREADS_DIR),
      cache: folderBytes(cacheDir()),
      recordings: folderBytes(RECORDINGS_DIR),
    },
    app: appUpdate(),
    remembered: rememberedAnswerProjects(),
  };
}

const EMPTY: Info = {
  engines: { rizin: { path: null, version: null }, ghidra: { path: null, version: null }, hopper: null, ida: null },
  java: { path: null, version: null },
  rea: { version: null, state: { kind: "checking" } },
  lldb: null,
  sizes: { projects: null, apps: 0, chats: null, cache: null, recordings: null },
  app: appUpdate(),
  remembered: 0,
};

/** What Settings shows about this Mac: engine versions, folder sizes and updates. Measured again on refresh. */
export function useSettingsInfo(): { readonly info: Info; readonly refresh: () => void } {
  const [info, setInfo] = useState<Info>(EMPTY);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const load = async (): Promise<void> => {
      const next = await gather();
      if (live) setInfo(next);
    };
    void load();
    return () => {
      live = false;
    };
  }, [tick]);
  return { info, refresh: () => setTick((t) => t + 1) };
}
