import "./fixtures/isolate";
import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";

import * as engine from "../src/engine/ask";
import type { RewriteProgress } from "../src/engine/rewrite";
import { useChat } from "../src/chat/useChat";
import { loadProject } from "../src/engine/project";
import { comboFor, parseCombo } from "../src/keys/keymaps";
import { dispatchShortcut } from "../src/lib/shortcuts";
import { currentSettings } from "../src/settings/store";
import { DARK, ThemeContext } from "../src/theme";
import { quickSetup } from "../src/engine/warm";
import { askRange } from "../src/workbench/ask/place";
import { isPinned, pinAnswer, pinnedLines, unpinAnswer } from "../src/workbench/ask/pins";
import { explainQuestion, suggestedQuestions } from "../src/workbench/ask/questions";
import { initialState } from "../src/workbench/state";
import { WorkbenchView } from "../src/workbench/Workbench";
import { NO_GPU, SAMPLE_PROGRAM } from "./fixtures/sampleProgram";
import { Screen } from "./harness";

const REPLY = "When standard output isn't a terminal, `isatty(1)` returns `0` and `ls` sets `DAT_10000c0d0` to print one name per line.\n```c\nif (!isatty(1)) one_per_line = 1;\n```\nRENAME DAT_10000c0d0 -> one_per_line";

const NARRATION = "Let me pull the binary first.";

const asked: { readonly quote: engine.Quote; readonly question: string; readonly earlier: number }[] = [];

mock.module("../src/engine/ask", () => ({
  ...engine,
  askAbout: async (_req: unknown, quote: engine.Quote, earlier: readonly engine.Exchange[], question: string, onProgress: (progress: RewriteProgress) => void): Promise<string> => {
    asked.push({ quote, question, earlier: earlier.length });
    onProgress({ step: null, code: null, reply: NARRATION });
    onProgress({ step: "Reading entry", code: null, reply: NARRATION });
    await new Promise((resolve) => setTimeout(resolve, 100));
    onProgress({ step: "Reading entry", code: null, reply: NARRATION + REPLY.slice(0, 40) });
    await new Promise((resolve) => setTimeout(resolve, 100));
    return NARRATION + REPLY;
  },
}));

test("a pinned answer is its own paragraph in the note, found again by its lines", () => {
  const once = pinAnswer("Parses the flags.", "pseudocode", 18, 25, "Prints one per line.\n\nUnless it's a terminal.");
  expect(once).toBe("Parses the flags.\n\nLines 18–25 of the pseudocode: Prints one per line.\n\nUnless it's a terminal.");
  const twice = pinAnswer(once, "listing", 3, 3, "A compare.");
  expect([...pinnedLines(twice, "pseudocode")]).toEqual([25]);
  expect([...pinnedLines(twice, "listing")]).toEqual([3]);
  expect(isPinned(twice, "pseudocode", 18, 25)).toBe(true);
  expect(pinAnswer(twice, "pseudocode", 18, 25, "Updated.")).toContain("Lines 18–25 of the pseudocode: Updated.");
  expect(unpinAnswer(twice, "pseudocode", 18, 25)).toBe("Parses the flags.\n\nLine 3 of the listing: A compare.");
  expect(unpinAnswer("Line 3 of the listing: A compare.", "listing", 3, 3)).toBe("");
});

test("suggested questions fit the lines: a name to give, a number to explain", () => {
  expect(suggestedQuestions(["  DAT_10000c0d0 = 1;", "  if (x) {"], "c")).toEqual([explainQuestion(), "Name DAT_10000c0d0", "When does this branch run?"]);
  expect(suggestedQuestions(["and.b64 %rd28, %rd27, -4294967296;"], "ptx")).toEqual([explainQuestion(), "Why -4294967296?", "What would this look like in C?"]);
  expect(suggestedQuestions(["ret"], "asm")).toEqual([explainQuestion(), "What would this look like in C?", "Where does this get used?"]);
});

test("the Ask bar follows a picked range, or a line picked by its number, but not a picked word", () => {
  const base = initialState([]);
  const line = { kind: "line", fn: "0x1", view: "pseudo", number: 4, text: "x = 1;", addr: null } as const;
  expect(askRange({ ...base, selected: { ...line, token: null } })).toEqual({ fn: "0x1", view: "pseudo", from: 4, to: 4 });
  expect(askRange({ ...base, selected: { ...line, token: { text: "x", addr: null } } })).toBeNull();
  expect(askRange({ ...base, lineRange: { fn: "0x1", view: "asm", from: 2, to: 6 } })).toEqual({ fn: "0x1", view: "asm", from: 2, to: 6 });
});

test("quick answers take the lowest effort, the picked model and fast mode, only where the agent offers them", () => {
  const choice = (value: string): { readonly value: string; readonly name: string; readonly description: null } => ({ value, name: value, description: null });
  const options = [
    { id: "model", name: "Model", category: "model", current: "opus", choices: ["opus", "haiku"].map(choice), legacyMode: false },
    { id: "effort", name: "Effort", category: "thought_level", current: "high", choices: ["low", "high"].map(choice), legacyMode: false },
    { id: "fast", name: "Fast mode", category: "other", current: "off", choices: ["on", "off"].map(choice), legacyMode: false },
  ] as const;
  const set = (tune: { readonly model: string | null; readonly fast: boolean }): readonly string[] => quickSetup(options, tune).map((pick) => `${pick.option.id}=${pick.value}`);
  expect(set({ model: "haiku", fast: true })).toEqual(["model=haiku", "effort=low", "fast=on"]);
  expect(set({ model: "opus", fast: false })).toEqual(["effort=low"]);
  expect(set({ model: "gpt-9", fast: false })).toEqual(["effort=low"]);
  expect(quickSetup([], { model: "haiku", fast: true })).toEqual([]);
});

test("answers stream without a half-written rename line; backticks become code runs", () => {
  expect(engine.answerSoFar("It counts.\nRENAME DAT_1 ->")).toBe("It counts.");
  expect(engine.splitAnswer(REPLY).rename).toEqual({ from: "DAT_10000c0d0", to: "one_per_line" });
  expect(engine.inlineRuns("sets `x` to **bold** `0`.")).toEqual([{ code: false, bold: false, text: "sets " }, { code: true, bold: false, text: "x" }, { code: false, bold: false, text: " to " }, { code: false, bold: true, text: "bold" }, { code: false, bold: false, text: " " }, { code: true, bold: false, text: "0" }, { code: false, bold: false, text: "." }]);
  expect(engine.proseBlocks("I tried:\n- one thing\n- another\n\nEither:\n1. paste it\n2. let me run it")).toEqual([
    { kind: "para", text: "I tried:" }, { kind: "item", marker: "•", text: "one thing" }, { kind: "item", marker: "•", text: "another" },
    { kind: "para", text: "Either:" }, { kind: "item", marker: "1.", text: "paste it" }, { kind: "item", marker: "2.", text: "let me run it" },
  ]);
  const prompt = engine.askPrompt({ about: "entry", from: 18, to: 19, lines: ["a;", "b;"], code: [...Array.from({ length: 17 }, () => "x;"), "a;", "b;", "", "c;"], fence: "c" }, [{ question: "Why?", answer: "Because." }], "And then?");
  expect(prompt).toContain("lines 18 to 19 of entry");
  expect(prompt).toContain("> 18 | a;\n> 19 | b;\n  20 | \n  21 | c;\n```");
  expect(prompt).toContain("without using any tools");
  expect(prompt).toContain("Earlier question: Why?");
  expect(prompt).toContain("Question: And then?");
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

const key = (name: string, cmd: boolean): void =>
  dispatchShortcut({ elementId: 0, eventType: "keyDown", key: name, modifiers: { cmd, ctrl: false, alt: false, shift: false } });

/** Presses whatever the agent panel shortcut is in the current keymap. */
function pressAgentShortcut(): void {
  const settings = currentSettings();
  const { mods, key: name } = parseCombo(comboFor("agent", settings.keymap ?? "eleven", settings.shortcuts));
  dispatchShortcut({ elementId: 0, eventType: "keyDown", key: name, modifiers: { cmd: mods.includes("cmd"), ctrl: mods.includes("ctrl"), alt: mods.includes("alt"), shift: mods.includes("shift") } });
}

/** Clicks a line's number, the way you pick whole lines. */
function clickGutter(number: number, shift = false): void {
  const id = screen.labelled(`Line ${number}`);
  if (id === null) throw new Error(`no line ${number}`);
  const box = screen.ui.renderer.getElementBounds(id);
  if (!box) throw new Error(`no box for line ${number}`);
  screen.ui.renderer.nativeSimulateClick(box.x + 30, box.y + box.height / 2, 0, shift ? "shift" : undefined);
  screen.ui.renderer.dispatchNativeEvents();
  screen.ui.renderer.flush();
}

test("select lines, Explain, see the answer under them, accept its rename, pin it, close with Esc", async () => {
  await screen.until(() => screen.labelled("entry") !== null, 20_000);
  screen.clickLabel("entry");
  await screen.until(() => screen.text().includes("_isatty"), 20_000);
  clickGutter(18);
  await screen.until(() => screen.labelled("Ask about the selection") !== null, 5_000);
  clickGutter(25, true);
  await screen.until(() => screen.labelled("Explain") !== null, 5_000);
  screen.clickLabel("Explain");
  await screen.until(() => screen.labelled("Ask about lines 18–25") !== null, 5_000);
  await screen.until(() => screen.text().includes("Renamed") || screen.labelled("Accept") !== null, 10_000);
  expect(asked.at(-1)?.question).toBe(explainQuestion());
  expect(asked.at(-1)?.quote.lines[0]).toContain("_isatty(1)");
  expect(asked.at(-1)?.quote.lines).toHaveLength(8);
  expect(screen.texts().join("")).toContain("sets DAT_10000c0d0 to print one name per line.");
  expect(screen.texts().join("")).toContain("DAT_10000c0d0 → one_per_line");
  expect(screen.text()).not.toContain("RENAME");
  expect(screen.texts().join("")).not.toContain("pull the binary");
  expect(screen.labelled("Ask about the selection")).toBeNull();
  screen.clickLabel("Accept");
  await screen.until(() => screen.text().includes("Renamed everywhere in this project."), 5_000);
  expect(loadProject(SAMPLE_PROGRAM.id).names.get("0x10000c0d0")).toBe("one_per_line");
  screen.clickLabel("Pin as note");
  await screen.until(() => screen.labelled("Has a pinned answer") !== null, 5_000);
  key("escape", false);
  await screen.until(() => screen.labelled("Ask about lines 18–25") === null, 5_000);
  expect(screen.labelled("Has a pinned answer")).not.toBeNull();
}, 60_000);

test("the agent shortcut asks about the picked line, and a typed follow-up quotes the same line", async () => {
  clickGutter(17);
  await screen.until(() => screen.labelled("Ask about the selection") !== null, 5_000);
  pressAgentShortcut();
  await screen.until(() => screen.labelled("Ask about line 17") !== null, 5_000);
  expect(screen.labelled("Your question about the selection")).not.toBeNull();
  screen.type("Your question about the selection", "w h y space s o ? enter");
  await screen.until(() => asked.at(-1)?.question === "why so?", 5_000);
  expect(asked.at(-1)?.quote.lines).toEqual(["  DAT_10000c024 = (char)BVar6;"]);
  await screen.until(() => screen.labelled("Continue in chat") !== null, 10_000);
  screen.type("Your question about the selection", "escape");
  await screen.until(() => screen.labelled("Ask about line 17") === null, 5_000);
}, 60_000);
