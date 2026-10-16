import { randomUUID } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

import { errorMessage, isRecord } from "../lib/guards";
import {
  listThreads,
  loadThread,
  stoppedThread,
  threadFile,
  threadReadIssues,
  threadSummary,
  type SavedThread,
} from "./history";
import { applyThreadPatch } from "./historyPatch";
import type {
  HistoryOperation,
  HistoryRequest,
  HistoryResponse,
  HistoryValue,
} from "./historyProtocol";
import { writeThreadFile } from "./writeThreadFile";
import { buildDocument } from "../engine/document";

type CachedThread = { readonly thread: SavedThread; readonly fingerprint: string };
const cached = new Map<string, CachedThread>();

function fingerprint(path: string): string | null {
  try {
    const stat = statSync(path);
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

function remember(thread: SavedThread, stamp: string): void {
  cached.delete(thread.id);
  cached.set(thread.id, { thread, fingerprint: stamp });
  while (cached.size > 1) {
    const oldest = cached.keys().next().value;
    if (oldest === undefined) break;
    cached.delete(oldest);
  }
}

function restoreThread(id: string): SavedThread | null {
  const thread = readThread(id);
  if (!thread) return null;
  const stopped = stoppedThread(thread);
  const stamp = fingerprint(threadFile(id));
  if (stamp) remember(stopped, stamp);
  return stopped;
}

function readThread(id: string): SavedThread | null {
  const stamp = fingerprint(threadFile(id));
  const known = cached.get(id);
  if (known && known.fingerprint === stamp) return known.thread;
  cached.delete(id);
  const thread = loadThread(id);
  if (thread && stamp) remember(thread, stamp);
  return thread;
}

function prepare(patch: Extract<HistoryOperation, { kind: "prepare" }>["patch"]): HistoryValue {
  const thread = applyThreadPatch(readThread(patch.metadata.id), patch);
  const temporary = `${threadFile(thread.id)}.${randomUUID()}.saving`;
  mkdirSync(dirname(temporary), { recursive: true });
  writeThreadFile(temporary, thread);
  const stamp = fingerprint(temporary);
  if (!stamp) throw new Error("The completed chat snapshot disappeared before it could be saved.");
  remember(thread, stamp);
  return { kind: "prepare", temporary, summary: threadSummary(thread) };
}

async function execute(operation: HistoryOperation): Promise<HistoryValue> {
  switch (operation.kind) {
    case "list":
      return { kind: "list", summaries: listThreads(), issues: threadReadIssues() };
    case "load":
      return { kind: "load", thread: restoreThread(operation.id) };
    case "prepare":
      return prepare(operation.patch);
    case "document":
      await buildDocument(operation.target, operation.id, operation.path, operation.threadIds);
      return { kind: "document" };
  }
}

const requests: HistoryRequest[] = [];
let processing: Promise<void> | null = null;

async function drain(): Promise<void> {
  try {
    for (let request = requests.shift(); request; request = requests.shift()) {
      let response: HistoryResponse;
      try {
        response = {
          requestId: request.requestId,
          ok: true,
          value: await execute(request.operation),
        };
      } catch (error) {
        response = { requestId: request.requestId, ok: false, error: errorMessage(error) };
      }
      globalThis.postMessage(response);
    }
  } finally {
    processing = null;
  }
}

globalThis.onmessage = (event: MessageEvent<HistoryRequest>): void => {
  requests.push(event.data);
  processing ??= drain();
};
