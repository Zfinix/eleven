import "./fixtures/isolate";
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { ReactElement } from "react";

import { openMenuEntries } from "../src/components/ContextMenu";
import { useChat } from "../src/chat/useChat";
import { DARK, ThemeContext } from "../src/theme";
import { WorkbenchView } from "../src/workbench/Workbench";
import { NO_GPU, SAMPLE_PROGRAM } from "./fixtures/sampleProgram";
import { Screen } from "./harness";
import { clearFilter, findFunction } from "./fixtures/sidebar";

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

function settle(): void {
  screen.ui.renderer.dispatchNativeEvents();
  screen.ui.renderer.flush();
}

function rightClickId(id: number): void {
  screen.ui.renderer.scrollIntoView(id);
  settle();
  const box = screen.ui.renderer.getElementBounds(id);
  if (!box) throw new Error(`element ${id} has no box`);
  screen.ui.renderer.nativeSimulateClick(box.x + box.width / 2, box.y + box.height / 2, 2);
  settle();
}


function rightClickLabel(label: string): void {
  const id = screen.labelled(label);
  if (id === null) throw new Error(`nothing labelled "${label}"`);
  rightClickId(id);
}

function menuLabels(): readonly string[] {
  return openMenuEntries().flatMap((entry) => (entry.kind === "separator" ? [] : [entry.label]));
}

test("menus: a data label in pseudocode can be renamed, and the rename undone", async () => {
  await screen.until(() => screen.labelled("entry") !== null, 20_000);
  screen.clickLabel("entry");
  await screen.until(() => screen.text().includes("DAT_10000c024"), 20_000);
  screen.rightClickWord("DAT_10000c024");
  await screen.until(() => menuLabels().includes("Rename DAT_10000c024"), 5_000);
  expect(menuLabels()).toContain("References to DAT_10000c024");
  expect(menuLabels()).toContain("Go to 0x10000c024");
  screen.clickLabel("Rename DAT_10000c024");
  await screen.until(() => screen.labelled("New name") !== null, 5_000);
  screen.type("New name", "cmd-a backspace i s _ t t y enter");
  await screen.until(() => screen.text().includes("is_tty") && screen.text().includes("Renamed to is_tty"), 5_000);
  screen.click("Undo");
  await screen.until(() => screen.text().includes("DAT_10000c024") && !screen.text().includes("is_tty"), 5_000);
}, 60_000);

test("menus: a call opens in a split from its menu", async () => {
  rightClickLabel("Open FUN_100004088");
  await screen.until(() => menuLabels().includes("Jump to FUN_100004088"), 5_000);
  screen.clickLabel("Open in split");
  await screen.until(() => screen.labelled("Close this split") !== null, 5_000);
  screen.clickLabel("Close this split");
  await screen.until(() => screen.labelled("Split right") !== null, 5_000);
}, 60_000);

test("menus: a tab offers to close the others", async () => {
  const preview = "FUN_1000016d8 (preview, click again to keep it open)";
  await findFunction(screen, "FUN_1000016d8");
  screen.clickLabel("function FUN_1000016d8");
  await screen.until(() => screen.labelled(preview) !== null, 5_000);
  rightClickLabel(preview);
  await screen.until(() => menuLabels().includes("Close other tabs") && menuLabels().includes("Keep open"), 5_000);
  screen.clickLabel("Close other tabs");
  await screen.until(() => openMenuEntries().length === 0, 5_000);
  rightClickLabel(preview);
  await screen.until(() => menuLabels().includes("Close"), 5_000);
  expect(menuLabels()).not.toContain("Close other tabs");
  screen.clickLabel("Close");
  await screen.until(() => screen.labelled(preview) === null, 5_000);
  clearFilter(screen);
}, 60_000);

test("menus: an assembly line takes a comment that shows at the end of the line", async () => {
  screen.clickLabel("function entry");
  await screen.until(() => screen.labelled("Listing view") !== null, 10_000);
  screen.clickLabel("Listing view");
  await screen.until(() => screen.text().includes("pacibsp"), 10_000);
  screen.rightClickWord("pacibsp");
  await screen.until(() => menuLabels().includes("Comment this line"), 5_000);
  expect(menuLabels()).toContain("Change type");
  screen.clickLabel("Comment this line");
  await screen.until(() => screen.labelled("Comment") !== null, 5_000);
  screen.type("Comment", "s i g n s space l r enter");
  await screen.until(() => screen.text().includes("; signs lr"), 5_000);
}, 60_000);

test("kit: a rename with spaces shows what to type instead and isn't saved", async () => {
  await findFunction(screen, "FUN_1000016d8");
  rightClickLabel("function FUN_1000016d8");
  await screen.until(() => menuLabels().includes("Rename FUN_1000016d8"), 5_000);
  screen.clickLabel("Rename FUN_1000016d8");
  await screen.until(() => screen.labelled("New name") !== null, 5_000);
  screen.type("New name", "cmd-a backspace p r i n t space u s a g e enter");
  await screen.until(() => screen.text().includes("Names can't have spaces. Try print_usage."), 5_000);
  expect(screen.labelled("New name")).not.toBeNull();
  screen.clickLabel("Cancel");
  await screen.until(() => screen.labelled("New name") === null, 5_000);
}, 60_000);

test("kit: a filter that matches nothing says what to try", async () => {
  screen.type("Filter functions", "cmd-a backspace z z q q");
  await screen.until(() => screen.text().includes("No functions match. Press ↩ to ask the agent."), 5_000);
}, 60_000);
