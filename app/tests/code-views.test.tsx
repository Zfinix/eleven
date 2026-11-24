import "./fixtures/isolate";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReactElement } from "react";

import { useChat } from "../src/chat/useChat";
import { dispatchShortcut } from "../src/lib/shortcuts";
import { DARK, ThemeContext } from "../src/theme";
import { layoutJumps, piecesByLine } from "../src/workbench/arrows";
import { foldGroups, layoutGraph } from "../src/workbench/cfg";
import { findInBytes, lineMatcher } from "../src/workbench/Find";
import { graphPdf } from "../src/workbench/graphPdf";
import { WorkbenchView } from "../src/workbench/Workbench";
import { updateProject } from "../src/engine/project";
import { NO_GPU, SAMPLE_PROGRAM } from "./fixtures/sampleProgram";
import { Screen } from "./harness";

const exports = mkdtempSync(join(tmpdir(), "eleven-export-"));
process.env.ELEVEN_EXPORT_DIR = exports;

const ASM = [
  "0x1000: cmp w0, #0x1",
  "0x1004: b.lt 0x1010",
  "0x1008: bl 0x2000",
  "0x100c: b 0x1000",
  "0x1010: ret",
];

test("arrows: forward and backward jumps get their own lanes, calls get none", () => {
  const jumps = layoutJumps(ASM);
  expect(jumps).toHaveLength(2);
  const back = jumps.find((jump) => jump.back);
  const forward = jumps.find((jump) => !jump.back);
  expect(forward).toMatchObject({ from: 1, to: 4 });
  expect(back).toMatchObject({ from: 3, to: 0 });
  expect(forward?.lane).not.toBe(back?.lane);
  const pieces = piecesByLine(jumps, ASM.length);
  expect(pieces[2]?.map((piece) => piece.kind).sort()).toEqual(["through", "through"]);
  expect(pieces[4]?.[0]?.kind).toBe("end");
});

test("find: text, numbers and patterns find lines; bad input says why", () => {
  const text = lineMatcher("B.LT", "text");
  expect(text.kind === "ok" && ASM.filter(text.test)).toEqual(["0x1004: b.lt 0x1010"]);
  const number = lineMatcher("1", "number");
  expect(number.kind === "ok" && ASM.filter(number.test)).toEqual(["0x1000: cmp w0, #0x1"]);
  expect(lineMatcher("(", "regex").kind).toBe("bad");
  expect(lineMatcher("1f 2", "hex").kind).toBe("bad");
});

test("find: bytes match as hex, text and little-endian numbers", () => {
  const bytes = [0x1f, 0x20, 0x03, 0xd5, 0x41, 0x42, 0x50, 0x00];
  expect(findInBytes(bytes, "1f2003d5", "hex").hits).toEqual([[0, 4]]);
  expect(findInBytes(bytes, "AB", "text").hits).toEqual([[4, 2]]);
  expect(findInBytes(bytes, "0x50", "number").hits).toEqual([[6, 1]]);
});

const BLOCKS = [
  { start: "0x1000", end: "0x1008", successors: ["0x1008", "0x1010"] },
  { start: "0x1008", end: "0x1010", successors: ["0x1010"] },
  { start: "0x1010", end: "0x1014", successors: [] },
];

test("groups: folded blocks become one node that keeps the edges in and out", () => {
  const folded = foldGroups(BLOCKS, [["0x1008", "0x1010"]]);
  expect(folded).toHaveLength(2);
  expect(folded.find((b) => b.start === "0x1000")?.successors).toEqual(["0x1008"]);
  expect(folded.find((b) => b.start === "0x1008")?.successors).toEqual([]);
});

test("pdf: the graph PDF is well formed and finds its own objects", () => {
  const layout = layoutGraph(BLOCKS, ASM);
  const pdf = graphPdf(layout, new Map(), "entry · 0x1000");
  expect(pdf.startsWith("%PDF-1.4")).toBe(true);
  const xref = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
  expect(pdf.slice(xref, xref + 4)).toBe("xref");
  const first = Number(/0000000000 65535 f \n(\d{10})/.exec(pdf)?.[1]);
  expect(pdf.slice(first, first + 7)).toBe("1 0 obj");
});

function SampleBench(): ReactElement {
  const chat = useChat(null, () => {});
  return (
    <ThemeContext.Provider value={{ p: DARK, appearance: "Dark", setAppearance: () => {} }}>
      <WorkbenchView program={SAMPLE_PROGRAM} problem={null} since={null} code gpu={NO_GPU} chat={chat} onBack={() => {}} onOpen={() => {}} />
    </ThemeContext.Provider>
  );
}

let screen: Screen;

beforeAll(() => {
  screen = new Screen().render(<SampleBench />);
}, 60_000);

afterAll(() => screen.unmount());

const press = (key: string, shift = false): void =>
  dispatchShortcut({ elementId: 0, eventType: "keyDown", key, modifiers: { cmd: true, ctrl: false, alt: false, shift } });

test("find: ⌘F opens Find in the details dock and counts matches", async () => {
  await screen.until(() => screen.labelled("entry") !== null, 20_000);
  screen.clickLabel("entry");
  await screen.until(() => screen.text().includes("DAT_10000c024"), 20_000);
  press("f");
  await screen.until(() => screen.labelled("Find in this file") !== null, 5_000);
  screen.type("Find in this file", "D A T _ 1 0 0 0 0 c 0 2 4");
  await screen.until(() => /\d+ match(es)?/.test(screen.text()), 5_000);
  screen.clickLabel("Hide details");
  await screen.until(() => screen.labelled("Find in this file") === null, 5_000);
}, 60_000);

test("listing: the whole file opens as one listing, function by function", async () => {
  screen.click("Listing");
  await screen.until(() => screen.text().includes("entry:"), 20_000);
}, 60_000);

test("graph: blocks group into one node and the graph saves as a PDF", async () => {
  screen.clickLabel("function entry");
  await screen.until(() => screen.text().includes("Graph"), 10_000);
  screen.click("Graph");
  await screen.until(() => screen.labelled("Export PDF") !== null, 10_000);
  const blocks = ["Block 0x1000009ac", "Block 0x1000009b0"].filter((label) => screen.labelled(label) !== null);
  expect(blocks.length).toBe(2);
  for (const label of blocks) {
    const id = screen.labelled(label);
    if (id === null) throw new Error(label);
    screen.ui.renderer.scrollIntoView(id);
    screen.ui.renderer.dispatchNativeEvents();
    screen.ui.renderer.flush();
    const box = screen.ui.renderer.getElementBounds(id);
    if (!box) throw new Error(`no box for ${label}`);
    screen.ui.renderer.nativeSimulateClick(box.x + 20, box.y + 6, 0, "shift");
    screen.ui.renderer.dispatchNativeEvents();
    screen.ui.renderer.flush();
  }
  await screen.until(() => screen.labelled("Group 2 blocks") !== null, 5_000);
  screen.clickLabel("Group 2 blocks");
  await screen.until(() => screen.text().includes("2 blocks folded"), 5_000);
  screen.clickLabel("Export PDF");
  await screen.until(() => readdirSync(exports, { recursive: true }).some((name) => String(name).endsWith(".graph.pdf")), 10_000);
  const file = readdirSync(exports, { recursive: true }).map(String).find((name) => name.endsWith(".graph.pdf")) ?? "";
  expect(readFileSync(join(exports, file), "utf8").startsWith("%PDF")).toBe(true);
  const percent = (): number => Number(/(\d+)%/.exec(screen.text())?.[1] ?? NaN);
  screen.clickLabel("Fit the whole graph");
  screen.ui.renderer.dispatchNativeEvents();
  screen.ui.renderer.flush();
  const before = percent();
  screen.clickLabel("Zoom in (⌘ and scroll)");
  await screen.until(() => percent() > before, 5_000);
  const canvas = screen.labelled("Control flow graph");
  const box = canvas === null ? null : screen.ui.renderer.getElementBounds(canvas);
  if (!box) throw new Error("no canvas");
  const zoomed = percent();
  screen.ui.renderer.nativeSimulateScrollWheel(box.x + box.width / 2, box.y + box.height / 2, 0, -120, "cmd");
  await screen.until(() => percent() < zoomed, 5_000);
  screen.clickLabel("Fit the whole graph");
  await screen.until(() => percent() === before, 5_000);
  const blockX = (): number => {
    const id = screen.labelled("Block 0x100000960");
    return id === null ? NaN : (screen.ui.renderer.getElementBounds(id)?.x ?? NaN);
  };
  const start = blockX();
  screen.ui.renderer.nativeSimulateMouseDown(box.x + 8, box.y + box.height - 8, 0);
  screen.ui.renderer.nativeSimulateMouseMove(box.x + 108, box.y + box.height - 8, 0);
  screen.ui.renderer.nativeSimulateMouseUp(box.x + 108, box.y + box.height - 8, 0);
  await screen.until(() => Math.round(blockX() - start) === 100, 5_000);
}, 60_000);

test("palette: typing then Return opens the top match; shortcuts read as plain text", async () => {
  press("k");
  await screen.until(() => screen.labelled("Search functions, strings and actions") !== null, 5_000);
  screen.type("Search functions, strings and actions", "s t r i n g s");
  await screen.until(() => screen.labelled("Strings") !== null, 5_000);
  expect(screen.labelled("⇧⌘S")).not.toBeNull();
  screen.type("Search functions, strings and actions", "cmd-a backspace F U N _ 1 0 0 0 0 4 0 8 8 enter");
  await screen.until(() => screen.labelled("Search functions, strings and actions") === null, 5_000);
  expect(screen.labelled("FUN_100004088 (preview, click again to keep it open)")).not.toBeNull();
}, 60_000);

test("palette: a call path from one function to another opens as steps", async () => {
  screen.clickLabel("entry");
  await screen.until(() => screen.texts().includes("0x100000960"), 20_000);
  press("k");
  await screen.until(() => screen.labelled("Search functions, strings and actions") !== null, 5_000);
  screen.type("Search functions, strings and actions", "c a l l space p a t h");
  await screen.until(() => screen.text().includes("Find a call path from here…"), 5_000);
  screen.click("Find a call path from here…");
  await screen.until(() => screen.text().includes("Path from entry to…"), 5_000);
  screen.type("Search functions, strings and actions", "1 9 f c enter");
  await screen.until(() => screen.text().includes("How entry reaches FUN_1000019fc"), 10_000);
  await screen.until(() => screen.texts().includes("FUN_1000016d8"), 10_000);
  expect(screen.texts().filter((text) => text === "0x1000016d8" || text === "0x1000019fc")).toEqual(["0x1000016d8", "0x1000019fc"]);
}, 60_000);

test("palette: the notebook links the addresses written in it, and guesses list what agents left unproven", async () => {
  press("k");
  await screen.until(() => screen.labelled("Search functions, strings and actions") !== null, 5_000);
  screen.type("Search functions, strings and actions", "n o t e b o o k");
  await screen.until(() => screen.text().includes("Open the notebook"), 5_000);
  screen.click("Open the notebook");
  await screen.until(() => screen.labelled(`Notebook for ${SAMPLE_PROGRAM.name}`) !== null, 5_000);
  screen.type(`Notebook for ${SAMPLE_PROGRAM.name}`, "e n t r y space i s space 0 x 1 0 0 0 0 0 9 6 0");
  await screen.until(() => screen.text().includes("Addresses in this page"), 5_000);
  expect(screen.texts().some((text) => text.includes("0x100000960"))).toBe(true);

  updateProject(SAMPLE_PROGRAM.id, (project) => ({ ...project, names: new Map(project.names).set("0x100004088", "maybe_usage") }), { kind: "agent", agent: "Claude", chat: null });
  press("k");
  await screen.until(() => screen.labelled("Search functions, strings and actions") !== null, 5_000);
  screen.type("Search functions, strings and actions", "g u e s s e s");
  await screen.until(() => screen.text().includes("Show guesses to check"), 5_000);
  screen.click("Show guesses to check");
  await screen.until(() => screen.text().includes("1 guesses to check"), 5_000);
  expect(screen.texts().some((text) => text.includes("maybe_usage"))).toBe(true);
}, 60_000);
