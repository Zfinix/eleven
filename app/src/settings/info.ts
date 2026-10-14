import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { useEffect, useState } from "react";

import { findOnPath } from "../agents/detect";
import { rememberedAnswerProjects } from "../agents/remembered";
import { findLldbDap } from "../debug/adapter";
import { reaLaunch } from "../engine/rea";
import { RECORDINGS_DIR } from "../gpu/trace";
import { cacheDir, folderBytes, ghidraVersion, javaVersion, latestRelease, newer, PROJECTS_DIR, projectCount, reaVersion, rizinVersion, sizeText, THREADS_DIR } from "./actions";
import type { Tone } from "./model";
import { currentSettings } from "./store";
import { appVersion } from "./system";

export type AppUpdate = { readonly version: string; readonly line: string; readonly short: string; readonly download: string | null };

export type Info = {
  readonly engines: {
    readonly rizin: { readonly path: string | null; readonly version: string | null };
    readonly ghidra: { readonly path: string | null; readonly version: string | null };
    readonly hopper: string | null;
    readonly ida: string | null;
  };
  readonly java: { readonly path: string | null; readonly version: string | null };
  readonly rea: { readonly version: string | null; readonly status: { readonly text: string; readonly tone: Tone } };
  readonly lldb: string | null;
  readonly sizes: { readonly projects: string; readonly apps: number; readonly chats: string; readonly cache: string; readonly recordings: string };
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
  if (latest && newer(latest.version, version)) return { version, line: `Eleven ${latest.version} is ready to download.`, short: `Eleven ${latest.version} is out.`, download: latest.url };
  if (checkedAt === null) return { version, line: "Not checked yet.", short: "Not checked yet.", download: null };
  if (offline) return { version, line: `Couldn’t reach the update server. Last tried today at ${clock(checkedAt)}.`, short: "Couldn’t check for updates.", download: null };
  return { version, line: `You’re up to date. Last checked today at ${clock(checkedAt)}.`, short: "Up to date.", download: null };
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
  const reaStatus = (): { readonly text: string; readonly tone: Tone } => {
    if (!rea) return { text: "Not found", tone: "warn" };
    if (reaV && reaLatest && newer(reaLatest.version, reaV)) return { text: `${reaLatest.version} is out`, tone: "warn" };
    return reaLatest ? { text: "Up to date", tone: "good" } : { text: "Installed", tone: "good" };
  };
  return {
    engines: { rizin: { path: rizinProgram, version: rizin }, ghidra: { path: ghidraDir, version: ghidraDir ? ghidraVersion(ghidraDir) : null }, hopper: hopperPath(), ida: idaPath() },
    java: { path: javaHome, version: java },
    rea: { version: reaV, status: reaStatus() },
    lldb: findLldbDap(),
    sizes: {
      projects: sizeText(folderBytes(PROJECTS_DIR)),
      apps: projectCount(),
      chats: sizeText(folderBytes(THREADS_DIR)),
      cache: sizeText(folderBytes(cacheDir())),
      recordings: sizeText(folderBytes(RECORDINGS_DIR)),
    },
    app: appUpdate(),
    remembered: rememberedAnswerProjects(),
  };
}

const EMPTY: Info = {
  engines: { rizin: { path: null, version: null }, ghidra: { path: null, version: null }, hopper: null, ida: null },
  java: { path: null, version: null },
  rea: { version: null, status: { text: "Checking", tone: "quiet" } },
  lldb: null,
  sizes: { projects: "Measuring", apps: 0, chats: "Measuring", cache: "Measuring", recordings: "Measuring" },
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
