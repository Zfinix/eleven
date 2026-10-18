import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";

import { deleteThread, listThreads, loadThread, renameThread, saveThread, type SavedThread } from "../chat/history";
import { isRecord } from "../lib/guards";
import { supportPath } from "../lib/support";
import { pathSetting } from "../settings/store";
import { appVersion } from "../settings/system";
import { SerialQueue } from "../lib/serial";
import { compressFile, compressStream, type Manifest, openElevenFile, pack, type Packed, sha256, writeAtomic } from "./elevenFile";
import { projectJson, restoreProjectJson } from "./project";
import type { Target } from "./target";
import { cacheRoot as platformCache, chooseSavePath } from "../lib/platform";

function cacheRoot(): string {
  return pathSetting("cacheDir", "ELEVEN_CACHE") ?? platformCache();
}
const DOCUMENTS = supportPath("documents.json");
const EXTENSION = ".eleven";

/** Level 19 took tens of seconds and GiBs on large binaries; 3 is fast and streams in little memory. */
const LEVEL = 3;

/** Binaries rarely change, so the last one compressed is kept for the next save, compressed only. */
let packedBinary: { readonly id: string; readonly part: Packed } | null = null;

const saves = new SerialQueue();

export function isElevenFile(path: string): boolean {
  return path.toLowerCase().endsWith(EXTENSION);
}

function documents(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(DOCUMENTS, "utf8"));
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
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
      else if (/\.(c|s|json|txt)$/.test(name)) out[relative(root, path)] = readFileSync(path, "utf8");
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

async function* chunk(data: Uint8Array): AsyncGenerator<Uint8Array> {
  yield data;
}

function squeeze(name: string, raw: Uint8Array): Promise<Packed> {
  return compressStream(name, chunk(raw), LEVEL);
}

async function binaryPart(path: string, id: string): Promise<Packed> {
  if (packedBinary?.id === id) return packedBinary.part;
  const part = await compressFile("binary", path, LEVEL);
  packedBinary = { id, part };
  return part;
}

/** Where the save dialog starts: Documents/Eleven. */
export function projectsFolder(): string {
  return process.env.ELEVEN_PROJECTS_DIR ?? join(homedir(), "Documents", "Eleven");
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

async function writeDocument(target: Target, id: string, path: string, remember: boolean): Promise<void> {
  const parts: readonly Packed[] = [
    await squeeze("project.json", text(projectJson(id))),
    await squeeze("chats.json", text(JSON.stringify(listThreads().filter((summary) => summary.project === id).flatMap((summary) => loadThread(summary.id) ?? [])))),
    await squeeze("cache.json", text(JSON.stringify(cacheFiles(id)))),
    await binaryPart(target.path, id),
  ];
  const info: Omit<Manifest, "format" | "entries"> = { name: target.name, kind: target.kind, arch: target.arch, meta: target.meta, binary: id, savedAt: Date.now(), app: appVersion() };
  mkdirSync(dirname(path), { recursive: true });
  writeAtomic(path, pack(info, parts));
  if (remember) setDocumentPath(id, path);
}

/** Packs the binary, your work, this project's chats and the decompiled code into one `.eleven` file. One part at a time, one save at a time, so large buffers never pile up. */
export function saveDocument(target: Target, id: string, path: string, remember = true): Promise<void> {
  return saves.run(() => writeDocument(target, id, path, remember));
}

/** Deletes the project's `.eleven` file and every chat in it. */
export function deleteDocument(id: string): void {
  const path = documentPath(id);
  if (path) rmSync(path, { force: true });
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
    setDocumentPath(id, to);
  }
  return to;
}

function isThread(value: unknown): value is SavedThread {
  return isRecord(value) && typeof value.id === "string" && typeof value.title === "string" && Array.isArray(value.messages) && typeof value.updatedAt === "number";
}

function json(data: Uint8Array | null): unknown {
  return data ? JSON.parse(new TextDecoder().decode(data)) : null;
}

/** Unpacks a `.eleven` file: the binary into the cache, then your work, chats and decompiled code. */
export function openDocument(path: string): { readonly manifest: Manifest; readonly binary: string } {
  const file = openElevenFile(path);
  try {
    const { manifest } = file;
    const id = manifest.binary;
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
        if (typeof body !== "string" || !out.startsWith(join(cacheRoot(), id)) || existsSync(out)) continue;
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
