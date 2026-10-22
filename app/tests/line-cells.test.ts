import { expect, test } from "bun:test";

import { cellAt, chunksOf, lineText, spansOf, wordRanges } from "../src/workbench/lineCells";

const cells = [
  { text: "if", color: "#kw", token: { text: "if", addr: null }, opens: null },
  { text: " (", color: "#plain", token: null, opens: null },
  { text: "count", color: "#plain", token: { text: "count", addr: null }, opens: null },
  { text: ") ", color: "#plain", token: null, opens: null },
  { text: "run", color: "#call", token: { text: "run", addr: "0x100" }, opens: "0x100" },
];

test("the line draws as one string", () => {
  expect(lineText(cells)).toBe("if (count) run");
});

test("spans cover only the coloured runs", () => {
  expect(spansOf(cells, "#plain")).toEqual([[0, 2, "#kw"], [11, 14, "#call"]]);
});

test("neighbouring cells of one colour merge into one span", () => {
  const same = [
    { text: "a", color: "#x", token: null, opens: null },
    { text: "b", color: "#x", token: null, opens: null },
  ];
  expect(spansOf(same, "#plain")).toEqual([[0, 2, "#x"]]);
});

test("a column finds the cell it lands in", () => {
  expect(cellAt(cells, 0)?.text).toBe("if");
  expect(cellAt(cells, 4)?.text).toBe("count");
  expect(cellAt(cells, 12)?.opens).toBe("0x100");
  expect(cellAt(cells, 99)).toBeNull();
  expect(cellAt(cells, -1)).toBeNull();
});

test("the picked word lights up everywhere it appears", () => {
  const twice = [
    { text: "x", color: "#p", token: null, opens: null },
    { text: " = ", color: "#p", token: null, opens: null },
    { text: "x", color: "#p", token: null, opens: null },
  ];
  expect(wordRanges(twice, "x")).toEqual([[0, 1], [4, 5]]);
  expect(wordRanges(twice, null)).toEqual([]);
});

test("a renamed word lights up under the name the line holds", () => {
  const renamed = [
    { text: "decryptKey", color: "#d", token: { text: "FUN_1000", addr: "0x1000" }, opens: null },
  ];
  expect(wordRanges(renamed, "FUN_1000")).toEqual([[0, 10]]);
});

test("plain cells merge into one chunk and links keep their own", () => {
  const mixed = [
    { text: "bl ", color: "#p", token: null, opens: null },
    { text: "setup", color: "#l", token: { text: "FUN_1", addr: "0x1" }, opens: "0x1" },
    { text: " ; go", color: "#c", token: null, opens: null },
  ];
  const chunks = chunksOf(mixed);
  expect(chunks.map((chunk) => chunk.kind)).toEqual(["text", "link", "text"]);
  expect(chunks[1]?.kind === "link" && chunks[1].cell.opens).toBe("0x1");
});
