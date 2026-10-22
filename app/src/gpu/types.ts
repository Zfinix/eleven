export type FunctionKind = "compute" | "vertex" | "fragment";

export type Binding = { readonly slot: string; readonly type: string };

export type LoadedBy = { readonly symbol: string; readonly note: string };

export type ShaderFunction = {
  readonly name: string;
  /** The name the code object uses, mangled for C++ kernels; the same as `name` for Metal. */
  readonly symbol: string;
  readonly kind: FunctionKind;
  readonly ir: string;
  readonly bindings: readonly Binding[];
  readonly loadedBy: LoadedBy | null;
  /** What the GPU needs to run it: registers, shared memory, code size, the chips it was built for. */
  readonly stats: readonly Binding[];
};

export type GpuApi = "metal" | "cuda" | "hip";

export type ShaderLibrary = { readonly name: string; readonly format: string; readonly api: GpuApi; readonly functions: readonly ShaderFunction[] };

export type Tensor =
  | { readonly kind: "image"; readonly name: string; readonly shape: readonly number[] }
  | { readonly kind: "tensor"; readonly name: string; readonly shape: readonly number[] };

/** The views of one model file in its workbench tab. */
export const MODEL_PAGES = ["overview", "tensors", "nodes", "metadata", "template", "loads"] as const;

export type ModelPage = (typeof MODEL_PAGES)[number];

export type ModelLayer = { readonly name: string; readonly op: string; readonly shape: string; readonly type: string };

/** What to know before loading a model, kept as data so the warning reads in the language picked when shown. */
export type ModelRisk =
  | { readonly kind: "systemPrompt"; readonly text: string }
  | { readonly kind: "everyPrompt"; readonly text: string }
  | { readonly kind: "template" }
  | { readonly kind: "foreignOps"; readonly domains: readonly string[] }
  | { readonly kind: "outsideWeights"; readonly count: number }
  | { readonly kind: "runsCode"; readonly file: string; readonly calls: readonly string[] };

/** One stored tensor; `offset` is from the start of the file's data section, null when the format doesn't say. */
export type ModelTensor = { readonly name: string; readonly shape: string; readonly type: string; readonly bytes: number; readonly offset: number | null };

/** How much of the file one weight type takes. */
export type TypeShare = { readonly type: string; readonly bytes: number; readonly tensors: number };

/** One operator in a model's graph, wired by the names of the values it reads and writes. */
export type ModelNode = { readonly name: string; readonly op: string; readonly domain: string; readonly inputs: readonly string[]; readonly outputs: readonly string[] };

export type MetaEntry = { readonly key: string; readonly value: string };

export type LoadEffect = "data" | "layer" | "class" | "runs code";

/** A Python name a pickle imports when it loads, and what that does. */
export type PickleName = { readonly name: string; readonly from: string; readonly effect: LoadEffect };

export type ModelInfo = {
  readonly name: string;
  readonly format: string;
  readonly weights: string;
  readonly inputs: readonly Tensor[];
  readonly outputs: readonly Tensor[];
  readonly layers: readonly ModelLayer[];
  readonly risk: ModelRisk | null;
  readonly tensors: readonly ModelTensor[];
  readonly mix: readonly TypeShare[];
  readonly metadata: readonly MetaEntry[];
  readonly template: string | null;
  readonly loads: readonly PickleName[];
  readonly nodes: readonly ModelNode[];
  readonly size: number;
};

export type SpanTone = "cpu" | "wait" | "kernel" | "light";

export type SpanStat = { readonly label: string; readonly value: string };

export type Span = {
  readonly id: string;
  readonly label: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly tone: SpanTone;
  readonly stats: readonly SpanStat[];
  readonly advice: readonly string[];
};

export type Lane = { readonly name: string; readonly spans: readonly Span[] };

export type Recording = {
  readonly title: string;
  readonly source: string;
  readonly frameMs: number;
  readonly tickMs: number;
  readonly lanes: readonly Lane[];
};

