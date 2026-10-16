import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";

import {
  deleteThread,
  listThreads,
  loadThread,
  renameThread,
  saveThread,
  type SavedThread,
} from "../chat/history";
import { prepareDocumentAsync } from "../chat/historyAsync";
import { isRecord } from "../lib/guards";
import { supportPath } from "../lib/support";
import { pathSetting } from "../settings/store";
import { appVersion } from "../settings/system";
import { type Manifest, openElevenFile, pack, type Part, sha256, writeAtomic } from "./elevenFile";
import { projectJson, restoreProjectJson } from "./project";
import type { Target } from "./target";
import { cacheRoot as platformCache, chooseSavePath } from "../lib/platform";

function cacheRoot(): string {
  return pathSetting("cacheDir", "ELEVEN_CACHE") ?? platformCache();
}
const DOCUMENTS = supportPath("documents.json");
const EXTENSION = ".eleven";
const revisions = new Map<string, number>();
type PendingDocument = {
  readonly target: Target;
  readonly id: string;
  readonly path: string;
  readonly remember: boolean;
  readonly revision: number;
};
type DocumentQueue = { pending: PendingDocument | null; readonly finished: Promise<void> };
const saves = new Map<string, DocumentQueue>();

/** Binaries rarely change and level 19 is slow, so each one is compressed once per run. */
const packedBinaries = new Map<string, { readonly raw: Uint8Array; readonly packed: Uint8Array }>();

export function isElevenFile(path: string): boolean {
  return path.toLowerCase().endsWith(EXTENSION);
}

function documents(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(DOCUMENTS, "utf8"));
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/** Where a project was last saved as a `.eleven` file, if it ever was and the file is still there. */
export function documentPath(id: string): string | null {
  const path = documents()[id];
  return path && existsSync(path) ? path : null;
}

export function setDocumentPath(id: string, path: string): void {
  mkdirSync(dirname(DOCUMENTS), { recursive: true });
  writeFileSync(DOCUMENTS, `${JSON.stringify({ ...documents(), [id]: path }, null, 2)}\n`);
}

function cacheFiles(id: string): Record<string, string> {
  const root = join(cacheRoot(), id);
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (/\.(c|s|json|txt)$/.test(name))
        out[relative(root, path)] = readFileSync(path, "utf8");
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

async function squeeze(name: string, raw: Uint8Array, level: number): Promise<Part> {
  return { name, raw, packed: new Uint8Array(await Bun.zstdCompress(raw, { level })) };
}

async function binaryPart(path: string, id: string): Promise<Part> {
  const known = packedBinaries.get(id);
  if (known) return { name: "binary", raw: known.raw, packed: known.packed };
  packedBinaries.clear();
  const part = await squeeze("binary", new Uint8Array(readFileSync(path)), 19);
  if ("packed" in part) packedBinaries.set(id, { raw: part.raw, packed: part.packed });
  return part;
}

/** Where the save dialog starts: Documents/Eleven. */
export function projectsFolder(): string {
  return process.env.ELEVEN_PROJECTS_DIR ?? join(homedir(), "Documents", "Eleven");
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

/** Runs in the storage worker; parsing, encoding, hashing and compression all stay off the UI thread. */
export async function buildDocument(
  target: Target,
  id: string,
  path: string,
  threadIds: readonly string[],
): Promise<void> {
  const chats = threadIds.flatMap((threadId) => loadThread(threadId) ?? []);
  const parts: readonly Part[] = await Promise.all([
    squeeze("project.json", text(projectJson(id)), 3),
    squeeze("chats.json", text(JSON.stringify(chats)), 3),
    squeeze("cache.json", text(JSON.stringify(cacheFiles(id))), 19),
    binaryPart(target.path, id),
  ]);
  const info: Omit<Manifest, "format" | "entries"> = {
    name: target.name,
    kind: target.kind,
    arch: target.arch,
    meta: target.meta,
    binary: id,
    savedAt: Date.now(),
    app: appVersion(),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeAtomic(path, pack(info, parts));
}

async function persistDocument(snapshot: PendingDocument): Promise<void> {
  const { target, id, path, remember, revision } = snapshot;
  if (revision !== (revisions.get(id) ?? 0)) return;
  const temporary = `${path}.${randomUUID()}.saving`;
  await prepareDocumentAsync(target, id, temporary);
  if (revision !== (revisions.get(id) ?? 0)) {
    rmSync(temporary);
    return;
  }
  renameSync(temporary, path);
  if (remember) setDocumentPath(id, path);
}

async function drainDocuments(key: string, first: PendingDocument): Promise<void> {
  let snapshot: PendingDocument | null = first;
  try {
    while (snapshot) {
      await persistDocument(snapshot);
      const queue = saves.get(key);
      snapshot = queue?.pending ?? null;
      if (queue) queue.pending = null;
    }
  } finally {
    saves.delete(key);
  }
}

/** Autosaves share one active write and retain only the newest pending request. */
export async function saveDocument(
  target: Target,
  id: string,
  path: string,
  remember = true,
): Promise<void> {
  const snapshot = { target, id, path, remember, revision: revisions.get(id) ?? 0 };
  const key = `${id}:${path}`;
  const active = saves.get(key);
  if (active) {
    active.pending = snapshot;
    return await active.finished;
  }
  const finished = drainDocuments(key, snapshot);
  saves.set(key, { pending: null, finished });
  await finished;
}

/** Deletes the project's `.eleven` file and every chat in it. */
export function deleteDocument(id: string): void {
  const path = documentPath(id);
  if (path) rmSync(path, { force: true });
  revisions.set(id, (revisions.get(id) ?? 0) + 1);
  const { [id]: _gone, ...rest } = documents();
  mkdirSync(dirname(DOCUMENTS), { recursive: true });
  writeFileSync(DOCUMENTS, `${JSON.stringify(rest, null, 2)}\n`);
  for (const thread of listThreads()) if (thread.project === id) deleteThread(thread.id);
}

/** Renames the project's file on disk, keeping it in the same folder. */
export function renameDocument(id: string, name: string): string | null {
  const from = documentPath(id);
  const clean = name.trim().replace(/[/\\:]/g, "_");
  if (!from || !clean) return null;
  const to = join(dirname(from), `${clean.replace(/\.eleven$/i, "")}${EXTENSION}`);
  if (to !== from) {
    if (existsSync(to)) throw new Error("A project with that name is already in that folder.");
    renameSync(from, to);
    revisions.set(id, (revisions.get(id) ?? 0) + 1);
    setDocumentPath(id, to);
  }
  return to;
}

function isThread(value: unknown): value is SavedThread {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.messages) &&
    typeof value.updatedAt === "number"
  );
}

function json(data: Uint8Array | null): unknown {
  return data ? JSON.parse(new TextDecoder().decode(data)) : null;
}

/** Unpacks a `.eleven` file: the binary into the cache, then your work, chats and decompiled code. */
export function openDocument(path: string): {
  readonly manifest: Manifest;
  readonly binary: string;
} {
  const file = openElevenFile(path);
  try {
    const { manifest } = file;
    const id = manifest.binary;
    revisions.set(id, (revisions.get(id) ?? 0) + 1);
    const binary = join(cacheRoot(), id, "document", manifest.name.replace(/[/\\]/g, "_"));
    if (!existsSync(binary) || sha256(new Uint8Array(readFileSync(binary))) !== id) {
      const data = file.entry("binary");
      if (!data) throw new Error("This project file has no binary in it.");
      mkdirSync(dirname(binary), { recursive: true });
      writeFileSync(binary, data, { mode: 0o755 });
    }
    const cache = json(file.entry("cache.json"));
    if (isRecord(cache)) {
      for (const [name, body] of Object.entries(cache)) {
        const out = join(cacheRoot(), id, name);
        if (typeof body !== "string" || !out.startsWith(join(cacheRoot(), id)) || existsSync(out))
          continue;
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, body);
      }
    }
    const work = file.entry("project.json");
    if (work) restoreProjectJson(id, new TextDecoder().decode(work));
    const chats = json(file.entry("chats.json"));
    if (Array.isArray(chats)) {
      for (const chat of chats.filter(isThread)) {
        saveThread({ ...chat, project: id });
        if (chat.named) renameThread(chat.id, chat.named);
      }
    }
    setDocumentPath(id, path);
    return { manifest, binary };
  } finally {
    file.close();
  }
}

/** Asks where to save, with the system's save dialog; null when you cancel. */
export async function askSavePath(name: string): Promise<string | null> {
  const base = name.replace(/\.(app|eleven)$/i, "");
  const chosen = await chooseSavePath("Save the project", `${base}${EXTENSION}`, projectsFolder());
  if (!chosen) return null;
  return isElevenFile(chosen) ? chosen : `${chosen}${EXTENSION}`;
}
