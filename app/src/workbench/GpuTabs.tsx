import { type ReactElement, useState } from "react";

import { ModelView } from "../gpu/ModelView";
import { pagesOf } from "../gpu/models/facts";
import type { LoadedBy, ModelPage, ShaderFunction, ShaderLibrary } from "../gpu/types";
import { ProfileView } from "../gpu/ProfileView";
import { ShaderView } from "../gpu/ShaderView";
import { type Loaded, useFunctionIr, useLoadedBy } from "../gpu/useGpu";
import { errorMessage } from "../lib/guards";
import { TYPING } from "../lib/shortcuts";
import { useTheme } from "../theme";
import { t } from "../i18n";
import { Icon } from "../components/ui";
import { ask } from "./actions";
import { shaderPlace, useKernelExtras } from "./KernelBar";
import { ELLIPSIS, HOVER, MONO_STYLE, useBench } from "./parts";
import { shortName } from "../gpu/look";

function Note({ text }: { readonly text: string }): ReactElement {
  const { p } = useTheme();
  return <div style={{ padding: 18, color: p.muted }}>{text}</div>;
}

export function ShaderTab({ library, name }: { readonly library: string; readonly name: string }): ReactElement {
  const bench = useBench();
  const { gpu, gpuData } = bench;
  const ir = useFunctionIr(gpu, library, name);
  const loadedBy = useLoadedBy(gpu, library, name);
  const lib = gpuData.kind === "ready" ? gpuData.value.libraries.find((l) => l.name === library) : undefined;
  const fn = lib?.functions.find((f) => f.name === name);
  if (!lib || !fn) return <Note text={gpuData.kind === "loading" ? t("gpu.readingLibrary") : t("gpu.notInLibrary", { name, library })} />;
  const reads = lib.api === "cuda" ? "its PTX and register use" : lib.api === "hip" ? "its registers, local memory and arguments" : "its AIR";
  const what = lib.api === "metal" ? `${fn.kind} shader` : `${lib.api === "cuda" ? "CUDA" : "HIP"} kernel`;
  const onAsk = (): void => ask(bench, `Why might the ${what} ${name} in ${library} be slow? Read ${reads} and say what to change, in plain terms.`);
  const onOpen = (symbol: string): void => {
    const addr = bench.addrOf(symbol);
    if (addr) bench.openFn(addr, false);
    else bench.wb.notify(t("gpu.notFound", { symbol }), null);
  };
  return <KernelTab key={`${library}:${name}`} lib={lib} fn={fn} ir={ir} loadedBy={loadedBy} onOpen={onOpen} onAsk={onAsk} />;
}

/** A shader or kernel; CUDA kernels also get View as, Explain and Beside PTX. */
function KernelTab({ lib, fn, ir, loadedBy, onOpen, onAsk }: {
  readonly lib: ShaderLibrary;
  readonly fn: ShaderFunction;
  readonly ir: Loaded<string>;
  readonly loadedBy: Loaded<LoadedBy | null>;
  readonly onOpen: (symbol: string) => void;
  readonly onAsk: () => void;
}): ReactElement {
  const extras = useKernelExtras(lib, fn, ir);
  return <ShaderView fn={fn} stage={lib.format} api={lib.api} ir={ir} loadedBy={loadedBy} onOpen={onOpen} onAsk={onAsk} ask={shaderPlace(lib, fn)} {...(extras ? { extras } : {})} />;
}

export function ModelTab({ name, page, tensor }: { readonly name: string; readonly page: ModelPage; readonly tensor: string | null }): ReactElement {
  const bench = useBench();
  const { gpuData, wb } = bench;
  const models = gpuData.kind === "ready" ? gpuData.value.models : [];
  const model = models.find((m) => m.name === name);
  if (!model) return <Note text={gpuData.kind === "loading" ? t("gpu.readingModel") : t("gpu.modelGone", { name })} />;
  const shown = pagesOf(model).includes(page) ? page : "overview";
  const onAsk = (): void => ask(bench, `What is the model ${model.name} (${model.format}) for? Read its tensors and metadata and say what it does and whether it's safe to load, in plain terms.`);
  const onTensor = (picked: string): void => {
    wb.open({ kind: "model", name, page: "tensors", tensor: picked }, false);
    wb.reveal("inspector");
  };
  return <ModelView model={model} page={shown} tensor={tensor} onPage={(next) => wb.open({ kind: "model", name, page: next }, false)} onTensor={onTensor} onAsk={onAsk} />;
}

export function ProfileTab({ title }: { readonly title: string }): ReactElement {
  const bench = useBench();
  const { gpuData } = bench;
  const [picked, setPicked] = useState<string | null>(null);
  const recording = gpuData.kind === "ready" ? gpuData.value.recordings.find((r) => r.title === title) : undefined;
  if (!recording) return <Note text={gpuData.kind === "loading" ? t("gpu.readingRecording") : t("gpu.recordingGone")} />;
  const all = recording.lanes.flatMap((lane) => lane.spans);
  const span = all.find((s) => s.id === picked) ?? all.find((s) => s.tone === "wait") ?? all.find((s) => s.tone === "kernel") ?? all[0];
  if (!span) return <Note text={t("gpu.noGpuWork")} />;
  const onAsk = (): void => ask(bench, `Look at the GPU recording "${recording.title}". What is the biggest slowdown, and what should I change to fix it? Use the gpu_profile tool if you need the numbers.`);
  return <ProfileView recording={recording} span={span} onPick={setPicked} onAsk={onAsk} />;
}

type RecordState = { readonly kind: "idle" } | { readonly kind: "asking" } | { readonly kind: "recording" } | { readonly kind: "failed"; readonly message: string };

function RecordButton(): ReactElement {
  const { p } = useTheme();
  const { gpu, refreshGpu, chat } = useBench();
  const [state, setState] = useState<RecordState>({ kind: "idle" });
  const record = async (): Promise<void> => {
    setState({ kind: "recording" });
    try {
      await gpu.record();
      setState({ kind: "idle" });
      refreshGpu();
    } catch (err) {
      setState({ kind: "failed", message: errorMessage(err) });
    }
  };
  const button = { display: "flex", alignItems: "center", height: 26, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.line3, borderRadius: 7, fontSize: 12, cursor: "pointer", hover: HOVER } as const;
  switch (state.kind) {
    case "idle":
      return <Row icon="profile" label={t("gpu.record")} note="" mono={false} indent={false} on={false} onOpen={() => setState({ kind: "asking" })} />;
    case "asking":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, borderRadius: 8, backgroundColor: p.raised }}>
          <div style={{ fontSize: 12, color: p.text }}>{chat.target ? t("gpu.record.confirm", { name: chat.target.name }) : t("gpu.record.confirmApp")}</div>
          <div style={{ display: "flex", gap: 6 }}>
            <div onClick={() => void record()} role="button" style={{ ...button, backgroundColor: p.primary, color: p.onPrimary, borderColor: p.primary }}>{t("gpu.record.run")}</div>
            <div onClick={() => setState({ kind: "idle" })} role="button" style={button}>{t("gpu.record.cancel")}</div>
          </div>
        </div>
      );
    case "recording":
      return <Row icon="working" label={t("gpu.record.recording")} note="" mono={false} indent={false} on={false} onOpen={() => setState({ kind: "recording" })} />;
    case "failed":
      return <Row icon="problem" label={t("gpu.record.failed", { error: state.message })} note="" mono={false} indent={false} on={false} onOpen={() => setState({ kind: "idle" })} />;
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}

function Row({ icon, label, note, warn = false, mono, indent, on, onOpen }: {
  readonly icon: string | null;
  readonly label: string;
  readonly note: string;
  readonly warn?: boolean;
  readonly mono: boolean;
  readonly indent: boolean;
  readonly on: boolean;
  readonly onOpen: () => void;
}): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onOpen} role="button" aria-current={on} style={{ display: "flex", alignItems: "center", gap: 8, height: 28, flexShrink: 0, paddingLeft: indent ? 34 : 8, paddingRight: 8, borderWidth: 1, borderColor: "transparent", borderRadius: 7, backgroundColor: on ? p.sel : "transparent", color: indent ? p.text : p.text4, cursor: "pointer", hover: HOVER }}>
      {icon && <Icon name={icon} size={16} color={p.muted} />}
      <div style={{ flexGrow: 1, minWidth: 0, ...ELLIPSIS, ...(mono ? { ...MONO_STYLE, fontSize: 12 } : {}) }}>{label}</div>
      <div style={{ fontSize: 11, color: warn ? p.error : p.faint }}>{note}</div>
    </div>
  );
}

function Heading({ text, first }: { readonly text: string; readonly first: boolean }): ReactElement {
  const { p } = useTheme();
  return <div style={{ paddingTop: first ? 4 : 14, paddingBottom: 6, paddingLeft: 8, paddingRight: 8, fontSize: 11.5, color: p.muted }}>{text}</div>;
}

/** Libraries past this many functions get a filter, since a CUDA or HIP build can hold thousands of kernels. */
const SHOWN_FUNCTIONS = 40;

function LibraryRows({ lib, isOpen }: { readonly lib: ShaderLibrary; readonly isOpen: (name: string) => boolean }): ReactElement {
  const { p } = useTheme();
  const { wb } = useBench();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = q ? lib.functions.filter((fn) => fn.name.toLowerCase().includes(q)) : lib.functions;
  const many = lib.functions.length > SHOWN_FUNCTIONS;
  const hidden = matches.length - SHOWN_FUNCTIONS;
  const note = (fn: ShaderFunction): string => (lib.api === "metal" ? fn.kind : fn.stats.find((s) => s.slot === "Registers" || s.slot === "Vector registers")?.type.split(" ")[0] ?? "");
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <Row icon="gpu" label={lib.name} note={many ? lib.functions.length.toLocaleString("en-US") : ""} mono={false} indent={false} on={false} onOpen={() => lib.functions[0] && wb.open({ kind: "shader", library: lib.name, name: lib.functions[0].name }, false)} />
      {many && (
        <div style={{ display: "flex", alignItems: "center", height: 28, marginTop: 2, marginBottom: 4, marginLeft: 26, paddingLeft: 8, paddingRight: 8, borderRadius: 7, backgroundColor: p.fill }}>
          <input {...TYPING} value={query} placeholder={t("gpu.filterKernels", { count: lib.functions.length.toLocaleString("en-US") })} aria-label={t("gpu.filterLibrary", { name: lib.name })} onChange={(e) => setQuery(e.value ?? "")} style={{ flexGrow: 1, minWidth: 0, fontSize: 12, color: p.text3 }} />
        </div>
      )}
      {matches.slice(0, SHOWN_FUNCTIONS).map((fn) => (
        <Row key={fn.name} icon={null} label={shortName(fn.name)} note={note(fn)} mono indent on={isOpen(fn.name)} onOpen={() => wb.open({ kind: "shader", library: lib.name, name: fn.name }, true)} />
      ))}
      {hidden > 0 && <div style={{ paddingTop: 2, paddingBottom: 6, paddingLeft: 34, fontSize: 11.5, color: p.faint }}>{t("gpu.moreKernels", { count: hidden.toLocaleString("en-US") })}</div>}
      {q && matches.length === 0 && <div style={{ paddingTop: 2, paddingBottom: 6, paddingLeft: 34, fontSize: 11.5, color: p.faint }}>{t("gpu.noKernelsMatch", { query: query.trim() })}</div>}
    </div>
  );
}

/** The GPU items for the sidebar, framed by the caller; null when the target has none. */
export function GpuSection({ frame }: { readonly frame: (count: number, body: ReactElement) => ReactElement }): ReactElement | null {
  const { gpuData, wb, chat } = useBench();
  if (gpuData.kind !== "ready") return null;
  const { libraries, models, recordings } = gpuData.value;
  const app = chat.target?.kind === "app";
  const pane = wb.s.panes[wb.s.focus];
  const tab = pane?.tabs[pane.active];
  const isOpen = (kind: "shader" | "model" | "profile", name: string): boolean => {
    if (!tab) return false;
    switch (tab.kind) {
      case "shader":
        return kind === "shader" && tab.name === name;
      case "model":
        return kind === "model" && tab.name === name;
      case "profile":
        return kind === "profile" && tab.title === name;
      default:
        return false;
    }
  };
  if (libraries.length === 0 && models.length === 0 && !app) return null;
  return frame(libraries.length + models.length + recordings.length, (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <Heading text={app ? t("gpu.insideApp") : t("gpu.inFile")} first />
      {libraries.map((lib) => <LibraryRows key={lib.name} lib={lib} isOpen={(name) => isOpen("shader", name)} />)}
      {models.map((model) => {
        const runs = model.layers.some((l) => l.op === "runs code");
        return <Row key={model.name} icon="model" label={model.name} note={runs ? t("gpu.runsCode") : ""} warn={runs} mono={false} indent={false} on={isOpen("model", model.name)} onOpen={() => wb.open({ kind: "model", name: model.name }, false)} />;
      })}
      {(app || recordings.length > 0) && <Heading text={t("gpu.recordings")} first={false} />}
      {recordings.map((recording) => (
        <Row key={recording.title} icon="profile" label={recording.title} note="" mono={false} indent={false} on={isOpen("profile", recording.title)} onOpen={() => wb.open({ kind: "profile", title: recording.title }, false)} />
      ))}
      {app && <RecordButton />}
    </div>
  ));
}
