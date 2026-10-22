import { type ReactElement, useMemo, useState } from "react";

import { type Palette, scrollbar, useTheme } from "../theme";
import { useLoaded } from "../lib/useLoaded";
import { ask } from "./actions";
import { tokenize } from "../components/code";
import { type Syntax as Colors, syntaxFor, useCodeLook } from "../settings/look";
import { useSettings } from "../settings/store";
import { type PlainId, t } from "../i18n";
import { classifyFunctions, diffStats, lineDiff, reviewRows, type DiffOp, type FnMatch, type FnStatus, type ReviewRow, type Span } from "./diff";
import { HOVER, MONO_STYLE, TextButton, useBench } from "./parts";
import type { Program } from "./model";

const ASK_CHARS = 4000;

const STATUS_LABEL: Readonly<Record<FnStatus, PlainId>> = { added: "workbench.view.diff.added", removed: "workbench.view.diff.removed", both: "workbench.view.diff.both" };

const MAX_ROWS = 300;

const RANK: Readonly<Record<FnStatus, number>> = { added: 0, removed: 1, both: 2 };

function statusColor(status: FnStatus, p: ReturnType<typeof useTheme>["p"]): string {
  if (status === "added") return p.string;
  if (status === "removed") return p.error;
  return p.muted;
}

const SIGN: Readonly<Record<DiffOp, string>> = { add: "+", del: "-", same: " " };

type Piece = { readonly text: string; readonly color: string; readonly marked: boolean };

/** A line in code colors, cut again where the edited span starts and ends so that part can be marked. */
function pieces(line: string, mark: Span | null, p: Palette, c: Colors): readonly Piece[] {
  let at = 0;
  return tokenize(line, "c", p, c).flatMap((part) => {
    const from = at;
    const to = at + part.text.length;
    at = to;
    const color = part.kind === "text" ? part.color : p.link;
    const cuts = [...new Set([from, ...(mark ? [mark.start, mark.end] : []), to])].filter((n) => n >= from && n <= to).sort((a, b) => a - b);
    return cuts.slice(1).flatMap((end, k) => {
      const start = cuts[k] ?? from;
      return end > start ? [{ text: line.slice(start, end), color, marked: mark !== null && start >= mark.start && end <= mark.end }] : [];
    });
  });
}

function ReviewLine({ row, width }: { readonly row: Extract<ReviewRow, { kind: "line" }>; readonly width: number }): ReactElement {
  const { p } = useTheme();
  const { colorScheme } = useSettings().settings;
  const tint = row.op === "add" ? p.addBg : row.op === "del" ? p.delBg : null;
  const mark = row.op === "add" ? p.addMark : p.delMark;
  const signColor = row.op === "add" ? p.string : row.op === "del" ? p.error : p.gutter;
  const number = { width, flexShrink: 0, display: "flex", justifyContent: "flex-end", paddingRight: 10, color: p.gutter, userSelect: "none" } as const;
  return (
    <div style={{ display: "flex", ...(tint ? { backgroundColor: tint } : {}) }}>
      <div style={number}>{row.before === null ? "" : String(row.before)}</div>
      <div style={number}>{row.after === null ? "" : String(row.after)}</div>
      <div style={{ width: 18, flexShrink: 0, color: signColor, userSelect: "none" }}>{SIGN[row.op]}</div>
      <div style={{ display: "flex", whiteSpace: "nowrap", paddingRight: 16 }}>
        {row.text.length === 0 ? <div> </div> : pieces(row.text, row.changed, p, syntaxFor(colorScheme, p)).map((piece, k) => (
          <div key={k} style={{ color: piece.color, whiteSpace: "nowrap", ...(piece.marked ? { backgroundColor: mark, borderRadius: 2 } : {}) }}>{piece.text}</div>
        ))}
      </div>
    </div>
  );
}

function FoldRow({ count, width, onOpen }: { readonly count: number; readonly width: number; readonly onOpen: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onOpen} role="button" style={{ display: "flex", alignItems: "center", cursor: "pointer", backgroundColor: p.fill, color: p.muted, marginTop: 2, marginBottom: 2, userSelect: "none", hover: { opacity: 0.72 } }}>
      <div style={{ width: width * 2 + 18, flexShrink: 0, display: "flex", justifyContent: "center" }}>⋯</div>
      <div>{t("workbench.view.diff.unchanged", { count })}</div>
    </div>
  );
}

function DiffLines({ name, left, right, program, compare }: { readonly name: string; readonly left: string; readonly right: string; readonly program: Program; readonly compare: Program }): ReactElement {
  const { p } = useTheme();
  const look = useCodeLook();
  const bench = useBench();
  const before = useLoaded<string>(() => program.code(left, "pseudo"), `${program.id}:${left}:diff`);
  const after = useLoaded<string>(() => compare.code(right, "pseudo"), `${compare.id}:${right}:diff`);
  const old = before.kind === "ready" ? before.value : null;
  const next = after.kind === "ready" ? after.value : null;
  const lines = useMemo(() => (old !== null && next !== null ? lineDiff(old, next) : []), [old, next]);
  const [opened, setOpened] = useState<ReadonlySet<number>>(() => new Set());
  const rows = useMemo(() => reviewRows(lines, opened), [lines, opened]);
  if (old === null || next === null) {
    const failed = before.kind === "failed" ? before.message : after.kind === "failed" ? after.message : null;
    return <div style={{ marginTop: 8, color: failed ? p.error : p.muted }}>{failed ? t("workbench.view.diff.readFailed", { error: failed }) : t("workbench.view.diff.reading")}</div>;
  }
  const { added, removed } = diffStats(lines);
  const identical = added === 0 && removed === 0;
  const digits = String(Math.max(old.split("\n").length, next.split("\n").length)).length;
  const width = Math.round(Math.max(2, digits) * look.size * 0.62) + 16;
  const askChange = (): void =>
    ask(bench, `The function ${name} changed between ${program.name} and ${compare.name}.\n\nOld (${program.name}):\n${old.slice(0, ASK_CHARS)}\n\nNew (${compare.name}):\n${next.slice(0, ASK_CHARS)}\n\nExplain what changed and why it matters.`);
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ flexShrink: 1, minWidth: 0, color: p.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{identical ? t("workbench.view.diff.identical") : t("workbench.view.diff.changed", { name })}</div>
        {!identical && <div style={{ flexShrink: 0, color: p.string, ...MONO_STYLE }}>{`+${added}`}</div>}
        {!identical && <div style={{ flexShrink: 0, color: p.error, ...MONO_STYLE }}>{`-${removed}`}</div>}
        <div style={{ flexGrow: 1 }} />
        <TextButton label={t("workbench.view.diff.ask")} tone="outline" onClick={askChange} />
      </div>
      {!identical && (
        <div style={{ display: "flex", flexDirection: "column", userSelect: "text", fontFamily: look.family, fontSize: look.size, lineHeight: look.lineHeight }}>
          {rows.map((row) => row.kind === "fold"
            ? <FoldRow key={`fold:${row.at}`} count={row.count} width={width} onOpen={() => setOpened(new Set([...opened, row.at]))} />
            : <ReviewLine key={`${row.op}:${row.before ?? ""}:${row.after ?? ""}`} row={row} width={width} />)}
        </div>
      )}
    </div>
  );
}

/** Compares the open binary with another one: which functions were added, removed, or changed, and the line diff of one. */
export function DiffView(): ReactElement {
  const { p } = useTheme();
  const { program, compare, openCompare } = useBench();
  const [selected, setSelected] = useState<FnMatch | null>(null);
  const matches = useMemo(() => {
    if (!compare) return [];
    return [...classifyFunctions(program.functions, compare.functions)].sort((a, b) => RANK[a.status] - RANK[b.status]);
  }, [program, compare]);
  if (!compare) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10, padding: 16 }}>
        <div style={{ color: p.muted, maxWidth: 520 }}>{t("workbench.view.diff.intro", { name: program.name })}</div>
        <TextButton label={t("workbench.view.diff.choose")} tone="primary" onClick={openCompare} />
      </div>
    );
  }
  const added = matches.filter((m) => m.status === "added").length;
  const removed = matches.filter((m) => m.status === "removed").length;
  const row = { display: "flex", alignItems: "center", gap: 10, height: 26, paddingLeft: 8, paddingRight: 8, borderRadius: 6, cursor: "pointer", hover: HOVER, ...MONO_STYLE } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 12, height: 36, flexShrink: 0 }}>
        <div style={{ flexGrow: 1, color: p.muted }}>{t("workbench.view.diff.summary", { left: program.name, right: compare.name, added, removed })}</div>
        <TextButton label={t("workbench.view.diff.pickAnother")} tone="outline" onClick={openCompare} />
      </div>
      <div style={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
        <div style={{ width: 280, flexShrink: 0, overflow: "scroll", ...scrollbar(p), paddingLeft: 6, paddingRight: 6, paddingBottom: 8 }}>
          {matches.slice(0, MAX_ROWS).map((match) => (
            <div key={`${match.name}:${match.status}`} onClick={() => setSelected(match)} role="option" style={{ ...row, ...(selected?.name === match.name && selected.status === match.status ? { backgroundColor: p.sel } : {}) }}>
              <div style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: p.text }}>{match.name}</div>
              <div style={{ flexShrink: 0, fontSize: 11, color: statusColor(match.status, p) }}>{t(STATUS_LABEL[match.status])}</div>
            </div>
          ))}
          {matches.length > MAX_ROWS && <div style={{ paddingLeft: 8, paddingTop: 6, fontSize: 11.5, color: p.faint }}>{t("workbench.view.diff.capped", { shown: MAX_ROWS, count: matches.length })}</div>}
        </div>
        <div style={{ flexGrow: 1, minWidth: 0, overflow: "scroll", ...scrollbar(p), paddingLeft: 12, paddingRight: 12, paddingBottom: 12, borderLeftWidth: 1, borderColor: p.fill }}>
          {!selected && <div style={{ marginTop: 8, color: p.muted }}>{t("workbench.view.diff.pickFunction")}</div>}
          {selected?.status === "added" && <div style={{ marginTop: 8, color: p.muted }}>{t("workbench.view.diff.isNew", { name: selected.name, binary: compare.name })}</div>}
          {selected?.status === "removed" && <div style={{ marginTop: 8, color: p.muted }}>{t("workbench.view.diff.isGone", { name: selected.name, binary: compare.name })}</div>}
          {selected?.status === "both" && selected.left && selected.right && (
            <DiffLines key={selected.name} name={selected.name} left={selected.left} right={selected.right} program={program} compare={compare} />
          )}
        </div>
      </div>
    </div>
  );
}
