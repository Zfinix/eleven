import type { BigIntStats } from "node:fs";
import { open, readdir, type FileHandle } from "node:fs/promises";
import { fun, getManyValues, none } from "stream-chain/core";
import filter from "stream-json/core/filters/filter.js";
import parser from "stream-json/core/parser.js";
import stringer from "stream-json/core/stringer.js";

import { isRecord, type JsonRecord } from "../lib/guards";
import { supportPath } from "../lib/support";
import { projectId } from "./project";
import { prepareTarget } from "./target";

async function chatFiles(): Promise<readonly string[]> {
  try {
    const names = await readdir(supportPath("threads"));
    return names.filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function openChat(name: string): Promise<FileHandle | null> {
  try {
    return await open(supportPath("threads", name), "r");
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

/** Validate the complete JSON while assembling only the fields needed to identify its project. */
async function chatMetadata(file: FileHandle): Promise<JsonRecord | null> {
  const select = fun(
    (chunk: string | typeof none): string | typeof none => chunk,
    parser({ packStrings: false }),
    filter({ filter: /^(id|title|target|project|updatedAt)$/ }),
    stringer(),
  );
  const chunks: string[] = [];
  for await (const text of chatText(file)) chunks.push(...getManyValues(await select(text)));
  chunks.push(...getManyValues(await select(none)));

  const metadata: unknown = JSON.parse(chunks.join("") || "null");
  return isRecord(metadata) ? metadata : null;
}

async function* chatText(file: FileHandle): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  for await (const chunk of chatBytes(file)) yield decoder.decode(chunk, { stream: true });
  yield decoder.decode();
}

function chatProject(metadata: JsonRecord | null): string | null {
  if (!metadata || typeof metadata.id !== "string" || typeof metadata.title !== "string" || typeof metadata.updatedAt !== "number") return null;
  if (typeof metadata.project === "string") return metadata.project;
  if (metadata.project === null || typeof metadata.target !== "string") return null;

  // Chats saved before projects existed inherit their target's project, as loadThread does.
  try {
    return projectId(prepareTarget(metadata.target));
  } catch {
    return null;
  }
}

async function assertUnchanged(file: FileHandle, before: BigIntStats): Promise<void> {
  const after = await file.stat({ bigint: true });
  if (after.size !== before.size || after.mtimeNs !== before.mtimeNs) {
    throw new Error("A chat changed while saving the project. Try saving again.");
  }
}

async function* chatBytes(file: FileHandle): AsyncGenerator<Uint8Array> {
  for await (const chunk of file.createReadStream({ start: 0, autoClose: false })) {
    if (!(chunk instanceof Uint8Array)) throw new Error("Couldn't read the saved chat bytes.");
    yield chunk;
  }
}

/** Keep both passes on one descriptor and reject in-place edits before committing the archive. */
export async function* documentChats(project: string): AsyncGenerator<Uint8Array> {
  let separator = "";
  yield Buffer.from("[");

  for (const name of await chatFiles()) {
    await using file = await openChat(name);
    if (!file) continue;

    const before = await file.stat({ bigint: true });
    const metadata = await chatMetadata(file);
    if (chatProject(metadata) !== project) continue;

    yield Buffer.from(separator);
    yield* chatBytes(file);
    await assertUnchanged(file, before);
    separator = ",";
  }

  yield Buffer.from("]");
}
