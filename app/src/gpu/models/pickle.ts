import { stat } from "node:fs/promises";
import { basename } from "node:path";

import type { LoadEffect, ModelInfo, ModelRisk, PickleName } from "../types";
import { bytes, head } from "./read";
import { run, runBytes } from "../../lib/process";
import { zipEntry, zipListing } from "../../lib/platform";

const MAX_PICKLE = 64 * 1024 * 1024;

/** Imports that let a pickle run code on whoever loads it. */
const DANGEROUS = /^(os|posix|nt|subprocess|sys|socket|shutil|runpy|pty|webbrowser|importlib|ctypes|marshal|code|types)\.|^(builtins|__builtin__)\.(eval|exec|compile|__import__|open|getattr|setattr|delattr|globals|locals|vars|input|breakpoint|memoryview)$/;
const PLAIN_BUILTINS = /^(builtins|__builtin__)\.(set|frozenset|dict|list|tuple|bytearray|bytes|slice|complex|float|int|bool|str|range)$/;
const DATA = /^(collections|_codecs|copyreg|numpy|numpy\.core\.multiarray|torch\._utils|torch\._tensor|torch\.serialization)\.|^torch\.(\w*Storage|Size|device|dtype|float\d*|bfloat16|half|int\d*|uint8|bool|complex\d*)$/;

/** How many argument bytes follow each opcode: a count, a newline-ended text line (or two), or a length prefix. */
type Arg = number | "line" | "lines" | "len1" | "len4" | "len8";

const ARGS: ReadonlyMap<number, Arg> = new Map<number, Arg>([
  [0x4a, 4], [0x4b, 1], [0x4d, 2], [0x47, 8], [0x80, 1], [0x82, 1], [0x83, 2], [0x84, 4], [0x95, 8],
  [0x46, "line"], [0x49, "line"], [0x4c, "line"], [0x50, "line"], [0x53, "line"], [0x56, "line"], [0x67, "line"], [0x70, "line"],
  [0x63, "lines"], [0x69, "lines"],
  [0x55, "len1"], [0x43, "len1"], [0x8a, "len1"], [0x8c, "len1"],
  [0x54, "len4"], [0x58, "len4"], [0x42, "len4"], [0x8b, "len4"],
  [0x8d, "len8"], [0x8e, "len8"], [0x96, "len8"],
  [0x68, 1], [0x71, 1], [0x6a, 4], [0x72, 4],
]);

const NO_ARG = new Set([0x28, 0x2e, 0x30, 0x31, 0x32, 0x4e, 0x51, 0x52, 0x61, 0x62, 0x64, 0x7d, 0x65, 0x6c, 0x5d, 0x6f, 0x73, 0x74, 0x29, 0x75, 0x81, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8f, 0x90, 0x91, 0x92, 0x93, 0x94, 0x97, 0x98]);
const TEXT_OPS = new Set([0x53, 0x56, 0x55, 0x54, 0x58, 0x8c, 0x8d]);
const STOP = 0x2e;
const PROTO = 0x80;
const STACK_GLOBAL = 0x93;
const MEMOIZE = 0x94;
const PUTS = new Set([0x70, 0x71, 0x72]);
const GETS = new Set([0x67, 0x68, 0x6a]);
const POPS_NOTHING = new Set([0x28, 0x2e, 0x30, 0x31, 0x32, 0x61, 0x62, 0x65, 0x73, 0x75, 0x90, 0x94, 0x70, 0x71, 0x72, 0x80, 0x95]);

type Step = { readonly op: number; readonly next: number; readonly arg: string | number | null };

function lineEnd(data: Buffer, from: number): number {
  const end = data.indexOf(0x0a, from);
  return end < 0 ? data.length : end;
}

/** Decodes the opcode at `at` and where the next one starts; null for an unknown opcode or a cut-off argument. */
function stepAt(data: Buffer, at: number): Step | null {
  const op = data[at];
  if (op === undefined) return null;
  const arg = ARGS.get(op);
  const from = at + 1;
  if (arg === undefined) return NO_ARG.has(op) ? { op, next: from, arg: null } : null;
  if (typeof arg === "number") {
    if (from + arg > data.length) return null;
    const value = arg === 1 ? data.readUInt8(from) : arg === 2 ? data.readUInt16LE(from) : arg === 4 ? data.readInt32LE(from) : 0;
    return { op, next: from + arg, arg: value };
  }
  if (arg === "line") {
    const end = lineEnd(data, from);
    return { op, next: end + 1, arg: data.toString("utf8", from, end) };
  }
  if (arg === "lines") {
    const first = lineEnd(data, from);
    const second = lineEnd(data, first + 1);
    return { op, next: second + 1, arg: `${data.toString("utf8", from, first)}.${data.toString("utf8", first + 1, second)}` };
  }
  const width = arg === "len1" ? 1 : arg === "len4" ? 4 : 8;
  if (from + width > data.length) return null;
  const length = width === 1 ? data.readUInt8(from) : width === 4 ? data.readUInt32LE(from) : Number(data.readBigUInt64LE(from));
  const start = from + width;
  if (start + length > data.length) return null;
  return { op, next: start + length, arg: TEXT_OPS.has(op) ? data.toString("utf8", start, start + length) : null };
}

/** The module.name pairs a pickle imports, found by walking its opcodes rather than scanning bytes. */
export function pickleImports(data: Buffer): readonly string[] {
  const found = new Set<string>();
  const stack: (string | null)[] = [];
  const memo = new Map<number, string | null>();
  let at = 0;
  while (at < data.length) {
    const step = stepAt(data, at);
    if (!step) break;
    at = step.next;
    const top = stack.at(-1) ?? null;
    if (step.op === 0x63 || step.op === 0x69) {
      if (typeof step.arg === "string") found.add(step.arg);
      stack.push(null);
    } else if (step.op === STACK_GLOBAL) {
      const name = stack.pop();
      const module = stack.pop();
      if (typeof module === "string" && typeof name === "string") found.add(`${module}.${name}`);
      stack.push(null);
    } else if (TEXT_OPS.has(step.op)) {
      stack.push(typeof step.arg === "string" ? step.arg : null);
    } else if (step.op === MEMOIZE) {
      memo.set(memo.size, top);
    } else if (PUTS.has(step.op)) {
      memo.set(Number(step.arg), top);
    } else if (GETS.has(step.op)) {
      stack.push(memo.get(Number(step.arg)) ?? null);
    } else if (step.op === STOP) {
      if (data[at] !== PROTO) break;
    } else if (!POPS_NOTHING.has(step.op)) {
      stack.push(null);
    }
  }
  return [...found];
}

export function loadEffect(name: string): LoadEffect {
  if (DANGEROUS.test(name)) return "runs code";
  if (/^(builtins|__builtin__)\./.test(name)) return PLAIN_BUILTINS.test(name) ? "data" : "runs code";
  if (DATA.test(name)) return "data";
  if (name.startsWith("torch.nn.")) return "layer";
  return "class";
}

function packageOf(name: string): string {
  const root = name.split(".")[0] ?? name;
  return ["builtins", "__builtin__", "collections", "_codecs", "copyreg"].includes(root) ? "Python" : root;
}

async function pickleBytes(path: string): Promise<Buffer> {
  const start = await head(path, 4);
  if (start.toString("latin1", 0, 2) !== "PK") return head(path, MAX_PICKLE);
  const [lister, listArgs] = zipListing(path);
  const { stdout: listing } = await run(lister, listArgs, { maxBuffer: 16 * 1024 * 1024 });
  const entry = listing.split(/\r?\n/).find((name) => name.endsWith("data.pkl"));
  if (!entry) return Buffer.alloc(0);
  const [reader, readArgs] = zipEntry(path, entry);
  const { stdout } = await runBytes(reader, readArgs, { maxBuffer: MAX_PICKLE });
  return stdout;
}

/** A PyTorch or pickle file: what it imports when loaded, and whether any of that runs code. */
export async function readPickle(path: string): Promise<ModelInfo> {
  const loads: PickleName[] = pickleImports(await pickleBytes(path)).map((name) => ({ name, from: packageOf(name), effect: loadEffect(name) }));
  const dangerous = loads.filter((item) => item.effect === "runs code").map((item) => item.name);
  const risk: ModelRisk | null = dangerous.length > 0
    ? { kind: "runsCode", file: basename(path), calls: dangerous }
    : null;
  const size = (await stat(path)).size;
  return {
    name: basename(path),
    format: "PyTorch pickle",
    weights: bytes(size),
    inputs: [],
    outputs: [],
    layers: loads.map((item) => ({ name: item.name, op: item.effect === "runs code" ? "runs code" : "import", shape: "", type: "" })),
    risk,
    tensors: [],
    mix: [],
    metadata: [],
    template: null,
    loads,
    nodes: [],
    size,
  };
}
