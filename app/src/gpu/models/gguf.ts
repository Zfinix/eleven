import { stat } from "node:fs/promises";
import { basename } from "node:path";

import type { MetaEntry, ModelInfo, ModelRisk, ModelTensor } from "../types";
import { bytes, head, mixOf, mixSummary } from "./read";

const HEADER_LIMIT = 64 * 1024 * 1024;
const SHOWN_ITEMS = 3;
const LONGEST_VALUE = 300;
const GGML_TYPES: Readonly<Record<number, string>> = {
  0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1", 6: "Q5_0", 7: "Q5_1", 8: "Q8_0", 9: "Q8_1", 10: "Q2_K", 11: "Q3_K", 12: "Q4_K",
  13: "Q5_K", 14: "Q6_K", 15: "Q8_K", 16: "IQ2_XXS", 17: "IQ2_XS", 18: "IQ3_XXS", 19: "IQ1_S", 20: "IQ4_NL", 21: "IQ3_S",
  22: "IQ2_S", 23: "IQ4_XS", 24: "I8", 25: "I16", 26: "I32", 27: "I64", 28: "F64", 29: "IQ1_M", 30: "BF16",
};

/** Elements per block and bytes per block for each ggml type, so a tensor's size follows from its shape. */
const BLOCKS: Readonly<Record<string, readonly [number, number]>> = {
  F32: [1, 4], F16: [1, 2], BF16: [1, 2], F64: [1, 8], I8: [1, 1], I16: [1, 2], I32: [1, 4], I64: [1, 8],
  Q4_0: [32, 18], Q4_1: [32, 20], Q5_0: [32, 22], Q5_1: [32, 24], Q8_0: [32, 34], Q8_1: [32, 36], IQ4_NL: [32, 18],
  Q2_K: [256, 84], Q3_K: [256, 110], Q4_K: [256, 144], Q5_K: [256, 176], Q6_K: [256, 210], Q8_K: [256, 292],
  IQ2_XXS: [256, 66], IQ2_XS: [256, 74], IQ3_XXS: [256, 98], IQ1_S: [256, 50], IQ3_S: [256, 110], IQ2_S: [256, 82], IQ4_XS: [256, 136], IQ1_M: [256, 56],
};

type Value = string | number | bigint | boolean | readonly Value[];

class Cursor {
  constructor(private readonly buf: Buffer, private at = 0) {}
  u32(): number { const v = this.buf.readUInt32LE(this.at); this.at += 4; return v; }
  u64(): bigint { const v = this.buf.readBigUInt64LE(this.at); this.at += 8; return v; }
  str(): string { const n = Number(this.u64()); const v = this.buf.toString("utf8", this.at, this.at + n); this.at += n; return v; }
  value(type: number): Value {
    switch (type) {
      case 0: return this.buf.readUInt8(this.at++);
      case 1: return this.buf.readInt8(this.at++);
      case 2: { const v = this.buf.readUInt16LE(this.at); this.at += 2; return v; }
      case 3: { const v = this.buf.readInt16LE(this.at); this.at += 2; return v; }
      case 4: return this.u32();
      case 5: { const v = this.buf.readInt32LE(this.at); this.at += 4; return v; }
      case 6: { const v = this.buf.readFloatLE(this.at); this.at += 4; return v; }
      case 7: return this.buf.readUInt8(this.at++) !== 0;
      case 8: return this.str();
      case 9: { const inner = this.u32(); const n = Number(this.u64()); return Array.from({ length: n }, () => this.value(inner)); }
      case 10: return this.u64();
      case 11: { const v = this.buf.readBigInt64LE(this.at); this.at += 8; return v; }
      case 12: { const v = this.buf.readDoubleLE(this.at); this.at += 8; return v; }
      default: throw new Error(`GGUF value type ${type} isn't known.`);
    }
  }
}

function shown(value: Value): string {
  if (Array.isArray(value)) {
    const first = value.slice(0, SHOWN_ITEMS).map((item) => (Array.isArray(item) ? "[…]" : String(item)));
    if (value.length === 1) return first[0] ?? "";
    return `${value.length.toLocaleString("en-US")} items: ${first.join(", ")}${value.length > SHOWN_ITEMS ? " …" : ""}`;
  }
  const out = String(value);
  return out.length > LONGEST_VALUE ? `${out.slice(0, LONGEST_VALUE)}…` : out;
}

/** Text a chat template puts in front of the model: a default system message, or plain text outside its tags that every prompt carries. */
export function hiddenPrompt(template: string): ModelRisk | null {
  const fallback = /<\|im_start\|>system\\?n?\s*([^<'"{}]{8,}?)\s*(?:<\|im_end\|>|['"])/.exec(template)?.[1]?.trim();
  if (fallback) return { kind: "systemPrompt", text: fallback };
  const loose = template.replace(/\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}|\{#[\s\S]*?#\}/g, " ").replace(/\s+/g, " ").trim();
  if (loose.split(" ").length >= 3) return { kind: "everyPrompt", text: loose };
  return null;
}

function text(meta: ReadonlyMap<string, Value>, key: string): string | null {
  const value = meta.get(key);
  return typeof value === "string" || typeof value === "number" || typeof value === "bigint" ? String(value) : null;
}

/** GGUF header: architecture, quantization, tokenizer and any baked-in chat template or system prompt. */
export async function readGguf(path: string): Promise<ModelInfo> {
  const buffer = await head(path, HEADER_LIMIT);
  if (buffer.toString("ascii", 0, 4) !== "GGUF") throw new Error("This isn't a GGUF file.");
  const cursor = new Cursor(buffer, 4);
  const version = cursor.u32();
  const tensorCount = Number(cursor.u64());
  const kvCount = Number(cursor.u64());
  const meta = new Map<string, Value>();
  for (let ix = 0; ix < kvCount; ix++) {
    const key = cursor.str();
    meta.set(key, cursor.value(cursor.u32()));
  }
  const tensors: ModelTensor[] = [];
  for (let ix = 0; ix < tensorCount; ix++) {
    const name = cursor.str();
    const dims = Array.from({ length: cursor.u32() }, () => Number(cursor.u64()));
    const type = GGML_TYPES[cursor.u32()] ?? "unknown";
    const offset = Number(cursor.u64());
    const [per, size] = BLOCKS[type] ?? [1, 0];
    const elements = dims.reduce((n, d) => n * d, 1);
    tensors.push({ name, shape: dims.join(" × "), type, bytes: Math.ceil(elements / per) * size, offset });
  }
  const mix = mixOf(tensors);
  const template = text(meta, "tokenizer.chat_template");
  const risk: ModelRisk | null = template ? (hiddenPrompt(template) ?? { kind: "template" }) : null;
  const arch = text(meta, "general.architecture") ?? "unknown";
  const context = text(meta, `${arch}.context_length`);
  const metadata: MetaEntry[] = [...meta].filter(([key]) => key !== "tokenizer.chat_template").map(([key, value]) => ({ key, value: shown(value) }));
  const size = (await stat(path)).size;
  return {
    name: text(meta, "general.name") ?? basename(path),
    format: `GGUF v${version} · ${arch}${context ? ` · ${context} context` : ""} · ${text(meta, "tokenizer.ggml.model") ?? "no"} tokenizer`,
    weights: `${mixSummary(mix)} · ${tensorCount} tensors · ${bytes(size)}`,
    inputs: [],
    outputs: [],
    layers: tensors.map((t) => ({ name: t.name, op: "weights", shape: t.shape, type: t.type })),
    risk,
    tensors,
    mix,
    metadata,
    template,
    loads: [],
    nodes: [],
    size,
  };
}
