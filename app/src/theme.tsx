import type { GpuixTheme, StyleDesc } from "@gpuix/react";
import { createContext, useContext } from "react";

import type { CodeLook, Syntax } from "./settings/look";
import { systemDark as platformDark } from "./lib/platform";

export const SANS = ".SystemUIFont";
export const MONO = "JetBrains Mono";

/** Line height for a code font size: tight enough to read dense disassembly. */
export function codeLineHeight(size: number): number {
  return Math.round(size * 1.5);
}

export type Appearance = "Dark" | "Light" | "System";

export const DARK = {
  win: "#171717",
  glassTile: "rgba(255,255,255,0.07)",
  card: "#0f0f0f",
  deep: "#0b0b0b",
  deep2: "#0d0d0d",
  raised: "#141414",
  raised2: "#1c1c1c",
  well: "#141414",
  fill: "#1f1f1f",
  fill2: "#222222",
  sel: "#262626",
  sel2: "#2e2e2e",
  line2: "#2a2a2a",
  line3: "#3a3a3a",
  text: "#ededed",
  text2: "#dcdcdc",
  text3: "#c8c8c8",
  text4: "#a8a8a8",
  muted: "#8f8f8f",
  faint: "#6b6b6b",
  gutter: "#4a4a4a",
  primary: "#ededed",
  onPrimary: "#0a0a0a",
  link: "#73ade9",
  keyword: "#c678dd",
  string: "#98c379",
  number: "#d19a66",
  kind: "#56b6c2",
  call: "#61afef",
  data: "#e5c07b",
  error: "#e06c75",
  comment: "#5c6370",
  warnBg: "#15130d",
  warnLine: "#3d3522",
  onWarn: "#1a1406",
  errBg: "#160f10",
  errLine: "#3d2226",
  addBg: "rgba(152,195,121,0.09)",
  addMark: "rgba(152,195,121,0.28)",
  delBg: "rgba(224,108,117,0.09)",
  delMark: "rgba(224,108,117,0.28)",
  ring: "rgba(255,255,255,0.08)",
  icon: "icon-dark.png",
};

export type Palette = typeof DARK;

export const LIGHT: Palette = {
  win: "#f3f3f1",
  glassTile: "rgba(0,0,0,0.05)",
  card: "#ffffff",
  deep: "#f6f6f5",
  deep2: "#fafaf9",
  raised: "#f7f7f6",
  raised2: "#f1f1ef",
  well: "#f7f7f6",
  fill: "#ececea",
  fill2: "#e9e9e7",
  sel: "#e6e6e4",
  sel2: "#dfdfdc",
  line2: "#dededb",
  line3: "#cbcbc8",
  text: "#171717",
  text2: "#262626",
  text3: "#3a3a3a",
  text4: "#525252",
  muted: "#6b6b6b",
  faint: "#8f8f8f",
  gutter: "#b8b8b8",
  primary: "#171717",
  onPrimary: "#ffffff",
  link: "#2f6fd0",
  keyword: "#a626a4",
  string: "#50a14f",
  number: "#986801",
  kind: "#0184bc",
  call: "#4078f2",
  data: "#c18401",
  error: "#e45649",
  comment: "#a0a1a7",
  warnBg: "#fff8e6",
  warnLine: "#efd9a6",
  onWarn: "#1a1406",
  errBg: "#fdeeee",
  errLine: "#f1c6ca",
  addBg: "rgba(80,161,79,0.10)",
  addMark: "rgba(80,161,79,0.26)",
  delBg: "rgba(228,86,73,0.09)",
  delMark: "rgba(228,86,73,0.24)",
  ring: "rgba(0,0,0,0.08)",
  icon: "icon-light.png",
};

/** Solid greys pick up the wallpaper's tint through the glass and fade; text there is see-through white (or black), stronger as the window gets clearer. */
/** The scrollbar thumb every scrolling view draws, so long code and lists show where you are. */
export function scrollbar(p: Palette): Pick<StyleDesc, "scrollbarColor" | "scrollbarWidth"> {
  return { scrollbarColor: p.gutter, scrollbarWidth: 6 };
}

export function onGlass(p: Palette, transparency = 30): Palette {
  const dark = p === DARK;
  const clearer = Math.min(1, Math.max(0, (transparency - 30) / 70));
  const tint = (alpha: number, boost = 0): string => `rgba(${dark ? "255,255,255" : "0,0,0"},${Math.min(1, alpha + boost * clearer).toFixed(2)})`;
  const glass = dark
    ? { text: tint(0.92, 0.06), text3: tint(0.86, 0.08), text4: tint(0.74, 0.1), muted: tint(0.64, 0.12), faint: tint(0.5, 0.14), fill: tint(0.07), fill2: tint(0.09), sel: tint(0.09), sel2: tint(0.13), line2: tint(0.1), line3: tint(0.16), well: tint(0.05), glassTile: tint(0.08), errBg: "rgba(224,108,117,0.1)", errLine: "rgba(224,108,117,0.3)" }
    : { text: tint(0.88, 0.08), text3: tint(0.8, 0.1), text4: tint(0.7, 0.12), muted: tint(0.62, 0.14), faint: tint(0.5, 0.16), fill: tint(0.05), fill2: tint(0.07), sel: tint(0.07), sel2: tint(0.1), line2: tint(0.1), line3: tint(0.16), well: tint(0.04), glassTile: tint(0.06), errBg: "rgba(192,57,43,0.07)", errLine: "rgba(192,57,43,0.25)" };
  return { ...p, ...glass };
}

const clamp = (value: number): number => Math.min(100, Math.max(0, value));

/** The window colour laid over the blurred desktop, from solid at transparency 0 to mostly clear at 100. */
export function glassTint(p: Palette, transparency: number): string {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(p.win.slice(at, at + 2), 16));
  const alpha = 1 - (0.7 * clamp(transparency)) / 100;
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

/** Points of blur behind the window for a frost of 0 to 100. */
export function frostRadius(frost: number): number {
  return Math.round(clamp(frost) / 2);
}

let systemDark: boolean | null = null;

/** Asked once: asking the OS blocks the frame loop, and App renders on every chat update. */
export function systemIsDark(): boolean {
  if (systemDark !== null) return systemDark;
  try {
    systemDark = platformDark();
  } catch {
    systemDark = false;
  }
  return systemDark;
}

export function paletteFor(appearance: Appearance): Palette {
  const dark = appearance === "Dark" || (appearance === "System" && systemIsDark());
  return dark ? DARK : LIGHT;
}

export const ThemeContext = createContext<{
  p: Palette;
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
}>({ p: DARK, appearance: "Dark", setAppearance: () => {} });

export const useTheme = () => useContext(ThemeContext);

/** Palette mapped onto GPUIX's native markdown and code components. */
export function nativeTheme(p: Palette, look: Pick<CodeLook, "family" | "size" | "lineHeight">, syntax: Syntax): GpuixTheme {
  return {
    appearance: p === DARK ? "dark" : "light",
    bg: p.card,
    border: p.line2,
    text: p.text2,
    textMuted: p.muted,
    textFaint: p.faint,
    accent: p.link,
    caret: p.text,
    codeText: p.text3,
    codeWash: p.fill,
    fontSans: SANS,
    fontMono: look.family,
    syntax: { comment: syntax.comment, keyword: syntax.keyword, string: syntax.string, number: syntax.number, boolean: syntax.number, typeName: syntax.kind, constructor: syntax.kind, function: syntax.call, constant: p.data, property: p.error },
    metrics: { mdTextSize: 13.5, mdLineHeight: 21, mdBlockGap: 10, mdHeadingSizes: [18, 16, 14.5, 13.5], mdCodeRadius: 8, mdInlineCodeRadius: 4, codeTextSize: look.size, codeLineHeight: look.lineHeight, mdCodeHeaderTextSize: look.size },
  };
}
