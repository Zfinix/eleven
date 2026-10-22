import type { ReactElement } from "react";

import { blockOf, tensorRole } from "../gpu/models/facts";
import { bytes } from "../gpu/models/read";
import { useLoaded } from "../lib/useLoaded";
import { TYPING } from "../lib/shortcuts";
import { scrollbar, useTheme } from "../theme";
import { Icon } from "../components/ui";
import { ask, BLOCK_COLORS } from "./actions";
import type { HexRow, Refs } from "./model";
import { fileOffset } from "./patch";
import { ELLIPSIS, MONO_STYLE, TextButton, useBench } from "./parts";
import { currentAddr, placeIn, segmentOf } from "./where";
import { type PlainId, t } from "../i18n";

const NO_COLOR: PlainId = "workbench.inspector.none";

function Heading({ text }: { readonly text: string }): ReactElement {
  const { p } = useTheme();
  return <div style={{ marginBottom: 8, fontSize: 11.5, fontWeight: 600, color: p.muted }}>{text}</div>;
}

function Pair({ label, value, mono = false }: { readonly label: string; readonly value: string; readonly mono?: boolean }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", gap: 12, minHeight: 22, fontSize: 12.5 }}>
      <div style={{ width: 84, flexShrink: 0, color: p.muted }}>{label}</div>
      <div style={{ flexGrow: 1, minWidth: 0, color: p.text3, userSelect: "text", ...(mono ? { fontSize: 12, ...MONO_STYLE } : {}), ...ELLIPSIS }}>{value}</div>
    </div>
  );
}

function bytesAt(rows: readonly HexRow[], addr: string): string {
  const at = Number.parseInt(addr, 16);
  const row = rows.find((r) => {
    const start = Number.parseInt(r.addr, 16);
    return at >= start && at < start + 16;
  });
  if (!row) return "";
  const offset = at - Number.parseInt(row.addr, 16);
  return row.bytes.split(" ").slice(offset, offset + 4).join(" ");
}

/** The tensor picked in a model tab: what it does, its shape, type, size and where it sits in the file. */
function TensorInspector({ name, tensor }: { readonly name: string; readonly tensor: string | null }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { gpuData } = bench;
  const model = gpuData.kind === "ready" ? gpuData.value.models.find((m) => m.name === name) : undefined;
  const picked = model?.tensors.find((entry) => entry.name === tensor);
  const box = { display: "flex", flexDirection: "column", gap: 18, flexGrow: 1, minHeight: 0, overflowY: "scroll", ...scrollbar(p), paddingTop: 4, paddingLeft: 14, paddingRight: 14, paddingBottom: 18 } as const;
  if (!model || !picked) {
    return (
      <div style={box}>
        <Heading text={model?.name ?? name} />
        <div style={{ color: p.muted, fontSize: 12.5 }}>{model && model.tensors.length > 0 ? t("workbench.inspector.pickTensor") : t("workbench.inspector.emptyModel")}</div>
      </div>
    );
  }
  const elements = picked.shape ? picked.shape.split(" × ").reduce((n, d) => n * Number(d), 1) : 1;
  const block = blockOf(picked.name);
  const blocks = new Set(model.tensors.flatMap((entry) => blockOf(entry.name) ?? [])).size;
  return (
    <div style={box}>
      <div role="region" aria-label={t("workbench.inspector.tensor")} style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 13, color: p.text, userSelect: "text", ...MONO_STYLE }}>{picked.name}</div>
        {tensorRole(picked.name) && <div style={{ marginBottom: 8, color: p.muted, fontSize: 12.5 }}>{tensorRole(picked.name)}</div>}
        <Pair label={t("workbench.inspector.shape")} value={picked.shape || t("workbench.inspector.scalar")} mono />
        <Pair label={t("workbench.inspector.elements")} value={elements.toLocaleString("en-US")} mono />
        <Pair label={t("workbench.inspector.type")} value={picked.type} mono />
        <Pair label={t("workbench.inspector.size")} value={bytes(picked.bytes)} mono />
        {picked.offset !== null && <Pair label={t("workbench.inspector.offset")} value={t(model.format.startsWith("GGUF") ? "workbench.inspector.inData" : "workbench.inspector.inFile", { offset: `0x${picked.offset.toString(16)}` })} mono />}
        <Pair label={t("workbench.inspector.block")} value={block === null ? t("workbench.inspector.outsideBlocks") : t("workbench.inspector.blockOf", { block, count: blocks })} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <TextButton label={t("workbench.inspector.askTensor")} tone="ask" onClick={() => ask(bench, t("workbench.inspector.askTensorPrompt", { model: model.name, tensor: picked.name, shape: picked.shape, type: picked.type }))} />
      </div>
    </div>
  );
}

/** The inspector for whatever is focused: a model's tensor, or a place in the code. */
export function Inspector(): ReactElement {
  const { wb } = useBench();
  const pane = wb.s.panes[wb.s.focus];
  const tab = pane?.tabs[pane.active];
  if (tab?.kind === "model") return <TensorInspector name={tab.name} tensor={tab.tensor} />;
  return <CodeInspector />;
}

/** What is selected: where it is in memory and in the file, its bytes, its function, your tag and note. */
function CodeInspector(): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { wb, program, focusAddr, nameOf } = bench;
  const at = currentAddr(bench);
  const offset = useLoaded<number | null>(() => (program.dossier ? fileOffset(program.path, at) : Promise.resolve(null)), `${program.path}:${at}:offset`);
  const hex = useLoaded<readonly HexRow[]>(() => program.hex(at), `${program.id}:${at}:hex`);
  const refs = useLoaded<Refs>(() => program.refs(focusAddr), `${program.name}:${focusAddr}:refs`);
  const color = wb.s.colors.get(focusAddr) ?? "";
  const callers = refs.kind === "ready" ? refs.value.callers.length : null;
  const calls = refs.kind === "ready" ? refs.value.callees.map(nameOf).join(", ") : "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, flexGrow: 1, minHeight: 0, overflowY: "scroll", ...scrollbar(p), paddingTop: 4, paddingLeft: 14, paddingRight: 14, paddingBottom: 18 }}>
      <div role="region" aria-label={t("workbench.inspector.selection")} style={{ display: "flex", flexDirection: "column" }}>
        <Heading text={t("workbench.inspector.selection")} />
        <Pair label={t("workbench.action.address")} value={at} mono />
        <Pair label={t("workbench.inspector.inFileAt")} value={offset.kind === "ready" && offset.value !== null ? `0x${offset.value.toString(16)}` : t("workbench.inspector.notInFile")} mono />
        <Pair label={t("workbench.inspector.segment")} value={segmentOf(program.segments, at) ?? t("workbench.inspector.unknown")} />
        <Pair label={t("workbench.inspector.bytes")} value={hex.kind === "ready" ? bytesAt(hex.value, at) || t("workbench.inspector.none") : t("workbench.inspector.reading")} mono />
      </div>
      <div role="region" aria-label={t("workbench.inspector.function")} style={{ display: "flex", flexDirection: "column" }}>
        <Heading text={t("workbench.inspector.function")} />
        <Pair label={t("workbench.menu.name")} value={placeIn(nameOf(focusAddr), focusAddr, at)} mono />
        <Pair label={t("workbench.calledBy")} value={callers === null ? t("workbench.inspector.finding") : callers === 1 ? t("workbench.inspector.onePlace") : t("workbench.inspector.places", { count: callers })} />
        <Pair label={t("workbench.calls")} value={refs.kind === "ready" ? calls || t("workbench.inspector.nothing") : t("workbench.inspector.finding")} />
      </div>
      <div role="region" aria-label={t("workbench.inspector.yourNotes")} style={{ display: "flex", flexDirection: "column" }}>
        <Heading text={t("workbench.inspector.tagAndNote")} />
        <div role="radiogroup" aria-label={t("workbench.inspector.colourTag")} style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {[{ label: NO_COLOR, color: "" }, ...BLOCK_COLORS].map((c) => (
            <div key={c.label} onClick={() => wb.setColor(focusAddr, c.color)} role="radio" aria-label={t(c.label)} aria-selected={color === c.color} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: 10, backgroundColor: c.color || p.fill, cursor: "pointer" }}>
              {color === c.color && <Icon name="check" size={12} color={c.color ? "#ffffff" : p.text} />}
            </div>
          ))}
        </div>
        <textarea {...TYPING} value={wb.s.notes.get(focusAddr) ?? ""} minRows={3} maxRows={8} placeholder={t("workbench.inspector.notePlaceholder")} aria-label={t("workbench.inspector.note")} onChange={(e) => wb.setNote(focusAddr, e.value ?? "")} style={{ paddingTop: 8, paddingBottom: 8, paddingLeft: 9, paddingRight: 9, borderWidth: 1, borderColor: p.line3, borderRadius: 8, backgroundColor: p.deep, fontSize: 12.5, color: p.text3 }} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <TextButton label={t("workbench.inspector.patchLine")} tone="outline" onClick={() => wb.patch({ patching: at, patchDraft: "" })} />
        <TextButton label={t("workbench.inspector.askLine")} tone="outline" onClick={() => ask(bench, t("workbench.inspector.askLinePrompt", { address: at, name: nameOf(focusAddr) }))} />
      </div>
    </div>
  );
}
