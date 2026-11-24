import { expect, test } from "bun:test";

import { StepChanges } from "../src/debug/changes";

test("a step marks the values it changed, against the stop just before it", () => {
  const seen = new StepChanges();
  expect(seen.changed(1, "Registers/x0", "0x1")).toBe(false);
  expect(seen.changed(1, "Registers/x1", "0x2")).toBe(false);
  expect(seen.changed(2, "Registers/x0", "0x7")).toBe(true);
  expect(seen.changed(2, "Registers/x1", "0x2")).toBe(false);
  expect(seen.changed(2, "Registers/x0", "0x7")).toBe(true);
  expect(seen.changed(4, "Registers/x0", "0x9")).toBe(false);
});
