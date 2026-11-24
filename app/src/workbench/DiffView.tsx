import { type ReactElement, useMemo, useState } from "react";

import { type Palette, scrollbar, useTheme } from "../theme";
import { useLoaded } from "../lib/useLoaded";
import { ask } from "./actions";
import { tokenize } from "../components/code";
import { type Syntax as Colors, syntaxFor, useCodeLook } from "../settings/look";
import { useSettings } from "../settings/store";
import { type PlainId, t } from "../i18n";
import { carryOver, changedLines, classifyFunctions, diffStats, isAutoName, lineDiff, mergeCodePairs, pairByCode, rankChanges, reviewRows, type CodePair, type DiffOp, type FnChange, type FnCode, type FnMatch, type FnStatus, type ReviewRow, type Span } from "./diff";
import { HOVER, MONO_STYLE, TextButton, useBench } from "./parts";
import type { Program } from "./model";
import { useProject } from "./useProject";
import { loadProject, updateProject } from "../engine/project";
import { setValue, YOU } from "../engine/edits";

const ASK_CHARS = 4000;

const STATUS_LABEL: Readonly<Record<FnStatus, PlainId>> = { added: "workbench.view.diff.added", removed: "workbench.view.diff.removed", both: "workbench.view.diff.both" };

const MAX_ROWS = 300;

/** How many unmatched functions a side reads to pair by code, and how many reads run at once. */
const MAX_BY_CODE = 200;
const READERS = 4;

async function readAll(program: Program, matches: readonly FnMatch[], side: "left" | "right"): Promise<readonly FnCode[]> {
  const wanted = matches
    .filter((match) => match.status === (side === "left" ? "removed" : "added"))
    .sort((a, b) => Number(isAutoName(b.name)) - Number(isAutoName(a.name)))
    .slice(0, MAX_BY_CODE);
  const out: FnCode[] = [];
  let next = 0;
  const reader = async (): Promise<void> => {
    while (next < wanted.length) {
      const match = wanted[next++];
      const addr = match?.[side];
      if (!match || !addr) continue;
      try {
        out.push({ name: match.name, addr, code: await program.code(addr, "asm") });
      } catch {
        continue;
      }
    }
  };
  await Promise.all(Array.from({ length: READERS }, reader));
  return out;
}

const MAX_RANKED = 300;
const ASK_TOP = 8;
const ASK_DIFFS = 3;
const DIFF_LINES = 40;

type Ranked = { readonly changes: readonly FnChange[]; readonly read: number };

async function rankBoth(program: Program, compare: Program, matches: readonly FnMatch[]): Promise<Ranked> {
  const both = matches.filter((match) => match.status === "both" && match.left && match.right).slice(0, MAX_RANKED);
  const read: { name: string; before: string; after: string }[] = [];
  let next = 0;
  const reader = async (): Promise<void> => {
    while (next < both.length) {
      const match = both[next++];
      if (!match?.left || !match.right) continue;
      try {
        read.push({ name: match.name, before: await program.code(match.left, "asm"), after: await compare.code(match.right, "asm") });
      } catch {
        continue;
      }
    }
  };
  await Promise.all(Array.from({ length: READERS }, reader));
  return { changes: rankChanges(read), read: read.length };
}

/** What the agent needs to say what an update fixed: the most changed functions, and the line diffs of the top few. */
async function updatePrompt(program: Program, compare: Program, matches: readonly FnMatch[], changes: readonly FnChange[]): Promise<string> {
  const top = changes.slice(0, ASK_TOP);
  const list = top.map((item) => `- ${item.name}: ${Math.round(item.change * 100)}% of its code changed`).join("\n");
  const diffs = await Promise.all(top.slice(0, ASK_DIFFS).map(async (item) => {
    const match = matches.find((m) => m.name === item.name && m.status === "both");
    if (!match?.left || !match.right) return "";
    const [before, after] = await Promise.all([program.code(match.left, "pseudo"), compare.code(match.right, "pseudo")]);
    return `${item.name}:\n${changedLines(before, after, DIFF_LINES)}`;
  }));
  return t("workbench.view.diff.updatePrompt", { left: program.name, right: compare.name, list, diffs: diffs.filter(Boolean).join("\n\n") });
}

async function codePairs(program: Program, compare: Program, matches: readonly FnMatch[]): Promise<readonly CodePair[]> {
  const [removed, added] = await Promise.all([readAll(program, matches, "left"), readAll(compare, matches, "right")]);
  return pairByCode(removed, added);
}

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
  const byName = useMemo(() => (compare ? classifyFunctions(program.functions, compare.functions) : []), [program, compare]);
  const paired = useLoaded<readonly CodePair[]>(async () => (compare ? codePairs(program, compare, byName) : []), `${program.id}:${compare?.id ?? ""}:by-code`);
  const pairs = paired.kind === "ready" ? paired.value : [];
  const [ranked, setRanked] = useState<Ranked | "ranking" | null>(null);
  const changeOf = useMemo(() => new Map(ranked && ranked !== "ranking" ? ranked.changes.map((item) => [item.name, item.change]) : []), [ranked]);
  const matches = useMemo(() => [...mergeCodePairs(byName, pairs)].sort((a, b) => RANK[a.status] - RANK[b.status] || (changeOf.get(b.name) ?? 0) - (changeOf.get(a.name) ?? 0)), [byName, pairs, changeOf]);
  const bench = useBench();
  const rank = (): void => {
    if (!compare) return;
    setRanked("ranking");
    void (async (): Promise<void> => {
      try {
        setRanked(await rankBoth(program, compare, matches));
      } catch {
        setRanked(null);
      }
    })();
  };
  const here = useProject(program.id);
  const carried = useMemo(() => (compare ? carryOver(matches, loadProject(compare.id), here) : []), [matches, compare, here]);
  const bringOver = (): void => {
    if (!compare) return;
    updateProject(program.id, (project) => carried.reduce((next, mark) => setValue(next, mark.field, mark.addr, mark.value), project), YOU);
    bench.wb.notify(t("workbench.view.diff.broughtOver", { count: carried.length, from: compare.name }), null);
  };
  const askUpdate = (): void => {
    if (!compare || !ranked || ranked === "ranking") return;
    void (async (): Promise<void> => ask(bench, await updatePrompt(program, compare, matches, ranked.changes)))();
  };
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
        <div style={{ flexShrink: 0, color: p.faint, fontSize: 11.5 }}>{paired.kind === "loading" ? t("workbench.view.diff.pairing") : pairs.length > 0 ? t("workbench.view.diff.paired", { count: pairs.length }) : ""}</div>
        {carried.length > 0 && <TextButton label={t("workbench.view.diff.bringOver", { count: carried.length, from: compare.name })} tone="outline" onClick={bringOver} />}
        {ranked === null && <TextButton label={t("workbench.view.diff.rank")} tone="outline" onClick={rank} />}
        {ranked === "ranking" && <div style={{ flexShrink: 0, color: p.faint, fontSize: 11.5 }}>{t("workbench.view.diff.ranking")}</div>}
        {ranked && ranked !== "ranking" && ranked.changes.length > 0 && <TextButton label={t("workbench.view.diff.askUpdate")} tone="outline" onClick={askUpdate} />}
        <TextButton label={t("workbench.view.diff.pickAnother")} tone="outline" onClick={openCompare} />
      </div>
      <div style={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
        <div style={{ width: 280, flexShrink: 0, overflow: "scroll", ...scrollbar(p), paddingLeft: 6, paddingRight: 6, paddingBottom: 8 }}>
          {matches.slice(0, MAX_ROWS).map((match) => (
            <div key={`${match.name}:${match.status}`} onClick={() => setSelected(match)} role="option" style={{ ...row, ...(selected?.name === match.name && selected.status === match.status ? { backgroundColor: p.sel } : {}) }}>
              <div style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: p.text }}>{match.renamed && match.renamed !== match.name ? `${match.name} → ${match.renamed}` : match.name}</div>
              <div style={{ flexShrink: 0, fontSize: 11, color: statusColor(match.status, p) }}>{changeOf.has(match.name) ? t("workbench.view.diff.changedBy", { percent: Math.round((changeOf.get(match.name) ?? 0) * 100) }) : t(match.renamed ? "workbench.view.diff.sameCode" : STATUS_LABEL[match.status])}</div>
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
