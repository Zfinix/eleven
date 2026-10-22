import type { Syntax } from "../../components/code";
import { t } from "../../i18n";
import type { Bench } from "../parts";
import type { LineRange, UiState, Workbench } from "../state";

/** A code view that can be asked about: which lines it holds, how to describe and quote them, and where pins go. */
export type AskPlace = {
  readonly fn: string;
  readonly view: LineRange["view"];
  readonly about: string;
  readonly fence: string;
  readonly syntax: Syntax;
  /** The function whose note keeps pinned answers; null where nothing can be pinned. */
  readonly owner: string | null;
  /** How a pinned answer names this view, like "pseudocode". */
  readonly label: string;
};

export function codePlace(b: Bench, fn: string, view: "pseudo" | "asm"): AskPlace {
  const what = view === "asm" ? "its assembly" : "its decompiled pseudocode";
  return { fn, view, about: `${b.nameOf(fn)} (at ${fn}) in ${b.program.name}, ${what}`, fence: view === "asm" ? "asm" : "c", syntax: view === "asm" ? "asm" : "c", owner: fn, label: view === "asm" ? "listing" : "pseudocode" };
}

/** A rewrite of `fn` in another language; its pins go in the function's note like the pseudocode's. */
export function rewritePlace(b: Bench, fn: string, language: string, syntax: Syntax): AskPlace {
  return { fn: `rewrite:${fn}:${language}`, view: "text", about: `the ${language} rewrite of ${b.nameOf(fn)} (at ${fn}) in ${b.program.name}`, fence: language.toLowerCase(), syntax, owner: fn, label: `${language} rewrite` };
}

/** A whole source file; nothing in it can be pinned, since notes belong to functions. */
export function sourcePlace(file: string, syntax: Syntax): AskPlace {
  const extension = /\.([A-Za-z0-9+]+)$/.exec(file)?.[1]?.toLowerCase();
  return { fn: `source:${file}`, view: "text", about: `the source file ${file}`, fence: extension ?? (syntax === "code" ? "" : syntax), syntax, owner: null, label: "source" };
}

export function rangeText(range: Pick<LineRange, "from" | "to">): string {
  return range.from === range.to ? `line ${range.from}` : `lines ${range.from}–${range.to}`;
}

/** rangeText for the reader, in their language; rangeText stays English for prompts. */
export function rangeLabel(range: Pick<LineRange, "from" | "to">): string {
  return range.from === range.to ? t("ask.range.line", { number: range.from }) : t("ask.range.lines", { from: range.from, to: range.to });
}

/** The lines the Ask bar is for: a picked range, or one line picked by its number or the space around its code. */
export function askRange(s: UiState): LineRange | null {
  if (s.lineRange) return s.lineRange;
  const picked = s.selected;
  if (picked?.kind !== "line" || picked.token !== null || picked.number < 1) return null;
  return { fn: picked.fn, view: picked.view, from: picked.number, to: picked.number };
}

export function sameRange(a: LineRange | null, b: LineRange | null): boolean {
  return a !== null && b !== null && a.fn === b.fn && a.view === b.view && a.from === b.from && a.to === b.to;
}

/** Opens the thread under the Ask bar's lines; false when there is no bar or its thread is already open. */
export function openAsk(wb: Workbench, start: string | null): boolean {
  const range = askRange(wb.s);
  if (!range || sameRange(range, wb.s.asking?.range ?? null)) return false;
  wb.patch({ lineRange: range, asking: { range, start } });
  return true;
}

export function closeAsk(wb: Workbench): void {
  wb.patch({ asking: null });
}
