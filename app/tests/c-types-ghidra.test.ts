import "./fixtures/isolate";
import { beforeAll, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { adoptLoginShell } from "../src/agents/detect";
import { rea } from "../src/engine/rea";
import { prepareTarget } from "../src/engine/target";
import { adoptToolchain } from "../src/engine/toolchain";
import { loadProgram } from "../src/workbench/program";

function ghidraBinary(os: string, match: (name: string) => boolean): string {
  const dir = join(process.env.GHIDRA_INSTALL_DIR ?? "", "GPL", "DemanglerGnu", "os", os);
  const file = existsSync(dir) ? readdirSync(dir).find(match) : undefined;
  if (!file) throw new Error(`no binary found in ${dir} to test with`);
  return join(dir, file);
}

beforeAll(async () => {
  await adoptLoginShell();
  adoptToolchain();
});

test("C types: Ghidra adds a struct, places it at an address, and refuses C it can't read", async () => {
  const program = await loadProgram(prepareTarget(ghidraBinary("linux_x86_64", (name) => !name.includes("."))));
  const define = program.defineCType;
  if (!define) throw new Error("the Ghidra engine should take C types");
  await define("struct eleven_pair { int first; int second; };", null);
  const data = program.segments.find((row) => /data/i.test(row.a));
  const at = data ? /^0x[0-9a-f]+/i.exec(data.b)?.[0] : undefined;
  if (!at) throw new Error("need a data segment to place the struct in");
  const placed = await rea.tool(program.path, "define_c_type", { declaration: "struct eleven_pair { int first; int second; };", address: at });
  expect(placed).toMatchObject({ name: "eleven_pair", size: 8, address: at.toLowerCase() });
  await expect(define("struct broken { int x", null)).rejects.toThrow("Could not read that C");
}, 600_000);
