import { beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { adoptLoginShell } from "../src/agents/detect";
import { ENGINES, setEnabled } from "../src/analysis/engines";
import { adoptToolchain } from "../src/engine/toolchain";
import { prepareTarget } from "../src/engine/target";
import { openProgram } from "../src/workbench/program";

function ghidraBinary(os: string, match: (name: string) => boolean): string {
  const dir = join(process.env.GHIDRA_INSTALL_DIR ?? join(process.env.HOME ?? "", ".local/share/ghidra_12.1.4_PUBLIC"), "GPL", "DemanglerGnu", "os", os);
  const file = existsSync(dir) ? readdirSync(dir).find(match) : undefined;
  if (!file) throw new Error(`no binary found in ${dir} to test with`);
  return join(dir, file);
}

function rizinInstalled(): boolean {
  try {
    execFileSync("rizin", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const run = rizinInstalled() ? test : test.skip;

beforeAll(async () => {
  await adoptLoginShell();
  adoptToolchain();
});

run("a rizin quick look shows functions first, then Ghidra's full read replaces it", async () => {
  process.env.ELEVEN_SUPPORT = mkdtempSync(join(tmpdir(), "eleven-preview-"));
  for (const e of ENGINES) setEnabled(e.id, false);
  setEnabled("ghidra", true);

  const fresh = join(process.env.ELEVEN_SUPPORT, "fresh-elf");
  copyFileSync(ghidraBinary("linux_x86_64", (name) => !name.includes(".")), fresh);
  appendFileSync(fresh, randomBytes(16));
  const target = prepareTarget(fresh);
  const started = Date.now();
  const { first, full } = openProgram(target);

  const preview = await first;
  const previewMs = Date.now() - started;
  expect(preview.preview).toBe(true);
  expect(preview.functions.length).toBeGreaterThan(50);
  expect(preview.retype).toBeNull();
  expect(await preview.code(preview.functions[0]?.addr ?? "0x0", "pseudo")).toContain("Ghidra is still reading this file");

  const program = await full;
  expect(program.preview).toBeUndefined();
  expect(program.engine).toBe("Ghidra");
  expect(Date.now() - started).toBeGreaterThan(previewMs);
  const ghidraAddrs = new Set(program.functions.map((fn) => fn.addr));
  expect(preview.functions.some((fn) => ghidraAddrs.has(fn.addr))).toBe(true);
}, 300_000);
