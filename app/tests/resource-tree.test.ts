import { expect, test } from "bun:test";

import { sourceTree } from "../src/workbench/sidebar/model";
import { indexResources, visibleResources } from "../src/workbench/sidebar/resourceTree";

const PATHS = [
  "/build/Game/Contents/Resources/z.png",
  "/build/Game/Contents/Resources/a.TXT",
  "/build/Game/Contents/MacOS/Game",
  "/build/Game/Contents/Info.plist",
  "/build/Game/Contents/Resources/a.TXT",
];

const paths = (rows: ReturnType<typeof visibleResources>): readonly string[] => rows.map(({ node }) => node.path);

test("resource folders keep their order, saved keys and exact file paths", () => {
  const index = indexResources(PATHS);
  const start = visibleResources(index, (_key, byDefault) => byDefault);
  expect(paths(start)).toEqual(["Contents", "Contents/MacOS", "Contents/Resources", "Contents/Info.plist"]);
  const opened = visibleResources(index, (key, byDefault) => byDefault || key === "res:Contents/Resources");
  expect(paths(opened)).toEqual(["Contents", "Contents/MacOS", "Contents/Resources", "Contents/Resources/a.TXT", "Contents/Resources/z.png", "Contents/Info.plist"]);
  expect(opened.find(({ node }) => node.name === "a.TXT")?.node).toEqual({
    path: "Contents/Resources/a.TXT", name: "a.TXT", depth: 2, folder: false, ext: "txt", full: "/build/Game/Contents/Resources/a.TXT",
  });
  expect(opened.find(({ node }) => node.path === "Contents/Resources")?.open).toBe(true);
  expect(paths(visibleResources(index, () => false))).toEqual(["Contents"]);
  expect(visibleResources(index, (_key, byDefault) => byDefault)).toEqual(start);
});

test("an opened folder's rows are built once and reused when it opens again", () => {
  const index = indexResources(PATHS);
  const open = (): ReturnType<typeof visibleResources> => visibleResources(index, () => true);
  const first = open().find(({ node }) => node.name === "z.png")?.node;
  visibleResources(index, () => false);
  expect(first).toBeDefined();
  expect(open().find(({ node }) => node.name === "z.png")?.node).toBe(first);
});

test("resources handle empty inventories, lone files and names that share a prefix", () => {
  expect(visibleResources(indexResources([]), () => true)).toEqual([]);
  expect(paths(visibleResources(indexResources(["/build/Game/Contents/Info.plist"]), () => true))).toEqual(["Contents", "Contents/Info.plist"]);
  expect(paths(visibleResources(indexResources(["b.txt", "a/file.txt", "aa/nested.txt"]), () => true))).toEqual(["a", "a/file.txt", "aa", "aa/nested.txt", "b.txt"]);
});

test("fully open, the lazy tree matches the source tree row for row", () => {
  const cases: readonly (readonly string[])[] = [
    PATHS,
    ["AndroidManifest.xml", "res/layout/main.xml", "res/values/strings.xml", "lib/arm64-v8a/libgreeter.so"],
    ["/a/b/c/one.txt", "/a/b/d/two.txt", "/a/b/c/e/three.txt", "//a//b/four.txt/"],
    ["/Users/me/App/Sources/A.swift", "/Users/me/App/Sources/B.swift"],
  ];
  for (const files of cases) expect(visibleResources(indexResources(files), () => true).map(({ node }) => node)).toEqual([...sourceTree(files, new Set())]);
});
