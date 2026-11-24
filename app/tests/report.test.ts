import { expect, test } from "bun:test";

import type { Edit } from "../src/engine/edits";
import { EMPTY_PROJECT } from "../src/engine/project";
import { projectReport } from "../src/workbench/report";

const claude = { kind: "agent", agent: "Claude", chat: null } as const;

function applied(field: Edit["field"], key: string, after: string, evidence?: readonly string[]): Edit {
  return { id: `${field}:${key}`, at: 1, changedAt: 1, by: claude, field, key, before: null, after, status: "applied", ...(evidence ? { evidence } : {}) };
}

test("the report lists names with who set them and why, and counts unchecked guesses", () => {
  const project = {
    ...EMPTY_PROJECT,
    names: new Map([["0x10", "read_columns"], ["0x20", "do_thing"]]),
    notes: new Map([["0x10", "reads COLUMNS | then parses"]]),
    ctypes: new Map([["header", "struct header { int magic; };"]]),
    ctypeAt: new Map([["0x8000", "header"]]),
    edits: [applied("names", "0x10", "read_columns", ['0x4906 string "COLUMNS"']), applied("names", "0x20", "do_thing"), applied("notes", "0x10", "reads COLUMNS | then parses", ["0x4906 string"])],
  };
  const report = projectReport("ls", project, (addr) => `FUN_${addr.slice(2)}`, new Date("2026-11-18"));
  expect(report).toContain("# ls");
  expect(report).toContain("2 names, 1 notes, 0 comments, 1 still unchecked guesses.");
  expect(report).toContain('| 0x10 | FUN_10 | read_columns | Claude; 0x4906 string "COLUMNS" |');
  expect(report).toContain("| 0x20 | FUN_20 | do_thing | Claude, no evidence |");
  expect(report).toContain("reads COLUMNS \\| then parses");
  expect(report).toContain("```c\nstruct header { int magic; };\n```");
  expect(report).toContain("| 0x8000 | header |");
  expect(report).not.toContain("## Patches");
});
