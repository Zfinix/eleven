import { type ReactElement, useMemo } from "react";

import { type Syntax, tokenize } from "../components/code";
import { ErrorCard } from "../components/kit";
import { useListWindow } from "../lib/useListWindow";
import { useLoaded } from "../lib/useLoaded";
import { syntaxFor, useCodeLook } from "../settings/look";
import { useSettings } from "../settings/store";
import { scrollbar, useTheme } from "../theme";
import { t } from "../i18n";
import type { SourceText } from "./model";
import { HOVER, useBench } from "./parts";
import { RecoveredView } from "./RecoveredView";
import { type AskRow, PinDot, useAskRows } from "./ask/AskThread";
import { type AskPlace, sourcePlace } from "./ask/place";

const NEARBY = 40;

function SourceLine({ text, number, addr, syntax, label, row }: { readonly text: string; readonly number: number; readonly addr: string | null; readonly syntax: Syntax; readonly label: boolean; readonly row: AskRow | null }): ReactElement {
  const { p } = useTheme();
  const { openFn, nameOf } = useBench();
  const { settings } = useSettings();
  const look = useCodeLook();
  const parts = text.length === 0 ? [] : tokenize(text, syntax, p, syntaxFor(settings.colorScheme, p));
  const pick = row ? { onClick: row.pick } : {};
  const link = addr === null ? pick : { onClick: () => openFn(addr, false), role: "link", "aria-label": t("workbench.view.open", { name: nameOf(addr) }) };
  const line = (
    <div role="row" aria-label={t("workbench.view.line", { number })} aria-selected={row?.picked ?? false} style={{ display: "flex", height: look.lineHeight, flexShrink: 0, fontFamily: look.family, fontSize: look.size, lineHeight: look.lineHeight, ...(row?.picked ? { backgroundColor: p.sel2 } : {}) }}>
      <div {...pick} style={{ position: "relative", display: "flex", justifyContent: "flex-end", width: 50, flexShrink: 0, paddingRight: 16, color: row?.picked ? p.text : p.gutter, userSelect: "none" }}>{row?.pinned && <PinDot />}{String(number)}</div>
      <div {...link} style={{ display: "flex", whiteSpace: "nowrap", userSelect: "text", ...(addr === null ? {} : { cursor: "pointer", hover: HOVER }) }}>
        {parts.map((part, ix) => <div key={ix} style={{ color: part.kind === "text" ? part.color : p.call, whiteSpace: "nowrap", pointerEvents: "none" }}>{part.text}</div>)}
        {label && addr !== null && <div style={{ marginLeft: 14, fontSize: 11, color: p.faint, whiteSpace: "nowrap", pointerEvents: "none" }}>{nameOf(addr)}</div>}
      </div>
      {row?.bar}
      {row && <div {...pick} style={{ flexGrow: 1, minWidth: 24 }} />}
    </div>
  );
  return row?.below ? <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>{line}{row.below}</div> : line;
}

/** Numbered, coloured lines of source; a line in `starts` opens its function when clicked, named beside it with `labels`. */
export function SourceLines({ source, syntax = "c", labels = false, ask = null }: { readonly source: SourceText; readonly syntax?: Syntax; readonly labels?: boolean; readonly ask?: AskPlace | null }): ReactElement {
  const { p } = useTheme();
  const look = useCodeLook();
  const lines = useMemo(() => source.text.split("\n"), [source]);
  const starts = useMemo(() => new Map(source.starts.map((start) => [start.line, start.addr])), [source]);
  const shown = useListWindow(lines.length, NEARBY);
  const rows = useAskRows(ask, lines);
  return (
    <virtual-list itemCount={lines.length} windowStart={shown.start} estimatedItemHeight={look.lineHeight} onVisibleRange={shown.onVisibleRange} style={{ ...scrollbar(p), flexGrow: 1, minHeight: 0, paddingTop: 10, paddingBottom: 28 }}>
      {lines.slice(shown.start, shown.end).map((line, ix) => {
        const number = shown.start + ix + 1;
        return <SourceLine key={number} text={line} number={number} addr={starts.get(number) ?? null} syntax={syntax} label={labels} row={rows(number)} />;
      })}
    </virtual-list>
  );
}

/** A source file: decompiled whole where the engine can (jadx), otherwise the original or what the binary holds of it. */
export function SourceView({ file }: { readonly file: string }): ReactElement {
  const { program } = useBench();
  const read = program.source;
  return read ? <DecompiledFile file={file} read={read} /> : <RecoveredView file={file} />;
}

/** A whole decompiled source file; a function's signature line opens that function. */
function DecompiledFile({ file, read }: { readonly file: string; readonly read: (file: string) => Promise<SourceText> }): ReactElement {
  const { p } = useTheme();
  const { program } = useBench();
  const source = useLoaded(() => read(file), `${program.id}:${file}`);
  switch (source.kind) {
    case "loading":
      return <div style={{ padding: 16, color: p.muted }}>{t("workbench.view.reading", { file })}</div>;
    case "failed":
      return <div style={{ padding: 16 }}><ErrorCard title={t("workbench.view.openFailed", { file })} detail={t("workbench.view.openFailed.function")} raw={source.message} /></div>;
    case "ready":
      return <SourceLines source={source.value} ask={sourcePlace(file, "c")} />;
    default: {
      const unhandled: never = source;
      return unhandled;
    }
  }
}
