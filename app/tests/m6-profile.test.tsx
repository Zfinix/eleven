import { afterAll, beforeAll, test } from "bun:test";
import { join } from "node:path";

import { adoptLoginShell } from "../src/agents/detect";
import { prepareTarget } from "../src/engine/target";
import { adoptToolchain } from "../src/engine/toolchain";
import { Screen } from "./harness";

let screen: Screen;

beforeAll(async () => {
  await adoptLoginShell();
  adoptToolchain();
  screen = new Screen().workbench(prepareTarget(join(import.meta.dir, "fixtures", "PhotoFilter.app")));
}, 30_000);

afterAll(() => screen.unmount());

test("M6: recording a GPU run shows the timeline and what to fix", async () => {
  await screen.until(() => screen.text().includes("Shaders and models"), 120_000);
  screen.click("Shaders and models");
  await screen.until(() => screen.text().includes("Record a GPU run"));
  screen.click("Record a GPU run");
  await screen.until(() => screen.text().includes("Run it"));
  screen.click("Run it");
  await screen.until(() => screen.text().includes("PhotoFilter run,"), 120_000);
  const title = screen.texts().find((line) => line.startsWith("PhotoFilter run,"));
  if (!title) throw new Error("no recording listed");
  screen.click(title);
  await screen.until(() => screen.text().includes("GPU · compute") && screen.text().includes("What the numbers say"), 120_000);
}, 300_000);
