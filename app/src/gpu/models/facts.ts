import { listOf, type PlainId, t } from "../../i18n";
import type { MetaEntry, ModelInfo, ModelPage, ModelRisk, ModelTensor } from "../types";
import { bytes, count } from "./read";

export type ModelFact = { readonly label: string; readonly value: string; readonly sub: string };

export type NoteTone = "warn" | "ok" | "plain";

export type ModelNote = { readonly title: string; readonly body: string; readonly quote: string | null; readonly page: ModelPage | null; readonly tone: NoteTone };

export type TensorGroup = { readonly key: string; readonly label: string; readonly tensors: readonly ModelTensor[] };

export type MetaGroup = { readonly title: string; readonly entries: readonly MetaEntry[] };

const BLOCK = /^((?:blk|model\.layers|layers|blocks|transformer\.h|h|model\.decoder\.layers|encoder\.layer)\.(\d+))\./;

export function pagesOf(model: ModelInfo): readonly ModelPage[] {
  return [
    "overview",
    ...(model.tensors.length > 0 ? ["tensors" as const] : []),
    ...(model.nodes.length > 0 ? ["nodes" as const] : []),
    ...(model.metadata.length > 0 ? ["metadata" as const] : []),
    ...(model.template ? ["template" as const] : []),
    ...(model.loads.length > 0 ? ["loads" as const] : []),
  ];
}

export function pageLabel(page: ModelPage): string {
  switch (page) {
    case "overview":
      return t("gpu.model.page.overview");
    case "tensors":
      return t("gpu.model.page.tensors");
    case "nodes":
      return t("gpu.model.page.nodes");
    case "metadata":
      return t("gpu.model.page.metadata");
    case "template":
      return t("gpu.model.page.template");
    case "loads":
      return t("gpu.model.page.loads");
    default: {
      const unhandled: never = page;
      return unhandled;
    }
  }
}

export function pageIcon(page: ModelPage): string {
  switch (page) {
    case "overview":
      return "info";
    case "tensors":
      return "segments";
    case "nodes":
      return "graph";
    case "metadata":
      return "tag";
    case "template":
      return "thread";
    case "loads":
      return "library";
    default: {
      const unhandled: never = page;
      return unhandled;
    }
  }
}

/** How many entries a page lists, for the sidebar; empty for pages that aren't lists. */
export function pageCount(model: ModelInfo, page: ModelPage): string {
  switch (page) {
    case "tensors":
      return model.tensors.length.toLocaleString("en-US");
    case "nodes":
      return model.nodes.length.toLocaleString("en-US");
    case "metadata":
      return model.metadata.length.toLocaleString("en-US");
    case "loads":
      return model.loads.length.toLocaleString("en-US");
    case "overview":
    case "template":
      return "";
    default: {
      const unhandled: never = page;
      return unhandled;
    }
  }
}

function lookup(model: ModelInfo): (key: string) => string | null {
  const map = new Map(model.metadata.map((entry) => [entry.key, entry.value]));
  return (key) => map.get(key) ?? null;
}

function grouped(n: string | null): string | null {
  if (n === null) return null;
  const value = Number(n);
  return Number.isFinite(value) ? value.toLocaleString("en-US") : n;
}

function listLength(value: string | null): string | null {
  const match = value ? /^([\d,]+) items/.exec(value) : null;
  return match?.[1] ?? null;
}

function joined(parts: readonly (string | null | false)[], by: string): string {
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join(by);
}

function parameters(tensors: readonly ModelTensor[]): number {
  return tensors.reduce((sum, t) => sum + (t.shape ? t.shape.split(" × ").reduce((n, d) => n * Number(d), 1) : 1), 0);
}

function ggufFacts(model: ModelInfo): readonly ModelFact[] {
  const get = lookup(model);
  const arch = get("general.architecture") ?? "unknown";
  const at = (key: string): string | null => get(`${arch}.${key}`);
  const blocks = at("block_count");
  const heads = at("attention.head_count");
  const kv = at("attention.head_count_kv");
  const vocab = listLength(get("tokenizer.ggml.tokens")) ?? grouped(at("vocab_size"));
  return [
    { label: t("gpu.model.fact.architecture"), value: joined([arch, blocks && t("gpu.model.fact.blocks", { count: blocks })], " · "), sub: joined([at("embedding_length") && t("gpu.model.fact.wide", { count: at("embedding_length") ?? "" }), heads && t("gpu.model.fact.heads", { count: heads }), kv && kv !== heads && t("gpu.model.fact.kvHeads", { count: kv })], ", ") },
    { label: t("gpu.model.fact.context"), value: at("context_length") ? t("gpu.model.fact.tokens", { count: grouped(at("context_length")) ?? "" }) : t("gpu.model.fact.unknown"), sub: at("rope.freq_base") ? t("gpu.model.fact.rope", { base: grouped(at("rope.freq_base")) ?? "" }) : "" },
    { label: t("gpu.model.fact.size"), value: joined([get("general.size_label"), bytes(model.size)], " · "), sub: t("gpu.model.fact.formatTensors", { format: model.format.split(" · ")[0] ?? "GGUF", count: model.tensors.length.toLocaleString("en-US") }) },
    { label: t("gpu.model.fact.tokenizer"), value: joined([get("tokenizer.ggml.model"), vocab && t("gpu.model.fact.tokens", { count: vocab })], " · ") || t("gpu.model.fact.none"), sub: get("tokenizer.ggml.pre") ? t("gpu.model.fact.preTokenizer", { name: get("tokenizer.ggml.pre") ?? "" }) : "" },
  ];
}

function safetensorsFacts(model: ModelInfo): readonly ModelFact[] {
  const blocks = new Set(model.tensors.flatMap((t) => BLOCK.exec(t.name)?.[1] ?? [])).size;
  return [
    { label: t("gpu.model.fact.format"), value: "safetensors", sub: model.metadata.length > 0 ? t("gpu.model.fact.metadataEntries", { count: model.metadata.length }) : t("gpu.model.fact.noMetadata") },
    { label: t("gpu.model.fact.parameters"), value: count(parameters(model.tensors)), sub: model.mix.map((m) => m.type).join(", ") },
    { label: t("gpu.model.fact.size"), value: bytes(model.size), sub: t("gpu.model.fact.tensors", { count: model.tensors.length.toLocaleString("en-US") }) },
    { label: t("gpu.model.fact.layout"), value: blocks > 0 ? t("gpu.model.fact.layers", { count: blocks }) : t("gpu.model.fact.noLayers"), sub: "" },
  ];
}

function pickleFacts(model: ModelInfo): readonly ModelFact[] {
  const classes = [...new Set(model.loads.filter((l) => l.effect === "class").map((l) => l.from))];
  const running = model.loads.filter((l) => l.effect === "runs code").length;
  return [
    { label: t("gpu.model.fact.format"), value: model.format, sub: t("gpu.model.fact.pickle") },
    { label: t("gpu.model.fact.size"), value: bytes(model.size), sub: "" },
    { label: t("gpu.model.fact.builtWith"), value: classes.length > 0 ? classes.join(", ") : t("gpu.model.fact.pytorchOnly"), sub: "" },
    { label: t("gpu.model.fact.loads"), value: t("gpu.model.fact.pythonNames", { count: model.loads.length }), sub: running > 0 ? t("gpu.model.fact.runCode", { count: running }) : t("gpu.model.fact.noneRunCode") },
  ];
}

/** Each operator and how often the graph uses it, most used first. */
export function opCounts(model: ModelInfo): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>();
  for (const n of model.nodes) counts.set(n.op, (counts.get(n.op) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

export function shapeText(shape: readonly number[]): string {
  return shape.length === 0 ? t("gpu.model.scalar") : shape.map((d) => (d < 0 ? "?" : String(d))).join(" × ");
}

function onnxFacts(model: ModelInfo): readonly ModelFact[] {
  const [, opset, from] = model.format.split(" · ");
  const ops = opCounts(model);
  const io = (list: ModelInfo["inputs"]): string => list.map((tensor) => `${tensor.name} ${shapeText(tensor.shape)}`).join(", ") || t("gpu.model.fact.none");
  return [
    { label: t("gpu.model.fact.format"), value: joined(["ONNX", opset ?? null], " · "), sub: from ?? "" },
    { label: t("gpu.model.fact.input"), value: io(model.inputs), sub: model.inputs.length > 1 ? t("gpu.model.fact.inputs", { count: model.inputs.length }) : "" },
    { label: t("gpu.model.fact.output"), value: io(model.outputs), sub: model.outputs.length > 1 ? t("gpu.model.fact.outputs", { count: model.outputs.length }) : "" },
    { label: t("gpu.model.fact.graph"), value: t("gpu.model.fact.operators", { count: model.nodes.length.toLocaleString("en-US") }), sub: ops.slice(0, 3).map(([op, n]) => `${op} ×${n}`).join(", ") },
  ];
}

export function modelFacts(model: ModelInfo): readonly ModelFact[] {
  if (model.format.startsWith("ONNX")) return onnxFacts(model);
  if (model.format.startsWith("GGUF")) return ggufFacts(model);
  if (model.format === "safetensors") return safetensorsFacts(model);
  if (model.loads.length > 0 || model.format.includes("pickle")) return pickleFacts(model);
  const tensorText = (list: ModelInfo["inputs"]): string => list.map((tensor) => `${tensor.name} ${shapeText(tensor.shape)}`).join(", ") || t("gpu.model.fact.unknown");
  return [
    { label: t("gpu.model.fact.format"), value: model.format, sub: "" },
    { label: t("gpu.model.fact.weights"), value: model.weights, sub: "" },
    { label: t("gpu.model.fact.input"), value: tensorText(model.inputs), sub: "" },
    { label: t("gpu.model.fact.output"), value: tensorText(model.outputs), sub: "" },
  ];
}

/** A model's risk as a heading and what it means, in the current language; quoted model text stays as written. */
export function riskText(risk: ModelRisk): { readonly title: string; readonly detail: string } {
  switch (risk.kind) {
    case "systemPrompt":
      return { title: t("gpu.model.risk.systemPrompt"), detail: risk.text };
    case "everyPrompt":
      return { title: t("gpu.model.risk.everyPrompt"), detail: risk.text };
    case "template":
      return { title: t("gpu.model.risk.template"), detail: t("gpu.model.risk.template.detail") };
    case "foreignOps":
      return { title: t("gpu.model.risk.foreignOps"), detail: t("gpu.model.risk.foreignOps.detail", { domains: risk.domains.join(", ") }) };
    case "outsideWeights":
      return { title: t("gpu.model.risk.outsideWeights"), detail: t("gpu.model.risk.outsideWeights.detail", { count: risk.count }) };
    case "runsCode":
      return { title: t("gpu.model.risk.runsCode", { file: risk.file }), detail: t("gpu.model.risk.runsCode.detail", { calls: risk.calls.join(", ") }) };
    default: {
      const unhandled: never = risk;
      return unhandled;
    }
  }
}

/** The text a chat template puts in front of every prompt, when that is the risk. */
export function riskQuote(risk: ModelRisk | null): string | null {
  return risk?.kind === "systemPrompt" || risk?.kind === "everyPrompt" ? risk.text : null;
}

/** The things worth telling someone before they load the file. */
export function modelNotes(model: ModelInfo): readonly ModelNote[] {
  const notes: ModelNote[] = [];
  const pickle = model.loads.length > 0;
  if (model.risk) {
    const fromTemplate = model.template !== null;
    const { title, detail } = riskText(model.risk);
    notes.push({ title, body: fromTemplate ? t("gpu.model.note.fromTemplate") : detail, quote: fromTemplate ? detail : null, page: fromTemplate ? "template" : pickle ? "loads" : null, tone: "warn" });
  }
  if (pickle) {
    const classes = [...new Set(model.loads.filter((l) => l.effect === "class").map((l) => l.from))];
    if (classes.length > 0) notes.push({ title: t("gpu.model.note.needs", { names: listOf(classes) }), body: t("gpu.model.note.needs.body", { names: listOf(classes) }), quote: null, page: "loads", tone: "warn" });
    if (!model.risk) notes.push({ title: t("gpu.model.note.noCommands"), body: t("gpu.model.note.noCommands.body"), quote: null, page: null, tone: "ok" });
  } else if (model.tensors.length > 0) {
    const kind = model.format.startsWith("GGUF") ? "GGUF" : model.format.startsWith("ONNX") ? "ONNX" : "safetensors";
    const body = kind === "ONNX" ? t("gpu.model.note.onnx.body") : t("gpu.model.note.data.body", { format: kind });
    if (!(kind === "ONNX" && model.risk)) notes.push({ title: t("gpu.model.note.noCode"), body, quote: null, page: null, tone: "ok" });
  }
  const path = model.metadata.find((entry) => /\.(file|path|dataset)$/.test(entry.key) && entry.value.startsWith("/"));
  if (path) notes.push({ title: t("gpu.model.note.builtAt"), body: t("gpu.model.note.builtAt.body", { key: path.key, value: path.value }), quote: null, page: "metadata", tone: "plain" });
  return notes;
}

type Loose = "Embeddings" | "Output" | "Other";

const LOOSE_LABEL: Readonly<Record<Loose, PlainId>> = { Embeddings: "gpu.model.group.embeddings", Output: "gpu.model.group.output", Other: "gpu.model.group.other" };

function looseGroup(name: string): Loose {
  if (/embd|embed|wte|wpe|tok_/.test(name)) return "Embeddings";
  if (/output|lm_head|head|norm/.test(name)) return "Output";
  return "Other";
}

/** Tensors in file order, gathered into their numbered blocks; the rest by what they are. */
export function tensorGroups(tensors: readonly ModelTensor[]): readonly TensorGroup[] {
  const groups: { key: string; label: string; tensors: ModelTensor[] }[] = [];
  for (const tensor of tensors) {
    const block = BLOCK.exec(tensor.name)?.[1];
    const key = block ?? looseGroup(tensor.name);
    const last = groups.at(-1);
    const found = last?.key === key ? last : block ? undefined : groups.find((g) => g.key === key);
    if (found) found.tensors.push(tensor);
    else groups.push({ key, label: block ?? t(LOOSE_LABEL[looseGroup(tensor.name)]), tensors: [tensor] });
  }
  const number = (g: TensorGroup): number => Number(/\.(\d+)$/.exec(g.key)?.[1] ?? Number.NaN);
  const blocks = groups.filter((g) => !Number.isNaN(number(g))).sort((a, b) => number(a) - number(b));
  const rest = groups.filter((g) => Number.isNaN(number(g)));
  return [...rest.filter((g) => g.key === "Embeddings"), ...blocks, ...rest.filter((g) => g.key !== "Embeddings")];
}

export function metaGroups(metadata: readonly MetaEntry[]): readonly MetaGroup[] {
  const titles = new Map<string, PlainId>([["general", "gpu.model.meta.general"], ["tokenizer", "gpu.model.meta.tokenizer"], ["quantize", "gpu.model.meta.quantize"], ["split", "gpu.model.meta.split"]]);
  const groups = new Map<string, MetaEntry[]>();
  for (const entry of metadata) {
    const root = entry.key.includes(".") ? (entry.key.split(".")[0] ?? "") : "";
    const known = titles.get(root);
    const title = known ? t(known) : root ? t("gpu.model.meta.arch", { root }) : t("gpu.model.meta.file");
    groups.set(title, [...(groups.get(title) ?? []), entry]);
  }
  return [...groups].map(([title, entries]) => ({ title, entries }));
}

/** What a tensor does, from the names llama.cpp and Hugging Face give them. */
export function tensorRole(name: string): string {
  const rules: readonly (readonly [RegExp, PlainId])[] = [
    [/token_embd|embed_tokens|wte/, "gpu.model.role.tokenEmbeddings"],
    [/attn_q\b|attn_q\.|q_proj/, "gpu.model.role.queries"],
    [/attn_k\b|attn_k\.|k_proj/, "gpu.model.role.keys"],
    [/attn_v\b|attn_v\.|v_proj/, "gpu.model.role.values"],
    [/attn_output|o_proj/, "gpu.model.role.attentionOutput"],
    [/attn_norm|input_layernorm/, "gpu.model.role.attentionNorm"],
    [/ffn_norm|post_attention_layernorm/, "gpu.model.role.feedForwardNorm"],
    [/ffn_gate|gate_proj/, "gpu.model.role.gate"],
    [/ffn_up|up_proj/, "gpu.model.role.up"],
    [/ffn_down|down_proj/, "gpu.model.role.down"],
    [/output_norm|model\.norm|ln_f/, "gpu.model.role.finalNorm"],
    [/^output\.|lm_head/, "gpu.model.role.output"],
  ];
  const role = rules.find(([pattern]) => pattern.test(name))?.[1];
  return role ? t(role) : "";
}

export function blockOf(name: string): string | null {
  return BLOCK.exec(name)?.[2] ?? null;
}
