import { readdirSync } from "node:fs";

import { currentSettings } from "../settings/store";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { isRecord } from "../lib/guards";
import type { Lane, Recording, Span } from "./types";
import { parseXml, tableRows, type XmlNode } from "./xml";
import { cacheRoot, OS } from "../lib/platform";
import { run } from "../lib/process";

/** Where GPU recordings are kept, so Settings can size and clear them. */
export const RECORDINGS_DIR = join(cacheRoot(), "recordings");
const RECORDINGS = RECORDINGS_DIR;

function skipFrames(): number {
  return Number(currentSettings().gpuSkipFrames);
}
const SHOWN_FRAMES = 6;

type Interval = { readonly start: number; readonly end: number; readonly label: string; readonly latency: number };

/** What the numbers say, in plain words; shared by the timeline and the agent tool. */
export type GpuFindings = {
  readonly frames: number;
  readonly frameMs: number;
  readonly gpuMs: number;
  readonly busy: number;
  readonly gapMs: number;
  readonly serial: boolean;
  readonly warmupMs: number;
  readonly advice: readonly string[];
};

export type GpuRun = { readonly recording: Recording; readonly findings: GpuFindings; readonly trace: string };

async function table(trace: string, schema: string): Promise<readonly ReadonlyMap<string, XmlNode>[]> {
  const { stdout } = await run("xcrun", ["xctrace", "export", "--input", trace, "--xpath", `/trace-toc/run[@number="1"]/data/table[@schema="${schema}"]`], { maxBuffer: 256 * 1024 * 1024 });
  return tableRows(parseXml(stdout));
}

function ownedBy(row: ReadonlyMap<string, XmlNode>, process: string): boolean {
  return (row.get("process")?.attrs.fmt ?? "").startsWith(`${process} (`);
}

function intervals(rows: readonly ReadonlyMap<string, XmlNode>[], label: string, process: string): readonly Interval[] {
  return rows.filter((row) => ownedBy(row, process) && (!row.get("channel-name") || row.get("channel-name")?.text === "Compute")).map((row) => {
    const start = Number(row.get("start")?.text ?? 0) / 1e6;
    const text = row.get(label)?.attrs.fmt ?? "";
    const frame = row.get("frame-number")?.text;
    return { start, end: start + Number(row.get("duration")?.text ?? 0) / 1e6, label: frame ? `Frame ${frame}` : (text.split("(")[0]?.trim() ?? text), latency: Number(row.get("start-latency")?.text ?? 0) / 1e6 };
  }).sort((a, b) => a.start - b.start);
}

function ms(value: number): string {
  return value >= 10 ? `${value.toFixed(0)} ms` : `${value.toFixed(2)} ms`;
}

function findingsOf(gpu: readonly Interval[], cpu: readonly Interval[]): GpuFindings {
  const steady = gpu.slice(skipFrames());
  const first = steady[0];
  const last = steady.at(-1);
  if (!first || !last) throw new Error("The recording has too few GPU frames to measure. Record a longer run.");
  const span = last.end - first.start;
  const gpuMs = steady.reduce((total, frame) => total + (frame.end - frame.start), 0);
  const frameMs = span / steady.length;
  const busy = gpuMs / span;
  const gaps = steady.slice(1).map((frame, ix) => frame.start - (steady[ix]?.end ?? frame.start));
  const gapMs = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
  const serial = steady.slice(1).every((frame, ix) => cpu.some((enc) => enc.start >= (steady[ix]?.end ?? 0) - 0.05 && enc.start <= frame.start));
  const warmupMs = gpu[0]?.latency ?? 0;
  const advice = [
    busy < 0.95 && serial ? `The GPU sits idle ${ms(gapMs)} between frames (${Math.round((1 - busy) * 100)}% of the time) because the app waits for each frame to finish before it starts encoding the next. Commit the next command buffer before waiting, or wait with addCompletedHandler, and keep two or three frames in flight.` : null,
    busy >= 0.95 ? `The GPU is busy ${Math.round(busy * 100)}% of the time, so the kernels themselves are the cost (${ms(gpuMs / steady.length)} a frame). Open the kernels and look at how much memory each one reads; reading the same pixels several times is the usual cost.` : null,
    warmupMs > frameMs * 5 ? `The first frame waited ${ms(warmupMs)} before the GPU started, mostly pipeline setup. Build pipelines at launch, or ship a binary archive, so the first frame isn't slow.` : null,
  ].filter((line): line is string => line !== null);
  return { frames: gpu.length, frameMs, gpuMs: gpuMs / steady.length, busy, gapMs, serial, warmupMs, advice };
}

function spans(items: readonly Interval[], origin: number, tone: Span["tone"], prefix: string, advice: readonly string[]): readonly Span[] {
  return items.map((item, ix) => ({
    id: `${prefix}-${ix}`,
    label: item.label || prefix,
    startMs: item.start - origin,
    endMs: item.end - origin,
    tone,
    stats: [["Time", ms(item.end - item.start)], ...(item.latency > 0 ? [["Waited to start", ms(item.latency)] as const] : [])].map(([label, value]) => ({ label, value })),
    advice,
  }));
}

/** Reads a Metal System Trace once and keeps the result beside it, since xctrace exports take seconds. */
export async function readGpuRun(trace: string, title: string): Promise<GpuRun> {
  const cache = `${trace}.eleven.json`;
  const cached = await readCached(cache);
  if (cached) return { recording: { ...cached.recording, title }, findings: cached.findings, trace };
  const run = await exportGpuRun(trace, title);
  await writeFile(cache, JSON.stringify({ recording: run.recording, findings: run.findings }));
  return run;
}

function isLane(value: unknown): value is Lane {
  return isRecord(value) && typeof value.name === "string" && Array.isArray(value.spans);
}

function isRecording(value: unknown): value is Recording {
  return isRecord(value) && typeof value.title === "string" && typeof value.source === "string" && typeof value.frameMs === "number"
    && typeof value.tickMs === "number" && Array.isArray(value.lanes) && value.lanes.every(isLane);
}

function isFindings(value: unknown): value is GpuFindings {
  return isRecord(value) && typeof value.frames === "number" && typeof value.busy === "number" && Array.isArray(value.advice);
}

async function readCached(path: string): Promise<{ readonly recording: Recording; readonly findings: GpuFindings } | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed) || !isRecording(parsed.recording) || !isFindings(parsed.findings)) return null;
    return { recording: parsed.recording, findings: parsed.findings };
  } catch {
    return null;
  }
}

async function exportGpuRun(trace: string, title: string): Promise<GpuRun> {
  const process = basename(trace).replace(/-\d+\.trace$/, "");
  const gpu = intervals(await table(trace, "metal-gpu-intervals"), "event-label", process);
  const cpu = intervals(await table(trace, "metal-application-intervals"), "event-label", process).filter((item) => item.label.startsWith("Command Buffer"));
  const findings = findingsOf(gpu, cpu);
  const window = gpu.slice(skipFrames(), skipFrames() + SHOWN_FRAMES);
  const origin = window[0]?.start ?? 0;
  const end = window.at(-1)?.end ?? origin;
  const gaps: Interval[] = window.slice(1).map((frame, ix) => ({ start: window[ix]?.end ?? frame.start, end: frame.start, label: "GPU idle", latency: 0 })).filter((gap) => gap.end - gap.start > 0.01);
  const lanes: Lane[] = [
    { name: "CPU · encoding", spans: spans(cpu.filter((item) => item.start >= origin && item.end <= end), origin, "cpu", "encode", ["Encoding is cheap here. The CPU is not what makes this slow."]) },
    { name: "GPU · compute", spans: [...spans(window, origin, "kernel", "frame", findings.advice), ...spans(gaps, origin, "wait", "idle", findings.advice)].sort((a, b) => a.startMs - b.startMs) },
  ];
  const frameMs = Math.max(0.1, Number((end - origin).toFixed(2)));
  const recording: Recording = { title, source: `Metal System Trace · ${findings.frames} frames · ${SHOWN_FRAMES} steady frames shown`, frameMs, tickMs: Math.max(0.1, Number((frameMs / 4).toPrecision(1))), lanes };
  return { recording, findings, trace };
}

function keepCount(): number {
  const keep = currentSettings().keepRecordings;
  return keep === "All" ? Infinity : Number(keep);
}

function allRuns(executable: string): readonly string[] {
  try {
    return readdirSync(RECORDINGS).filter((name) => name.startsWith(`${executable}-`) && name.endsWith(".trace")).sort().reverse().map((name) => join(RECORDINGS, name));
  } catch {
    return [];
  }
}

/** The newest recordings of an app that Settings says to keep, newest first. */
export function listRuns(executable: string): readonly string[] {
  return allRuns(executable).slice(0, keepCount());
}

async function pruneRuns(executable: string): Promise<void> {
  const stale = allRuns(executable).slice(keepCount());
  await Promise.all(stale.flatMap((trace) => [rm(trace, { recursive: true, force: true }), rm(`${trace}.eleven.json`, { force: true })]));
}

export function runTitle(trace: string): string {
  const stamp = Number(/-(\d+)\.trace$/.exec(trace)?.[1] ?? 0);
  const name = basename(trace).replace(/-\d+\.trace$/, "");
  return `${name} run, ${new Date(stamp).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

/** Runs the app under the chosen Instruments template for the chosen time. Only called after the user agrees. */
export async function recordGpuRun(executable: string, args: readonly string[]): Promise<string> {
  if (OS !== "mac") throw new Error("GPU recording uses Apple's Instruments, which only runs on macOS.");
  await mkdir(RECORDINGS, { recursive: true });
  const trace = join(RECORDINGS, `${basename(executable)}-${Date.now()}.trace`);
  await rm(trace, { recursive: true, force: true });
  const { gpuTemplate, gpuSeconds } = currentSettings();
  await run("xcrun", ["xctrace", "record", "--template", gpuTemplate, "--output", trace, "--time-limit", `${gpuSeconds}s`, "--launch", "--", executable, ...args], { maxBuffer: 16 * 1024 * 1024 });
  await pruneRuns(basename(executable));
  return trace;
}

export function describeFindings(findings: GpuFindings): string {
  return [
    `${findings.frames} frames recorded. Steady state: ${ms(findings.frameMs)} a frame, GPU busy ${Math.round(findings.busy * 100)}% (${ms(findings.gpuMs)} of GPU work a frame), ${ms(findings.gapMs)} idle between frames.`,
    findings.serial ? "Each frame starts only after the previous one finished (the app waits on every frame)." : "Frames overlap; the app keeps more than one frame in flight.",
    `First frame waited ${ms(findings.warmupMs)} before the GPU started.`,
    ...findings.advice,
  ].join("\n");
}
