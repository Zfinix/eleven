import { expect, test } from "bun:test";

import { EMPTY_PROJECT } from "../src/engine/project";
import { addressesIn } from "../src/workbench/NotebookView";
import { projectReport } from "../src/workbench/report";

test("the notebook's addresses become links, once each and in order", () => {
  expect(addressesIn("entry 0x100000E74 hands off to 0x100000c78, then 0x100000e74 again; 0x10 is too short")).toEqual(["0x100000e74", "0x100000c78"]);
});

test("the report opens with the notebook when there is one", () => {
  const report = projectReport("ls", { ...EMPTY_PROJECT, pages: new Map([["notebook", "Columns come from COLUMNS at 0x100004906."]]) }, (addr) => addr);
  expect(report).toContain("## Notebook\n\nColumns come from COLUMNS at 0x100004906.");
});
