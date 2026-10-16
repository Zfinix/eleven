import { createHash } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { constants, createZstdCompress } from "node:zlib";

import type { PackedPart } from "./elevenFile";

/** Compress with backpressure, retaining only the compressed output and its integrity metadata. */
export async function compressPart(
  name: string,
  input: AsyncIterable<Uint8Array>,
): Promise<PackedPart> {
  const checksum = createHash("sha256");
  const packed: Uint8Array[] = [];
  let raw = 0;

  async function* measuredInput(): AsyncGenerator<Uint8Array> {
    for await (const chunk of input) {
      checksum.update(chunk);
      raw += chunk.byteLength;
      yield chunk;
    }
  }

  const compressor = createZstdCompress({
    params: { [constants.ZSTD_c_compressionLevel]: 3 },
  });
  const collect = new Writable({
    write(chunk: Uint8Array, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
      packed.push(chunk);
      done();
    },
  });

  await pipeline(
    Readable.from(measuredInput(), { objectMode: false }),
    compressor,
    collect,
  );

  return { name, packed: Buffer.concat(packed), raw, sha256: checksum.digest("hex") };
}
