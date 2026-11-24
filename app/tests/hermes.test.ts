import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decompileHermes, failureLine, hbcDecompiler, hermesSupported } from "../src/engine/hermes";

test("supported versions, and a Python failure reads as its last line", () => {
  expect(hermesSupported(96)).toBe(true);
  expect(hermesSupported(94)).toBe(false);
  expect(failureLine("Traceback (most recent call last):\n  File x\nValueError: This file does not have the magic header for a Hermes bytecode file.\n")).toBe("ValueError: This file does not have the magic header for a Hermes bytecode file.");
});

const run = hbcDecompiler() ? test : test.skip;

run("a file that isn't Hermes bytecode fails with hermes-dec's own reason", async () => {
  const dir = mkdtempSync(join(tmpdir(), "eleven-hermes-"));
  const fake = join(dir, "index.android.bundle");
  writeFileSync(fake, "not hermes at all");
  await expect(decompileHermes(fake)).rejects.toThrow("magic header");
}, 60_000);
