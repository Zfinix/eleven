import { expect, test } from "bun:test";

import { describeSession } from "../src/debug/useDebug";

test("M9: a paused session reads as where it stopped, the stack, locals, registers and output", () => {
  const text = describeSession(
    {
      kind: "stopped", reason: "breakpoint", thread: 1, threads: [], stop: 1,
      frames: [{ id: 1, name: "check_license", line: 0, source: null, pc: "0x100003e68" }, { id: 2, name: "main", line: 0, source: null, pc: "0x100004010" }],
      scopes: [{ name: "Locals", reference: 3, vars: [{ name: "key", value: "\"ELEVEN-2026\"", reference: 0 }] }],
    },
    [{ kind: "program", text: "Enter license key:" }, { kind: "asked", text: "w8" }, { kind: "answer", text: "(unsigned int) $0 = 2051103170" }],
    [{ name: "x0", value: "0x7a3f19c2", reference: 0 }],
  );
  expect(text).toContain("Paused (breakpoint) in check_license at 0x100003e68");
  expect(text).toContain("  main 0x100004010");
  expect(text).toContain("key = \"ELEVEN-2026\"");
  expect(text).toContain("x0 = 0x7a3f19c2");
  expect(text).toContain("> w8");
});

test("M9: with no session the agent is told to ask the user", () => {
  expect(describeSession({ kind: "idle" }, [], [])).toContain("Start one with debug_start");
  expect(describeSession({ kind: "exited", code: 3 }, [{ kind: "program", text: "bye" }], [])).toContain("exited with code 3.\n\nOutput:\nbye");
});
