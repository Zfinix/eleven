import "./fixtures/isolate";
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { ReactElement } from "react";

import { type Chat, useChat } from "../src/chat/useChat";
import type { Author } from "../src/engine/edits";
import { propose } from "../src/engine/history";
import { loadProject, updateProject } from "../src/engine/project";
import { runCommand } from "../src/lib/shortcuts";
import { DARK, ThemeContext } from "../src/theme";
import { WorkbenchView } from "../src/workbench/Workbench";
import { NO_GPU, SAMPLE_PROGRAM } from "./fixtures/sampleProgram";
import { Screen } from "./harness";

const ID = SAMPLE_PROGRAM.id;
const CLAUDE: Author = { kind: "agent", agent: "Claude", chat: null };

let chat: Chat | null = null;

function SampleBench(): ReactElement {
  chat = useChat(null, () => {});
  return (
    <ThemeContext.Provider value={{ p: DARK, appearance: "Dark", setAppearance: () => {} }}>
      <WorkbenchView program={SAMPLE_PROGRAM} problem={null} since={null} code gpu={NO_GPU} chat={chat} onBack={() => {}} onOpen={() => {}} />
    </ThemeContext.Provider>
  );
}

let screen: Screen;

beforeAll(async () => {
  screen = new Screen().render(<SampleBench />);
  await screen.until(() => screen.text().includes("Pseudocode"));
}, 60_000);

afterAll(() => screen.unmount());

test("undo: opening the workbench logs nothing, and undo and redo step through an agent's rename", async () => {
  expect(loadProject(ID).edits).toEqual([]);
  updateProject(ID, (project) => ({ ...project, names: new Map(project.names).set("0x1000016d8", "print_usage") }), CLAUDE);
  expect(loadProject(ID).edits.map((edit) => edit.by)).toEqual([CLAUDE]);
  runCommand("undo");
  await screen.until(() => screen.text().includes("Undid: Renamed FUN_1000016d8 to print_usage"));
  expect(loadProject(ID).names.has("0x1000016d8")).toBe(false);
  runCommand("redo");
  await screen.until(() => screen.text().includes("Redid: Renamed FUN_1000016d8 to print_usage"));
  expect(loadProject(ID).names.get("0x1000016d8")).toBe("print_usage");
}, 60_000);

test("suggestions: an agent's patch waits in the chat until accepted", async () => {
  chat?.thread.note("Looking at the entry point");
  await screen.until(() => screen.text().includes("Looking at the entry point"));
  propose(ID, "patches", "0x100000960", "1f 20 03 d5", CLAUDE, "Skips the first instruction");
  await screen.until(() => screen.text().includes("Skips the first instruction"));
  expect(loadProject(ID).patches).toEqual([]);
  screen.click("Accept");
  await screen.until(() => screen.text().includes("Patched"));
  expect(loadProject(ID).patches).toEqual([{ addr: "0x100000960", bytes: "1f 20 03 d5" }]);
}, 60_000);
