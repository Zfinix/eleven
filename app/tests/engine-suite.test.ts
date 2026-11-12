import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { adoptLoginShell } from "../src/agents/detect";
import { chooseEngine, ENGINES, type EngineId, setEnabled } from "../src/analysis/engines";
import { prepareTarget } from "../src/engine/target";
import { adoptToolchain } from "../src/engine/toolchain";
import { loadProgram } from "../src/workbench/program";

/** Every engine that opens files itself. Hopper is left out: it opens its own window. Paid engines run only where they're installed. */
const SUITE: readonly EngineId[] = ["ghidra", "rizin", "radare2", "ida", "binaryninja"];

/** A Linux binary that ships with every Ghidra install, so no extra fixture is needed. */
function elf(): string {
  const dir = join(process.env.GHIDRA_INSTALL_DIR ?? join(process.env.HOME ?? "", ".local/share/ghidra_12.1.4_PUBLIC"), "GPL", "DemanglerGnu", "os", "linux_x86_64");
  const file = existsSync(dir) ? readdirSync(dir).find((name) => !name.includes(".")) : undefined;
  if (!file) throw new Error(`no binary found in ${dir} to test with`);
  return join(dir, file);
}

await adoptLoginShell();
adoptToolchain();

function use(id: EngineId): void {
  process.env.ELEVEN_SUPPORT = mkdtempSync(join(tmpdir(), `eleven-suite-${id}-`));
  for (const engine of ENGINES) setEnabled(engine.id, false);
  chooseEngine(id);
}

describe("every installed engine reads the same ELF the same way", () => {
  for (const id of SUITE) {
    const engine = ENGINES.find((candidate) => candidate.id === id);
    const run = engine?.installed() ? test : test.skip;
    run(`${engine?.name ?? id}: functions, strings, segments, code, bytes and callers`, async () => {
      use(id);
      const program = await loadProgram(prepareTarget(elf()));
      expect(program.engine).toBe(engine?.name ?? id);
      expect(program.total).toBeGreaterThan(50);
      expect(program.strings.length).toBeGreaterThan(5);
      expect(program.segments.length).toBeGreaterThan(2);
      const main = program.functions.find((fn) => /(^|\.)main$/.test(fn.name)) ?? program.functions.find((fn) => fn.kind === "function");
      if (!main) throw new Error("no functions");
      expect((await program.code(main.addr, "asm")).length).toBeGreaterThan(20);
      expect((await program.code(main.addr, "pseudo")).length).toBeGreaterThan(20);
      const hex = await program.hex(main.addr);
      expect(hex[0]?.bytes).toMatch(/^[0-9a-f]{2}( [0-9a-f]{2})*$/);
      const refs = await program.refs(main.addr);
      expect(refs.callers.length + refs.callees.length).toBeGreaterThan(0);
    }, 600_000);
  }
});
