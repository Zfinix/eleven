import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { rememberProject } from "../engine/project";
import { prepareTarget } from "../engine/target";
import { z } from "zod";

import { errorMessage, isRecord } from "../lib/guards";
import { readOr } from "../lib/schema";
import { supportPath } from "../lib/support";
import type { Message } from "./thread";

const THREADS = supportPath("threads");
const MESSAGE_KINDS = new Set(["user", "agent", "permission", "note"]);

export type SavedThread = {
  readonly id: string;
  readonly title: string;
  readonly target: string | null;
  /** The project (app or binary) this chat belongs to; null while it has no file. */
  readonly project: string | null;
  readonly messages: readonly Message[];
  readonly updatedAt: number;
  /** The name you gave the thread; the first message names it until then. */
  readonly named?: string;
};

export type ThreadSummary = Omit<SavedThread, "messages">;

export function threadFile(id: string): string {
  return join(THREADS, `${id}.json`);
}

function isMessage(value: unknown): value is Message {
  return isRecord(value) && typeof value.kind === "string" && MESSAGE_KINDS.has(value.kind);
}

/** A thread saved mid-turn can't resume that turn, so it reopens as stopped. */
function settle(message: Message): Message {
  if (message.kind === "agent" && message.outcome === "running")
    return { ...message, outcome: "cancelled", endedAt: message.endedAt ?? message.startedAt };
  if (message.kind === "permission" && message.state.kind === "pending")
    return { ...message, state: { kind: "answered", label: "No answer" } };
  return message;
}

export function stoppedThread(thread: SavedThread): SavedThread {
  return { ...thread, messages: thread.messages.map(settle) };
}

/** Chats saved before projects existed get the project of their file, or none if the file is gone. */
function projectOf(target: string, at: number): string | null {
  try {
    return rememberProject(prepareTarget(target), at);
  } catch {
    return null;
  }
}

/** `project` is undefined in chats saved before projects existed. */
const SAVED = z.object({
  id: z.string(),
  title: z.string(),
  target: z.string().nullable().catch(null),
  project: z.string().nullable().optional().catch(undefined),
  messages: z.array(z.unknown()).transform((messages) => messages.filter(isMessage).map(settle)),
  updatedAt: z.number(),
  named: z.string().catch(""),
});

function parse(json: unknown): { readonly thread: SavedThread; readonly migrated: boolean } | null {
  const saved = readOr(SAVED, json, null);
  if (!saved) return null;
  const { project, named, ...rest } = saved;
  const migrated = project === undefined;
  const owner =
    project ?? (migrated && rest.target ? projectOf(rest.target, rest.updatedAt) : null);
  const thread = { ...rest, project: owner };
  return { thread: named ? { ...thread, named } : thread, migrated };
}

export function loadThread(id: string): SavedThread | null {
  try {
    const parsed = parse(JSON.parse(readFileSync(threadFile(id), "utf8")));
    if (!parsed) throw new Error(`The saved chat ${id} has an invalid format.`);
    return parsed.thread;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

const revisions = new Map<string, number>();
const nameRevisions = new Map<string, number>();
let summaries: Map<string, ThreadSummary> | null = null;
const readIssues: string[] = [];

export function threadReadIssues(): readonly string[] {
  return [...readIssues];
}

function readSummary(name: string): readonly ThreadSummary[] {
  try {
    const saved = loadThread(name.slice(0, -5));
    return saved ? [threadSummary(saved)] : [];
  } catch (error) {
    readIssues.push(`Couldn't read saved chat ${name}. ${errorMessage(error)}`);
    return [];
  }
}

export function threadRevision(id: string): number {
  return revisions.get(id) ?? 0;
}

export function threadNameRevision(id: string): number {
  return nameRevisions.get(id) ?? 0;
}

export function threadSummary(thread: SavedThread): ThreadSummary {
  return {
    id: thread.id,
    title: thread.named || thread.title,
    target: thread.target,
    project: thread.project,
    updatedAt: thread.updatedAt,
    ...(thread.named ? { named: thread.named } : {}),
  };
}

export function installThreadSummaries(loaded: readonly ThreadSummary[]): void {
  summaries = new Map(loaded.map((summary) => [summary.id, summary]));
}

export function listThreads(): readonly ThreadSummary[] {
  if (summaries === null) {
    let names: string[];
    try {
      names = readdirSync(THREADS);
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") names = [];
      else throw error;
    }
    const loaded = names.filter((name) => name.endsWith(".json")).flatMap(readSummary);
    installThreadSummaries(loaded);
  }
  return [...(summaries?.values() ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
}

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

function writeAtomic(path: string, text: string): void {
  const temporary = `${path}.${randomUUID()}.saving`;
  writeFileSync(temporary, text);
  // Keep the complete temporary file if replacement fails, so it can be recovered.
  renameSync(temporary, path);
}

function write(thread: SavedThread, change: "replace" | "rename"): void {
  mkdirSync(THREADS, { recursive: true });
  writeAtomic(threadFile(thread.id), `${JSON.stringify(thread)}\n`);
  if (change === "rename") nameRevisions.set(thread.id, threadNameRevision(thread.id) + 1);
  else revisions.set(thread.id, threadRevision(thread.id) + 1);
  summaries?.set(thread.id, threadSummary(thread));
  notify();
}

/** A background save is committed only if no import or deletion superseded it. */
export function commitThreadSave(
  temporary: string,
  summary: ThreadSummary,
  revision: number,
): boolean {
  if (threadRevision(summary.id) !== revision) {
    rmSync(temporary);
    return false;
  }
  renameSync(temporary, threadFile(summary.id));
  summaries?.set(summary.id, summary);
  notify();
  return true;
}

/** Saves a thread, keeping any name you gave it. A chat stays in the first project it joined. */
export function saveThread(thread: SavedThread): void {
  const saved = loadThread(thread.id);
  const kept = { ...thread, project: saved?.project ?? thread.project };
  write(saved?.named ? { ...kept, named: saved.named } : kept, "replace");
}

export function renameThread(id: string, name: string): void {
  const saved = loadThread(id);
  if (saved) write({ ...saved, named: name.trim() }, "rename");
}

export function deleteThread(id: string): void {
  rmSync(threadFile(id), { force: true });
  revisions.set(id, threadRevision(id) + 1);
  summaries?.delete(id);
  notify();
}

export function onThreadsChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
