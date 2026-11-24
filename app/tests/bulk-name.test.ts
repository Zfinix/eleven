import { expect, test } from "bun:test";

import { agree, batches, namingPrompt, parseNames } from "../src/engine/bulkName";

const job = (addr: string, size: number) => ({ addr, name: `FUN_${addr.slice(2)}`, pseudocode: "x".repeat(size) });

test("batches start with the smallest functions, which are usually the leaves", () => {
  const split = batches([job("0x3", 300), job("0x1", 10), job("0x2", 100)], 2);
  expect(split.map((batch) => batch.map((item) => item.addr))).toEqual([["0x1", "0x2"], ["0x3"]]);
  expect(namingPrompt(split[0] ?? [], "ls")).toContain("FUN_1 at 0x1:");
});

test("only well-formed names for functions in the batch are kept, with their evidence", () => {
  const batch = [job("0x10", 5), job("0x20", 5)];
  const reply = [
    "Here you go:",
    '{"addr": "0x10", "name": "read_columns", "why": "reads COLUMNS", "evidence": "0x100004906 string \\"COLUMNS\\""}',
    '{"addr": "0x10", "name": "again", "why": "", "evidence": ""}',
    '{"addr": "0x20", "name": "not a name", "why": "", "evidence": ""}',
    '{"addr": "0x99", "name": "elsewhere", "why": "", "evidence": "0x1 x"}',
    '- {"addr": "0x20", "name": "print_usage", "why": "prints usage", "evidence": ""},',
    "{broken",
  ].join("\n");
  expect(parseNames(reply, batch)).toEqual([
    { addr: "0x10", name: "read_columns", why: "reads COLUMNS", evidence: ['0x100004906 string "COLUMNS"'] },
    { addr: "0x20", name: "print_usage", why: "prints usage", evidence: [] },
  ]);
});

test("two passes that agree keep the name with both evidence; ones that differ become a marked guess", () => {
  const first = [
    { addr: "0x10", name: "read_columns", why: "a", evidence: ["0x1 getenv"] },
    { addr: "0x20", name: "parse_args", why: "b", evidence: ["0x2 getopt"] },
    { addr: "0x30", name: "only_once", why: "c", evidence: ["0x3 x"] },
  ];
  const second = [
    { addr: "0x10", name: "Read_Columns", why: "d", evidence: ["0x4 COLUMNS"] },
    { addr: "0x20", name: "handle_flags", why: "e", evidence: ["0x2 getopt"] },
  ];
  expect(agree(first, second)).toEqual([
    { addr: "0x10", name: "read_columns", why: "a", evidence: ["0x1 getenv", "0x4 COLUMNS"] },
    { addr: "0x20", name: "parse_args", why: "Two passes disagreed: parse_args or handle_flags. Check before accepting.", evidence: [] },
  ]);
});
