import { createHash } from "node:crypto";
import { closeSync, createReadStream, openSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { constants, createZstdCompress } from "node:zlib";

import { isRecord } from "../lib/guards";

/** `.eleven` files start with these bytes; the last one is the container version. */
const MAGIC = new Uint8Array([0x45, 0x4c, 0x45, 0x56, 0x45, 0x4e, 0x00, 0x01]);
const HEADER = MAGIC.length + 4;

export const FORMAT = 1;

export type Codec = "zstd" | "none";

export type Entry = { readonly name: string; readonly codec: Codec; readonly offset: number; readonly size: number; readonly raw: number; readonly sha256: string };

export type Manifest = {
  readonly format: number;
  readonly name: string;
  readonly kind: string;
  readonly arch: string;
  readonly meta: string;
  /** SHA-256 of the binary REA reads: the project's id. */
  readonly binary: string;
  readonly savedAt: number;
  readonly app: string;
  readonly entries: readonly Entry[];
};

export type Packed = { readonly name: string; readonly packed: Uint8Array; readonly raw: number; readonly sha256: string };

export type Part = { readonly name: string; readonly data: Uint8Array; readonly level: number } | Packed;

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function compress(data: Uint8Array, level: number): Uint8Array {
  return Bun.zstdCompressSync(data, { level });
}

/** Compresses as it reads, keeping only the compressed bytes, so a large input is never held whole. */
export async function compressStream(name: string, input: AsyncIterable<Uint8Array>, level: number): Promise<Packed> {
  const hash = createHash("sha256");
  const out: Uint8Array[] = [];
  let raw = 0;
  async function* measured(): AsyncGenerator<Uint8Array> {
    for await (const chunk of input) {
      hash.update(chunk);
      raw += chunk.length;
      yield chunk;
    }
  }
  const collect = new Writable({
    write(chunk: Uint8Array, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
      out.push(chunk);
      done();
    },
  });
  await pipeline(Readable.from(measured(), { objectMode: false }), createZstdCompress({ params: { [constants.ZSTD_c_compressionLevel]: level } }), collect);
  return { name, packed: Buffer.concat(out), raw, sha256: hash.digest("hex") };
}

export function compressFile(name: string, path: string, level: number): Promise<Packed> {
  return compressStream(name, createReadStream(path), level);
}

function packed(part: Part): Packed {
  return "data" in part ? { name: part.name, packed: compress(part.data, part.level), raw: part.data.length, sha256: sha256(part.data) } : part;
}

/** One file: magic, the manifest's length, the manifest as JSON, then each entry compressed on its own. */
export function pack(info: Omit<Manifest, "format" | "entries">, parts: readonly Part[]): Uint8Array {
  let offset = 0;
  const entries: Entry[] = [];
  const blobs: Uint8Array[] = [];
  for (const part of parts) {
    const ready = packed(part);
    entries.push({ name: ready.name, codec: "zstd", offset, size: ready.packed.length, raw: ready.raw, sha256: ready.sha256 });
    blobs.push(ready.packed);
    offset += ready.packed.length;
  }
  const manifest = new TextEncoder().encode(JSON.stringify({ ...info, format: FORMAT, entries }));
  const out = new Uint8Array(HEADER + manifest.length + offset);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(MAGIC.length, manifest.length, true);
  out.set(manifest, HEADER);
  let at = HEADER + manifest.length;
  for (const blob of blobs) {
    out.set(blob, at);
    at += blob.length;
  }
  return out;
}

/** Writes beside the target, then renames over it, so a crash or a failed write never leaves half a project. */
export function writeAtomic(path: string, data: Uint8Array): void {
  const temp = `${path}.saving`;
  try {
    writeFileSync(temp, data);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function readAt(fd: number, offset: number, length: number): Uint8Array {
  const buffer = new Uint8Array(length);
  let done = 0;
  while (done < length) {
    const read = readSync(fd, buffer, done, length - done, offset + done);
    if (read === 0) throw new Error("This project file is cut short.");
    done += read;
  }
  return buffer;
}

function isEntry(value: unknown): value is Entry {
  return isRecord(value) && typeof value.name === "string" && (value.codec === "zstd" || value.codec === "none") && typeof value.offset === "number" && typeof value.size === "number" && typeof value.raw === "number" && typeof value.sha256 === "string";
}

function parseManifest(text: string): Manifest {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || !Array.isArray(parsed.entries)) throw new Error("This project file has no table of contents.");
  const { format, name, kind, arch, meta, binary, savedAt, app } = parsed;
  if (typeof format !== "number" || format > FORMAT) throw new Error("This project was saved by a newer Eleven. Update Eleven to open it.");
  if (typeof name !== "string" || typeof kind !== "string" || typeof arch !== "string" || typeof meta !== "string" || typeof binary !== "string" || typeof savedAt !== "number" || typeof app !== "string") {
    throw new Error("This project file's details are damaged.");
  }
  return { format, name, kind, arch, meta, binary, savedAt, app, entries: parsed.entries.filter(isEntry) };
}

/** The open project file: its manifest, read without decompressing anything, and each entry on demand. */
export type ElevenFile = { readonly manifest: Manifest; readonly entry: (name: string) => Uint8Array | null; readonly close: () => void };

export function openElevenFile(path: string): ElevenFile {
  const fd = openSync(path, "r");
  try {
    const head = readAt(fd, 0, HEADER);
    if (!MAGIC.every((byte, ix) => head[ix] === byte)) throw new Error("This isn't an Eleven project file.");
    const length = new DataView(head.buffer).getUint32(MAGIC.length, true);
    const manifest = parseManifest(new TextDecoder().decode(readAt(fd, HEADER, length)));
    const base = HEADER + length;
    return {
      manifest,
      entry: (name) => {
        const found = manifest.entries.find((entry) => entry.name === name);
        if (!found) return null;
        const packed = readAt(fd, base + found.offset, found.size);
        const damaged = new Error(`Part of this project (${name}) is damaged.`);
        let raw: Uint8Array;
        try {
          raw = found.codec === "zstd" ? new Uint8Array(Bun.zstdDecompressSync(packed)) : packed;
        } catch {
          throw damaged;
        }
        if (raw.length !== found.raw || sha256(raw) !== found.sha256) throw damaged;
        return raw;
      },
      close: () => closeSync(fd),
    };
  } catch (err) {
    closeSync(fd);
    throw err;
  }
}
