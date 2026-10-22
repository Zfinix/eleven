import { expect, test } from "bun:test";

import { inputTemplate, MAX_WALK_STEPS, normalAddress, parseWalk, signatureParams, type WalkRequest, walkPrompt } from "../src/engine/walk";
import { visitText, walkMarks } from "../src/workbench/WalkBar";

const BLOCKS = ["0x100000960", "0x1000009ac", "0x1000009b0"];

const REQUEST: WalkRequest = {
  agent: { id: "fake-agent", name: "Fake", description: "", version: "1", iconUrl: null, distribution: { kind: "command", command: "fake", args: [] } },
  native: null,
  projectId: "p",
  binary: { path: "/tmp/ls" },
  tune: { model: null, fast: false },
  fn: "0x100000960",
  name: "entry",
  pseudo: "void entry(undefined8 param_1,long param_2)\n\n{\n  if ((int)param_1 < 1) usage();\n}",
  inputs: 'param_1 = 2, param_2 = "pipelined"',
  blocks: [
    { start: "0x100000960", successors: ["0x1000009ac", "0x1000009b0"], lines: ["0x100000960: cmp w0, #0x1", "0x100000964: b.lt 0x1000009ac"] },
    { start: "0x1000009ac", successors: [], lines: ["0x1000009ac: bl 0x100004088"] },
    { start: "0x1000009b0", successors: [], lines: ["0x1000009b0: ret"] },
  ],
};

test("walk: parameters come from the signature line, ready for values", () => {
  expect(signatureParams(REQUEST.pseudo)).toEqual(["param_1", "param_2"]);
  expect(inputTemplate(REQUEST.pseudo)).toBe("param_1 = , param_2 = ");
  expect(signatureParams("\nchar * copy(char *param_1,int param_2[4])\n{")).toEqual(["param_1", "param_2"]);
  expect(signatureParams("int main(void)")).toEqual([]);
  expect(inputTemplate("// not decompiled yet")).toBe("");
});

test("walk: addresses match whatever their case or padding", () => {
  expect(normalAddress("0x0000000100000960")).toBe("0x100000960");
  expect(normalAddress("0X1000009AC")).toBe("0x1000009ac");
  expect(normalAddress(" 1000009b0 ")).toBe("0x1000009b0");
  expect(normalAddress("LAB_1000009b0")).toBeNull();
});

test("walk: the prompt holds the function, its code, every block with where it goes, and the inputs", () => {
  const prompt = walkPrompt(REQUEST);
  expect(prompt).toContain("entry at 0x100000960");
  expect(prompt).toContain('param_1 = 2, param_2 = "pipelined"');
  expect(prompt).toContain("if ((int)param_1 < 1) usage();");
  expect(prompt).toContain("0x100000960 -> 0x1000009ac, 0x1000009b0\n  0x100000960: cmp w0, #0x1\n  0x100000964: b.lt 0x1000009ac");
  expect(prompt).toContain("0x1000009b0 -> (leaves the function)\n  0x1000009b0: ret");
  expect(prompt).toContain(`${MAX_WALK_STEPS} steps`);
  expect(prompt).toContain("Reply with only JSON");
  expect(prompt).toContain("without using any tools");
});

test("walk: the reply keeps steps on known blocks, in order, and reads values as text", () => {
  const reply = `Here is the path.\n{"steps":[{"block":"0x0000000100000960","values":{"param_1":2,"iVar11":"2"},"note":"2 is not below 1"},{"block":"0x100000abc","note":"made up"},{"block":"0X1000009B0","values":{"w0":0}},{"note":"no block"}],"result":"returns 0"}\nDone.`;
  expect(parseWalk(reply, BLOCKS)).toEqual({
    steps: [
      { block: "0x100000960", values: [{ name: "param_1", value: "2" }, { name: "iVar11", value: "2" }], note: "2 is not below 1" },
      { block: "0x1000009b0", values: [{ name: "w0", value: "0" }], note: "" },
    ],
    result: "returns 0",
  });
});

test("walk: unreadable or empty replies fail, and a long walk is capped", () => {
  expect(parseWalk("I can't tell without running it.", BLOCKS)).toBeNull();
  expect(parseWalk('{"steps":[{"block":"0x100000960",}]}', BLOCKS)).toBeNull();
  expect(parseWalk('{"steps":[],"result":"returns"}', BLOCKS)).toBeNull();
  expect(parseWalk('{"steps":[{"block":"0xdead"}]}', BLOCKS)).toBeNull();
  expect(parseWalk('{"path":[]}', BLOCKS)).toBeNull();
  const loop = JSON.stringify({ steps: Array.from({ length: 250 }, (_, ix) => ({ block: BLOCKS[ix % 2] })) });
  expect(parseWalk(loop, BLOCKS)?.steps).toHaveLength(MAX_WALK_STEPS);
  expect(parseWalk(loop, BLOCKS)?.result).toBe("");
});

test("walk: a loop lists every visit on its block and lights each edge it took", () => {
  const walk = { steps: ["0x1", "0x2", "0x1", "0x2", "0x3"].map((block) => ({ block, values: [], note: "" })), result: "" };
  const marks = walkMarks(walk, 2, (start) => start);
  expect(marks.visits.get("0x1")).toEqual([1, 3]);
  expect(marks.current).toBe("0x1");
  expect([...marks.edges].sort()).toEqual(["0x1>0x2", "0x2>0x1", "0x2>0x3"]);
  const folded = walkMarks(walk, 4, (start) => (start === "0x3" ? "0x2" : start));
  expect(folded.visits.get("0x2")).toEqual([2, 4, 5]);
  expect(visitText([1])).toBe("1");
  expect(visitText([2, 5])).toBe("2, 5");
  expect(visitText([1, 3, 5, 7, 9])).toBe("1, 3, 5 +2");
});
