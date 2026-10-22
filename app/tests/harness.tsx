import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import type { ReactElement } from "react";

import { useChat } from "../src/chat/useChat";
import type { Target } from "../src/engine/target";
import { DARK, ThemeContext } from "../src/theme";
import { Workbench } from "../src/workbench/Workbench";

type Json = { readonly id?: number; readonly customProps?: Record<string, unknown>; readonly children?: readonly Json[] };

function nodeLabelled(node: unknown, label: string): Json | null {
  if (typeof node !== "object" || node === null) return null;
  const json: Json = node;
  if (json.customProps?.["aria-label"] === label) return json;
  for (const child of json.children ?? []) {
    const found = nodeLabelled(child, label);
    if (found !== null) return found;
  }
  return null;
}

function byLabel(node: unknown, label: string): number | null {
  const id = nodeLabelled(node, label)?.id;
  return typeof id === "number" ? id : null;
}

function Bench({ target }: { readonly target: Target }): ReactElement {
  const chat = useChat(target, () => {});
  return (
    <ThemeContext.Provider value={{ p: DARK, appearance: "Dark", setAppearance: () => {} }}>
      <Workbench target={target} chat={chat} onBack={() => {}} onOpen={() => {}} />
    </ThemeContext.Provider>
  );
}

/** Drives a headless Eleven window: wait for text, click by text or by accessible label, type. */
export class Screen {
  readonly ui: TestRoot = createTestRoot({ width: 1440, height: 900 });

  render(node: ReactElement): this {
    this.ui.render(node);
    return this;
  }

  workbench(target: Target): this {
    return this.render(<Bench target={target} />);
  }

  text(): string {
    return this.ui.renderer.getAllText().join("\n");
  }

  texts(): readonly string[] {
    return this.ui.renderer.getAllText();
  }

  async until(check: () => boolean, ms = 60_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      this.ui.renderer.dispatchNativeEvents();
      this.ui.renderer.flush();
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`timed out; screen shows: ${this.texts().slice(0, 50).join(" | ")}`);
  }

  /** Right-clicks a word where it is drawn, even inside a longer line of code, the way a person would. */
  rightClickWord(word: string): void {
    const renderer = this.ui.renderer;
    const element = renderer.findByText(word);
    if (!element?.text) throw new Error(`no "${word}" on screen`);
    renderer.scrollIntoView(element.id);
    renderer.dispatchNativeEvents();
    renderer.flush();
    const box = renderer.getElementBounds(element.id);
    if (!box) throw new Error(`"${word}" has no box`);
    const advance = box.width / element.text.length;
    renderer.nativeSimulateClick(box.x + (element.text.indexOf(word) + word.length / 2) * advance, box.y + box.height / 2, 2);
    renderer.dispatchNativeEvents();
    renderer.flush();
  }

  labelled(label: string): number | null {
    return byLabel(this.ui.renderer.toJSON(), label);
  }

  /** What a field labelled this way holds right now. */
  valueOf(label: string): string | null {
    const value = nodeLabelled(this.ui.renderer.toJSON(), label)?.customProps?.value;
    return typeof value === "string" ? value : null;
  }

  clickId(id: number): void {
    this.ui.renderer.scrollIntoView(id);
    this.ui.renderer.flush();
    const box = this.ui.renderer.getElementBounds(id);
    if (!box) throw new Error(`element ${id} has no layout box`);
    this.ui.renderer.nativeSimulateClick(box.x + box.width / 2, box.y + box.height / 2);
    this.ui.renderer.dispatchNativeEvents();
    this.ui.renderer.flush();
  }

  click(text: string): void {
    const element = this.ui.renderer.findByText(text);
    if (!element) throw new Error(`no "${text}" on screen`);
    this.clickId(element.id);
  }

  /** A click the way a hand makes one: the release lands a moment after the press, once timers have run. */
  async pressLabel(label: string, holdMs = 80): Promise<void> {
    const id = this.labelled(label);
    if (id === null) throw new Error(`nothing labelled "${label}"`);
    this.ui.renderer.flush();
    const box = this.ui.renderer.getElementBounds(id);
    if (!box) throw new Error(`element ${id} has no layout box`);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    this.ui.renderer.nativeSimulateMouseDown(x, y);
    this.ui.renderer.dispatchNativeEvents();
    this.ui.renderer.flush();
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    this.ui.renderer.flush();
    this.ui.renderer.nativeSimulateMouseUp(x, y);
    this.ui.renderer.dispatchNativeEvents();
    this.ui.renderer.flush();
  }

  clickLabel(label: string): void {
    const id = this.labelled(label);
    if (id === null) throw new Error(`nothing labelled "${label}"`);
    this.clickId(id);
  }

  type(label: string, keystrokes: string): void {
    const id = this.labelled(label);
    if (id === null) throw new Error(`no field labelled "${label}"`);
    this.ui.renderer.nativeSimulateKeystrokes(id, keystrokes);
    this.ui.renderer.dispatchNativeEvents();
    this.ui.renderer.flush();
  }

  unmount(): void {
    this.ui.unmount();
  }
}
