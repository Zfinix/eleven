import { afterAll, beforeAll, expect, test } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ReactElement } from "react";

import { adoptLoginShell } from "../src/agents/detect";
import { useChat } from "../src/chat/useChat";
import { prepareTarget } from "../src/engine/target";
import { runCommand } from "../src/lib/shortcuts";
import { DARK, ThemeContext } from "../src/theme";
import { adoptToolchain } from "../src/engine/toolchain";
import { Workbench } from "../src/workbench/Workbench";

const LS = prepareTarget("/bin/ls");
const PROJECT = join(homedir(), "Library", "Application Support", "Eleven", "projects", "7475c05a59b8bfbdcedffe4195a45c36d22c5ccdd9412bf48152472965653fee.json");

let ui: TestRoot;

function Bench(): ReactElement {
  const chat = useChat(LS, () => {});
  return (
    <ThemeContext.Provider value={{ p: DARK, appearance: "Dark", setAppearance: () => {} }}>
      <Workbench target={LS} chat={chat} onBack={() => {}} onOpen={() => {}} />
    </ThemeContext.Provider>
  );
}

async function settle(until: () => boolean, ms = 60_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    ui.renderer.dispatchNativeEvents();
    ui.renderer.flush();
    if (until()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out; screen shows: ${ui.renderer.getAllText().slice(0, 40).join(" | ")}`);
}

const text = (): string => ui.renderer.getAllText().join("\n");

type Json = { readonly id?: number; readonly customProps?: Record<string, unknown>; readonly children?: readonly Json[] };

function byLabel(node: unknown, label: string): number | null {
  if (typeof node !== "object" || node === null) return null;
  const json: Json = node;
  if (json.customProps?.["aria-label"] === label && typeof json.id === "number") return json.id;
  for (const child of json.children ?? []) {
    const found = byLabel(child, label);
    if (found !== null) return found;
  }
  return null;
}

function clickId(id: number): void {
  const box = ui.renderer.getElementBounds(id);
  if (!box) throw new Error(`element ${id} has no box`);
  ui.renderer.nativeSimulateClick(box.x + box.width / 2, box.y + box.height / 2);
  ui.renderer.dispatchNativeEvents();
  ui.renderer.flush();
}

function click(label: string): void {
  const element = ui.renderer.findByText(label) ?? null;
  const id = element?.id ?? byLabel(ui.renderer.toJSON(), label);
  if (id === null || id === undefined) throw new Error(`no "${label}" on screen`);
  clickId(id);
}

function mount(): void {
  ui = createTestRoot({ width: 1440, height: 900 });
  ui.render(<Bench />);
}

beforeAll(async () => {
  await adoptLoginShell();
  adoptToolchain();
  rmSync(PROJECT, { force: true });
  mount();
});

afterAll(() => {
  ui.unmount();
  rmSync(PROJECT, { force: true });
});

test("M2 gate: a rename and a bookmark survive closing and reopening", async () => {
  await settle(() => text().includes("134") && text().includes("Pseudocode"));
  runCommand("rename");
  await settle(() => byLabel(ui.renderer.toJSON(), "New name") !== null);
  const input = byLabel(ui.renderer.toJSON(), "New name");
  if (input === null) throw new Error("no rename box");
  ui.renderer.nativeSimulateKeystrokes(input, "cmd-a backspace m a i n _ l s enter");
  await settle(() => text().includes("main_ls"));
  const bookmark = byLabel(ui.renderer.toJSON(), "Bookmark");
  if (bookmark === null) throw new Error("no bookmark button");
  clickId(bookmark);
  await settle(() => byLabel(ui.renderer.toJSON(), "Bookmark") !== null);
  ui.unmount();
  mount();
  await settle(() => text().includes("main_ls") && text().includes("134"));
  if (byLabel(ui.renderer.toJSON(), "Bookmarks") === null) click("Your work");
  await settle(() => byLabel(ui.renderer.toJSON(), "Bookmarks") !== null);
  click("Bookmarks");
  await settle(() => byLabel(ui.renderer.toJSON(), "main_ls") !== null, 5_000).catch(() => undefined);
  expect(byLabel(ui.renderer.toJSON(), "main_ls")).not.toBeNull();
}, 180_000);
