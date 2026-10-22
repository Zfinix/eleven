import type { ReactElement } from "react";

import { type Syntax as Grammar, tokenize } from "../components/code";
import { type Syntax, syntaxFor, useCodeLook } from "../settings/look";
import { useSettings } from "../settings/store";
import { type Palette, SANS, scrollbar, useTheme } from "../theme";
import { type PlainId, t } from "../i18n";
import { type AskRow, PinDot, useAskRows } from "../workbench/ask/AskThread";
import type { AskPlace } from "../workbench/ask/place";
import type { KernelNote } from "./kernelRewrite";
import { shortName, text } from "./look";
import type { Binding, GpuApi, LoadedBy, ShaderFunction } from "./types";
import type { Loaded } from "./useGpu";

type IrTone = "plain" | "label" | "branch" | "call" | "comment";

function toneOf(line: string): IrTone {
  const trimmed = line.trim();
  if (trimmed.startsWith(";")) return "comment";
  if (/^[\w.]+:$/.test(trimmed)) return "label";
  if (/^(br|ret|switch|unreachable)\b/.test(trimmed)) return "branch";
  if (/\bcall\b/.test(trimmed)) return "call";
  return "plain";
}

function toneColor(tone: IrTone, p: Palette, c: Syntax): string {
  switch (tone) {
    case "plain":
      return p.text2;
    case "label":
      return p.data;
    case "branch":
      return c.keyword;
    case "call":
      return c.call;
    case "comment":
      return c.comment;
    default: {
      const unhandled: never = tone;
      return unhandled;
    }
  }
}

/** One line of shader code: PTX and rewrites in their grammar's colors, LLVM-style IR by what the line does. */
function IrLine({ line, number, grammar, note, surprise, row }: { readonly line: string; readonly number: number; readonly grammar: Grammar | null; readonly note: KernelNote | null; readonly surprise: boolean; readonly row: AskRow | null }): ReactElement {
  const { p } = useTheme();
  const { colorScheme, lineNumbers } = useSettings().settings;
  const colors = syntaxFor(colorScheme, p);
  const code = grammar && line.length > 0
    ? tokenize(line, grammar, p, colors).map((part, ix) => <div key={ix} style={{ color: part.kind === "text" ? part.color : colors.call, whiteSpace: "nowrap" }}>{part.text}</div>)
    : <div style={{ whiteSpace: "nowrap", color: toneColor(toneOf(line), p, colors) }}>{line}</div>;
  const pick = row ? { onClick: row.pick } : {};
  const tint = row?.picked ? { backgroundColor: p.sel2 } : surprise ? { backgroundColor: p.fill } : {};
  const shown = (
    <div role="row" aria-label={t("workbench.view.line", { number })} aria-selected={row?.picked ?? false} style={{ display: "flex", alignItems: "flex-start", flexShrink: 0, userSelect: "text", ...tint }}>
      {lineNumbers
        ? <div {...pick} style={{ position: "relative", display: "flex", justifyContent: "flex-end", width: 62, flexShrink: 0, paddingRight: 14, color: row?.picked ? p.text : p.gutter, userSelect: "none" }}>{row?.pinned && <PinDot />}{String(number)}</div>
        : <div {...pick} style={{ position: "relative", width: 18, flexShrink: 0 }}>{row?.pinned && <PinDot />}</div>}
      <div style={{ display: "flex", flexShrink: 1, minWidth: 0, overflow: "hidden" }}>{code}</div>
      {row?.bar}
      <div {...pick} style={{ flexGrow: 1, minWidth: 24, alignSelf: "stretch" }} />
      {note && (
        <div style={{ flexGrow: 0, flexShrink: 1, flexBasis: 320, minWidth: 180, marginTop: 2, marginBottom: 2, marginLeft: 8, marginRight: 12, paddingTop: 4, paddingBottom: 4, paddingLeft: 10, paddingRight: 10, borderLeftWidth: 2, borderColor: note.surprise ? p.data : p.line3, borderTopRightRadius: 6, borderBottomRightRadius: 6, backgroundColor: p.raised2, fontFamily: SANS, color: p.text3, userSelect: "text", ...text(12) }}>
          {note.note}
        </div>
      )}
    </div>
  );
  return row?.below ? <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>{shown}{row.below}</div> : shown;
}

/** Numbered code lines, with plain-words notes beside the first line of each group when there are any. */
export function CodeLinesOf({ code, grammar, notes = [], ask = null }: { readonly code: string; readonly grammar: Grammar | null; readonly notes?: readonly KernelNote[]; readonly ask?: AskPlace | null }): ReactElement {
  const lines = code.split("\n");
  const rows = useAskRows(ask, lines);
  const startsAt = new Map(notes.map((n) => [n.from, n]));
  const inSurprise = (line: number): boolean => notes.some((n) => n.surprise && line >= n.from && line <= n.to);
  return <>{lines.map((line, ix) => <IrLine key={ix} line={line} number={ix + 1} grammar={grammar} note={startsAt.get(ix + 1) ?? null} surprise={inSurprise(ix + 1)} row={rows(ix + 1)} />)}</>;
}

function LoadedByCard({ loadedBy, onOpen }: { readonly loadedBy: Loaded<LoadedBy | null>; readonly onOpen: (symbol: string) => void }): ReactElement {
  const { p } = useTheme();
  const look = useCodeLook();
  const body = ((): ReactElement => {
    if (loadedBy.kind === "loading") return <div style={{ color: p.muted, ...text(12) }}>{t("gpu.loadedBy.finding")}</div>;
    if (loadedBy.kind === "failed") return <div style={{ color: p.muted, ...text(12) }}>{t("gpu.loadedBy.failed", { error: loadedBy.message })}</div>;
    if (!loadedBy.value) return <div style={{ color: p.muted, ...text(12) }}>{t("gpu.loadedBy.none")}</div>;
    const { symbol } = loadedBy.value;
    return (
      <>
        <div onClick={() => onOpen(symbol)} role="link" style={{ fontFamily: look.family, color: p.link, textDecoration: "underline", fontSize: 12, lineHeight: 18.85, cursor: "pointer", hover: { color: p.text } }}>{symbol}</div>
        <div style={{ marginTop: 4, color: p.muted, ...text(12) }}>{loadedBy.value.note}</div>
      </>
    );
  })();
  return (
    <div style={{ display: "flex", flexDirection: "column", padding: 12, borderWidth: 1, borderColor: p.line3, borderRadius: 10, backgroundColor: p.raised }}>
      <div style={{ marginBottom: 4, color: p.muted, ...text(11.5) }}>{t("gpu.loadedBy")}</div>
      {body}
    </div>
  );
}

const CLIP = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

/** The CUDA and HIP readers name a kernel's stats in English, which other code matches on, so they read in the current language only here. */
const STAT_NAME: ReadonlyMap<string, PlainId> = new Map([
  ["Registers", "gpu.stat.registers"],
  ["Shared memory", "gpu.stat.sharedMemory"],
  ["Code size", "gpu.stat.codeSize"],
  ["Parameter block", "gpu.stat.paramBlock"],
  ["Built for", "gpu.stat.builtFor"],
  ["Vector registers", "gpu.stat.vectorRegisters"],
  ["Scalar registers", "gpu.stat.scalarRegisters"],
  ["Local memory (LDS)", "gpu.stat.lds"],
  ["Scratch", "gpu.stat.scratch"],
  ["Wavefront", "gpu.stat.wavefront"],
  ["Largest workgroup", "gpu.stat.largestWorkgroup"],
]);

function statValue(value: string): string {
  const [, count, unit] = /^([\d,]+) (.+)$/.exec(value) ?? [];
  if (count === undefined) return value;
  switch (unit) {
    case "per thread":
      return t("gpu.stat.perThread", { count });
    case "per wave":
      return t("gpu.stat.perWave", { count });
    case "bytes":
      return t("gpu.stat.bytes", { count });
    case "bytes per thread":
      return t("gpu.stat.bytesPerThread", { count });
    case "lanes":
      return t("gpu.stat.lanes", { count });
    case "threads":
      return t("gpu.stat.threads", { count });
    default:
      return value;
  }
}

function statText(stat: Binding): Binding {
  const name = STAT_NAME.get(stat.slot);
  return { slot: name ? t(name) : stat.slot, type: statValue(stat.type) };
}

function Bindings({ title, bindings, mono }: { readonly title: string; readonly bindings: readonly Binding[]; readonly mono: boolean }): ReactElement {
  const { p } = useTheme();
  const { family } = useCodeLook();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: 12, borderWidth: 1, borderColor: p.sel, borderRadius: 10, userSelect: "text" }}>
      <div style={{ marginBottom: 4, color: p.muted, ...text(11.5) }}>{title}</div>
      {bindings.map((b) => (
        <div key={b.slot} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <div style={{ flexShrink: 0, color: mono ? p.text3 : p.text }}>{b.slot}</div>
          <div style={{ minWidth: 0, ...(mono ? { fontFamily: family } : {}), color: p.text4, textAlign: "right", ...CLIP }}>{b.type}</div>
        </div>
      ))}
    </div>
  );
}

function IrBody({ ir, name, grammar, notes, ask }: { readonly ir: Loaded<string>; readonly name: string; readonly grammar: Grammar | null; readonly notes: readonly KernelNote[]; readonly ask: AskPlace | null }): ReactElement {
  const { p } = useTheme();
  switch (ir.kind) {
    case "loading":
      return <div style={{ paddingLeft: 18, fontFamily: SANS, color: p.muted }}>{t("gpu.reading", { name })}</div>;
    case "failed":
      return <div style={{ paddingLeft: 18, fontFamily: SANS, color: p.error }}>{t("gpu.readFailed", { name, error: ir.message })}</div>;
    case "ready":
      return <CodeLinesOf code={ir.value} grammar={grammar} notes={notes} ask={ask} />;
    default: {
      const unhandled: never = ir;
      return unhandled;
    }
  }
}

/** What the code on the left is, in the words of the API that built it. */
function stageOf(fn: ShaderFunction, format: string, api: GpuApi): string {
  switch (api) {
    case "metal": {
      const what = fn.kind === "compute" ? t("gpu.stage.metalCompute") : t("gpu.stage.metalShader", { kind: fn.kind });
      const reads = format.split(" · ")[1];
      return reads ? `${what} · ${reads}` : what;
    }
    case "cuda":
      return t("gpu.stage.cuda");
    case "hip":
      return t("gpu.stage.hip");
    default: {
      const unhandled: never = api;
      return unhandled;
    }
  }
}

/** What a kernel tab adds above and in place of the plain code: its toolbar, a status line, another view of the code, notes. */
export type ShaderExtras = {
  readonly subtitle: string | null;
  readonly toolbar: ReactElement | null;
  readonly status: ReactElement | null;
  readonly body: ReactElement | null;
  readonly notes: readonly KernelNote[];
};

const NO_EXTRAS: ShaderExtras = { subtitle: null, toolbar: null, status: null, body: null, notes: [] };

export function ShaderView({ fn, stage, api, ir, loadedBy, onOpen, onAsk, ask, extras = NO_EXTRAS }: {
  readonly fn: ShaderFunction;
  readonly stage: string;
  readonly api: GpuApi;
  readonly onOpen: (symbol: string) => void;
  readonly ir: Loaded<string>;
  readonly loadedBy: Loaded<LoadedBy | null>;
  readonly onAsk: () => void;
  readonly ask: AskPlace | null;
  readonly extras?: ShaderExtras;
}): ReactElement {
  const { p } = useTheme();
  const look = useCodeLook();
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, minHeight: 40, paddingLeft: 18, paddingRight: 10, overflow: "hidden" }}>
        <div style={{ flexShrink: 1, minWidth: 0, fontWeight: 600, userSelect: "text", ...CLIP, ...text(14) }}>{shortName(fn.name)}</div>
        <div style={{ flexShrink: 1, minWidth: 0, color: p.muted, ...CLIP, ...text(13) }}>{extras.subtitle ?? stageOf(fn, stage, api)}</div>
        <div style={{ flexGrow: 1 }} />
        {extras.toolbar}
      </div>
      {extras.status}
      <div style={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
      {extras.body ?? (
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 999, flexBasis: 420, minWidth: 0, overflow: "scroll", ...scrollbar(p), paddingTop: 4, paddingBottom: 14, fontFamily: look.family, fontSize: look.size, lineHeight: look.lineHeight }}>
          <IrBody ir={ir} name={fn.name} grammar={api === "cuda" ? "ptx" : null} notes={extras.notes} ask={ask} />
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, flexGrow: 1, flexBasis: 280, maxWidth: 340, padding: 14, borderLeftWidth: 1, borderColor: p.sel }}>
        {api === "metal" && <LoadedByCard loadedBy={loadedBy} onOpen={onOpen} />}
        {fn.stats.length > 0 && <Bindings title={t("gpu.needs")} bindings={fn.stats.map(statText)} mono={false} />}
        {fn.bindings.length > 0 && <Bindings title={api === "metal" ? t("gpu.inputs") : t("gpu.parameters")} bindings={fn.bindings} mono={api !== "metal"} />}
        <div onClick={onAsk} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 30, borderWidth: 1, borderColor: p.line3, borderRadius: 8, backgroundColor: p.sel, color: p.text, cursor: "pointer", hover: { opacity: 0.72 } }}>
          <div>{t("gpu.askSlow")}</div>
        </div>
      </div>
      </div>
    </div>
  );
}
