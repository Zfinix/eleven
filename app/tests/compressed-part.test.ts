import { expect, test } from "bun:test";

import { compressPart } from "../src/engine/compressedPart";
import { sha256 } from "../src/engine/elevenFile";

test("streamed compression preserves chunked bytes and their integrity metadata", async () => {
  const bytes = Buffer.from("Unicode: 日本語 🐘\n".repeat(16000));
  async function* chunks(): AsyncGenerator<Uint8Array> {
    for (let offset = 0; offset < bytes.length; offset += 4093) {
      yield bytes.subarray(offset, offset + 4093);
    }
  }

  const part = await compressPart("chats.json", chunks());
  expect(Bun.zstdDecompressSync(part.packed)).toEqual(bytes);
  expect(part.raw).toBe(bytes.length);
  expect(part.sha256).toBe(sha256(bytes));
});

test("a source failure rejects a partially compressed part and closes the source", async () => {
  let closed = false;
  async function* interrupted(): AsyncGenerator<Uint8Array> {
    try {
      yield Buffer.alloc(128 * 1024, 42);
      throw new Error("source read interrupted");
    } finally {
      closed = true;
    }
  }

  await expect(compressPart("binary", interrupted())).rejects.toThrow("source read interrupted");
  expect(closed).toBe(true);
});
