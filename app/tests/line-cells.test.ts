import { expect, test } from "bun:test";

import { cellAt, chunksOf, columnAt, lineText, spansOf } from "../src/workbench/lineCells";

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

test("spans colour every character, merging neighbours of one colour", () => {
  expect(spansOf(cells)).toEqual([[0, 2, "#kw"], [2, 11, "#plain"], [11, 14, "#call"]]);
});

test("spans leave no gap, so nothing falls back to an inherited colour", () => {
  const spans = spansOf(cells);
  expect(spans[0]?.[0]).toBe(0);
  expect(spans.at(-1)?.[1]).toBe(lineText(cells).length);
  for (const [ix, span] of spans.entries()) if (ix > 0) expect(span[0]).toBe(spans[ix - 1]?.[1] ?? -1);
});

test("a column finds the cell it lands in", () => {
  expect(cellAt(cells, 0)?.text).toBe("if");
  expect(cellAt(cells, 4)?.text).toBe("count");
  expect(cellAt(cells, 99)).toBeNull();
  expect(cellAt(cells, -1)).toBeNull();
});

test("a click's column comes from the run's own box", () => {
  const box = { x: 100, width: 140 };
  expect(columnAt(box, 100, 14)).toBe(0);
  expect(columnAt(box, 145, 14)).toBe(4);
  expect(columnAt(box, 239, 14)).toBe(13);
  expect(columnAt({ x: 0, width: 0 }, 5, 10)).toBe(-1);
  expect(columnAt(box, 100, 0)).toBe(-1);
});

test("links keep their own element so they can be labelled and clicked", () => {
  const chunks = chunksOf(cells);
  expect(chunks.map((chunk) => chunk.kind)).toEqual(["text", "own"]);
  expect(chunks[1]?.kind === "own" && chunks[1].cell.opens).toBe("0x100");
});

test("text that is not fixed width keeps its own element, so clicks stay exact", () => {
  const wide = [
    { text: 'puts("', color: "#s", token: null, opens: null },
    { text: "日本語テキスト", color: "#s", token: { text: "日本語テキスト", addr: null }, opens: null },
    { text: '")', color: "#s", token: null, opens: null },
  ];
  const chunks = chunksOf(wide);
  expect(chunks.map((chunk) => chunk.kind)).toEqual(["text", "own", "text"]);
});

test("an emoji in a string literal does not shift the columns after it", () => {
  const emoji = [
    { text: "msg = ", color: "#p", token: null, opens: null },
    { text: "🎉", color: "#s", token: null, opens: null },
    { text: " end", color: "#p", token: { text: "end", addr: null }, opens: null },
  ];
  expect(chunksOf(emoji).map((chunk) => chunk.kind)).toEqual(["text", "own", "text"]);
});

test("a tab keeps its own element, since it can draw wider than one column", () => {
  const tabbed = [
    { text: "mov", color: "#kw", token: { text: "mov", addr: null }, opens: null },
    { text: "\t", color: "#p", token: null, opens: null },
    { text: "x0, x1", color: "#p", token: null, opens: null },
  ];
  expect(chunksOf(tabbed).map((chunk) => chunk.kind)).toEqual(["text", "own", "text"]);
});
