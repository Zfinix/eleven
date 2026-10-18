import { expect, test } from "bun:test";

import { goalControl } from "../src/agents/goals";

test("goal controls: Codex pause and clear go straight to the session", () => {
  expect(goalControl("codex-acp", "/goal pause")).toBe("pause");
  expect(goalControl("codex-acp", "  /GOAL Clear ")).toBe("clear");
});

test("goal controls: other commands and other agents send as typed", () => {
  expect(goalControl("codex-acp", "/goal resume")).toBeNull();
  expect(goalControl("codex-acp", "/goal pause the parser work")).toBeNull();
  expect(goalControl("codex-acp", "/goal")).toBeNull();
  expect(goalControl("claude-acp", "/goal pause")).toBeNull();
});
