import type { Fn } from "./model";

export type FnStatus = "added" | "removed" | "both";

/** `renamed` is the new binary's name for a function paired by its code rather than its name. */
export type FnMatch = { readonly name: string; readonly status: FnStatus; readonly left: string | null; readonly right: string | null; readonly renamed?: string };

/** Code for one function, read so functions with no shared name can be paired by what they do. */
export type FnCode = { readonly name: string; readonly addr: string; readonly code: string };

const AUTO_NAME = /^(?:thunk_)?(?:FUN|sub|fcn|func|LAB|loc)[._][0-9a-fA-F]+$/;

/** A name the analyser made up from the address, which says nothing about the function and changes between builds. */
export function isAutoName(name: string): boolean {
  return AUTO_NAME.test(name);
}

/**
 * One assembly line reduced to its shape: mnemonic and registers stay, while
 * addresses, offsets, symbols and comments, which move between builds, become
 * placeholders.
 */
function shapeOf(line: string): string {
  return line
    .replace(/(?:;|\/\/|#\s).*$/, "")
    .replace(/^\s*(?:0x)?[0-9a-fA-F]{6,}\s*:?\s*/, "")
    .replace(/^(?:[0-9a-fA-F]{2}\s)+\s*/, "")
    .replace(/\b(?:FUN|sub|fcn|LAB|DAT|PTR|loc|str|sym|obj)[._][\w.$]+/g, "S")
    .replace(/0x[0-9a-fA-F]+|\b\d+\b/g, "N")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function codeShape(code: string): readonly string[] {
  return code.split("\n").map(shapeOf).filter((line) => line.length > 0);
}

function shingles(shape: readonly string[]): ReadonlySet<string> {
  if (shape.length < 2) return new Set(shape);
  return new Set(shape.slice(1).map((line, ix) => `${shape[ix] ?? ""}\n${line}`));
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared++;
  return shared / (left.size + right.size - shared);
}

function counted(shape: readonly string[]): ReadonlySet<string> {
  const seen = new Map<string, number>();
  return new Set(shape.map((line) => {
    const n = (seen.get(line) ?? 0) + 1;
    seen.set(line, n);
    return `${n}:${line}`;
  }));
}

/** How alike two shapes are, from 0 to 1: half which lines they share, half whether those lines come in the same order. */
export function shapeSimilarity(a: readonly string[], b: readonly string[]): number {
  return (jaccard(counted(a), counted(b)) + jaccard(shingles(a), shingles(b))) / 2;
}

const MIN_SIMILARITY = 0.7;
const MIN_LINES = 4;

export type CodePair = { readonly left: FnCode; readonly right: FnCode; readonly similarity: number };

/**
 * Pairs removed and added functions that hold the same code under different
 * names. Identical shapes pair first, then the closest left over, each
 * function at most once. Tiny functions are skipped: most look alike.
 */
export function pairByCode(removed: readonly FnCode[], added: readonly FnCode[]): readonly CodePair[] {
  const leftShapes = removed.map((fn) => ({ fn, shape: codeShape(fn.code) })).filter((side) => side.shape.length >= MIN_LINES);
  const rightShapes = added.map((fn) => ({ fn, shape: codeShape(fn.code) })).filter((side) => side.shape.length >= MIN_LINES);
  const taken = new Set<string>();
  const pairs: CodePair[] = [];
  const byShape = new Map<string, (typeof rightShapes)[number][]>();
  for (const side of rightShapes) byShape.set(side.shape.join("\n"), [...(byShape.get(side.shape.join("\n")) ?? []), side]);
  const unpaired = leftShapes.filter((side) => {
    const same = byShape.get(side.shape.join("\n"))?.find((other) => !taken.has(other.fn.addr));
    if (!same) return true;
    taken.add(same.fn.addr);
    pairs.push({ left: side.fn, right: same.fn, similarity: 1 });
    return false;
  });
  const candidates = unpaired.flatMap((side) =>
    rightShapes
      .filter((other) => !taken.has(other.fn.addr) && Math.min(side.shape.length, other.shape.length) / Math.max(side.shape.length, other.shape.length) >= MIN_SIMILARITY)
      .map((other) => ({ left: side.fn, right: other.fn, similarity: shapeSimilarity(side.shape, other.shape) }))
      .filter((pair) => pair.similarity >= MIN_SIMILARITY),
  );
  const used = new Set<string>();
  for (const pair of candidates.sort((a, b) => b.similarity - a.similarity)) {
    if (used.has(pair.left.addr) || taken.has(pair.right.addr)) continue;
    used.add(pair.left.addr);
    taken.add(pair.right.addr);
    pairs.push(pair);
  }
  return pairs;
}

/** Turns each removed/added couple that `pairByCode` matched into one function found in both, under its old name. */
export function mergeCodePairs(matches: readonly FnMatch[], pairs: readonly CodePair[]): readonly FnMatch[] {
  const byLeft = new Map(pairs.map((pair) => [pair.left.addr, pair.right]));
  const pairedRight = new Set(pairs.map((pair) => pair.right.addr));
  return matches.flatMap((match): FnMatch[] => {
    if (match.status === "added" && match.right && pairedRight.has(match.right)) return [];
    const right = match.status === "removed" && match.left ? byLeft.get(match.left) : undefined;
    return right ? [{ name: match.name, status: "both", left: match.left, right: right.addr, renamed: right.name }] : [match];
  });
}

export type DiffOp = "same" | "add" | "del";

export type DiffLine = { readonly op: DiffOp; readonly text: string };

/** Pairs two binaries' functions by name: in both, only in the old one (removed), or only in the new one (added). */
export function classifyFunctions(left: readonly Fn[], right: readonly Fn[]): readonly FnMatch[] {
  const rightByName = new Map(right.map((fn) => [fn.name, fn.addr]));
  const seen = new Set<string>();
  const matched: FnMatch[] = left.map((fn) => {
    seen.add(fn.name);
    const other = rightByName.get(fn.name) ?? null;
    return { name: fn.name, status: other ? "both" : "removed", left: fn.addr, right: other };
  });
  const added: FnMatch[] = right.filter((fn) => !seen.has(fn.name)).map((fn) => ({ name: fn.name, status: "added", left: null, right: fn.addr }));
  return [...matched, ...added];
}

/** A line-by-line diff of two texts: which lines are shared, removed from the old, or added in the new. */
export function lineDiff(before: string, after: string): readonly DiffLine[] {
  const a = before.length === 0 ? [] : before.split("\n");
  const b = after.length === 0 ? [] : after.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const rowBelow = lcs[i + 1] ?? [];
    const row = lcs[i] ?? [];
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? (rowBelow[j + 1] ?? 0) + 1 : Math.max(rowBelow[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "same", text: a[i] ?? "" });
      i++;
      j++;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      out.push({ op: "del", text: a[i] ?? "" });
      i++;
    } else {
      out.push({ op: "add", text: b[j] ?? "" });
      j++;
    }
  }
  for (; i < n; i++) out.push({ op: "del", text: a[i] ?? "" });
  for (; j < m; j++) out.push({ op: "add", text: b[j] ?? "" });
  return out;
}

/** The part of an edited line that actually changed, so a review can mark just those characters. */
export type Span = { readonly start: number; readonly end: number };

export type ReviewRow =
  | { readonly kind: "line"; readonly op: DiffOp; readonly text: string; readonly before: number | null; readonly after: number | null; readonly changed: Span | null }
  | { readonly kind: "fold"; readonly at: number; readonly count: number };

export type DiffStats = { readonly added: number; readonly removed: number };

export function diffStats(lines: readonly DiffLine[]): DiffStats {
  return { added: lines.filter((line) => line.op === "add").length, removed: lines.filter((line) => line.op === "del").length };
}

/** Where two versions of a line differ, after their shared start and end; null when nothing is shared. */
export function changedSpan(line: string, other: string): Span | null {
  let start = 0;
  while (start < line.length && start < other.length && line[start] === other[start]) start++;
  let end = 0;
  while (end < line.length - start && end < other.length - start && line[line.length - 1 - end] === other[other.length - 1 - end]) end++;
  if (start === 0 && end === 0) return null;
  return { start, end: line.length - end };
}

/** Pairs each removed line with the added line in the same spot of the change that replaced it. */
function partners(lines: readonly DiffLine[]): ReadonlyMap<number, number> {
  const pairs = new Map<number, number>();
  let i = 0;
  while (i < lines.length) {
    if (lines[i]?.op !== "del") {
      i++;
      continue;
    }
    const dels = i;
    while (lines[i]?.op === "del") i++;
    const adds = i;
    while (lines[i]?.op === "add") i++;
    for (let k = 0; k < Math.min(adds - dels, i - adds); k++) {
      pairs.set(dels + k, adds + k);
      pairs.set(adds + k, dels + k);
    }
  }
  return pairs;
}

/** A diff as a code review shows it: numbers on both sides, edited words marked, long unchanged stretches folded unless opened. */
export function reviewRows(lines: readonly DiffLine[], opened: ReadonlySet<number>, context = 3): readonly ReviewRow[] {
  const pairs = partners(lines);
  const near = lines.map(() => false);
  lines.forEach((line, ix) => {
    if (line.op === "same") return;
    for (let k = Math.max(0, ix - context); k <= Math.min(lines.length - 1, ix + context); k++) near[k] = true;
  });
  const rows: ReviewRow[] = [];
  let before = 0;
  let after = 0;
  let ix = 0;
  while (ix < lines.length) {
    const start = ix;
    while (ix < lines.length && !near[ix] && lines[ix]?.op === "same") ix++;
    const hidden = ix - start;
    if (hidden > 1 && !opened.has(start)) {
      rows.push({ kind: "fold", at: start, count: hidden });
      before += hidden;
      after += hidden;
      continue;
    }
    ix = start + Math.max(hidden, 1);
    for (let k = start; k < ix; k++) {
      const line = lines[k];
      if (!line) continue;
      if (line.op !== "add") before++;
      if (line.op !== "del") after++;
      const other = pairs.get(k);
      const partner = other === undefined ? undefined : lines[other];
      rows.push({
        kind: "line",
        op: line.op,
        text: line.text,
        before: line.op === "add" ? null : before,
        after: line.op === "del" ? null : after,
        changed: partner ? changedSpan(line.text, partner.text) : null,
      });
    }
  }
  return rows;
}

/** A function found in both builds, with how much of its code changed, from 0 (same) to 1 (nothing shared). */
export type FnChange = { readonly name: string; readonly change: number };

/** Functions in both builds ordered by how much their code changed, most first; unchanged ones are left out. */
export function rankChanges(both: readonly { readonly name: string; readonly before: string; readonly after: string }[]): readonly FnChange[] {
  return both
    .map(({ name, before, after }) => ({ name, change: 1 - shapeSimilarity(codeShape(before), codeShape(after)) }))
    .filter((item) => item.change > 0)
    .sort((a, b) => b.change - a.change);
}

/** A diff as a few lines a prompt can carry: only the added and removed lines, up to a limit. */
export function changedLines(before: string, after: string, limit: number): string {
  const lines = lineDiff(before, after).filter((line) => line.op !== "same");
  const shown = lines.slice(0, limit).map((line) => `${line.op === "add" ? "+" : "-"} ${line.text}`);
  return lines.length > limit ? [...shown, `… ${lines.length - limit} more changed lines`].join("\n") : shown.join("\n");
}

/** A name or note from the other build to copy onto a function here. */
export type CarriedMark = { readonly field: "names" | "notes"; readonly addr: string; readonly value: string };

/** Names and notes the other build has on matched functions that this build lacks; nothing already set here is replaced. */
export function carryOver(matches: readonly FnMatch[], from: { readonly names: ReadonlyMap<string, string>; readonly notes: ReadonlyMap<string, string> }, into: { readonly names: ReadonlyMap<string, string>; readonly notes: ReadonlyMap<string, string> }): readonly CarriedMark[] {
  return matches.flatMap((match): CarriedMark[] => {
    if (match.status !== "both" || !match.left || !match.right) return [];
    const here = match.left;
    const name = from.names.get(match.right);
    const note = from.notes.get(match.right);
    return [
      ...(name && !into.names.has(here) ? [{ field: "names" as const, addr: here, value: name }] : []),
      ...(note && !into.notes.has(here) ? [{ field: "notes" as const, addr: here, value: note }] : []),
    ];
  });
}
