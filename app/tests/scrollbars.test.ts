import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "src");

/** Tab strips scroll sideways without a thumb, the way macOS draws them, and sidebars never show one. */
const NO_THUMB = new Set(["workbench/TabBar.tsx", "home/Canvas.tsx:72", "home/Sidebar.tsx", "settings/Nav.tsx", "workbench/Nav.tsx"]);

function sources(dir: string, base = ""): readonly string[] {
  return readdirSync(join(dir, base), { withFileTypes: true }).flatMap((entry) => {
    const path = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return sources(dir, path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

test("every scrolling view draws a scrollbar", () => {
  const missing = sources(SRC).flatMap((file) => readFileSync(join(SRC, file), "utf8").split("\n").flatMap((line, ix) => {
    const scrolls = /overflow[XY]?: "scroll"/.test(line) || line.includes("<virtual-list");
    const exempt = NO_THUMB.has(file) || NO_THUMB.has(`${file}:${ix + 1}`);
    return scrolls && !exempt && !line.includes("scrollbar(") ? [`${file}:${ix + 1}`] : [];
  }));
  expect(missing).toEqual([]);
});
