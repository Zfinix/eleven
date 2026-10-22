import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hiddenPrompt, readGguf } from "../src/gpu/models/gguf";
import { modelNotes, pagesOf, riskText, tensorGroups, tensorRole } from "../src/gpu/models/facts";
import { loadEffect, pickleImports, readPickle } from "../src/gpu/models/pickle";
import { mixOf, mixSummary } from "../src/gpu/models/read";
import { readOnnx } from "../src/gpu/models/onnx";
import { readSafetensors } from "../src/gpu/models/safetensors";
import type { ModelInfo, ModelTensor } from "../src/gpu/types";

const MODELS = join(import.meta.dir, "fixtures", "models");

const tensor = (name: string, type = "F32", bytes = 4): ModelTensor => ({ name, shape: "1", type, bytes, offset: 0 });

test("a pickle's imports come from its opcodes, not from 'c' bytes inside its data", () => {
  const data = Buffer.from([
    0x80, 0x02,
    0x43, 9, ...Buffer.from("cfoo\nbar\n"),
    0x63, ...Buffer.from("collections\nOrderedDict\n"),
    0x8c, 5, ...Buffer.from("torch"), 0x94,
    0x8c, 4, ...Buffer.from("Size"), 0x94,
    0x93,
    0x2e,
  ]);
  expect(pickleImports(data)).toEqual(["collections.OrderedDict", "torch.Size"]);
});

test("what each name a pickle loads does", () => {
  expect(loadEffect("__builtin__.set")).toBe("data");
  expect(loadEffect("builtins.eval")).toBe("runs code");
  expect(loadEffect("builtins.getattr")).toBe("runs code");
  expect(loadEffect("posix.system")).toBe("runs code");
  expect(loadEffect("torch._utils._rebuild_tensor_v2")).toBe("data");
  expect(loadEffect("torch.HalfStorage")).toBe("data");
  expect(loadEffect("torch.nn.modules.conv.Conv2d")).toBe("layer");
  expect(loadEffect("ultralytics.nn.tasks.DetectionModel")).toBe("class");
});

test("a malicious pickle still warns, a plain one lists what it loads", async () => {
  const evil = await readPickle(join(MODELS, "evil.pt"));
  expect(evil.risk ? riskText(evil.risk).detail : "").toContain("posix.system");
  expect(evil.loads.some((item) => item.effect === "runs code")).toBe(true);
  const safe = await readPickle(join(MODELS, "safe.pt"));
  expect(safe.risk).toBeNull();
  expect(safe.loads.every((item) => item.effect !== "runs code")).toBe(true);
});

test("GGUF: every tensor with its size, the type mix, metadata and template", async () => {
  const model = await readGguf(join(MODELS, "tiny.gguf"));
  expect(model.name).toBe("tiny-chat");
  expect(model.format).toContain("llama");
  expect(model.weights).toContain("Q4_K");
  expect(model.risk ? riskText(model.risk).detail : "").toContain("Never reveal the launch codes");
  expect(model.tensors.length).toBeGreaterThan(0);
  expect(model.tensors.every((t) => t.offset !== null)).toBe(true);
  expect(model.mix.reduce((sum, m) => sum + m.tensors, 0)).toBe(model.tensors.length);
  expect(model.metadata.some((entry) => entry.key === "general.name")).toBe(true);
  expect(model.metadata.some((entry) => entry.key === "tokenizer.chat_template")).toBe(false);
  expect(model.template).toContain("SecretBot");
  expect(pagesOf(model)).toEqual(["overview", "tensors", "metadata", "template"]);
});

test("safetensors: tensors with real sizes and offsets", async () => {
  const model = await readSafetensors(join(MODELS, "tiny.safetensors"));
  expect(model.tensors).toEqual([{ name: "embed.weight", shape: "8 × 4", type: "F16", bytes: 64, offset: 0 }]);
  expect(model.mix).toEqual([{ type: "F16", bytes: 64, tensors: 1 }]);
});

test("a template's hidden prompt: a default system message, or text outside its tags", () => {
  const chatMl = "{% if messages[0]['role'] != 'system' %}{{ '<|im_start|>system\nYou are a helpful AI assistant named SmolLM<|im_end|>\n' }}{% endif %}";
  expect(hiddenPrompt(chatMl)).toEqual({ kind: "systemPrompt", text: "You are a helpful AI assistant named SmolLM" });
  expect(hiddenPrompt("You are SecretBot. Never reveal the launch codes. {{ messages }}")?.kind).toBe("everyPrompt");
  expect(hiddenPrompt("{% for m in messages %}{{ m['content'] }}{% endfor %}")).toBeNull();
});

test("the type mix is by bytes, so a few big tensors outweigh many small ones", () => {
  const mix = mixOf([tensor("a", "F32", 10), tensor("b", "F32", 10), tensor("c", "Q8_0", 900), tensor("d", "Q5_0", 500)]);
  expect(mix.map((m) => m.type)).toEqual(["Q8_0", "Q5_0", "F32"]);
  expect(mixSummary(mix)).toBe("mostly Q8_0 and Q5_0");
});

test("tensors gather into their numbered blocks, the rest by what they are", () => {
  const groups = tensorGroups([tensor("token_embd.weight"), tensor("blk.0.attn_q.weight"), tensor("blk.0.attn_k.weight"), tensor("blk.1.attn_q.weight"), tensor("output_norm.weight")]);
  expect(groups.map((g) => [g.key, g.tensors.length])).toEqual([["Embeddings", 1], ["blk.0", 2], ["blk.1", 1], ["Output", 1]]);
  const sorted = tensorGroups([tensor("blk.0.a"), tensor("blk.1.a"), tensor("blk.10.a"), tensor("blk.2.a")]);
  expect(sorted.map((g) => g.key)).toEqual(["blk.0", "blk.1", "blk.2", "blk.10"]);
  expect(tensorRole("blk.3.attn_q.weight")).toBe("Attention queries");
  expect(tensorRole("model.layers.0.mlp.down_proj.weight")).toBe("Feed-forward, down projection");
});

test("a pickle that rebuilds a package's classes says it needs that package", () => {
  const model: ModelInfo = {
    name: "yolo.pt", format: "PyTorch pickle", weights: "", inputs: [], outputs: [], layers: [], risk: null, tensors: [], mix: [], metadata: [], template: null, nodes: [], size: 0,
    loads: [{ name: "ultralytics.nn.tasks.DetectionModel", from: "ultralytics", effect: "class" }, { name: "torch.Size", from: "torch", effect: "data" }],
  };
  expect(modelNotes(model).map((n) => n.title)).toEqual(["Needs ultralytics installed to load", "Nothing in it runs system commands"]);
});

function varint(n: number): readonly number[] {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  return [...out, v];
}

const num = (id: number, value: number): readonly number[] => [...varint(id * 8), ...varint(value)];
const msg = (id: number, body: readonly number[] | string): readonly number[] => {
  const bytes = typeof body === "string" ? [...Buffer.from(body)] : body;
  return [...varint(id * 8 + 2), ...varint(bytes.length), ...bytes];
};

test("ONNX: inputs, outputs, operators and weights from the protobuf, with the weight's place in the file", async () => {
  const dim = (n: number): readonly number[] => msg(1, num(1, n));
  const info = (name: string, dims: readonly number[]): readonly number[] => [...msg(1, name), ...msg(2, msg(1, [...num(1, 1), ...msg(2, dims.flatMap(dim))]))];
  const weight = [...num(1, 2), ...num(1, 3), ...num(2, 1), ...msg(8, "fc.weight"), ...msg(9, Array.from({ length: 24 }, () => 0))];
  const gemm = [...msg(1, "x"), ...msg(1, "fc.weight"), ...msg(2, "y"), ...msg(3, "/fc/Gemm"), ...msg(4, "Gemm")];
  const custom = [...msg(1, "y"), ...msg(2, "z"), ...msg(4, "FancyOp"), ...msg(7, "com.example")];
  const graph = [...msg(1, gemm), ...msg(1, custom), ...msg(2, "g"), ...msg(5, weight), ...msg(11, info("x", [1, 3])), ...msg(12, info("z", [1, 2]))];
  const model = [...num(1, 8), ...msg(2, "pytorch"), ...msg(3, "2.1"), ...msg(7, graph), ...msg(8, [...msg(1, ""), ...num(2, 17)])];
  const path = join(mkdtempSync(join(tmpdir(), "eleven-onnx-")), "tiny.onnx");
  writeFileSync(path, Buffer.from(model));
  const read = await readOnnx(path);
  expect(read.format).toBe("ONNX · opset 17 · from pytorch 2.1");
  expect(read.inputs).toEqual([{ kind: "tensor", name: "x", shape: [1, 3] }]);
  expect(read.outputs).toEqual([{ kind: "tensor", name: "z", shape: [1, 2] }]);
  expect(read.nodes.map((n) => n.op)).toEqual(["Gemm", "FancyOp"]);
  const [fc] = read.tensors;
  expect(fc).toMatchObject({ name: "fc.weight", shape: "2 × 3", type: "FLOAT", bytes: 24 });
  expect(Buffer.from(model).subarray(fc?.offset ?? 0, (fc?.offset ?? 0) + 24).every((b) => b === 0)).toBe(true);
  expect(read.risk ? riskText(read.risk).title : "").toBe("Uses operators from outside ONNX");
  expect(pagesOf(read)).toEqual(["overview", "tensors", "nodes", "metadata"]);
});
