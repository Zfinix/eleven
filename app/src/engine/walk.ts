import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isRecord } from "../lib/guards";
import { cacheRoot } from "../lib/platform";
import type { RewriteProgress } from "./rewrite";
import { askWarm, type QuickAsk } from "./warm";

export const MAX_WALK_STEPS = 200;

/** One basic block as the agent sees it: where it starts, where it can go next, and its instructions. */
export type WalkBlock = { readonly start: string; readonly successors: readonly string[]; readonly lines: readonly string[] };

/** A function and the inputs to walk it with, plus who walks it. */
export type WalkRequest = QuickAsk & {
  readonly fn: string;
  readonly name: string;
  readonly pseudo: string;
  readonly blocks: readonly WalkBlock[];
  readonly inputs: string;
};

export type WalkValue = { readonly name: string; readonly value: string };

export type WalkStep = { readonly block: string; readonly values: readonly WalkValue[]; readonly note: string };

export type Walk = { readonly steps: readonly WalkStep[]; readonly result: string };

/** The parameter names in a decompiled signature like `void entry(int param_1,long *param_2)`. */
export function signatureParams(pseudo: string): readonly string[] {
  const head = pseudo.split("\n").find((line) => line.trim().length > 0) ?? "";
  const open = head.indexOf("(");
  const close = head.lastIndexOf(")");
  if (open < 0 || close <= open) return [];
  return head.slice(open + 1, close).split(",").flatMap((part) => {
    const name = /([A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)*$/.exec(part.trim())?.[1];
    return name && name !== "void" ? [name] : [];
  });
}

/** The input field's starting text: each parameter waiting for its value. */
export function inputTemplate(pseudo: string): string {
  return signatureParams(pseudo).map((name) => `${name} = `).join(", ");
}

/** One spelling for an address, whatever its case or zero padding; null when it isn't one. */
export function normalAddress(text: string): string | null {
  const digits = /^\s*(?:0x)?([0-9a-f]+)\s*$/i.exec(text)?.[1];
  return digits ? `0x${BigInt(`0x${digits}`).toString(16)}` : null;
}

export function walkPrompt(req: WalkRequest): string {
  const entry = req.blocks[0]?.start ?? req.fn;
  const inputs = req.inputs.trim() || "none given, assume typical values and say which you picked";
  return [
    `Walk through the function ${req.name} at ${req.fn} by hand, for these inputs: ${inputs}`,
    "",
    `Simulate it, don't run it. Start at the entry block ${entry} and follow the branch the values take, one block at a time, until the function returns or you reach ${MAX_WALK_STEPS} steps. A loop visits its blocks again on every pass.`,
    "For each block you pass through, give its start address exactly as listed below, the values that matter once the block is done (parameters, locals, registers, memory), and one short sentence on why it went where it did.",
    "Answer straight away without using any tools: don't open, extract or decompile the binary and don't run shell commands. Don't change any files.",
    'Reply with only JSON, nothing else: {"steps":[{"block":"0x...","values":{"name":"value"},"note":"why it went this way"}],"result":"what it returns or how it ends"}',
    "",
    "Pseudocode:",
    "```c",
    req.pseudo,
    "```",
    "",
    "Blocks, each as start -> the blocks it can go to, then its instructions:",
    ...req.blocks.flatMap((block) => [`${block.start} -> ${block.successors.length > 0 ? block.successors.join(", ") : "(leaves the function)"}`, ...block.lines.map((line) => `  ${line}`)]),
  ].join("\n");
}

function shown(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function valuesOf(raw: unknown): readonly WalkValue[] {
  return isRecord(raw) ? Object.entries(raw).map(([name, value]) => ({ name, value: shown(value) })) : [];
}

/** The steps in the agent's reply that land on a real block, at most MAX_WALK_STEPS; null when nothing usable came back. */
export function parseWalk(reply: string, blocks: readonly string[]): Walk | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["steps"])) return null;
  const known = new Map(blocks.flatMap((block) => {
    const key = normalAddress(block);
    return key ? [[key, block] as const] : [];
  }));
  const steps = parsed["steps"].flatMap((raw): readonly WalkStep[] => {
    if (!isRecord(raw) || typeof raw["block"] !== "string") return [];
    const block = known.get(normalAddress(raw["block"]) ?? "");
    if (!block) return [];
    const note = typeof raw["note"] === "string" ? raw["note"].trim() : "";
    return [{ block, values: valuesOf(raw["values"]), note }];
  }).slice(0, MAX_WALK_STEPS);
  if (steps.length === 0) return null;
  const result = parsed["result"];
  return { steps, result: typeof result === "string" ? result.trim() : result === undefined ? "" : shown(result) };
}

function walkFile(req: WalkRequest): string {
  const key = createHash("sha256").update(JSON.stringify([req.fn, req.blocks, req.pseudo, req.inputs.trim(), req.agent.id])).digest("hex");
  return join(cacheRoot(), "walks", req.projectId, `${key}.json`);
}

async function saved(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

const running = new Map<string, Promise<Walk | null>>();

async function remember(file: string, walk: Walk): Promise<void> {
  const body = JSON.stringify({ steps: walk.steps.map((step) => ({ block: step.block, values: Object.fromEntries(step.values.map((v) => [v.name, v.value])), note: step.note })), result: walk.result });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(temp, body);
    await rename(temp, file);
  } catch {
    await rm(temp, { force: true }).catch(() => undefined);
  }
}

/** The path the agent works out for these inputs, saved so the same walk opens instantly; null when its reply had no usable steps. */
export async function walkPath(req: WalkRequest, onProgress: (progress: RewriteProgress) => void): Promise<Walk | null> {
  const starts = req.blocks.map((block) => block.start);
  const file = walkFile(req);
  const pending = running.get(file) ?? (async (): Promise<Walk | null> => {
    const known = await saved(file);
    const cached = known === null ? null : parseWalk(known, starts);
    if (cached) return cached;
    const walk = parseWalk(await askWarm(req, walkPrompt(req), onProgress), starts);
    if (walk) await remember(file, walk);
    return walk;
  })();
  running.set(file, pending);
  try {
    return await pending;
  } finally {
    running.delete(file);
  }
}
