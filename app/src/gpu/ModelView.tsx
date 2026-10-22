import { type ReactElement, useState } from "react";

import { useSize } from "../lib/useSize";
import { TYPING } from "../lib/shortcuts";
import { type Palette, scrollbar, useTheme } from "../theme";
import { t } from "../i18n";
import { useCodeLook } from "../settings/look";
import { Icon } from "../components/ui";
import { alertColors, text } from "./look";
import { bytes } from "./models/read";
import { type ModelFact, type ModelNote, metaGroups, modelFacts, modelNotes, type NoteTone, opCounts, riskQuote, riskText, tensorGroups } from "./models/facts";
import type { LoadEffect, ModelInfo, ModelLayer, ModelPage, ModelTensor, PickleName } from "./types";

const COLUMNS = [
  { label: "gpu.model.layer", weight: 262 },
  { label: "gpu.model.op", weight: 317.4 },
  { label: "gpu.model.outputShape", weight: 280.5 },
  { label: "gpu.model.type", weight: 280.5 },
] as const;

const CLIP = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

/** Below this width the fact cards sit two to a row. */
const FOUR_FROM = 720;

function Cell({ value, weight, color }: { readonly value: string; readonly weight: number; readonly color: string }): ReactElement {
  return <div style={{ flexGrow: weight, flexBasis: 0, minWidth: 0, paddingLeft: 12, paddingRight: 12, color, ...CLIP }}>{value}</div>;
}

function FactCard({ fact }: { readonly fact: ModelFact }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, padding: 12, borderWidth: 1, borderColor: p.sel, borderRadius: 10 }}>
      <div style={{ color: p.muted, ...text(12) }}>{fact.label}</div>
      <div style={{ fontWeight: 500 }}>{fact.value}</div>
      {fact.sub && <div style={{ color: p.faint, ...text(12) }}>{fact.sub}</div>}
    </div>
  );
}

function LayerRow({ layer }: { readonly layer: ModelLayer }): ReactElement {
  const { p } = useTheme();
  const { family } = useCodeLook();
  const [name, op, shape, type] = COLUMNS;
  return (
    <div style={{ display: "flex", alignItems: "center", height: 33.1, borderTopWidth: 1, borderColor: p.raised2, fontFamily: family, ...text(12.5) }}>
      <Cell value={layer.name} weight={name.weight} color={p.text} />
      <Cell value={layer.op} weight={op.weight} color={p.keyword} />
      <Cell value={layer.shape} weight={shape.weight} color={p.text4} />
      <Cell value={layer.type} weight={type.weight} color={p.kind} />
    </div>
  );
}

/** A CoreML model's layers, which have ops and shapes rather than stored tensors. */
function Layers({ layers }: { readonly layers: readonly ModelLayer[] }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", borderWidth: 1, borderColor: p.sel, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", height: 34.6, fontWeight: 500, color: p.muted, ...text(12.5) }}>
        {COLUMNS.map((c) => <Cell key={c.label} value={t(c.label)} weight={c.weight} color={p.muted} />)}
      </div>
      {layers.map((layer, ix) => <LayerRow key={`${layer.name}:${ix}`} layer={layer} />)}
    </div>
  );
}

/** One colour per weight type, so the bar, legend and tensor list agree. */
export function typeColor(p: Palette, type: string): string {
  if (/^(F32|F16|BF16|F64)$/.test(type)) return p.muted;
  if (type === "Q8_0" || type === "Q8_K") return p.call;
  if (type.startsWith("Q6")) return p.number;
  if (type.startsWith("Q4") || type.startsWith("IQ4")) return p.string;
  if (type.startsWith("Q5")) return p.keyword;
  return p.kind;
}

function Mix({ model }: { readonly model: ModelInfo }): ReactElement {
  const { p } = useTheme();
  const { family } = useCodeLook();
  const total = Math.max(1, model.mix.reduce((sum, m) => sum + m.bytes, 0));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 12, paddingBottom: 12, paddingLeft: 14, paddingRight: 14, borderWidth: 1, borderColor: p.sel, borderRadius: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontWeight: 500 }}>{t("gpu.model.weightsByType")}</div>
        <div style={{ color: p.muted, ...text(12) }}>{t("gpu.model.share")}</div>
      </div>
      <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", backgroundColor: p.fill }}>
        {model.mix.map((m) => <div key={m.type} style={{ flexGrow: Math.max(m.bytes / total, 0.006), flexBasis: 0, backgroundColor: typeColor(p, m.type), pointerEvents: "none" }} />)}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", columnGap: 18, rowGap: 6, ...text(12) }}>
        {model.mix.map((m) => (
          <div key={m.type} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: typeColor(p, m.type), pointerEvents: "none" }} />
            <div style={{ fontFamily: family, color: p.text3 }}>{m.type}</div>
            <div style={{ color: p.muted }}>{t("gpu.model.mix", { percent: Math.round((m.bytes / total) * 100), size: bytes(m.bytes), count: m.tensors })}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function noteFill(p: Palette, tone: NoteTone): { readonly bg: string; readonly line: string } {
  switch (tone) {
    case "warn":
      return { bg: p.warnBg, line: p.warnLine };
    case "ok":
    case "plain":
      return { bg: "transparent", line: p.line2 };
    default: {
      const unhandled: never = tone;
      return unhandled;
    }
  }
}

function openLabel(page: ModelPage): string {
  switch (page) {
    case "loads":
      return t("gpu.model.open.loads");
    case "template":
      return t("gpu.model.open.template");
    case "metadata":
      return t("gpu.model.open.metadata");
    case "tensors":
      return t("gpu.model.open.tensors");
    case "nodes":
      return t("gpu.model.open.nodes");
    case "overview":
      return t("gpu.model.open.overview");
    default: {
      const unhandled: never = page;
      return unhandled;
    }
  }
}

function Note({ note, onPage }: { readonly note: ModelNote; readonly onPage: (page: ModelPage) => void }): ReactElement {
  const { p } = useTheme();
  const { family } = useCodeLook();
  const fill = noteFill(p, note.tone);
  const page = note.page;
  return (
    <div role={note.tone === "warn" ? "alert" : "note"} style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 12, paddingBottom: 12, paddingLeft: 14, paddingRight: 14, borderWidth: 1, borderColor: fill.line, borderRadius: 10, backgroundColor: fill.bg }}>
      <div style={{ fontWeight: 500 }}>{note.title}</div>
      <div style={{ color: p.text3 }}>{note.body}</div>
      {note.quote && <div style={{ marginTop: 4, paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 10, borderRadius: 8, backgroundColor: p.deep, color: p.text3, fontFamily: family, ...text(12) }}>{note.quote}</div>}
      {page && (
        <div style={{ display: "flex", marginTop: 6 }}>
          <div onClick={() => onPage(page)} role="button" style={{ display: "flex", alignItems: "center", height: 28, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.line2, borderRadius: 8, color: p.text3, cursor: "pointer", hover: { opacity: 0.72 }, userSelect: "none" }}>
            <div>{openLabel(page)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function Overview({ model, onPage, onAsk }: { readonly model: ModelInfo; readonly onPage: (page: ModelPage) => void; readonly onAsk: () => void }): ReactElement {
  const { p } = useTheme();
  const { ref, width } = useSize();
  const notes = modelNotes(model);
  return (
    <div ref={ref} style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 18, paddingBottom: 28, paddingLeft: 20, paddingRight: 20, userSelect: "text" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 10 }}>
        <div style={{ fontWeight: 600, ...text(18) }}>{model.name}</div>
        <div style={{ flexGrow: 1, paddingBottom: 2.3, color: p.muted }}>{t("gpu.model.headersOnly")}</div>
        <div onClick={onAsk} role="button" style={{ display: "flex", alignItems: "center", height: 28, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.line3, borderRadius: 8, backgroundColor: p.sel, color: p.text, cursor: "pointer", hover: { opacity: 0.72 }, userSelect: "none" }}>
          <div>{t("gpu.model.ask")}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: width === 0 || width >= FOUR_FROM ? 4 : 2, gap: 10 }}>
        {modelFacts(model).map((f) => <FactCard key={f.label} fact={f} />)}
      </div>
      {model.mix.length > 1 && <Mix model={model} />}
      {notes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontWeight: 500 }}>{t("gpu.model.worthKnowing")}</div>
          {notes.map((n) => <Note key={n.title} note={n} onPage={onPage} />)}
        </div>
      )}
      {model.tensors.length === 0 && model.loads.length === 0 && model.layers.length > 0 && <Layers layers={model.layers} />}
    </div>
  );
}

type Grouping = "block" | "file";

const TENSOR_COLUMNS = [
  { label: "gpu.model.tensor", grow: 3, right: false },
  { label: "gpu.model.shape", grow: 1.4, right: false },
  { label: "gpu.model.type", grow: 0.8, right: false },
  { label: "gpu.model.size", grow: 0.9, right: true },
  { label: "gpu.model.offset", grow: 1, right: true },
] as const;

function Seg({ label, on, onClick }: { readonly label: string; readonly on: boolean; readonly onClick: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div role="radio" aria-checked={on} onClick={onClick} style={{ display: "flex", alignItems: "center", height: 24, paddingLeft: 9, paddingRight: 9, borderRadius: 6, backgroundColor: on ? p.sel2 : "transparent", color: on ? p.text : p.muted, cursor: "pointer", hover: { opacity: 0.72 }, ...text(12) }}>
      <div>{label}</div>
    </div>
  );
}

function TensorRow({ tensor, on, onPick }: { readonly tensor: ModelTensor; readonly on: boolean; readonly onPick: () => void }): ReactElement {
  const { p } = useTheme();
  const { family } = useCodeLook();
  const values = [tensor.name, tensor.shape, tensor.type, bytes(tensor.bytes), tensor.offset === null ? "" : `0x${tensor.offset.toString(16)}`];
  const colors = [p.text, p.text3, typeColor(p, tensor.type), p.text3, p.faint];
  return (
    <div role="row" aria-selected={on} onClick={onPick} style={{ display: "flex", alignItems: "center", flexShrink: 0, height: 30, borderTopWidth: 1, borderColor: p.fill, backgroundColor: on ? p.sel : "transparent", fontFamily: family, cursor: "pointer", hover: { opacity: 0.72 }, ...text(12) }}>
      {TENSOR_COLUMNS.map((c, ix) => (
        <div key={c.label} style={{ flexGrow: c.grow, flexBasis: 0, minWidth: 0, paddingLeft: ix === 0 ? 34 : 12, paddingRight: ix === TENSOR_COLUMNS.length - 1 ? 16 : 12, color: colors[ix] ?? p.text, textAlign: c.right ? "right" : "left", ...CLIP }}>{values[ix] ?? ""}</div>
      ))}
    </div>
  );
}

function GroupRow({ label, meta, open, onToggle }: { readonly label: string; readonly meta: string; readonly open: boolean; readonly onToggle: () => void }): ReactElement {
  const { p } = useTheme();
  const { family } = useCodeLook();
  return (
    <div role="row" aria-expanded={open} onClick={onToggle} style={{ display: "flex", alignItems: "center", flexShrink: 0, gap: 8, height: 30, paddingLeft: 16, paddingRight: 16, borderTopWidth: 1, borderColor: p.fill, backgroundColor: p.deep, cursor: "pointer", hover: { opacity: 0.72 } }}>
      <Icon name={open ? "arrow-down" : "arrow-right"} size={11} color={p.faint} />
      <div style={{ fontFamily: family, fontWeight: 500, color: p.text3, ...text(12) }}>{label}</div>
      <div style={{ color: p.faint, ...text(12) }}>{meta}</div>
    </div>
  );
}

function matches(tensor: ModelTensor, query: string): boolean {
  const q = query.toLowerCase();
  return tensor.name.toLowerCase().includes(q) || tensor.type.toLowerCase() === q || tensor.shape.includes(query);
}

function Tensors({ model, picked, onPick }: { readonly model: ModelInfo; readonly picked: string | null; readonly onPick: (name: string) => void }): ReactElement {
  const { p } = useTheme();
  const { family } = useCodeLook();
  const groups = tensorGroups(model.tensors);
  const firstBlock = groups.find((g) => /\d$/.test(g.key))?.key ?? null;
  const pickedGroup = picked ? groups.find((g) => g.tensors.some((t) => t.name === picked))?.key ?? null : null;
  const [grouping, setGrouping] = useState<Grouping>("block");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set([...(firstBlock ? [firstBlock] : []), ...(pickedGroup ? [pickedGroup] : [])]));
  const toggle = (key: string): void => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpen(next);
  };
  const filter = query.trim();
  const row = (t: ModelTensor): ReactElement => <TensorRow key={t.name} tensor={t} on={t.name === picked} onPick={() => onPick(t.name)} />;
  const found = filter ? model.tensors.filter((t) => matches(t, filter)) : [];
  const body = filter
    ? found.map(row)
    : grouping === "file"
      ? model.tensors.map(row)
      : groups.flatMap((g, gi) => {
        const isOpen = g.tensors.length === 1 || open.has(g.key);
        const size = bytes(g.tensors.reduce((sum, t) => sum + t.bytes, 0));
        const head = g.tensors.length === 1 ? [] : [<GroupRow key={`g${gi}`} label={g.label} meta={t("gpu.model.group", { count: g.tensors.length, size })} open={isOpen} onToggle={() => toggle(g.key)} />];
        return [...head, ...(isOpen ? g.tensors.map(row) : [])];
      });
  const total = bytes(model.tensors.reduce((sum, t) => sum + t.bytes, 0));
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, userSelect: "text" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, height: 40, flexShrink: 0, paddingLeft: 10, paddingRight: 12 }}>
        <div style={{ display: "flex", alignItems: "center", flexGrow: 0, flexShrink: 1, flexBasis: 280, minWidth: 120, height: 26, paddingLeft: 8, paddingRight: 8, borderWidth: 1, borderColor: p.line2, borderRadius: 7, backgroundColor: p.deep }}>
          <input {...TYPING} value={query} placeholder={t("gpu.model.filter.placeholder")} aria-label={t("gpu.model.filter")} onChange={(e) => setQuery(e.value ?? "")} style={{ flexGrow: 1, minWidth: 0, fontSize: 12, color: p.text3, fontFamily: family }} />
        </div>
        <div role="radiogroup" aria-label={t("gpu.model.grouping")} style={{ display: "flex", gap: 2, padding: 2, borderRadius: 8, backgroundColor: p.fill }}>
          <Seg label={t("gpu.model.byBlock")} on={grouping === "block"} onClick={() => setGrouping("block")} />
          <Seg label={t("gpu.model.fileOrder")} on={grouping === "file"} onClick={() => setGrouping("file")} />
        </div>
        <div style={{ flexGrow: 1 }} />
        <div style={{ color: p.muted, ...text(12) }}>{filter ? t("gpu.model.found", { found: found.length, count: model.tensors.length }) : t("gpu.model.total", { count: model.tensors.length.toLocaleString("en-US"), size: total })}</div>
      </div>
      <div role="row" style={{ display: "flex", alignItems: "center", flexShrink: 0, height: 30, borderBottomWidth: 1, borderColor: p.line2, color: p.muted, fontWeight: 500, ...text(12.5) }}>
        {TENSOR_COLUMNS.map((c, ix) => (
          <div key={c.label} style={{ flexGrow: c.grow, flexBasis: 0, minWidth: 0, paddingLeft: ix === 0 ? 16 : 12, paddingRight: ix === TENSOR_COLUMNS.length - 1 ? 16 : 12, textAlign: c.right ? "right" : "left" }}>{t(c.label)}</div>
        ))}
      </div>
      <div role="grid" aria-label={t("gpu.model.tensors")} style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", ...scrollbar(p) }}>
        {body.length > 0 ? body : <div style={{ padding: 18, color: p.muted }}>{t("gpu.model.noMatch", { query: filter })}</div>}
      </div>
    </div>
  );
}

function Metadata({ model }: { readonly model: ModelInfo }): ReactElement {
  const { p } = useTheme();
  const { family } = useCodeLook();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingTop: 18, paddingBottom: 28, paddingLeft: 20, paddingRight: 20, userSelect: "text" }}>
      {metaGroups(model.metadata).map((g) => (
        <div key={g.title} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ marginBottom: 4, fontWeight: 600, color: p.text3, ...text(12) }}>{g.title}</div>
          {g.entries.map((e) => (
            <div key={e.key} style={{ display: "flex", gap: 14, ...text(12.5) }}>
              <div style={{ flexGrow: 0, flexShrink: 0, flexBasis: 300, minWidth: 0, color: p.muted, fontFamily: family, ...text(12), ...CLIP }}>{e.key}</div>
              <div style={{ flexGrow: 1, minWidth: 0, color: p.text3 }}>{e.value}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function templateColor(p: Palette, line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith("{%")) return p.keyword;
  if (trimmed.startsWith("{{")) return p.text3;
  return p.string;
}

function Template({ model }: { readonly model: ModelInfo }): ReactElement {
  const { p } = useTheme();
  const { family } = useCodeLook();
  const quote = riskQuote(model.risk);
  const hidden = quote && model.template?.includes(quote) ? quote : null;
  const lines = (model.template ?? "").replace(/(%\}|\}\})(?=\{)/g, "$1\n").split("\n");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 18, paddingBottom: 28, paddingLeft: 20, paddingRight: 20, userSelect: "text" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontWeight: 600, ...text(14) }}>{t("gpu.model.chatTemplate")}</div>
        <div style={{ color: p.muted }}>{hidden ? t("gpu.model.template.hidden") : t("gpu.model.template")}</div>
      </div>
      <div role="region" aria-label="tokenizer.chat_template" style={{ display: "flex", flexDirection: "column", paddingTop: 10, paddingBottom: 10, borderWidth: 1, borderColor: p.line2, borderRadius: 10, backgroundColor: p.deep, fontFamily: family, ...text(12), overflowX: "scroll", ...scrollbar(p) }}>
        {lines.map((line, ix) => (
          <div key={ix} style={{ display: "flex", backgroundColor: hidden && line.includes(hidden) ? p.warnBg : "transparent" }}>
            <div style={{ width: 40, flexShrink: 0, paddingRight: 12, textAlign: "right", color: p.faint, userSelect: "none" }}>{`${ix + 1}`}</div>
            <div style={{ whiteSpace: "nowrap", color: templateColor(p, line) }}>{line}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function effectOf(p: Palette, item: PickleName): { readonly label: string; readonly color: string } {
  const effect: LoadEffect = item.effect;
  switch (effect) {
    case "data":
      return { label: t("gpu.model.effect.data"), color: p.string };
    case "layer":
      return { label: t("gpu.model.effect.layer"), color: p.text3 };
    case "class":
      return { label: t("gpu.model.effect.class", { from: item.from }), color: p.number };
    case "runs code":
      return { label: t("gpu.model.effect.runsCode"), color: p.error };
    default: {
      const unhandled: never = effect;
      return unhandled;
    }
  }
}

function Loads({ model }: { readonly model: ModelInfo }): ReactElement {
  const { p } = useTheme();
  const { family } = useCodeLook();
  const risk = alertColors(p);
  const warning = model.risk ? riskText(model.risk) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", userSelect: "text" }}>
      {warning && (
        <div role="alert" style={{ marginTop: 16, marginLeft: 20, marginRight: 20, paddingTop: 12, paddingBottom: 12, paddingLeft: 14, paddingRight: 14, borderWidth: 1, borderColor: risk.line, borderRadius: 10, backgroundColor: risk.bg }}>
          <div style={{ fontWeight: 500 }}>{warning.title}</div>
          <div style={{ color: p.text2 }}>{warning.detail}</div>
        </div>
      )}
      <div style={{ paddingTop: 16, paddingBottom: 10, paddingLeft: 20, paddingRight: 20, color: p.muted }}>{t("gpu.model.loads")}</div>
      <div style={{ display: "flex", alignItems: "center", height: 30, borderBottomWidth: 1, borderColor: p.line2, color: p.muted, fontWeight: 500, ...text(12.5) }}>
        <div style={{ flexGrow: 3, flexBasis: 0, paddingLeft: 20, paddingRight: 12 }}>{t("gpu.model.name")}</div>
        <div style={{ flexGrow: 1.2, flexBasis: 0, paddingLeft: 12, paddingRight: 12 }}>{t("gpu.model.from")}</div>
        <div style={{ flexGrow: 1.4, flexBasis: 0, paddingLeft: 12, paddingRight: 20 }}>{t("gpu.model.onLoad")}</div>
      </div>
      {model.loads.map((item) => {
        const effect = effectOf(p, item);
        return (
          <div key={item.name} role="row" style={{ display: "flex", alignItems: "center", height: 30, borderTopWidth: 1, borderColor: p.fill, ...text(12.5) }}>
            <div style={{ flexGrow: 3, flexBasis: 0, minWidth: 0, paddingLeft: 20, paddingRight: 12, fontFamily: family, color: p.text, ...text(12), ...CLIP }}>{item.name}</div>
            <div style={{ flexGrow: 1.2, flexBasis: 0, minWidth: 0, paddingLeft: 12, paddingRight: 12, color: p.text3 }}>{item.from}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexGrow: 1.4, flexBasis: 0, minWidth: 0, paddingLeft: 12, paddingRight: 20, color: effect.color }}>
              <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: effect.color, pointerEvents: "none" }} />
              <div style={CLIP}>{effect.label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The graph's operators in order, each with the values it reads and writes, under a count of each kind. */
function Operators({ model }: { readonly model: ModelInfo }): ReactElement {
  const { p } = useTheme();
  const { family } = useCodeLook();
  const counts = opCounts(model);
  return (
    <div style={{ display: "flex", flexDirection: "column", userSelect: "text" }}>
      <div style={{ display: "flex", flexWrap: "wrap", columnGap: 8, rowGap: 6, paddingTop: 16, paddingBottom: 12, paddingLeft: 20, paddingRight: 20 }}>
        {counts.map(([op, n]) => (
          <div key={op} style={{ display: "flex", alignItems: "center", gap: 6, height: 24, paddingLeft: 8, paddingRight: 8, borderRadius: 6, backgroundColor: p.fill, ...text(12) }}>
            <div style={{ fontFamily: family, color: p.keyword }}>{op}</div>
            <div style={{ color: p.muted }}>{`×${n}`}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", height: 30, borderBottomWidth: 1, borderColor: p.line2, color: p.muted, fontWeight: 500, ...text(12.5) }}>
        <div style={{ flexGrow: 0, flexShrink: 0, flexBasis: 56, paddingLeft: 20 }}>#</div>
        <div style={{ flexGrow: 1, flexBasis: 0, paddingLeft: 12, paddingRight: 12 }}>{t("gpu.model.operator")}</div>
        <div style={{ flexGrow: 2, flexBasis: 0, paddingLeft: 12, paddingRight: 12 }}>{t("gpu.model.reads")}</div>
        <div style={{ flexGrow: 2, flexBasis: 0, paddingLeft: 12, paddingRight: 20 }}>{t("gpu.model.writes")}</div>
      </div>
      {model.nodes.map((n, ix) => (
        <div key={`${ix}:${n.name}`} role="row" style={{ display: "flex", alignItems: "center", height: 30, borderTopWidth: 1, borderColor: p.fill, fontFamily: family, ...text(12) }}>
          <div style={{ flexGrow: 0, flexShrink: 0, flexBasis: 56, paddingLeft: 20, color: p.faint }}>{`${ix + 1}`}</div>
          <div style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, paddingLeft: 12, paddingRight: 12, color: n.domain ? p.number : p.keyword, ...CLIP }}>{n.domain ? `${n.domain}.${n.op}` : n.op}</div>
          <div style={{ flexGrow: 2, flexBasis: 0, minWidth: 0, paddingLeft: 12, paddingRight: 12, color: p.text3, ...CLIP }}>{n.inputs.filter(Boolean).join(", ")}</div>
          <div style={{ flexGrow: 2, flexBasis: 0, minWidth: 0, paddingLeft: 12, paddingRight: 20, color: p.text, ...CLIP }}>{n.outputs.join(", ")}</div>
        </div>
      ))}
    </div>
  );
}

/** Pages that fill the pane and scroll their own rows. */
export function pageOwnsScroll(page: ModelPage): boolean {
  return page === "tensors";
}

/** One model file, read from its headers only: the page picked in its tab. */
export function ModelView({ model, page, tensor, onPage, onTensor, onAsk }: {
  readonly model: ModelInfo;
  readonly page: ModelPage;
  readonly tensor: string | null;
  readonly onPage: (page: ModelPage) => void;
  readonly onTensor: (name: string) => void;
  readonly onAsk: () => void;
}): ReactElement {
  switch (page) {
    case "overview":
      return <Overview model={model} onPage={onPage} onAsk={onAsk} />;
    case "tensors":
      return <Tensors model={model} picked={tensor} onPick={onTensor} />;
    case "nodes":
      return <Operators model={model} />;
    case "metadata":
      return <Metadata model={model} />;
    case "template":
      return <Template model={model} />;
    case "loads":
      return <Loads model={model} />;
    default: {
      const unhandled: never = page;
      return unhandled;
    }
  }
}
