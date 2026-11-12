import type { HexRow } from "../workbench/model";

/** Bytes given as one hex string, in rows of 16 from `addr`. */
export function hexRowsOf(raw: string, addr: string): readonly HexRow[] {
  const bytes = (raw.match(/.{2}/g) ?? []).map((pair) => parseInt(pair, 16));
  const base = Number(addr);
  return Array.from({ length: Math.ceil(bytes.length / 16) }, (_, row) => {
    const slice = bytes.slice(row * 16, row * 16 + 16);
    return {
      addr: `0x${(base + row * 16).toString(16)}`,
      bytes: slice.map((b) => b.toString(16).padStart(2, "0")).join(" "),
      ascii: slice.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join(""),
    };
  });
}
