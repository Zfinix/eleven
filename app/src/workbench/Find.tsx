import type { EventPayload } from "@gpuix/react";
import { type ReactElement, useState } from "react";

import { fieldLook } from "../components/kit";
import { noteTyping } from "../lib/shortcuts";
import { useTheme } from "../theme";
import { IconButton, MONO_STYLE, SegItem, useBench } from "./parts";
import type { FindMode } from "./state";
import { type PlainId, t } from "../i18n";

export const FIND_MODES: readonly { readonly mode: FindMode; readonly label: PlainId }[] = [
  { mode: "text", label: "workbench.find.text" },
  { mode: "regex", label: "workbench.find.regex" },
  { mode: "hex", label: "workbench.find.hex" },
  { mode: "number", label: "workbench.find.number" },
];

export type Matcher = { readonly kind: "ok"; readonly test: (text: string) => boolean } | { readonly kind: "empty" } | { readonly kind: "bad"; readonly why: string };

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** How a query finds lines: plain text ignores case, a number matches it in hex or decimal, hex bytes match runs of bytes. */
export function lineMatcher(query: string, mode: FindMode): Matcher {
  const q = query.trim();
  if (!q) return { kind: "empty" };
  switch (mode) {
    case "text": {
      const needle = q.toLowerCase();
      return { kind: "ok", test: (text) => text.toLowerCase().includes(needle) };
    }
    case "regex":
      try {
        const pattern = new RegExp(q, "i");
        return { kind: "ok", test: (text) => pattern.test(text) };
      } catch {
        return { kind: "bad", why: t("workbench.find.badPattern") };
      }
    case "number": {
      const value = /^0x[0-9a-f]+$/i.test(q) ? BigInt(q) : /^-?\d+$/.test(q) ? BigInt(q) : null;
      if (value === null) return { kind: "bad", why: t("workbench.find.badNumber") };
      const pattern = new RegExp(`(?:0x0*${value.toString(16)}\\b|#${escape(value.toString(10))}\\b|\\b${escape(value.toString(10))}\\b)`, "i");
      return { kind: "ok", test: (text) => pattern.test(text) };
    }
    case "hex": {
      const bytes = hexBytes(q);
      if (!bytes) return { kind: "bad", why: t("workbench.find.badBytes") };
      const spaced = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
      return { kind: "ok", test: (text) => text.toLowerCase().includes(spaced) };
    }
    default: {
      const unhandled: never = mode;
      return unhandled;
    }
  }
}

/** Bytes typed as hex, spaces optional; null when it isn't whole bytes. */
export function hexBytes(query: string): readonly number[] | null {
  const clean = query.replace(/\s+/g, "").replace(/^0x/i, "");
  if (!clean || clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) return null;
  return (clean.match(/.{2}/g) ?? []).map((pair) => parseInt(pair, 16));
}

/** Where `needle` starts in `bytes`, every time. */
export function byteMatches(bytes: readonly number[], needle: readonly number[]): readonly number[] {
  if (needle.length === 0) return [];
  const found: number[] = [];
  for (let at = 0; at + needle.length <= bytes.length; at++) {
    if (needle.every((byte, ix) => bytes[at + ix] === byte)) found.push(at);
  }
  return found;
}

export type ByteHits = { readonly hits: readonly (readonly [number, number])[]; readonly problem: string | null };

function littleEndian(value: bigint): readonly number[] {
  const size = value < 0x100n ? 1 : value < 0x10000n ? 2 : value < 0x100000000n ? 4 : 8;
  return Array.from({ length: size }, (_, ix) => Number((value >> BigInt(ix * 8)) & 0xffn));
}

/** Matches in raw bytes, as [start, length]: hex runs, text as its characters, numbers as little-endian bytes, regexes over the text column. */
export function findInBytes(bytes: readonly number[], query: string, mode: FindMode): ByteHits {
  const q = query.trim();
  if (!q) return { hits: [], problem: null };
  const runs = (needle: readonly number[]): ByteHits => ({ hits: byteMatches(bytes, needle).map((at) => [at, needle.length] as const), problem: null });
  switch (mode) {
    case "hex": {
      const needle = hexBytes(q);
      return needle ? runs(needle) : { hits: [], problem: t("workbench.find.badBytes") };
    }
    case "text":
      return runs([...q].map((ch) => ch.charCodeAt(0) & 0xff));
    case "number": {
      const value = /^(0x[0-9a-f]+|\d+)$/i.test(q) ? BigInt(q) : null;
      return value === null ? { hits: [], problem: t("workbench.find.badNumber") } : runs(littleEndian(value));
    }
    case "regex": {
      try {
        const pattern = new RegExp(q, "gi");
        const text = String.fromCharCode(...bytes.map((byte) => (byte >= 0x20 && byte < 0x7f ? byte : 0x2e)));
        return { hits: [...text.matchAll(pattern)].filter((m) => m[0].length > 0).map((m) => [m.index ?? 0, m[0].length] as const), problem: null };
      } catch {
        return { hits: [], problem: t("workbench.find.badPattern") };
      }
    }
    default: {
      const unhandled: never = mode;
      return unhandled;
    }
  }
}

/** The current match, wrapped around however many there are. */
export function currentMatch(at: number, count: number): number {
  return count === 0 ? -1 : ((at % count) + count) % count;
}

/** The find strip over a code or hex view: the query, how to read it, and where you are among the matches. */
export function FindBar({ count, problem }: { readonly count: number; readonly problem: string | null }): ReactElement {
  const { p } = useTheme();
  const { wb } = useBench();
  const { s } = wb;
  const [focused, setFocused] = useState(true);
  const at = currentMatch(s.findAt, count);
  const step = (by: number): void => wb.patch({ findAt: s.findAt + by });
  const onKeyDown = (event: EventPayload): void => {
    noteTyping(event);
    if (event.key === "escape") wb.patch({ finding: false });
    if (event.key === "enter" && event.modifiers?.shift) step(-1);
  };
  const status = problem ?? (s.findQuery.trim() === "" ? "" : count === 0 ? t("workbench.find.noMatches") : t("workbench.find.position", { at: at + 1, count }));
  return (
    <div role="search" style={{ display: "flex", alignItems: "center", gap: 8, height: 38, flexShrink: 0, paddingLeft: 12, paddingRight: 8, borderBottomWidth: 1, borderColor: p.fill }}>
      <input autoFocus value={s.findQuery} placeholder={t("workbench.find.placeholder")} aria-label={t("workbench.find.label")} onKeyDown={onKeyDown} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={(e) => wb.patch({ findQuery: e.value ?? "", findAt: 0 })} onSubmit={() => step(1)} style={{ flexGrow: 1, minWidth: 80, maxWidth: 360, height: 26, paddingLeft: 9, paddingRight: 9, borderRadius: 7, backgroundColor: p.deep, fontSize: 12.5, color: p.text, ...MONO_STYLE, ...fieldLook(p, focused, problem !== null) }} />
      <div role="radiogroup" aria-label={t("workbench.find.as")} style={{ display: "flex", gap: 2, padding: 2, borderRadius: 8, backgroundColor: p.raised2 }}>
        {FIND_MODES.map((m) => <SegItem key={m.mode} label={t(m.label)} on={m.mode === s.findMode} onBg={p.sel2} padding={8} onClick={() => wb.patch({ findMode: m.mode, findAt: 0 })} />)}
      </div>
      <div style={{ flexGrow: 1, fontSize: 12, color: problem ? p.error : p.muted, whiteSpace: "nowrap" }}>{status}</div>
      <IconButton icon="back" label={t("workbench.find.previous")} size={24} iconSize={13} onClick={() => step(-1)} />
      <IconButton icon="forward" label={t("workbench.find.next")} size={24} iconSize={13} onClick={() => step(1)} />
      <IconButton icon="close" label={t("workbench.find.close")} size={24} iconSize={12} onClick={() => wb.patch({ finding: false })} />
    </div>
  );
}
