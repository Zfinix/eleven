import type { Token } from "./subject";

/** One drawn run of a code line: its text, its colour, and what clicking it acts on. */
export type Cell = {
  readonly text: string;
  readonly color: string;
  readonly token: Token | null;
  /** The function address this run opens when clicked, for a call or jump target. */
  readonly opens: string | null;
};

export type Span = readonly [number, number, string];

/** The line as one string, which is what the single text element draws. */
export function lineText(cells: readonly Cell[]): string {
  return cells.map((cell) => cell.text).join("");
}

/**
 * Colour ranges for the whole line, in UTF-16 units, merged so a run of
 * same-coloured cells costs one span. Ranges stay sorted and never overlap,
 * which is what the native `spans` prop requires.
 */
export function spansOf(cells: readonly Cell[], plain: string): readonly Span[] {
  const spans: Span[] = [];
  let at = 0;
  for (const cell of cells) {
    const end = at + cell.text.length;
    const last = spans.at(-1);
    if (cell.color === plain) {
      at = end;
      continue;
    }
    if (last && last[1] === at && last[2] === cell.color) spans[spans.length - 1] = [last[0], end, cell.color];
    else spans.push([at, end, cell.color]);
    at = end;
  }
  return spans;
}

/** The cell a column falls in, or null past the end of the line. */
export function cellAt(cells: readonly Cell[], column: number): Cell | null {
  if (column < 0) return null;
  let at = 0;
  for (const cell of cells) {
    at += cell.text.length;
    if (column < at) return cell;
  }
  return null;
}

/**
 * Every range matching `word`, so the picked name lights up everywhere it
 * appears. Matching is on the word the line holds, not the drawn one, so a
 * renamed symbol still lights up under its new name.
 */
export function wordRanges(cells: readonly Cell[], word: string | null): readonly (readonly [number, number])[] {
  if (!word) return [];
  const ranges: (readonly [number, number])[] = [];
  let at = 0;
  for (const cell of cells) {
    if ((cell.token?.text ?? cell.text) === word) ranges.push([at, at + cell.text.length]);
    at += cell.text.length;
  }
  return ranges;
}

/** A run of plain cells drawn as one element, or a link that keeps its own. */
export type Chunk =
  | { readonly kind: "text"; readonly cells: readonly Cell[] }
  | { readonly kind: "link"; readonly cell: Cell };

/**
 * Plain cells merge into one element; a call or jump keeps its own so it can
 * carry a label, a tooltip and a click of its own. A line has one or two
 * links, so this still costs a handful of elements instead of one per word.
 */
export function chunksOf(cells: readonly Cell[]): readonly Chunk[] {
  const chunks: Chunk[] = [];
  for (const cell of cells) {
    if (cell.opens) {
      chunks.push({ kind: "link", cell });
      continue;
    }
    const last = chunks.at(-1);
    if (last?.kind === "text") chunks[chunks.length - 1] = { kind: "text", cells: [...last.cells, cell] };
    else chunks.push({ kind: "text", cells: [cell] });
  }
  return chunks;
}
