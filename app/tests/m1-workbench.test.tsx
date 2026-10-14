import { afterAll, beforeAll, expect, test } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";

import type { ReactElement } from "react";

import { adoptLoginShell } from "../src/agents/detect";
import { useChat } from "../src/chat/useChat";
import { prepareTarget } from "../src/engine/target";
import { DARK, ThemeContext } from "../src/theme";
import { adoptToolchain } from "../src/engine/toolchain";
import { Workbench } from "../src/workbench/Workbench";

let ui: TestRoot;

const LS = prepareTarget("/bin/ls");

function Bench(): ReactElement {
  const chat = useChat(LS, () => {});
  return <Workbench target={LS} chat={chat} onBack={() => {}} onOpen={() => {}} />;
}

async function settle(until: () => boolean, ms = 120_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    ui.renderer.dispatchNativeEvents();
    ui.renderer.flush();
    if (until()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out; screen shows: ${ui.renderer.getAllText().slice(0, 40).join(" | ")}`);
}

function text(): string {
  return ui.renderer.getAllText().join("\n");
}

function click(label: string): void {
  const element = ui.renderer.findByText(label);
  if (!element) throw new Error(`no "${label}" on screen`);
  const box = ui.renderer.getElementBounds(element.id);
  if (!box) throw new Error(`"${label}" has no layout box`);
  ui.renderer.nativeSimulateClick(box.x + box.width / 2, box.y + box.height / 2);
  ui.renderer.dispatchNativeEvents();
  ui.renderer.flush();
}

type Json = { readonly id?: number; readonly customProps?: Record<string, unknown>; readonly children?: readonly Json[] };

function findByLabel(node: unknown, label: string): number | null {
  if (typeof node !== "object" || node === null) return null;
  const json: Json = node;
  const aria = json.customProps?.["aria-label"];
  if (aria === label && typeof json.id === "number") return json.id;
  for (const child of json.children ?? []) {
    const found = findByLabel(child, label);
    if (found !== null) return found;
  }
  return null;
}

function clickId(id: number): void {
  const box = ui.renderer.getElementBounds(id);
  if (!box) throw new Error(`element ${id} has no layout box`);
  ui.renderer.nativeSimulateClick(box.x + box.width / 2, box.y + box.height / 2);
  ui.renderer.dispatchNativeEvents();
  ui.renderer.flush();
}

beforeAll(async () => {
  await adoptLoginShell();
  adoptToolchain();
  ui = createTestRoot({ width: 1440, height: 900 });
  ui.render(
    <ThemeContext.Provider value={{ p: DARK, appearance: "Dark", setAppearance: () => {} }}>
      <Bench />
    </ThemeContext.Provider>,
  );
});

afterAll(() => ui.unmount());

test("M1: a binary opens and lists its functions", async () => {
  await settle(() => text().includes("entry"));
  expect(text()).toContain("ls");
}, 180_000);

test("M1: clicking a function shows Ghidra pseudocode", async () => {
  click("entry");
  await settle(() => text().includes("param_2") && text().includes("lVar1"));
}, 180_000);

test("M1: the assembly view shows instructions", async () => {
  const listing = findByLabel(ui.renderer.toJSON(), "Listing view");
  if (listing === null) throw new Error("no Listing view switch");
  clickId(listing);
  await settle(() => /\bstp\b/.test(text()) && text().includes("x29"));
}, 180_000);

function visibleCallLinks(node: unknown, found: { readonly id: number; readonly name: string }[] = []): { readonly id: number; readonly name: string }[] {
  if (typeof node !== "object" || node === null) return found;
  const json: Json = node;
  const label = json.customProps?.["aria-label"];
  if (typeof label === "string" && label.startsWith("Open FUN_") && typeof json.id === "number") found.push({ id: json.id, name: label.slice(5) });
  for (const child of json.children ?? []) visibleCallLinks(child, found);
  return found;
}

test("M1: clicking a call in the code jumps to that function", async () => {
  click("Pseudocode");
  await settle(() => visibleCallLinks(ui.renderer.toJSON()).length > 0);
  const link = visibleCallLinks(ui.renderer.toJSON())[0];
  if (!link) throw new Error("no call link in the code");
  ui.renderer.scrollIntoView(link.id);
  ui.renderer.flush();
  const box = ui.renderer.getElementBounds(link.id);
  if (!box) throw new Error(`${link.name} has no layout box`);
  ui.renderer.nativeSimulateMouseMove(box.x + box.width / 2, box.y + box.height / 2);
  await settle(() => !text().includes("The machine instructions in order"));
  clickId(link.id);
  await settle(() => text().split(link.name).length > 3);
}, 180_000);

test("M1: the function list filters as you type", async () => {
  const heading = findByLabel(ui.renderer.toJSON(), "Functions");
  if (heading !== null && findByLabel(ui.renderer.toJSON(), "Filter functions") === null) clickId(heading);
  await settle(() => findByLabel(ui.renderer.toJSON(), "Filter functions") !== null);
  const filter = findByLabel(ui.renderer.toJSON(), "Filter functions");
  if (filter === null) throw new Error("no filter box");
  ui.renderer.nativeSimulateKeystrokes(filter, "2 3 2 c");
  ui.renderer.flush();
  const listedFns = (): readonly string[] => {
    const found: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node !== "object" || node === null) return;
      const json: Json = node;
      const label = json.customProps?.["aria-label"];
      if (typeof label === "string" && label.startsWith("function ")) found.push(label.slice("function ".length));
      for (const child of json.children ?? []) walk(child);
    };
    walk(ui.renderer.toJSON());
    return found;
  };
  await settle(() => listedFns().join(" ") === "FUN_10000232c", 20_000);
}, 60_000);
