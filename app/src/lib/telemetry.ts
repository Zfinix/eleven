import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { currentSettings } from "../settings/store";
import { appVersion } from "../settings/system";
import { errorMessage, isRecord } from "./guards";
import { FROM_SOURCE, OS } from "./platform";
import { supportDir, supportPath } from "./support";

export type CrashKind = "screen" | "exception" | "rejection";

export type CrashReport = {
  readonly device: string;
  readonly version: string;
  readonly os: string;
  readonly arch: string;
  readonly kind: CrashKind;
  readonly signature: string;
  readonly message: string;
  readonly stack: string;
  readonly at: number;
};

const ENDPOINT = process.env.ELEVEN_TELEMETRY ?? "https://eleven.chizi.app/api";
const ENABLED = !FROM_SOURCE || process.env.ELEVEN_TELEMETRY !== undefined;
const QUEUE = supportPath("crashes");
const DEVICE_FILE = supportPath("device-id");
const HOME = homedir();

/** A random ID made on first launch; it says nothing about the machine or the person. */
export function deviceId(): string {
  try {
    const saved = readFileSync(DEVICE_FILE, "utf8").trim();
    if (/^[0-9a-f-]{36}$/.test(saved)) return saved;
  } catch {}
  const id = crypto.randomUUID();
  try {
    mkdirSync(supportDir(), { recursive: true });
    writeFileSync(DEVICE_FILE, id);
  } catch {}
  return id;
}

export function scrub(text: string): string {
  const named = HOME.length > 1 ? text.split(HOME).join("~") : text;
  return named.replace(/\/(Users|home)\/[^/\s:)]+/g, "~").replace(/[A-Za-z]:\\Users\\[^\\\s:)]+/g, "~");
}

/** Groups the same crash across versions: the error's name and its first frames without line numbers. */
export function signature(error: unknown): string {
  const name = error instanceof Error ? error.name : "Error";
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  const frames = stack
    .split("\n")
    .filter((line) => line.trim().startsWith("at "))
    .slice(0, 3)
    .map((line) => line.trim().replace(/:\d+(:\d+)?\)?$/, "").replace(/\(?[^\s(]*[/\\]/, "").trim());
  if (frames.length > 0) return `${name} ${frames.join(" < ")}`;
  return `${name}: ${scrub(errorMessage(error)).replace(/\d+/g, "#").slice(0, 120)}`;
}

export function crashReport(kind: CrashKind, error: unknown, extra = ""): CrashReport {
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  return {
    device: deviceId(),
    version: appVersion(),
    os: OS,
    arch: process.arch,
    kind,
    signature: signature(error),
    message: scrub(errorMessage(error)).slice(0, 500),
    stack: scrub(`${stack}\n${extra}`.trim()).slice(0, 8000),
    at: Date.now(),
  };
}

async function post(path: string, body: unknown): Promise<number | null> {
  try {
    const response = await fetch(`${ENDPOINT}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    return response.status;
  } catch {
    return null;
  }
}

/** Saved straight to disk so a crash that takes the app down is still sent on the next launch. */
export function recordCrash(kind: CrashKind, error: unknown, extra = ""): void {
  if (!ENABLED || !currentSettings().crashReports) return;
  try {
    mkdirSync(QUEUE, { recursive: true });
    writeFileSync(join(QUEUE, `${crypto.randomUUID()}.json`), JSON.stringify(crashReport(kind, error, extra)));
  } catch {}
}

export async function sendCrashes(): Promise<void> {
  if (!ENABLED || !existsSync(QUEUE)) return;
  for (const file of readdirSync(QUEUE).filter((name) => name.endsWith(".json"))) {
    const path = join(QUEUE, file);
    let report: unknown = null;
    try {
      report = JSON.parse(readFileSync(path, "utf8"));
    } catch {}
    const status = isRecord(report) && currentSettings().crashReports ? await post("crash", report) : 400;
    if (status !== null && status < 500) rmSync(path, { force: true });
  }
}

let watching = false;

/** Notes uncaught errors without changing how the app exits. */
function watchCrashes(): void {
  if (watching) return;
  watching = true;
  const seen = new WeakSet<object>();
  const note = (kind: CrashKind, error: unknown): void => {
    if (typeof error === "object" && error !== null) {
      if (seen.has(error)) return;
      seen.add(error);
    }
    recordCrash(kind, error);
  };
  process.on("uncaughtExceptionMonitor", (error) => note("exception", error));
  process.on("unhandledRejection", (reason) => {
    note("rejection", reason);
    throw reason;
  });
}

export function startTelemetry(): void {
  if (!ENABLED) return;
  watchCrashes();
  void (async (): Promise<void> => {
    if (currentSettings().countInstall) await post("launch", { device: deviceId(), version: appVersion(), os: OS, arch: process.arch });
    await sendCrashes();
  })();
}
