import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import type { MetaEntry, ModelInfo, ModelNode, ModelRisk, ModelTensor, Tensor } from "../types";
import { bytes, mixOf } from "./read";

/** Where one protobuf field sits: a number for varints and fixed widths, a byte range for everything length-delimited. */
type Field = { readonly id: number; readonly wire: number; readonly num: number; readonly from: number; readonly to: number };

const VARINT = 0;
const FIXED64 = 1;
const BYTES = 2;
const FIXED32 = 5;

/** ONNX TensorProto.DataType: its name and how many bytes one element takes (0 when it varies). */
const DATA_TYPES: Readonly<Record<number, readonly [string, number]>> = {
  1: ["FLOAT", 4], 2: ["UINT8", 1], 3: ["INT8", 1], 4: ["UINT16", 2], 5: ["INT16", 2], 6: ["INT32", 4], 7: ["INT64", 8], 8: ["STRING", 0],
  9: ["BOOL", 1], 10: ["FLOAT16", 2], 11: ["DOUBLE", 8], 12: ["UINT32", 4], 13: ["UINT64", 8], 14: ["COMPLEX64", 8], 15: ["COMPLEX128", 16],
  16: ["BFLOAT16", 2], 17: ["FLOAT8E4M3FN", 1], 18: ["FLOAT8E4M3FNUZ", 1], 19: ["FLOAT8E5M2", 1], 20: ["FLOAT8E5M2FNUZ", 1], 21: ["UINT4", 0.5], 22: ["INT4", 0.5],
};

function varint(buf: Buffer, at: number): readonly [number, number] {
  let value = 0;
  let scale = 1;
  let pos = at;
  for (;;) {
    const byte = buf[pos];
    if (byte === undefined) throw new Error("This ONNX file ends in the middle of a value.");
    value += (byte & 0x7f) * scale;
    pos++;
    if (byte < 0x80) return [value, pos];
    scale *= 128;
  }
}

/** The fields of one message between `from` and `to`, in order. */
function fields(buf: Buffer, from: number, to: number): readonly Field[] {
  const out: Field[] = [];
  let at = from;
  while (at < to) {
    const [key, next] = varint(buf, at);
    const id = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === VARINT) {
      const [num, end] = varint(buf, next);
      out.push({ id, wire, num, from: next, to: end });
      at = end;
    } else if (wire === BYTES) {
      const [length, start] = varint(buf, next);
      out.push({ id, wire, num: length, from: start, to: start + length });
      at = start + length;
    } else if (wire === FIXED64 || wire === FIXED32) {
      const width = wire === FIXED64 ? 8 : 4;
      out.push({ id, wire, num: 0, from: next, to: next + width });
      at = next + width;
    } else {
      throw new Error(`This doesn't look like an ONNX file (wire type ${wire}).`);
    }
  }
  return out;
}

function text(buf: Buffer, field: Field): string {
  return buf.toString("utf8", field.from, field.to);
}

function first(list: readonly Field[], id: number): Field | undefined {
  return list.find((f) => f.id === id);
}

function all(list: readonly Field[], id: number): readonly Field[] {
  return list.filter((f) => f.id === id);
}

/** Repeated int64s, packed or one per field. */
function ints(buf: Buffer, list: readonly Field[], id: number): readonly number[] {
  return all(list, id).flatMap((f) => {
    if (f.wire === VARINT) return [f.num];
    const out: number[] = [];
    let at = f.from;
    while (at < f.to) {
      const [num, next] = varint(buf, at);
      out.push(num);
      at = next;
    }
    return out;
  });
}

function stringPairs(buf: Buffer, list: readonly Field[], id: number): readonly MetaEntry[] {
  return all(list, id).map((f) => {
    const pair = fields(buf, f.from, f.to);
    const key = first(pair, 1);
    const value = first(pair, 2);
    return { key: key ? text(buf, key) : "", value: value ? text(buf, value) : "" };
  });
}

/** A graph input or output: its name and shape, with -1 for a dimension that is named rather than fixed. */
function valueInfo(buf: Buffer, field: Field): Tensor {
  const info = fields(buf, field.from, field.to);
  const name = first(info, 1);
  const type = first(info, 2);
  const tensorType = type ? first(fields(buf, type.from, type.to), 1) : undefined;
  const shape = tensorType ? first(fields(buf, tensorType.from, tensorType.to), 2) : undefined;
  const dims = shape
    ? all(fields(buf, shape.from, shape.to), 1).map((dim) => {
      const parts = fields(buf, dim.from, dim.to);
      const fixed = first(parts, 1);
      return fixed ? fixed.num : -1;
    })
    : [];
  return { kind: "tensor", name: name ? text(buf, name) : "", shape: dims };
}

function initializer(buf: Buffer, field: Field): ModelTensor {
  const parts = fields(buf, field.from, field.to);
  const dims = ints(buf, parts, 1);
  const kind = first(parts, 2)?.num ?? 0;
  const [type, width] = DATA_TYPES[kind] ?? [`type ${kind}`, 0];
  const raw = first(parts, 9);
  const external = stringPairs(buf, parts, 13);
  const elements = dims.reduce((n, d) => n * d, 1);
  const length = external.find((e) => e.key === "length")?.value;
  const stored = raw ? raw.to - raw.from : length ? Number(length) : Math.ceil(elements * width);
  const name = first(parts, 8);
  return { name: name ? text(buf, name) : "", shape: dims.join(" × "), type, bytes: stored, offset: raw ? raw.from : null };
}

function node(buf: Buffer, field: Field): ModelNode {
  const parts = fields(buf, field.from, field.to);
  const name = first(parts, 3);
  const op = first(parts, 4);
  const domain = first(parts, 7);
  return {
    name: name ? text(buf, name) : "",
    op: op ? text(buf, op) : "",
    domain: domain ? text(buf, domain) : "",
    inputs: all(parts, 1).map((f) => text(buf, f)),
    outputs: all(parts, 2).map((f) => text(buf, f)),
  };
}

const STANDARD_DOMAINS = new Set(["", "ai.onnx", "ai.onnx.ml"]);

/** An ONNX model: its graph's inputs, outputs, operators and stored weights, read without running it. */
export async function readOnnx(path: string): Promise<ModelInfo> {
  const buf = await readFile(path);
  const model = fields(buf, 0, buf.length);
  const graphField = first(model, 7);
  if (!graphField) throw new Error("This ONNX file has no graph in it.");
  const graph = fields(buf, graphField.from, graphField.to);
  const producer = first(model, 2);
  const producerVersion = first(model, 3);
  const opsets = all(model, 8).map((f) => {
    const parts = fields(buf, f.from, f.to);
    const domain = first(parts, 1);
    return { domain: domain ? text(buf, domain) : "", version: first(parts, 2)?.num ?? 0 };
  });
  const opset = opsets.find((o) => STANDARD_DOMAINS.has(o.domain))?.version;
  const tensors = all(graph, 5).map((f) => initializer(buf, f));
  const names = new Set(tensors.map((t) => t.name));
  const inputs = all(graph, 11).map((f) => valueInfo(buf, f)).filter((t) => !names.has(t.name));
  const outputs = all(graph, 12).map((f) => valueInfo(buf, f));
  const nodes = all(graph, 1).map((f) => node(buf, f));
  const custom = [...new Set(nodes.map((n) => n.domain).filter((d) => !STANDARD_DOMAINS.has(d)))];
  const outside = tensors.filter((t) => t.offset === null && t.bytes > 0);
  const graphName = first(graph, 2);
  const doc = first(model, 6);
  const by = producer ? `${text(buf, producer)}${producerVersion ? ` ${text(buf, producerVersion)}` : ""}` : "";
  const metadata: MetaEntry[] = [
    { key: "ir_version", value: String(first(model, 1)?.num ?? "") },
    ...(by ? [{ key: "producer", value: by }] : []),
    ...(opsets.length > 0 ? [{ key: "opset_import", value: opsets.map((o) => `${o.domain || "ai.onnx"} ${o.version}`).join(", ") }] : []),
    ...(graphName ? [{ key: "graph_name", value: text(buf, graphName) }] : []),
    ...(doc ? [{ key: "doc_string", value: text(buf, doc).slice(0, 300) }] : []),
    ...stringPairs(buf, model, 14),
  ];
  const risk: ModelRisk | null = custom.length > 0
    ? { kind: "foreignOps", domains: custom }
    : outside.length > 0 ? { kind: "outsideWeights", count: outside.length } : null;
  return {
    name: basename(path),
    format: `ONNX${opset ? ` · opset ${opset}` : ""}${by ? ` · from ${by}` : ""}`,
    weights: `${tensors.length} tensors · ${bytes(buf.length)}`,
    inputs,
    outputs,
    layers: [],
    risk,
    tensors,
    mix: mixOf(tensors),
    metadata,
    template: null,
    loads: [],
    nodes,
    size: buf.length,
  };
}
