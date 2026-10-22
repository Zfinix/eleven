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
 * A colour for every character, in UTF-16 units, merged so a run of
 * same-coloured cells costs one span. Covering the whole string matters: an
 * uncoloured gap would be drawn in whatever colour the element inherits.
 */
export function spansOf(cells: readonly Cell[]): readonly Span[] {
  const spans: Span[] = [];
  let at = 0;
  for (const cell of cells) {
    if (cell.text.length === 0) continue;
    const end = at + cell.text.length;
    const last = spans.at(-1);
    if (last && last[2] === cell.color) spans[spans.length - 1] = [last[0], end, cell.color];
    else spans.push([at, end, cell.color]);
    at = end;
  }
  return spans;
}

/** A run of plain cells drawn as one element, or a cell that keeps its own. */
export type Chunk =
  | { readonly kind: "text"; readonly cells: readonly Cell[] }
  | { readonly kind: "own"; readonly cell: Cell };

/** Only printable ASCII has one advance per UTF-16 unit, which is what a click's column arithmetic assumes. A tab can draw wider. */
function fixedWidth(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text);
}

/**
 * Plain cells merge into one element. A call or jump keeps its own so it can
 * carry a label, a tooltip and a click; so does anything that is not plain
 * ASCII, because a wide glyph would throw off every column after it and send
 * a click to the wrong word.
 */
export function chunksOf(cells: readonly Cell[]): readonly Chunk[] {
  const chunks: Chunk[] = [];
  let run: Cell[] = [];
  for (const cell of cells) {
    if (!cell.opens && fixedWidth(cell.text)) {
      run.push(cell);
      continue;
    }
    if (run.length > 0) chunks.push({ kind: "text", cells: run });
    run = [];
    chunks.push({ kind: "own", cell });
  }
  if (run.length > 0) chunks.push({ kind: "text", cells: run });
  return chunks;
}

/**
 * The character a click landed on, from the run's box and its length. Exact
 * because `chunksOf` only ever groups fixed-width text into one element.
 */
export function columnAt(box: { readonly x: number; readonly width: number }, x: number, length: number): number {
  if (length <= 0 || box.width <= 0) return -1;
  return Math.floor((x - box.x) / (box.width / length));
}

/** The cell a column falls in, or null past the end of the run. */
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
 * How wide the rows are, from the longest line. A list measures rows lazily,
 * so it cannot find its own widest row; the view knows the lines.
 */
export function contentWidth(lines: readonly string[], advance: number, gutter: number): number {
  const longest = lines.reduce((most, line) => Math.max(most, line.length), 0);
  return Math.ceil(longest * advance) + gutter + 40;
}
