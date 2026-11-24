import { expect, test } from "bun:test";

import { parseReaCallPath, searchCallPath } from "../src/engine/callPath";

const GRAPH: Readonly<Record<string, readonly string[]>> = { main: ["init", "run"], init: ["log"], run: ["loop", "log"], loop: ["draw"], draw: [] };
const callees = async (addr: string): Promise<readonly string[]> => GRAPH[addr] ?? [];

test("the shortest chain of calls from one function to another", async () => {
  expect(await searchCallPath("main", "draw", callees)).toEqual({ steps: ["main", "run", "loop", "draw"], searched: 5, complete: true });
  expect(await searchCallPath("main", "main", callees)).toEqual({ steps: ["main"], searched: 0, complete: true });
});

test("no path says whether every reachable function was searched", async () => {
  expect(await searchCallPath("init", "draw", callees)).toEqual({ steps: [], searched: 2, complete: true });
  expect(await searchCallPath("main", "draw", callees, 2)).toEqual({ steps: [], searched: 2, complete: false });
});

test("a function whose calls can't be read is skipped, not fatal", async () => {
  const flaky = async (addr: string): Promise<readonly string[]> => {
    if (addr === "init") throw new Error("decompiler timed out");
    return GRAPH[addr] ?? [];
  };
  expect((await searchCallPath("main", "draw", flaky)).steps).toEqual(["main", "run", "loop", "draw"]);
});

test("REA's traced path, and an unreached goal with gaps", () => {
  expect(parseReaCallPath({ goal_status: "reached", traversal_path: ["0x1", "0x2", "0x3"], nodes: [{}, {}, {}, {}], failures: [], truncated: false })).toEqual({ steps: ["0x1", "0x2", "0x3"], searched: 4, complete: true });
  expect(parseReaCallPath({ goal_status: "unknown", traversal_path: [], nodes: [{}], failures: [{}], truncated: false })).toEqual({ steps: [], searched: 1, complete: false });
  expect(parseReaCallPath(null)).toEqual({ steps: [], searched: 0, complete: false });
});
