import { type EventPayload, type PublicInstance, type StyleDesc, useGpuix } from "@gpuix/react";
import { type ReactElement, type RefObject, useEffect, useMemo, useRef, useState } from "react";

import { colorize, type Syntax, tokenize } from "../components/code";
import { type Span, useSpans } from "../components/highlight";
import { ErrorCard, Tooltip } from "../components/kit";
import { groups, openMenu } from "../components/ContextMenu";
import { Icon } from "../components/ui";
import { LIGHT, type Palette, scrollbar, useTheme } from "../theme";
import { useListWindow } from "../lib/useListWindow";
import { useLoaded } from "../lib/useLoaded";
import { showAddress, syntaxFor, useCodeLook } from "../settings/look";
import { type Settings, useSettings } from "../settings/store";
import { useCommand } from "../lib/shortcuts";
import { copyText } from "../settings/actions";
import { goTo, isFunction, menuGroups, subjectMenu } from "./actions";
import { type Cell, cellAt, chunksOf, columnAt, contentWidth, lineText, spansOf } from "./lineCells";
import { currentMatch, FindBar, lineMatcher } from "./Find";
import { arrowSvg, LANE_WIDTH, laneCount, type LanePiece, layoutJumps, piecesByLine } from "./arrows";
import type { HexRow } from "./model";
import { type Bench, useBench } from "./parts";
import { DALVIK } from "../engine/jadx";
import { t } from "../i18n";
import { formatOperand, isOperandFormat, type Lookup, type Symbolic } from "../engine/operands";
import type { LineRange } from "./state";
import { lineAddress, splitWords, type Subject, type Token, wordAddress } from "./subject";
import { primaryHeld } from "../lib/platform";
import { type AskRow, PinDot, useAskRows } from "./ask/AskThread";
import { codePlace } from "./ask/place";

type View = "pseudo" | "asm";


function isPicked(selected: Subject | null, fn: string, view: View, number: number, addr: string | null): boolean {
  if (selected?.kind !== "line" || selected.fn !== fn || selected.view !== view) return false;
  return selected.number === number || (selected.number < 0 && addr !== null && selected.addr === addr);
}

const GUTTER_WIDTH = 50;
const SYMBOL = /(?:\b(?:DAT|FUN|LAB|PTR|sym|reloc|fcn)[._][\w.$]+)|(?:\b_[A-Za-z][\w$]{2,})|(?:\b0x[0-9a-f]{5,}\b)/gi;

/** In linked view, a line matches the line picked in the other view when they name the same symbol or address. */
export function linkedMatch(picked: string, text: string): boolean {
  const names = picked.match(SYMBOL) ?? [];
  const lower = text.toLowerCase();
  return names.some((name) => lower.includes(name.toLowerCase()));
}

function inRange(range: LineRange | null, fn: string, view: View, number: number): boolean {
  return range !== null && range.fn === fn && range.view === view && number >= range.from && number <= range.to;
}

/** Cmd-A picks every line of the open function and Cmd-C copies the picked lines as plain text. */
function useCopyLines(fn: string, view: View, lines: readonly string[]): void {
  const { wb } = useBench();
  useCommand("selectAll", () => wb.patch({ lineRange: { fn, view, from: 1, to: lines.length } }));
  useCommand("copy", () => {
    const range = wb.s.lineRange;
    if (range?.fn !== fn || range.view !== view) return;
    void copyText(lines.slice(range.from - 1, range.to).join("\n"));
  });
}

function lineTint(found: Found, picked: boolean, ranged: boolean, p: Palette): StyleDesc {
  if (found === "current" || ranged) return { backgroundColor: p.sel2 };
  if (picked) return { backgroundColor: p.raised };
  return found === "match" ? { backgroundColor: p.fill } : {};
}

/** The lines matching the find bar, the current one, and a scroll to it whenever it changes. */
function useFind(lines: readonly string[], list: RefObject<PublicInstance | null>): { readonly matches: ReadonlySet<number>; readonly current: number; readonly count: number; readonly problem: string | null } {
  const { renderer } = useGpuix();
  const { wb } = useBench();
  const { finding, findQuery, findMode, findAt } = wb.s;
  const { hits, problem } = useMemo(() => {
    const matcher = finding ? lineMatcher(findQuery, findMode) : { kind: "empty" } as const;
    if (matcher.kind === "bad") return { hits: [], problem: matcher.why };
    if (matcher.kind === "empty") return { hits: [], problem: null };
    return { hits: lines.flatMap((line, ix) => (matcher.test(line) ? [ix] : [])), problem: null };
  }, [lines, finding, findQuery, findMode]);
  const current = hits[currentMatch(findAt, hits.length)] ?? -1;
  useEffect(() => {
    const id = list.current?.id;
    if (current >= 0 && id !== undefined) renderer?.scrollToItem?.(id, current, -80);
  }, [current]);
  return { matches: new Set(hits), current, count: hits.length, problem };
}

/** The word you clicked in this function; every use of it lights up, like Hopper. */
export function highlightedWord(selected: Subject | null, fn: string): string | null {
  return selected?.kind === "line" && selected.fn === fn ? (selected.token?.text ?? null) : null;
}

function JumpMargin({ pieces, lanes, height, active }: { readonly pieces: readonly LanePiece[]; readonly lanes: number; readonly height: number; readonly active: ReadonlySet<number> }): ReactElement {
  const { p } = useTheme();
  const width = lanes * LANE_WIDTH + 6;
  const quiet = pieces.filter((piece) => !active.has(piece.jump));
  const lit = pieces.filter((piece) => active.has(piece.jump));
  const layer = { position: "absolute", top: 0, left: 0, width, height } as const;
  return (
    <div aria-hidden style={{ position: "relative", width, height, flexShrink: 0 }}>
      {quiet.length > 0 && <svg source={arrowSvg(quiet, lanes, height)} style={{ ...layer, color: p.gutter }} />}
      {lit.length > 0 && <svg source={arrowSvg(lit, lanes, height)} style={{ ...layer, color: p.link }} />}
    </div>
  );
}

type Found = "no" | "match" | "current";

function sameAddress(a: string, b: string): boolean {
  const bare = (addr: string): string => addr.toLowerCase().replace(/^0x/, "").replace(/^0+/, "");
  return bare(a) === bare(b);
}

/** A red dot in the margin of an instruction: click to stop the debugger there. An arrow marks where it is paused. */
function Breakpoint({ addr, paused }: { readonly addr: string | null; readonly paused: boolean }): ReactElement {
  const { p } = useTheme();
  const { wb } = useBench();
  const on = addr !== null && wb.s.breakpoints.has(addr);
  if (addr === null) return <div style={{ width: 22, flexShrink: 0 }} />;
  return (
    <div onClick={() => wb.toggleBreakpoint(addr)} role="button" aria-label={t("workbench.view.code.breakpointAt", { addr })} aria-selected={on} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, flexShrink: 0, cursor: "pointer", hover: { opacity: 0.72 } }}>
      {paused ? <Icon name="play" size={11} color={on ? p.error : p.data} /> : <div style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: on ? p.error : "transparent", pointerEvents: "none" }} />}
    </div>
  );
}

/** The bytes of the instruction at `addr`, up to the next instruction, from rows of 16. */
export function instructionBytes(rows: readonly HexRow[], addr: string, next: string | null): string {
  const at = Number.parseInt(addr, 16);
  const end = next ? Math.min(Number.parseInt(next, 16), at + 15) : at + 4;
  const out: string[] = [];
  for (let byte = at; byte < end; byte += 1) {
    const row = rows.find((r) => byte >= Number.parseInt(r.addr, 16) && byte < Number.parseInt(r.addr, 16) + 16);
    const pair = row?.bytes.split(" ")[byte - Number.parseInt(row.addr, 16)];
    if (!pair) break;
    out.push(pair);
  }
  return out.join(" ");
}

const HEX_ADDRESS = /^0x[0-9a-f]+$/i;

/** Names to show a number against: functions by their current name, strings by their text. */
function lookupIn(bench: Bench): Lookup {
  const named = (): readonly Symbolic[] => [
    ...bench.program.functions.map((fn) => ({ start: BigInt(fn.addr), name: bench.nameOf(fn.addr) })),
    ...bench.program.strings.filter((row) => HEX_ADDRESS.test(row.a)).map((row) => ({ start: BigInt(row.a), name: JSON.stringify(row.b.length > 24 ? `${row.b.slice(0, 24)}…` : row.b) })),
  ];
  return {
    at: (value) => named().find((entry) => entry.start === value)?.name ?? null,
    below: (value) => named().reduce<Symbolic | null>((best, entry) => (entry.start <= value && (!best || entry.start > best.start) ? entry : best), null),
  };
}

function Line({ fn, view, text, number, focused, margin, found = "no", spans = null, bytes = null, ask = null, onAdvance = null }: { readonly fn: string; readonly view: View; readonly text: string; readonly number: number; readonly focused: boolean; readonly margin: ReactElement | null; readonly found?: Found; readonly spans?: readonly Span[] | null; readonly bytes?: string | null; readonly ask?: AskRow | null; readonly onAdvance?: ((advance: number) => void) | null }): ReactElement {
  const { p } = useTheme();
  const { renderer } = useGpuix();
  const bench = useBench();
  const { addrOf, nameOf, openFn, wb } = bench;
  const { settings } = useSettings();
  const look = useCodeLook();
  const syntax: Syntax = view === "asm" ? "asm" : "c";
  const here = view === "asm" ? lineAddress(text) : null;
  const format = here ? wb.s.formats.get(here) : undefined;
  const read = isOperandFormat(format) ? formatOperand(text, format, lookupIn(bench)) : text;
  const parts = read.length === 0 ? [] : spans ? colorize(read, spans, p) : tokenize(read, syntax, p, syntaxFor(settings.colorScheme, p));
  const gutter = view === "asm" || settings.lineNumbers;
  const sel = wb.s.selected;
  const linked = wb.s.linked && sel?.kind === "line" && sel.fn === fn && sel.view !== view && linkedMatch(sel.text, text);
  const picked = sel ? isPicked(sel, fn, view, number, here) || linked : focused;
  const paused = here !== null && wb.s.debugPc !== null && sameAddress(here, wb.s.debugPc);
  const comment = here ? wb.s.comments.get(here) : undefined;
  const subject = (token: Token | null): Subject => ({ kind: "line", fn, view, number, text, addr: here, token });
  const ranged = inRange(wb.s.lineRange, fn, view, number);
  const pick = (token: Token | null, event?: EventPayload): void => {
    const target = token?.addr;
    if (primaryHeld(event?.modifiers) && target) {
      if (event?.modifiers?.alt && isFunction(bench, target)) wb.openSplit({ kind: "fn", addr: target });
      else if (isFunction(bench, target)) openFn(target, false);
      else goTo(bench, target);
      return;
    }
    const anchor = sel?.kind === "line" && sel.fn === fn && sel.view === view ? sel.number : null;
    if (event?.modifiers?.shift && anchor !== null) {
      wb.patch({ lineRange: { fn, view, from: Math.min(anchor, number), to: Math.max(anchor, number) }, asking: null });
      return;
    }
    wb.patch({ lineRange: null, asking: null });
    wb.select(subject(token));
  };
  const word = (text: string): Token => ({ text, addr: addrOf(text) ?? wordAddress(text) });
  // One element for the whole line, not one per word: a word div with its own
  // menu handlers cost about 20 elements a line, which was a third of the
  // frame budget with the listing open. Colours ride along as `spans`, and a
  // click finds its word by column, exact because the code font is monospace.
  const cells: readonly Cell[] = parts.flatMap((part): readonly Cell[] => {
    if (part.kind === "text") {
      return splitWords(part.text).map(({ text: piece, word: isWord }) => {
        const token = isWord ? word(piece) : null;
        const renamed = token?.addr && !addrOf(token.text) ? wb.s.names.get(token.addr) : undefined;
        const shown = here !== null && token?.addr === here ? `${showAddress(here, settings)}${piece.endsWith(":") ? ":" : ""}` : piece;
        return { text: renamed ?? shown, color: renamed ? p.data : part.color, token, opens: null };
      });
    }
    const target = addrOf(part.text);
    const token = target ? { text: part.text, addr: target } : word(part.text);
    return [{ text: target ? nameOf(target) : part.text, color: target ? p.link : p.call, token, opens: target }];
  });
  // Links keep an element each so they can carry a label, a tooltip and their
  // own click; everything else merges into one. A line has one or two links,
  // so a row costs a handful of elements instead of one per word.
  const chunks = chunksOf(cells);
  /** The cell under a click, by column: text width over character count is the advance, so no measuring. */
  const cellUnder = (run: readonly Cell[], event: EventPayload): Cell | null => {
    const id = event.elementId;
    const box = id === undefined ? null : renderer?.getElementBounds?.(id);
    const drawn = lineText(run);
    if (!box) return run[0] ?? null;
    if (drawn.length > 0 && box.width > 0) onAdvance?.(box.width / drawn.length);
    return cellAt(run, columnAt(box, event.x ?? 0, drawn.length)) ?? run[0] ?? null;
  };
  const menuFor = (cell: Cell | null, event: EventPayload): void => {
    if (cell) wb.select(subject(cell.token));
    openMenu(event.x ?? 0, event.y ?? 0, groups(...menuGroups(bench, subject(cell?.token ?? null))));
  };
  const onRunClick = (run: readonly Cell[]) => (event: EventPayload): void => {
    const cell = cellUnder(run, event);
    if (event.modifiers?.ctrl) return menuFor(cell, event);
    pick(cell?.token ?? null, event);
  };
  const onRunMenu = (run: readonly Cell[]) => (event: EventPayload): void => {
    if (event.isRightClick) menuFor(cellUnder(run, event), event);
  };
  const row = (
    <div role="row" aria-label={t("workbench.view.line", { number })} aria-selected={picked} style={{ display: "flex", userSelect: "text", fontFamily: look.family, fontSize: look.size, lineHeight: look.lineHeight, ...lineTint(found, picked, ranged, p), ...(paused ? { backgroundColor: p.sel2 } : {}) }}>
      {view === "asm" && <Breakpoint addr={here} paused={paused} />}
      {gutter ? <div {...subjectMenu(bench, subject(null), (event) => pick(null, event))} style={{ position: "relative", display: "flex", justifyContent: "flex-end", width: GUTTER_WIDTH, flexShrink: 0, paddingRight: 16, color: picked ? p.text : p.gutter, userSelect: "none" }}>{ask?.pinned && <PinDot />}{String(number)}</div> : <div {...subjectMenu(bench, subject(null), (event) => pick(null, event))} style={{ width: 16, flexShrink: 0 }} />}
      {margin}
      {bytes !== null && <div style={{ width: 104, flexShrink: 0, color: p.faint, whiteSpace: "nowrap", overflow: "hidden" }}>{bytes}</div>}
      <div style={{ display: "flex", whiteSpace: "nowrap" }}>
        {chunks.length === 0 && <div {...subjectMenu(bench, subject(null), (event) => pick(null, event))}> </div>}
        {chunks.map((chunk, ix) => {
          if (chunk.kind === "own") {
            const { cell } = chunk;
            const target = cell.opens;
            if (!target) {
              return <div key={ix} {...subjectMenu(bench, subject(cell.token), (event) => pick(cell.token, event))} style={{ color: cell.color, whiteSpace: "nowrap" }}>{cell.text}</div>;
            }
            return (
              <Tooltip key={ix} label={t("workbench.view.code.goTo", { name: cell.text })} side="top">
                <div {...subjectMenu(bench, subject(cell.token), () => openFn(target, false))} role="link" aria-label={t("workbench.view.open", { name: cell.text })} style={{ color: cell.color, whiteSpace: "nowrap", textDecoration: "underline", cursor: "pointer" }}>{cell.text}</div>
              </Tooltip>
            );
          }
          return (
            <div key={ix} onClick={onRunClick(chunk.cells)} onAuxClick={onRunMenu(chunk.cells)} spans={spansOf(chunk.cells)} style={{ color: p.text3, whiteSpace: "nowrap" }}>{lineText(chunk.cells)}</div>
          );
        })}
        {comment && <div style={{ color: p.comment, whiteSpace: "nowrap" }}>{`   ; ${comment}`}</div>}
      </div>
      {ask?.bar}
      <div {...subjectMenu(bench, subject(null), (event) => pick(null, event))} style={{ flexGrow: 1, minWidth: 24 }} />
    </div>
  );
  return ask?.below ? <div style={{ display: "flex", flexDirection: "column" }}>{row}{ask.below}</div> : row;
}

/**
 * The word as the line draws it: a renamed symbol under its new name, and an
 * instruction's own address in the format the view shows. The highlight
 * searches drawn text, so a query built from the raw token would miss.
 */
function drawnWord(bench: Bench, settings: Settings, selected: Subject | null, fn: string): string | null {
  if (selected?.kind !== "line" || selected.fn !== fn) return null;
  const token = selected.token;
  if (!token) return null;
  if (!token.addr) return token.text;
  if (selected.addr && sameAddress(token.addr, selected.addr)) return showAddress(token.addr, settings);
  return bench.nameOf(token.addr);
}

/** Jumps and selection for one function's lines, shared by the scrolling view and the whole-file listing. */
function useJumpMargin(fn: string, view: View, lines: readonly string[], lineHeight: number): (index: number) => ReactElement | null {
  const { wb } = useBench();
  const jumps = useMemo(() => (view === "asm" ? layoutJumps(lines) : []), [lines, view]);
  const pieces = useMemo(() => piecesByLine(jumps, lines.length), [jumps, lines.length]);
  const lanes = laneCount(jumps);
  const selected = wb.s.selected;
  const pickedIndex = selected?.kind === "line" && selected.fn === fn ? selected.number - 1 : -1;
  const active = new Set(jumps.flatMap((jump, index) => (jump.from === pickedIndex || jump.to === pickedIndex ? [index] : [])));
  return (index) => (lanes > 0 ? <JumpMargin pieces={pieces[index] ?? []} lanes={lanes} height={lineHeight} active={active} /> : null);
}

/** One function's assembly without its own scrolling, for the whole-file listing. */
export function StaticLines({ fn, lines }: { readonly fn: string; readonly lines: readonly string[] }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { settings } = useSettings();
  const margin = useJumpMargin(fn, "asm", lines, useCodeLook().lineHeight);
  // The listing draws whole functions without a list of its own, so it
  // declares the picked name's highlight the same way the scrolling view does.
  const lit = drawnWord(bench, settings, bench.wb.s.selected, fn);
  return (
    <div {...(lit ? { highlight: { query: lit, wholeWord: true, caseSensitive: true, color: p.sel2 } } : {})} style={{ display: "flex", flexDirection: "column" }}>
      {lines.map((line, ix) => <Line key={ix} fn={fn} view="asm" text={line} number={ix + 1} focused={false} margin={margin(ix)} />)}
    </div>
  );
}

/** When something asked to show an address in this function, scroll to its line and pick it properly. */
function useScrollToPicked(fn: string, lines: readonly string[]): RefObject<PublicInstance | null> {
  const { renderer } = useGpuix();
  const { wb } = useBench();
  const list = useRef<PublicInstance | null>(null);
  const selected = wb.s.selected;
  useEffect(() => {
    if (selected?.kind !== "line" || selected.fn !== fn || selected.number >= 0 || !selected.addr) return;
    const index = lines.findIndex((line) => lineAddress(line) === selected.addr);
    const id = list.current?.id;
    if (index < 0 || id === undefined) return;
    renderer?.scrollToItem?.(id, index, -80);
    wb.select({ ...selected, number: index + 1, text: lines[index] ?? "" });
  }, [selected, lines]);
  return list;
}

function Lines({ fn, view, lines, focusLine }: { readonly fn: string; readonly view: View; readonly lines: readonly string[]; readonly focusLine: number }): ReactElement {
  const look = useCodeLook();
  const { lineHeight } = look;
  const { p } = useTheme();
  const { settings } = useSettings();
  const eleven = settings.colorScheme === "Eleven";
  const painted = useSpans(view === "pseudo" && eleven ? lines : [], p === LIGHT ? "light" : "dark");
  const shown = useListWindow(lines.length);
  const list = useScrollToPicked(fn, lines);
  const margin = useJumpMargin(fn, view, lines, lineHeight);
  const { wb } = useBench();
  const find = useFind(lines, list);
  useCopyLines(fn, view, lines);
  const bench = useBench();
  const { program } = bench;
  const askRow = useAskRows(useMemo(() => codePlace(bench, fn, view), [fn, view, bench.nameOf(fn), program.name]), lines);
  const withBytes = view === "asm" && wb.s.showBytes;
  const hex = useLoaded<readonly HexRow[]>(() => (withBytes ? program.hex(fn) : Promise.resolve([])), `${program.id}:${fn}:bytes:${withBytes}`);
  const addrs = useMemo(() => lines.map((line) => lineAddress(line)), [lines]);
  const bytesOf = (index: number): string | null => {
    const at = addrs[index];
    if (!withBytes || !at) return null;
    const next = addrs.slice(index + 1).find((a) => a !== null) ?? null;
    return hex.kind === "ready" ? instructionBytes(hex.value, at, next) : "";
  };
  const found = (index: number): Found => (index === find.current ? "current" : find.matches.has(index) ? "match" : "no");
  // The picked name lights up through one search over the list. Declaring a
  // highlight per row instead makes the native search resolve every row
  // separately, which took the whole view from milliseconds to seconds.
  const lit = drawnWord(bench, settings, wb.s.selected, fn);
  // A click measures the advance exactly; until one lands, a monospace glyph
  // is near enough to size the rows.
  const [advance, setAdvance] = useState(0);
  useEffect(() => setAdvance(0), [look.family, look.size]);
  const noteAdvance = (measured: number): void => setAdvance((now) => (Math.abs(now - measured) > 0.01 ? measured : now));
  const wide = useMemo(() => contentWidth(lines, advance || look.size * 0.62, GUTTER_WIDTH), [lines, advance, look.size]);
  return (
    <>
      {wb.s.finding && <FindBar count={find.count} problem={find.problem} />}
      <virtual-list ref={list} itemCount={lines.length} windowStart={shown.start} estimatedItemHeight={lineHeight} onVisibleRange={shown.onVisibleRange} contentWidth={wide} {...(lit ? { highlight: { query: lit, wholeWord: true, caseSensitive: true, color: p.sel2 } } : {})} style={{ flexGrow: 1, minHeight: 0, overflowX: "scroll", paddingTop: 10, paddingBottom: 28, fontFamily: look.family, fontSize: look.size, lineHeight, ...scrollbar(p) }}>
        {lines.slice(shown.start, shown.end).map((line, ix) => (
          <Line key={shown.start + ix} fn={fn} view={view} text={line} number={shown.start + ix + 1} focused={shown.start + ix === focusLine} margin={margin(shown.start + ix)} found={found(shown.start + ix)} spans={painted?.[shown.start + ix] ?? null} bytes={bytesOf(shown.start + ix)} ask={askRow(shown.start + ix + 1)} onAdvance={noteAdvance} />
        ))}
      </virtual-list>
    </>
  );
}

/** A function boundary in the listing: its label, or a step to the function before or after it. */
function Boundary({ fn, lead }: { readonly fn: string; readonly lead: "\u2191" | "\u2193" | "" }): ReactElement {
  const { p } = useTheme();
  const { nameOf, openFn } = useBench();
  const look = useCodeLook();
  return (
    <div onClick={() => openFn(fn, false)} role="button" aria-label={lead === "\u2191" ? t("workbench.view.code.previous", { name: nameOf(fn) }) : lead === "\u2193" ? t("workbench.view.code.next", { name: nameOf(fn) }) : nameOf(fn)} style={{ display: "flex", gap: 10, flexShrink: 0, paddingTop: 4, paddingBottom: 4, paddingLeft: 22, fontFamily: look.family, fontSize: look.size, lineHeight: look.lineHeight, color: p.faint, cursor: "pointer", hover: { opacity: 0.72 } }}>
      <div>{lead}</div>
      <div style={{ color: p.call }}>{`${nameOf(fn)}:`}</div>
      <div>{fn}</div>
    </div>
  );
}

/** The function's neighbours in address order, so the listing reads on across function boundaries. */
function useNeighbours(addr: string): { readonly before: string | null; readonly after: string | null } {
  const { program } = useBench();
  const sorted = useMemo(() => program.functions.map((f) => f.addr).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)), [program]);
  const at = sorted.indexOf(addr);
  return { before: at > 0 ? (sorted[at - 1] ?? null) : null, after: at >= 0 ? (sorted[at + 1] ?? null) : null };
}

function ListingLines({ fn, lines, focusLine }: { readonly fn: string; readonly lines: readonly string[]; readonly focusLine: number }): ReactElement {
  const { before, after } = useNeighbours(fn);
  return (
    <>
      {before && <Boundary fn={before} lead="↑" />}
      <Boundary fn={fn} lead="" />
      <Lines fn={fn} view="asm" lines={lines} focusLine={focusLine} />
      {after && <Boundary fn={after} lead="↓" />}
    </>
  );
}

/** Pseudocode or assembly with a quiet gutter and clickable calls; every word has a menu. Only lines near the viewport are built. */
export function CodeLines({ addr, view }: { readonly addr: string; readonly view: View }): ReactElement {
  const { p } = useTheme();
  const { program, nameOf, wb } = useBench();
  const code = useLoaded(() => program.code(addr, view), `${program.name}:${addr}:${view}:${wb.s.revision}`);
  switch (code.kind) {
    case "loading":
      return <div style={{ padding: 16, color: p.muted }}>{`${program.engine} is reading ${nameOf(addr)}. The first open of a file takes a few seconds.`}</div>;
    case "failed":
      return (
        <div style={{ padding: 16 }}>
          <ErrorCard title={`Couldn't load ${nameOf(addr)}`} detail={view === "pseudo" ? `${program.engine} couldn't decompile it. The ${program.arch === DALVIK ? "bytecode" : "assembly"} view still shows every instruction.` : `${program.engine} couldn't read its instructions. Open the file again, or check Setup.`} raw={code.message} />
        </div>
      );
    case "ready":
      return view === "asm"
        ? <ListingLines key={`${addr}:${view}`} fn={addr} lines={code.value.split("\n")} focusLine={program.focusLine(addr, view)} />
        : <Lines key={`${addr}:${view}`} fn={addr} view={view} lines={code.value.split("\n")} focusLine={program.focusLine(addr, view)} />;
    default: {
      const unhandled: never = code;
      return unhandled;
    }
  }
}
