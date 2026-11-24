import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { progressOf, systemCache, systemLibraries, unpack, unpackedDir } from "../src/engine/dyldCache";

test("progress lines and the unpacked libraries as their paths on a running Mac", () => {
  expect(progressOf("0 4115")).toEqual({ done: 1, total: 4115 });
  expect(progressOf("not progress")).toBeNull();
  const dir = mkdtempSync(join(tmpdir(), "eleven-dyld-"));
  mkdirSync(join(dir, "usr", "lib"), { recursive: true });
  mkdirSync(join(dir, "System", "Library", "Frameworks", "Security.framework", "Versions", "A"), { recursive: true });
  writeFileSync(join(dir, "usr", "lib", "libz.1.dylib"), "");
  writeFileSync(join(dir, "System", "Library", "Frameworks", "Security.framework", "Versions", "A", "Security"), "");
  writeFileSync(join(dir, ".unpacked"), "");
  expect(systemLibraries(dir)).toEqual(["/System/Library/Frameworks/Security.framework/Versions/A/Security", "/usr/lib/libz.1.dylib"]);
});

const run = process.platform === "darwin" && systemCache() !== null ? test : test.skip;

run("a file that isn't a dyld cache stops the unpack with macOS's reason and leaves nothing behind", async () => {
  const fake = join(mkdtempSync(join(tmpdir(), "eleven-dyld-fake-")), "dyld_shared_cache_arm64e");
  writeFileSync(fake, "not a cache");
  await expect(unpack(fake, () => {})).rejects.toThrow();
  expect(existsSync(unpackedDir(fake))).toBe(false);
}, 120_000);
