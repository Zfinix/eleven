import type { StyleDesc } from "@gpuix/react";
import type { ReactElement } from "react";

import { type PlainId, t } from "../i18n";
import { useListWindow } from "../lib/useListWindow";
import { useLoaded } from "../lib/useLoaded";
import { showAddress, useCodeLook } from "../settings/look";
import { type Settings, useSettings } from "../settings/store";
import { SANS, scrollbar, useTheme } from "../theme";
import type { ListKind, TableRow } from "./model";
import { EmptyState, ErrorCard } from "../components/kit";
import { subjectMenu } from "./actions";
import { currentMatch, FindBar, findInBytes } from "./Find";
import { MONO_STYLE, useBench } from "./parts";
import type { Subject } from "./subject";
import { MOD } from "../lib/platform";

function hexAt(base: bigint, index: number): string {
  return `0x${(base + BigInt(index)).toString(16)}`;
}

function asciiOf(bytes: readonly number[]): string {
  return bytes.map((byte) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ".")).join("");
}

function listCap(limit: Settings["listLimit"]): number {
  switch (limit) {
    case "400":
      return 400;
    case "1,000":
      return 1000;
    case "5,000":
      return 5000;
    case "All":
      return Number.POSITIVE_INFINITY;
    default: {
      const unhandled: never = limit;
      return unhandled;
    }
  }
}

/** The picked byte range in this hex view, as [first, last] indexes, or null. */
function pickedRange(selected: Subject | null, fn: string, base: bigint): readonly [number, number] | null {
  if (selected?.kind !== "bytes" || selected.fn !== fn || selected.bytes.length === 0) return null;
  const first = Number(BigInt(selected.addr) - base);
  return [first, first + selected.bytes.length - 1];
}

/** A screenful of bytes; click a byte to pick it, Shift-click to pick a run, right-click for what to do with them. */
export function HexView({ addr }: { readonly addr: string }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { program, wb } = bench;
  const { settings } = useSettings();
  const look = useCodeLook();
  const width = Number(settings.hexRow);
  const loaded = useLoaded(() => program.hex(addr), `${program.id}:${addr}:hex`);
  if (loaded.kind !== "ready") {
    if (loaded.kind === "failed") return <div style={{ padding: 16 }}><ErrorCard title={t("workbench.chrome.bytes.failed")} detail={t("workbench.chrome.bytes.failedDetail")} raw={loaded.message} /></div>;
    return <div style={{ padding: 16, color: p.muted }}>{t("workbench.chrome.bytes.reading")}</div>;
  }
  if (loaded.value.length === 0) return <Centered><EmptyState title={t("workbench.chrome.bytes.none", { addr })} hint={t("workbench.chrome.bytes.noneHint")} /></Centered>;
  const base = BigInt(loaded.value[0]?.addr ?? addr);
  const all = loaded.value.flatMap((row) => row.bytes.split(" ").map((pair) => parseInt(pair, 16)));
  const rows = Array.from({ length: Math.ceil(all.length / width) }, (_, r) => {
    const bytes = all.slice(r * width, (r + 1) * width);
    return { addr: hexAt(base, r * width), pairs: bytes.map((byte) => byte.toString(16).padStart(2, "0")), ascii: asciiOf(bytes) };
  });
  const range = pickedRange(wb.s.selected, addr, base);
  const span = (from: number, to: number): Subject => {
    const first = Math.min(from, to);
    const last = Math.max(from, to);
    return { kind: "bytes", fn: addr, addr: hexAt(base, first), bytes: all.slice(first, last + 1) };
  };
  const pick = (index: number, extend: boolean): void => wb.select(extend && range ? span(range[0], index) : span(index, index));
  const inRange = (index: number): boolean => range !== null && index >= range[0] && index <= range[1];
  const find = wb.s.finding ? findInBytes(all, wb.s.findQuery, wb.s.findMode) : { hits: [], problem: null };
  const now = find.hits[currentMatch(wb.s.findAt, find.hits.length)];
  const hitAt = (index: number): "no" | "match" | "current" => {
    if (now && index >= now[0] && index < now[0] + now[1]) return "current";
    return find.hits.some(([start, length]) => index >= start && index < start + length) ? "match" : "no";
  };
  const tint = (index: number): StyleDesc => {
    const hit = hitAt(index);
    if (inRange(index) || hit === "current") return { backgroundColor: p.sel2 };
    return hit === "match" ? { backgroundColor: p.fill } : {};
  };
  return (
    <>
      {wb.s.finding && <FindBar count={find.hits.length} problem={find.problem} />}
      <div style={{ display: "flex", flexDirection: "column", userSelect: "text", paddingTop: 12, paddingBottom: 12, paddingLeft: 16, paddingRight: 16, fontFamily: look.family, fontSize: look.size, lineHeight: look.lineHeight }}>
        {rows.map((row, r) => (
          <div key={row.addr} style={{ display: "flex", gap: 22, whiteSpace: "nowrap" }}>
            <div style={{ color: p.link }}>{showAddress(row.addr, settings)}</div>
            <div style={{ display: "flex" }}>
              {row.pairs.map((pair, c) => {
                const index = r * width + c;
                const menuFor = inRange(index) && range ? span(range[0], range[1]) : span(index, index);
                return (
                  <div key={c} {...subjectMenu(bench, menuFor, (e) => pick(index, e.modifiers?.shift === true))} aria-label={t("workbench.chrome.byte", { addr: hexAt(base, index) })} style={{ paddingLeft: 3, paddingRight: 3, color: p.text3, ...tint(index) }}>
                    {pair}
                  </div>
                );
              })}
            </div>
            <div style={{ color: p.faint }}>{row.ascii}</div>
          </div>
        ))}
      </div>
    </>
  );
}

const COLUMNS: Readonly<Record<ListKind, readonly [PlainId, PlainId]>> = {
  strings: ["workbench.chrome.col.address", "workbench.chrome.col.string"],
  imports: ["workbench.chrome.col.library", "workbench.chrome.col.symbol"],
  segments: ["workbench.chrome.col.segment", "workbench.chrome.col.range"],
};

const NONE: Readonly<Record<ListKind, PlainId>> = { strings: "workbench.chrome.noStrings", imports: "workbench.chrome.noImports", segments: "workbench.chrome.noSegments" };

const FIRST_COLUMN = 156;
const ROW_HEIGHT = 31;

function rowsFor(list: ListKind, strings: readonly TableRow[], imports: readonly TableRow[], segments: readonly TableRow[]): readonly TableRow[] {
  switch (list) {
    case "strings":
      return strings.map((r) => ({ a: r.a, b: `"${r.b}"` }));
    case "imports":
      return imports;
    case "segments":
      return segments;
    default: {
      const unhandled: never = list;
      return unhandled;
    }
  }
}

function rowSubject(list: ListKind, row: TableRow, raw: TableRow | undefined): Subject {
  switch (list) {
    case "strings":
      return { kind: "string", addr: row.a, value: raw?.b ?? row.b };
    case "imports":
      return { kind: "import", library: row.a, symbol: row.b };
    case "segments":
      return { kind: "segment", name: row.a, range: row.b };
    default: {
      const unhandled: never = list;
      return unhandled;
    }
  }
}

/** A segment row keeps "start to end" as data; the reader sees it in their language. */
function rangeText(range: string): string {
  const [start, end, ...rest] = range.split(" to ");
  return start !== undefined && end !== undefined && rest.length === 0 ? t("workbench.chrome.rangeOf", { start, end }) : range;
}

function Table({ list }: { readonly list: ListKind }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { program } = bench;
  const { settings } = useSettings();
  const [first, second] = COLUMNS[list];
  const every = rowsFor(list, program.strings, program.imports, program.segments);
  const rows = every.slice(0, listCap(settings.listLimit));
  const addresses = (text: string): string => (list === "imports" ? text : text.replace(/0x[0-9a-f]+/gi, (found) => showAddress(found, settings)));
  const shown = useListWindow(rows.length);
  const cell = { paddingTop: 5, paddingBottom: 5, paddingLeft: 8, paddingRight: 8, fontSize: 12, ...MONO_STYLE } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, paddingTop: 8, paddingLeft: 12, paddingRight: 12 }}>
      <div style={{ display: "flex", flexShrink: 0, color: p.muted, fontSize: 12 }}>
        <div style={{ width: FIRST_COLUMN, flexShrink: 0, paddingTop: 6, paddingBottom: 6, paddingLeft: 8, paddingRight: 8 }}>{t(first)}</div>
        <div style={{ paddingTop: 6, paddingBottom: 6, paddingLeft: 8, paddingRight: 8 }}>{t(second)}</div>
      </div>
      {rows.length === 0 && <Centered><EmptyState title={t(NONE[list])} hint={t("workbench.chrome.noneHint", { engine: program.engine })} /></Centered>}
      {rows.length > 0 && <virtual-list itemCount={rows.length} windowStart={shown.start} estimatedItemHeight={ROW_HEIGHT} onVisibleRange={shown.onVisibleRange} style={{ ...scrollbar(p), flexGrow: 1, minHeight: 0, paddingBottom: 24 }}>
        {rows.slice(shown.start, shown.end).map((row, ix) => (
          <div key={shown.start + ix} {...subjectMenu(bench, rowSubject(list, row, program[list][shown.start + ix]))} role="row" aria-label={list === "segments" ? rangeText(row.b) : row.b} style={{ display: "flex", userSelect: "text", borderTopWidth: 1, borderColor: p.raised2 }}>
            <div style={{ width: FIRST_COLUMN, flexShrink: 0, color: p.muted, ...cell }}>{addresses(row.a)}</div>
            <div style={{ flexGrow: 1, minWidth: 0, color: list === "strings" ? p.string : p.text3, ...cell }}>{list === "segments" ? rangeText(addresses(row.b)) : row.b}</div>
          </div>
        ))}
      </virtual-list>}
      {rows.length < every.length && <div style={{ flexShrink: 0, paddingTop: 8, paddingBottom: 10, paddingLeft: 8, fontSize: 12, color: p.faint }}>{t("workbench.chrome.showingFirst", { shown: rows.length.toLocaleString(), total: every.length.toLocaleString(), shortcut: `${MOD}K` })}</div>}
    </div>
  );
}

function Centered({ children }: { readonly children: ReactElement }): ReactElement {
  return <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexGrow: 1, minHeight: 0, padding: 24, fontFamily: SANS }}>{children}</div>;
}

/** Strings, imports or segments; only rows near the viewport are built. */
export function TableView({ list }: { readonly list: ListKind }): ReactElement {
  return <Table key={list} list={list} />;
}

export function EmptyPane(): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 300, padding: 24 }}>
      <EmptyState title={t("workbench.chrome.noTabs")} hint={t("workbench.chrome.noTabsHint", { shortcut: `${MOD}K` })} />
    </div>
  );
}
