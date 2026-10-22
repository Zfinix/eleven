import "./fixtures/isolate";
import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";

import * as engine from "../src/engine/walk";
import type { RewriteProgress } from "../src/engine/rewrite";
import { useChat } from "../src/chat/useChat";
import { DARK, ThemeContext } from "../src/theme";
import { WorkbenchView } from "../src/workbench/Workbench";
import { NO_GPU, SAMPLE_PROGRAM } from "./fixtures/sampleProgram";
import { Screen } from "./harness";

const walked: engine.WalkRequest[] = [];

const WALK: engine.Walk = {
  steps: [
    { block: "0x100000960", values: [{ name: "param_1", value: "2" }], note: "param_1 is 2, so it skips the usage message." },
    { block: "0x1000009b0", values: [{ name: "w0", value: "0" }], note: "Falls through to the return." },
  ],
  result: "returns 0",
};

mock.module("../src/engine/walk", () => ({
  ...engine,
  walkPath: async (req: engine.WalkRequest, onProgress: (progress: RewriteProgress) => void): Promise<engine.Walk | null> => {
    walked.push(req);
    onProgress({ step: "Reading entry", code: null, reply: "" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    return WALK;
  },
}));

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

test("graph: walk a path lights the blocks step by step, and closing clears it", async () => {
  await screen.until(() => screen.labelled("function entry") !== null, 20_000);
  screen.clickLabel("function entry");
  await screen.until(() => screen.text().includes("Graph"), 10_000);
  screen.click("Graph");
  await screen.until(() => screen.labelled("Walk a path") !== null, 10_000);
  screen.clickLabel("Walk a path");
  await screen.until(() => screen.valueOf("Inputs to walk with") === "param_1 = , param_2 = ", 10_000);
  screen.type("Inputs to walk with", "cmd-a backspace 2");
  await screen.until(() => screen.valueOf("Inputs to walk with") === "2", 5_000);
  screen.clickLabel("Walk");
  await screen.until(() => screen.text().includes("Walking the path with"), 5_000);
  await screen.until(() => screen.labelled("Step 1") !== null, 10_000);
  expect(walked.at(-1)?.inputs).toBe("2");
  expect(walked.at(-1)?.name).toBe("entry");
  expect(walked.at(-1)?.blocks.map((block) => block.start)).toEqual(["0x100000960", "0x1000009ac", "0x1000009b0"]);
  expect(walked.at(-1)?.blocks[0]?.lines[0]).toBe("0x100000960: pacibsp");
  expect(walked.at(-1)?.pseudo.startsWith("void entry(")).toBe(true);
  expect(screen.labelled("Step 2")).not.toBeNull();
  expect(screen.text()).toContain("Step 1 of 2");
  expect(screen.text()).toContain("param_1 = 2");
  expect(screen.text()).toContain("param_1 is 2, so it skips the usage message.");
  expect(screen.text()).toContain(", not run");
  expect(screen.text()).not.toContain("Ends: returns 0");
  screen.clickLabel("Next step");
  await screen.until(() => screen.text().includes("Step 2 of 2"), 5_000);
  expect(screen.text()).toContain("w0 = 0");
  expect(screen.text()).toContain("Ends: returns 0");
  screen.clickLabel("Previous step");
  await screen.until(() => screen.text().includes("Step 1 of 2"), 5_000);
  screen.clickLabel("Close the walk");
  await screen.until(() => screen.labelled("Inputs to walk with") === null, 5_000);
  expect(screen.labelled("Step 1")).toBeNull();
  expect(screen.labelled("Walk a path")).not.toBeNull();
}, 60_000);

test("graph: changing the inputs clears the walk, Esc closes the bar", async () => {
  screen.clickLabel("Walk a path");
  await screen.until(() => screen.labelled("Inputs to walk with") !== null, 5_000);
  screen.clickLabel("Walk");
  await screen.until(() => screen.labelled("Step 1") !== null, 10_000);
  screen.type("Inputs to walk with", "3");
  await screen.until(() => screen.labelled("Step 1") === null, 5_000);
  screen.type("Inputs to walk with", "escape");
  await screen.until(() => screen.labelled("Inputs to walk with") === null, 5_000);
}, 60_000);
