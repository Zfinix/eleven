import { expect, test } from "bun:test";

import { indexResources, visibleResources } from "../src/workbench/sidebar/resourceTree";

const PATHS = [
  "/build/Game/Contents/Resources/z.png",
  "/build/Game/Contents/Resources/a.TXT",
  "/build/Game/Contents/MacOS/Game",
  "/build/Game/Contents/Info.plist",
  "/build/Game/Contents/Resources/a.TXT",
];

test("resource folders preserve ordering, saved expansion keys and exact file paths", () => {
  const index = indexResources(PATHS);
  const collapsed = visibleResources(index, (_key, byDefault) => byDefault);
  expect(collapsed.map(({ node }) => node.path)).toEqual([
    "Contents", "Contents/MacOS", "Contents/Resources", "Contents/Info.plist",
  ]);

  const opened = visibleResources(index, (key, byDefault) => byDefault || key === "res:Contents/Resources");
  expect(opened.map(({ node }) => node.path)).toEqual([
    "Contents", "Contents/MacOS", "Contents/Resources", "Contents/Resources/a.TXT",
    "Contents/Resources/z.png", "Contents/Info.plist",
  ]);
  expect(opened.find(({ node }) => node.name === "a.TXT")?.node).toEqual({
    path: "Contents/Resources/a.TXT", name: "a.TXT", depth: 2,
    folder: false, ext: "txt", full: "/build/Game/Contents/Resources/a.TXT",
  });
  expect(visibleResources(index, () => false).map(({ node }) => node.path)).toEqual(["Contents"]);
  expect(visibleResources(index, (_key, byDefault) => byDefault)).toEqual(collapsed);
});

test("resources handle empty inventories, lone files and distinct root names", () => {
  expect(visibleResources(indexResources([]), () => true)).toEqual([]);
  expect(visibleResources(indexResources(["/build/Game/Contents/Info.plist"]), () => true).map(({ node }) => node.path))
    .toEqual(["Contents", "Contents/Info.plist"]);
  expect(visibleResources(indexResources(["b.txt", "a/file.txt", "aa/nested.txt"]), () => true).map(({ node }) => node.path))
    .toEqual(["a", "a/file.txt", "aa", "aa/nested.txt", "b.txt"]);
});
