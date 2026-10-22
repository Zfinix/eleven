import type { Block } from "../engine/dossier";

export const BLOCK_WIDTH = 250;
export const LINE_HEIGHT = 17;
export const MAX_LINES = 8;
const BLOCK_CHROME = 40;
const COLUMN_GAP = 36;
const ROW_GAP = 56;

export type Placed = {
  readonly block: Block;
  readonly lines: readonly string[];
  /** The address of each shown line, in the same order. */
  readonly addrs: readonly string[];
  readonly hidden: number;
  readonly x: number;
  readonly y: number;
  readonly height: number;
};

export type EdgeKind = "taken" | "fallthrough" | "always" | "back";

export type Edge = { readonly from: Placed; readonly to: Placed; readonly kind: EdgeKind };

export type Layout = { readonly blocks: readonly Placed[]; readonly edges: readonly Edge[]; readonly width: number; readonly height: number };

function addressOf(text: string): bigint {
  return BigInt(text);
}

export function linesIn(assembly: readonly string[], block: Block): readonly (readonly [string, string])[] {
  const start = addressOf(block.start);
  const end = addressOf(block.end);
  return assembly.flatMap((line) => {
    const match = /^(0x[0-9a-f]+):\s*(.*)$/i.exec(line);
    if (!match?.[1] || match[2] === undefined) return [];
    const at = addressOf(match[1]);
    return at >= start && at < end ? [[match[1], match[2]] as const] : [];
  });
}

function layers(blocks: readonly Block[]): ReadonlyMap<string, number> {
  const depth = new Map<string, number>(blocks.map((block) => [block.start, 0]));
  for (const block of blocks) {
    const here = depth.get(block.start) ?? 0;
    for (const next of block.successors) {
      if (depth.has(next) && addressOf(next) > addressOf(block.start)) depth.set(next, Math.max(depth.get(next) ?? 0, here + 1));
    }
  }
  return depth;
}

function edgeKind(block: Block, next: string): EdgeKind {
  if (addressOf(next) <= addressOf(block.start)) return "back";
  if (block.successors.length < 2) return "always";
  return next === block.end ? "fallthrough" : "taken";
}

/** Lays basic blocks out in rows by how far they are from the entry, widest row centred. */
export function layoutGraph(blocks: readonly Block[], assembly: readonly string[], maxLines: number = MAX_LINES, lineHeight: number = LINE_HEIGHT): Layout {
  const sorted = [...blocks].sort((a, b) => (addressOf(a.start) < addressOf(b.start) ? -1 : 1));
  const depth = layers(sorted);
  const rows = new Map<number, Block[]>();
  for (const block of sorted) rows.set(depth.get(block.start) ?? 0, [...(rows.get(depth.get(block.start) ?? 0) ?? []), block]);
  const widest = Math.max(1, ...[...rows.values()].map((row) => row.length));
  const width = widest * BLOCK_WIDTH + (widest - 1) * COLUMN_GAP;
  const placed = new Map<string, Placed>();
  let y = 0;
  for (const row of [...rows.keys()].sort((a, b) => a - b).map((key) => rows.get(key) ?? [])) {
    const rowWidth = row.length * BLOCK_WIDTH + (row.length - 1) * COLUMN_GAP;
    const shown = row.map((block) => {
      const lines = linesIn(assembly, block);
      const shown = lines.slice(0, maxLines);
      return { block, lines: shown.map(([, text]) => text), addrs: shown.map(([at]) => at.toLowerCase()), hidden: Math.max(0, lines.length - maxLines) };
    });
    const height = Math.max(...shown.map((item) => BLOCK_CHROME + (item.lines.length + (item.hidden > 0 ? 1 : 0)) * lineHeight));
    shown.forEach((item, ix) => placed.set(item.block.start, { ...item, x: (width - rowWidth) / 2 + ix * (BLOCK_WIDTH + COLUMN_GAP), y, height }));
    y += height + ROW_GAP;
  }
  const edges = sorted.flatMap((block) => {
    const from = placed.get(block.start);
    return from ? block.successors.flatMap((next) => {
      const to = placed.get(next);
      return to ? [{ from, to, kind: edgeKind(block, next) }] : [];
    }) : [];
  });
  return { blocks: [...placed.values()], edges, width, height: Math.max(0, y - ROW_GAP) };
}

export function edgePath(edge: Edge): string {
  const fromX = edge.from.x + BLOCK_WIDTH / 2;
  const fromY = edge.from.y + edge.from.height;
  const toX = edge.to.x + BLOCK_WIDTH / 2;
  const toY = edge.to.y;
  if (edge.kind === "back") {
    const side = Math.max(edge.from.x, edge.to.x) + BLOCK_WIDTH + 18;
    return `M${fromX} ${fromY} C${side} ${fromY + 30} ${side} ${toY - 30} ${toX} ${toY}`;
  }
  const bend = (toY - fromY) / 2;
  return `M${fromX} ${fromY} C${fromX} ${fromY + bend} ${toX} ${toY - bend} ${toX} ${toY}`;
}

export function arrowPath(edge: Edge): string {
  const x = edge.to.x + BLOCK_WIDTH / 2;
  const y = edge.to.y;
  return `M${x - 4} ${y - 7} L${x} ${y} L${x + 4} ${y - 7} Z`;
}

export type EdgeImage = { readonly kind: EdgeKind; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly source: string };

function shifted(path: string, dx: number, dy: number): string {
  return path.replace(/(-?[\d.]+) (-?[\d.]+)/g, (_, x: string, y: string) => `${(Number(x) - dx).toFixed(1)} ${(Number(y) - dy).toFixed(1)}`);
}

/** One small SVG per edge, since one SVG the size of a big graph is too large for GPUI to paint. */
export function edgeImages(layout: Layout): readonly EdgeImage[] {
  return layout.edges.map((edge) => {
    const line = edgePath(edge);
    const numbers = [...line.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    const x = Math.floor(Math.min(...numbers.map(([nx]) => nx))) - 6;
    const y = Math.floor(Math.min(...numbers.map(([, ny]) => ny))) - 8;
    const width = Math.ceil(Math.max(...numbers.map(([nx]) => nx))) + 6 - x;
    const height = Math.ceil(Math.max(...numbers.map(([, ny]) => ny))) + 2 - y;
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="${shifted(line, x, y)}" fill="none" stroke="black" stroke-width="1.4"/><path d="${shifted(arrowPath(edge), x, y)}" fill="black"/></svg>`;
    return { kind: edge.kind, x, y, width, height, source };
  });
}

/** Folds each group into one node at its first block: edges into any member go to the node, edges out leave from it. */
export function foldGroups(blocks: readonly Block[], groups: readonly (readonly string[])[]): readonly Block[] {
  const home = new Map<string, string>();
  for (const members of groups) {
    const first = [...members].sort((a, b) => (addressOf(a) < addressOf(b) ? -1 : 1))[0];
    if (first) for (const member of members) home.set(member, first);
  }
  const target = (addr: string): string => home.get(addr) ?? addr;
  const folded = new Map<string, Block>();
  for (const block of blocks) {
    const start = target(block.start);
    const outward = block.successors.map(target).filter((next) => next !== start || !home.has(block.start));
    const known = folded.get(start);
    const grouped = home.has(block.start);
    folded.set(start, {
      start,
      end: grouped ? start : block.end,
      successors: [...new Set([...(known?.successors ?? []), ...outward])],
    });
  }
  return [...folded.values()];
}
