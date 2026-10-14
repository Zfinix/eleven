import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectEngine } from "../src/welcome/engines";
import { hasDecompiler, nativeDir } from "../src/welcome/decompiler";
import { ANALYZE_HEADLESS, exe } from "../src/lib/platform";

let home = "";
const inherited = process.env.GHIDRA_INSTALL_DIR;

beforeEach(() => {
  home = join(mkdtempSync(join(tmpdir(), "eleven-ghidra-")), "ghidra_12.1.4_PUBLIC");
  mkdirSync(join(home, "support"), { recursive: true });
  writeFileSync(join(home, "support", ANALYZE_HEADLESS), "");
  process.env.GHIDRA_INSTALL_DIR = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (inherited === undefined) delete process.env.GHIDRA_INSTALL_DIR;
  else process.env.GHIDRA_INSTALL_DIR = inherited;
});

function addDecompiler(dir: string): void {
  const os = join(home, "Ghidra", "Features", "Decompiler", "os", dir);
  mkdirSync(os, { recursive: true });
  writeFileSync(join(os, exe("decompile")), "");
}

test("each machine looks in its own native folder", () => {
  expect(nativeDir("mac", "arm64")).toBe("mac_arm_64");
  expect(nativeDir("mac", "x64")).toBe("mac_x86_64");
  expect(nativeDir("linux", "arm64")).toBe("linux_arm_64");
  expect(nativeDir("linux", "x64")).toBe("linux_x86_64");
  expect(nativeDir("windows", "x64")).toBe("win_x86_64");
});

test("another machine's decompiler doesn't count", () => {
  addDecompiler(nativeDir() === "linux_x86_64" ? "win_x86_64" : "linux_x86_64");
  expect(hasDecompiler(home)).toBe(false);
  const found = detectEngine("ghidra");
  expect(found.found).toBe(false);
  expect(found.repair).toContain("decompiler");
});

test("ghidra is ready once this machine's decompiler is there", () => {
  addDecompiler(nativeDir());
  expect(hasDecompiler(home)).toBe(true);
  expect(detectEngine("ghidra")).toEqual({ found: true, where: home });
});
