import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

import { rizinBytes, rizinDisassembly, rizinEntry, rizinFunctions, rizinHasDecompiler, rizinSegments, rizinStrings } from "../src/engine/rizin";
import { activeBackend, ENGINES, setEnabled } from "../src/analysis/engines";
import { prepareTarget } from "../src/engine/target";
import { loadProgram } from "../src/workbench/program";

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

test("rizin reading starts at main, then the entry point, then the first real function", () => {
  expect(rizinEntry([{ addr: "0x1", name: "entry0", kind: "function" }, { addr: "0x2", name: "main", kind: "function" }])?.name).toBe("main");
  expect(rizinEntry([{ addr: "0x1", name: "sym.imp.printf", kind: "thunk" }, { addr: "0x2", name: "entry0", kind: "function" }])?.name).toBe("entry0");
  expect(rizinEntry([{ addr: "0x1", name: "sym.imp.printf", kind: "thunk" }, { addr: "0x2", name: "fcn.00002", kind: "function" }])?.name).toBe("fcn.00002");
  expect(rizinEntry([])).toBeNull();
});

run("rizin backend: reads functions, strings, segments and bytes with no JVM", async () => {
  const fixture = ghidraBinary("linux_x86_64", (name) => !name.includes("."));
  const fns = await rizinFunctions(fixture);
  expect(fns.length).toBeGreaterThan(50);
  expect(fns[0]?.addr).toMatch(/^0x[0-9a-f]+$/);

  const strings = await rizinStrings(fixture);
  expect(strings.length).toBeGreaterThan(5);

  const segments = await rizinSegments(fixture);
  expect(segments.length).toBeGreaterThan(2);

  const bytes = await rizinBytes(fixture, fns[0]?.addr ?? "0x0", 32);
  expect(bytes.length).toBeGreaterThan(0);
  expect(bytes[0]?.bytes).toMatch(/^[0-9a-f ]+$/);

  const asm = await rizinDisassembly(fixture, fns[0]?.addr ?? "0x0");
  expect(asm.length).toBeGreaterThan(10);
}, 120_000);

run("rizin engine: turning it on routes loadProgram through the native backend, no JVM", async () => {
  process.env.ELEVEN_SUPPORT = mkdtempSync(join(tmpdir(), "eleven-rizin-prog-"));
  for (const e of ENGINES) setEnabled(e.id, false);
  setEnabled("rizin", true);
  expect(activeBackend()).toBe("pipe");

  const target = prepareTarget(ghidraBinary("linux_x86_64", (name) => !name.includes(".")));
  const program = await loadProgram(target);
  expect(program.total).toBeGreaterThan(50);
  expect(program.strings.length).toBeGreaterThan(5);

  const first = program.functions[0]?.addr ?? "0x0";
  expect((await program.code(first, "asm")).length).toBeGreaterThan(10);
  const pseudo = await program.code(first, "pseudo");
  if (await rizinHasDecompiler(target.path)) expect(pseudo).toContain("{");
  else expect(pseudo).toContain("disassembly");
  expect((await program.hex(first)).length).toBeGreaterThan(0);

  const refs = await program.refs(first);
  expect(Array.isArray(refs.callers)).toBe(true);
  expect(Array.isArray(refs.callees)).toBe(true);
}, 120_000);
