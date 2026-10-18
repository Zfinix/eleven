import { expect, test } from "bun:test";

import type { Fn } from "../src/workbench/model";
import { hasFunctionModules, indexFunctionModules } from "../src/workbench/sidebar/functionModules";
import { functionRows } from "../src/workbench/sidebar/model";

const fn = (addr: string, name: string, kind: Fn["kind"] = "function", file?: string): Fn => ({ addr, name, kind, ...(file ? { file } : {}) });

const UNITY: readonly Fn[] = [
  fn("0x1000", "RegisterModule_Physics"),
  fn("0x1010", "RegisterModule_Audio"),
  fn("0x2000", "_GLOBAL__sub_I_Modules_Physics_0.cpp"),
  fn("0x2010", "FUN_00002010"),
  fn("0x2020", "FUN_00002020"),
  fn("0x2030", "InitializeModule_Physics"),
  fn("0x3000", "_GLOBAL__sub_I_Modules_Audio_0.cpp"),
  fn("0x3010", "FUN_00003010"),
  fn("0x3020", "_GLOBAL__sub_I_Modules_Video_0.cpp"),
  fn("0x3030", "FUN_00003030"),
  fn("0x3040", "CleanupModule_Audio"),
  fn("0x4000", "FUN_00004000", "function", "Runtime/Modules/Animation/Clip.cpp"),
  fn("0x5000", "_memcpy", "thunk"),
];

test("only binaries with module registration count as having modules", () => {
  expect(hasFunctionModules(UNITY)).toBe(true);
  expect(hasFunctionModules([fn("0x1", "main"), fn("0x2", "_GLOBAL__sub_I_main.cpp")])).toBe(false);
});

test("markers, source paths and guesses between two markers of one module", () => {
  const modules = indexFunctionModules(UNITY);
  expect(modules.get("0x2000")).toEqual({ name: "Physics", evidence: "source" });
  expect(modules.get("0x2010")).toEqual({ name: "Physics", evidence: "layout" });
  expect(modules.get("0x2030")).toEqual({ name: "Physics", evidence: "symbol" });
  expect(modules.get("0x4000")).toEqual({ name: "Animation", evidence: "source" });
});

test("no guess crosses a marker of another or unknown module", () => {
  const modules = indexFunctionModules(UNITY);
  expect(modules.get("0x3010")).toBeUndefined();
  expect(modules.get("0x3030")).toBeUndefined();
  expect(modules.get("0x3020")).toBeUndefined();
});

test("module headings sort A to Z with Imports and Unmapped last, and mark guesses", () => {
  const modules = indexFunctionModules(UNITY);
  const base = { nameOf: (addr: string) => UNITY.find((f) => f.addr === addr)?.name ?? addr, renamed: new Set<string>(), query: "", show: "all" as const, sort: "modules" as const, modules };
  const folded = functionRows(UNITY, { ...base, flipped: new Set<string>() });
  expect(folded.map((row) => (row.kind === "node" ? `${row.name} ${row.count}` : row.label))).toEqual(["Animation 1", "Audio 3", "Physics 5", "Imports 1", "Unmapped 3"]);
  const open = functionRows(UNITY, { ...base, flipped: new Set(["#module/Physics", "#module/Physics/#unnamed"]) });
  const guessed = open.filter((row) => row.kind === "fn" && row.module?.evidence === "layout").map((row) => (row.kind === "fn" ? row.fn.addr : ""));
  expect(guessed).toEqual(["0x2010", "0x2020"]);
});

test("search matches module names and says where each match lives", () => {
  const modules = indexFunctionModules(UNITY);
  const rows = functionRows(UNITY, { nameOf: (addr) => UNITY.find((f) => f.addr === addr)?.name ?? addr, renamed: new Set(), query: "physics", show: "all", sort: "modules", modules, flipped: new Set() });
  const where = rows.flatMap((row) => (row.kind === "fn" && row.fn.addr === "0x2010" ? [row.where] : []));
  expect(rows.length).toBe(5);
  expect(where).toEqual(["Physics · guessed"]);
});

test("a large inventory indexes quickly", () => {
  const many: Fn[] = [fn("0x10", "RegisterModule_Core")];
  for (let i = 0; i < 150_000; i++) many.push(fn(`0x${(0x100000 + i * 16).toString(16)}`, i % 1000 === 0 ? "_GLOBAL__sub_I_Modules_Core_0.cpp" : `FUN_${i}`));
  const started = performance.now();
  const modules = indexFunctionModules(many);
  expect(performance.now() - started).toBeLessThan(2000);
  expect(modules.size).toBeGreaterThan(140_000);
});
