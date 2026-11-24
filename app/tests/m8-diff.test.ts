import { expect, test } from "bun:test";

import { carryOver, changedLines, changedSpan, classifyFunctions, diffStats, isAutoName, lineDiff, mergeCodePairs, pairByCode, rankChanges, reviewRows } from "../src/workbench/diff";
import type { Fn } from "../src/workbench/model";

function fn(name: string, addr: string): Fn {
  return { name, addr, kind: "function" };
}

test("M8: classifying functions marks what is shared, removed and added", () => {
  const left = [fn("main", "0x100"), fn("old_helper", "0x200"), fn("shared", "0x300")];
  const right = [fn("main", "0xa00"), fn("shared", "0xb00"), fn("new_helper", "0xc00")];
  expect(classifyFunctions(left, right)).toEqual([
    { name: "main", status: "both", left: "0x100", right: "0xa00" },
    { name: "old_helper", status: "removed", left: "0x200", right: null },
    { name: "shared", status: "both", left: "0x300", right: "0xb00" },
    { name: "new_helper", status: "added", left: null, right: "0xc00" },
  ]);
});

test("M8: a line diff keeps shared lines and marks the one that changed", () => {
  expect(lineDiff("int x = 1;\nreturn x;", "int x = 2;\nreturn x;")).toEqual([
    { op: "del", text: "int x = 1;" },
    { op: "add", text: "int x = 2;" },
    { op: "same", text: "return x;" },
  ]);
});

test("M8: identical code is all shared, and empty sides are handled", () => {
  expect(lineDiff("a\nb", "a\nb")).toEqual([
    { op: "same", text: "a" },
    { op: "same", text: "b" },
  ]);
  expect(lineDiff("", "only")).toEqual([{ op: "add", text: "only" }]);
  expect(lineDiff("gone", "")).toEqual([{ op: "del", text: "gone" }]);
});

test("a review numbers both sides and marks only the edited characters", () => {
  const lines = lineDiff("int x = 1;\nreturn x;", "int x = 2;\nreturn x;");
  expect(diffStats(lines)).toEqual({ added: 1, removed: 1 });
  expect(reviewRows(lines, new Set())).toEqual([
    { kind: "line", op: "del", text: "int x = 1;", before: 1, after: null, changed: { start: 8, end: 9 } },
    { kind: "line", op: "add", text: "int x = 2;", before: null, after: 1, changed: { start: 8, end: 9 } },
    { kind: "line", op: "same", text: "return x;", before: 2, after: 2, changed: null },
  ]);
  expect(changedSpan("foo()", "bar")).toBeNull();
});

test("a review folds long unchanged stretches and opens them on request", () => {
  const body = Array.from({ length: 10 }, (_, ix) => `line ${ix}`);
  const before = [...body, "old"].join("\n");
  const after = [...body, "new"].join("\n");
  const folded = reviewRows(lineDiff(before, after), new Set());
  expect(folded[0]).toEqual({ kind: "fold", at: 0, count: 7 });
  expect(folded[1]).toEqual({ kind: "line", op: "same", text: "line 7", before: 8, after: 8, changed: null });
  const opened = reviewRows(lineDiff(before, after), new Set([0]));
  expect(opened.every((row) => row.kind === "line")).toBe(true);
  expect(opened).toHaveLength(12);
});

const BODY = ["stp x29, x30, [sp, #-0x10]!", "mov x29, sp", "bl FUN_100001234", "ldr x0, [x19, #0x18]", "cmp x0, #0x0", "b.eq LAB_100000f40", "ldp x29, x30, [sp], #0x10", "ret"];

test("functions with made-up names pair by the shape of their code", () => {
  expect(isAutoName("FUN_100000a70")).toBe(true);
  expect(isAutoName("sub_4010")).toBe(true);
  expect(isAutoName("parse_args")).toBe(false);
  const moved = BODY.map((line, ix) => `0x10000${(0x2000 + ix * 4).toString(16)}  ${line.replace("FUN_100001234", "FUN_100009999").replace("LAB_100000f40", "LAB_100002f40")}`).join("\n");
  const edited = [...BODY.slice(0, 5), "cmp x1, #0x4", ...BODY.slice(5)].join("\n");
  const original = { name: "FUN_a", addr: "0xa", code: BODY.join("\n") };
  const shuffled = { name: "FUN_b", addr: "0xb", code: [...BODY].reverse().join("\n") };
  const relocated = { name: "FUN_c", addr: "0xc", code: moved };
  expect(pairByCode([original, shuffled], [relocated, { name: "FUN_d", addr: "0xd", code: "ret" }])).toEqual([{ left: original, right: relocated, similarity: 1 }]);
  const near = pairByCode([original], [{ name: "FUN_e", addr: "0xe", code: edited }]).map((pair) => pair.similarity);
  expect(near).toHaveLength(1);
  expect(near.every((score) => score > 0.7 && score < 1)).toBe(true);
});

test("a pair by code joins the removed and added rows into one found in both", () => {
  const matches = classifyFunctions([fn("main", "0x1"), fn("FUN_a", "0xa")], [fn("main", "0x2"), fn("FUN_c", "0xc")]);
  const pairs = [{ left: { name: "FUN_a", addr: "0xa", code: "" }, right: { name: "FUN_c", addr: "0xc", code: "" }, similarity: 1 }];
  expect(mergeCodePairs(matches, pairs)).toEqual([
    { name: "main", status: "both", left: "0x1", right: "0x2" },
    { name: "FUN_a", status: "both", left: "0xa", right: "0xc", renamed: "FUN_c" },
  ]);
});

test("ranking puts the most changed function first and leaves out unchanged ones", () => {
  const same = BODY.join("\n");
  const small = [...BODY.slice(0, 5), "cmp x1, #0x4", ...BODY.slice(5)].join("\n");
  const big = ["mov x0, #0x0", "bl FUN_100002000", "cbz x0, LAB_1", "ldr x1, [x0]", "blr x1", "ret"].join("\n");
  expect(rankChanges([
    { name: "kept", before: same, after: same },
    { name: "tweaked", before: same, after: small },
    { name: "rewritten", before: same, after: big },
  ]).map((item) => item.name)).toEqual(["rewritten", "tweaked"]);
  expect(changedLines("a\nb\nc", "a\nB\nc\nd", 2)).toBe("- b\n+ B\n… 1 more changed lines");
});

test("names and notes come over from the other build onto matched functions, never over ones set here", () => {
  const matches = [
    { name: "FUN_a", status: "both", left: "0xa", right: "0xc", renamed: "FUN_c" },
    { name: "main", status: "both", left: "0x1", right: "0x2" },
    { name: "gone", status: "removed", left: "0x9", right: null },
  ] as const;
  const from = { names: new Map([["0xc", "parse_args"], ["0x2", "real_main"]]), notes: new Map([["0xc", "reads argv"]]) };
  const into = { names: new Map([["0x1", "mine"]]), notes: new Map<string, string>() };
  expect(carryOver(matches, from, into)).toEqual([
    { field: "names", addr: "0xa", value: "parse_args" },
    { field: "notes", addr: "0xa", value: "reads argv" },
  ]);
});
