import { expect, test } from "bun:test";

import { agentAnswer, arrangeFromEvidence, arrangePrompt, failureReason, failureText, reasonText } from "../src/workbench/arrange";
import type { Fn, TableRow } from "../src/workbench/model";
import { sourceFiles } from "../src/workbench/sources";

const fn = (addr: string, name: string, kind: Fn["kind"] = "function"): Fn => ({ addr, name, kind });

const STRINGS: readonly TableRow[] = [
  { a: "0x9000", b: "/Users/builder/Calc/Calculator/Engine/Evaluator.swift" },
  { a: "0x9100", b: "Fatal error: /Users/builder/Calc/Calculator/History/HistoryStore.swift" },
];

const FUNCTIONS: readonly Fn[] = [
  fn("0x10", "Calculator.Evaluator.parse"),
  fn("0x20", "helper_one"),
  fn("0x30", "Calculator.Evaluator.evaluate"),
  fn("0x40", "Calculator.HistoryStore.load"),
  fn("0x50", "orphan_fn"),
  fn("0x60", "FUN_00000060"),
  fn("0x70", "_objc_msgSend", "thunk"),
];

test("paths in the binary place files exactly, and code between two functions of one file joins it", () => {
  const sources = sourceFiles(STRINGS.map((row) => row.b), []);
  const result = arrangeFromEvidence(FUNCTIONS, STRINGS, [], sources);
  expect(result.files.map((file) => `${file.path} ${file.placement} ${[...file.fns].sort().join(",")}`)).toEqual([
    "Calculator/Engine/Evaluator.swift exact 0x10,0x20,0x30",
    "Calculator/History/HistoryStore.swift exact 0x40",
  ]);
  expect(result.files[0]?.key).toBe("/Users/builder/Calc/Calculator/Engine/Evaluator.swift");
  expect(reasonText(result.files[0]?.reason ?? [])).toBe("Its path is written in the binary: /Users/builder/Calc/Calculator/Engine/Evaluator.swift 1 more function sits right next to its code in the binary.");
  expect(result.unplaced).toEqual(["0x50", "0x60"]);
});

test("the agent's answer keeps only functions it was asked about and files that exist", () => {
  const reply = 'Here:\n```json\n{"folders": [{"folder": "Calculator/History", "reason": "History screens.", "files": ["HistoryView.swift", "Ghost.swift"]}], "groups": [{"file": "Calculator/Support/Orphans.swift", "reason": "Small helpers used by History.", "functions": ["0x50", "0x999"]}]}\n```';
  const answer = agentAnswer(reply, new Set(["0x50"]), new Set(["HistoryView.swift"]));
  expect(answer.groups).toEqual([{ key: "Calculator/Support/Orphans.swift", path: "Calculator/Support/Orphans.swift", placement: "guess", reason: [{ kind: "said", text: "Small helpers used by History." }], fns: ["0x50"] }]);
  expect([...answer.folders]).toEqual([["HistoryView.swift", { folder: "Calculator/History", reason: "History screens." }]]);
  expect(agentAnswer("not json", new Set(["0x50"]), new Set()).groups).toEqual([]);
});

test("the agent sees the placed files and only the leftovers", () => {
  const prompt = arrangePrompt("Calculator", [{ key: "a", path: "Calculator/Engine/Evaluator.swift", placement: "exact", reason: [], fns: ["0x10"] }], [fn("0x50", "orphan_fn")]);
  expect(prompt).toContain("- Calculator/Engine/Evaluator.swift (1)");
  expect(prompt).toContain("0x50 orphan_fn");
  expect(prompt).toContain("```json");
});

test("an agent failure says what happened and what to do, without semicolons", () => {
  expect(failureReason("Claude needs you to sign in. Run `claude login` in Terminal")).toBe("signin");
  expect(failureReason("429 Too Many Requests: usage limit reached")).toBe("limit");
  expect(failureReason("getaddrinfo ENOTFOUND api.anthropic.com")).toBe("offline");
  expect(failureReason("The agent exited with code 1")).toBe("stopped");
  const texts = (["signin", "limit", "stopped", "offline"] as const).map((reason) => failureText(reason, "Claude", 41));
  expect(texts[0]).toBe("Claude needs you to sign in again, so it couldn\u2019t place the other 41 functions. The files the binary places are kept.");
  expect(failureText("stopped", "Claude", 1)).toContain("the other 1 function.");
  expect(texts.every((text) => !text.includes(";"))).toBe(true);
});

