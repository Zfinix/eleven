import { rmSync } from "node:fs";

import {
  commitThreadSave,
  installThreadSummaries,
  listThreads,
  threadNameRevision,
  threadRevision,
  type SavedThread,
} from "./history";
import type { Target } from "../engine/target";
import { threadPatch, type ThreadPatch } from "./historyPatch";
import type {
  HistoryOperation,
  HistoryRequest,
  HistoryResponse,
  HistoryValue,
} from "./historyProtocol";
import { errorMessage } from "../lib/guards";
import { FROM_SOURCE } from "../lib/platform";

type Waiting = {
  readonly resolve: (value: HistoryValue) => void;
  readonly reject: (error: Error) => void;
};
type Snapshot = { readonly thread: SavedThread; readonly revision: number };
type SaveQueue = { pending: Snapshot | null; readonly finished: Promise<void> };

const waiting = new Map<number, Waiting>();
const snapshots = new Map<string, Snapshot>();
const saves = new Map<string, SaveQueue>();
const releaseAfterSave = new Set<string>();
let worker: Worker | null = null;
let sequence = 0;
let initializationIssues: readonly string[] = [];

function retainWorker(active: Worker): void {
  if ("ref" in active && typeof active.ref === "function") active.ref();
}

function releaseWorker(active: Worker): void {
  if ("unref" in active && typeof active.unref === "function") active.unref();
}

function failWorker(error: Error): void {
  const failed = worker;
  worker = null;
  failed?.terminate();
  for (const request of waiting.values()) request.reject(error);
  waiting.clear();
}

function receive(active: Worker, response: HistoryResponse): void {
  const pending = waiting.get(response.requestId);
  if (!pending) return;

  waiting.delete(response.requestId);
  if (response.ok) pending.resolve(response.value);
  else pending.reject(new Error(response.error));

  if (waiting.size === 0) releaseWorker(active);
}

function historyWorker(): Worker {
  if (worker) return worker;
  const path = FROM_SOURCE
    ? new URL("./historyWorker.ts", import.meta.url).href
    : "./src/chat/historyWorker.ts";
  const created = new Worker(path);
  created.onmessage = (event: MessageEvent<HistoryResponse>): void => {
    receive(created, event.data);
  };
  created.onerror = (event: ErrorEvent): void => {
    if (worker === created)
      failWorker(new Error(event.message || "The chat storage worker stopped."));
  };
  created.addEventListener("close", (): void => {
    if (worker === created)
      failWorker(new Error("The chat storage worker closed before completing its work."));
  });
  worker = created;
  return created;
}

async function request(operation: HistoryOperation): Promise<HistoryValue> {
  const active = historyWorker();
  const requestId = ++sequence;
  const message: HistoryRequest = { requestId, operation };
  return await new Promise<HistoryValue>((resolve, reject) => {
    waiting.set(requestId, { resolve, reject });
    retainWorker(active);
    try {
      active.postMessage(message);
    } catch (error) {
      waiting.delete(requestId);
      if (waiting.size === 0) releaseWorker(active);
      reject(error);
    }
  });
}

function remember(snapshot: Snapshot): void {
  snapshots.delete(snapshot.thread.id);
  snapshots.set(snapshot.thread.id, snapshot);
  while (snapshots.size > 6) {
    const oldest = snapshots.keys().next().value;
    if (oldest === undefined) break;
    snapshots.delete(oldest);
  }
}

export async function initializeThreadHistory(): Promise<void> {
  try {
    const result = await request({ kind: "list" });
    if (result.kind !== "list") throw new Error("Chat storage returned the wrong index response.");
    installThreadSummaries(result.summaries);
    initializationIssues = result.issues;
  } catch (error) {
    installThreadSummaries([]);
    initializationIssues = [`Couldn't load saved chats. ${errorMessage(error)}`];
  }
}

export function takeHistoryIssues(): readonly string[] {
  const issues = initializationIssues;
  initializationIssues = [];
  return issues;
}

export async function loadThreadAsync(id: string): Promise<SavedThread | null> {
  await saves.get(id)?.finished;
  const revision = threadRevision(id);
  const result = await request({ kind: "load", id });
  if (result.kind !== "load") throw new Error("Chat storage returned the wrong load response.");
  if (revision !== threadRevision(id)) return null;
  if (result.thread) remember({ thread: result.thread, revision });
  return result.thread;
}

async function persist(snapshot: Snapshot): Promise<void> {
  const { thread, revision } = snapshot;
  if (revision !== threadRevision(thread.id)) return;
  const previous = snapshots.get(thread.id);
  const baseline = previous?.revision === revision ? previous.thread : null;
  const patch = threadPatch(baseline, thread);
  const olderSaves: string[] = [];

  for (;;) {
    const nameRevision = threadNameRevision(thread.id);
    const result = await prepareCurrentThread(patch, revision);
    if (!result) {
      discardOlderSaves(olderSaves);
      return;
    }

    // A rename keeps the new messages; prepare them again with the latest saved name.
    if (nameRevision !== threadNameRevision(thread.id) && revision === threadRevision(thread.id)) {
      olderSaves.push(result.temporary);
      continue;
    }

    if (commitThreadSave(result.temporary, result.summary, revision)) remember(snapshot);
    discardOlderSaves(olderSaves);
    return;
  }
}

async function prepareCurrentThread(
  patch: ThreadPatch,
  revision: number,
): Promise<Extract<HistoryValue, { kind: "prepare" }> | null> {
  if (revision !== threadRevision(patch.metadata.id)) return null;
  try {
    const result = await request({ kind: "prepare", patch });
    if (result.kind !== "prepare")
      throw new Error("Chat storage returned the wrong save response.");
    return result;
  } catch (error) {
    if (revision !== threadRevision(patch.metadata.id)) return null;
    throw error;
  }
}

function discardOlderSaves(paths: readonly string[]): void {
  const failures: unknown[] = [];
  for (const path of paths) {
    try {
      rmSync(path);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Couldn't remove superseded chat snapshots.");
  }
}

async function drain(id: string, first: Snapshot): Promise<void> {
  let current: Snapshot | null = first;
  try {
    while (current) {
      await persist(current);
      const queue = saves.get(id);
      current = queue?.pending ?? null;
      if (queue) queue.pending = null;
    }
  } finally {
    saves.delete(id);
    if (releaseAfterSave.delete(id)) snapshots.delete(id);
  }
}

/** One save per chat at a time; a burst keeps only the newest pending snapshot. */
export async function saveThreadAsync(
  thread: SavedThread,
  revision = threadRevision(thread.id),
): Promise<void> {
  const snapshot = { thread, revision };
  const active = saves.get(thread.id);
  if (active) {
    active.pending = snapshot;
    return await active.finished;
  }
  const finished = drain(thread.id, snapshot);
  saves.set(thread.id, { pending: null, finished });
  await finished;
}

export function releaseThreadSnapshot(id: string): void {
  if (saves.has(id)) releaseAfterSave.add(id);
  else snapshots.delete(id);
}

export async function prepareDocumentAsync(
  target: Target,
  id: string,
  path: string,
): Promise<void> {
  await Promise.all([...saves.values()].map((save) => save.finished));
  const threadIds = listThreads()
    .filter((thread) => thread.project === id)
    .map((thread) => thread.id);
  const result = await request({ kind: "document", target, id, path, threadIds });
  if (result.kind !== "document")
    throw new Error("Chat storage returned the wrong project save response.");
}
