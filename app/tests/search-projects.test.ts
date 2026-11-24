import { expect, test } from "bun:test";

import { EMPTY_PROJECT, type Project, type ProjectEntry } from "../src/engine/project";
import { searchProjects } from "../src/engine/searchProjects";

const entry = (id: string, name: string): ProjectEntry => ({ id, name, original: `/apps/${name}`, arch: "arm64", kind: "binary", openedAt: 0 });

const PROJECTS: Readonly<Record<string, Project>> = {
  a: { ...EMPTY_PROJECT, names: new Map([["0x10", "check_license_key"]]), notes: new Map([["0x20", "compares the License header"]]) },
  b: { ...EMPTY_PROJECT, bookmarks: [{ addr: "0x30", label: "license server" }], comments: new Map([["0x40", "nothing here"]]) },
  c: { ...EMPTY_PROJECT, names: new Map([["0x50", "license_too"]]) },
};

test("search finds names, notes and bookmarks in other projects, skipping the open one", () => {
  const load = (id: string): Project => PROJECTS[id] ?? EMPTY_PROJECT;
  const hits = searchProjects("LICENSE", [entry("a", "Sketch"), entry("b", "Signal"), entry("c", "Open")], load, "c");
  expect(hits.map((hit) => [hit.project.name, hit.kind, hit.addr])).toEqual([["Sketch", "name", "0x10"], ["Sketch", "note", "0x20"], ["Signal", "bookmark", "0x30"]]);
  expect(searchProjects("li", [entry("a", "Sketch")], load, null)).toEqual([]);
  expect(searchProjects("license", [entry("a", "Sketch"), entry("b", "Signal")], load, null, 1)).toHaveLength(1);
});
