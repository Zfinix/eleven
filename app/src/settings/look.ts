import { OS, type Os } from "../lib/platform";
import type { Palette } from "../theme";
import { type CodeFont, currentSettings, type Settings, useSettings } from "./store";

export type Syntax = {
  readonly keyword: string;
  readonly call: string;
  readonly string: string;
  readonly number: string;
  readonly kind: string;
  readonly comment: string;
};

const SPACING: Readonly<Record<Settings["lineSpacing"], number>> = { Compact: 1.35, Normal: 1.6, Relaxed: 1.85 };

/** The monospace fonts each system ships, offered next to the bundled JetBrains Mono. */
const SYSTEM_FONTS: Readonly<Record<Os, readonly CodeFont[]>> = {
  mac: ["SF Mono", "Menlo"],
  windows: ["Cascadia Mono", "Consolas"],
  linux: ["DejaVu Sans Mono", "Liberation Mono"],
};

/** The code fonts worth offering on this computer. */
export function codeFontsHere(): readonly CodeFont[] {
  return ["JetBrains Mono", ...SYSTEM_FONTS[OS]];
}

/** A saved font from another system falls back to the bundled one, so code never renders in a missing font. */
export function codeFamily(font: CodeFont): string {
  return codeFontsHere().includes(font) ? font : "JetBrains Mono";
}

export function lineHeightFor(size: number, spacing: Settings["lineSpacing"]): number {
  return Math.round(size * SPACING[spacing]);
}

export function syntaxFor(scheme: Settings["colorScheme"], p: Palette): Syntax {
  switch (scheme) {
    case "Eleven":
      return { keyword: p.keyword, call: p.call, string: p.string, number: p.number, kind: p.kind, comment: p.comment };
    case "Classic":
      return { keyword: "#569cd6", call: "#dcdcaa", string: "#ce9178", number: "#b5cea8", kind: "#4ec9b0", comment: "#6a9955" };
    case "Quiet":
      return { keyword: p.text, call: p.text, string: p.text4, number: p.text4, kind: p.text3, comment: p.faint };
    default: {
      const unhandled: never = scheme;
      return unhandled;
    }
  }
}

export const UI_SCALE: Readonly<Record<Settings["uiSize"], number>> = { Small: 0.92, Default: 1, Large: 1.1 };

/** An address the way Code views asks for it: 0x or not, capital hex digits, padded to 16 digits. */
export function formatAddress(address: bigint | number, s: Pick<Settings, "addressPrefix" | "addressUpper" | "addressPad"> = currentSettings()): string {
  let hex = address.toString(16);
  if (s.addressPad) hex = hex.padStart(16, "0");
  if (s.addressUpper) hex = hex.toUpperCase();
  return `${s.addressPrefix ? "0x" : ""}${hex}`;
}

/** Re-formats an address string such as "0x100003f2c" or "100003f2c" with the Code views settings. */
export function showAddress(text: string, s: Pick<Settings, "addressPrefix" | "addressUpper" | "addressPad"> = currentSettings()): string {
  const bare = text.trim().replace(/^0x/i, "");
  return /^[0-9a-f]+$/i.test(bare) ? formatAddress(BigInt(`0x${bare}`), s) : text;
}

export type CodeLook = {
  readonly family: string;
  readonly size: number;
  readonly lineHeight: number;
  readonly lineNumbers: boolean;
};

/** Font, size and line height for every code view, from Appearance settings. */
export function useCodeLook(): CodeLook {
  const { settings } = useSettings();
  return { family: codeFamily(settings.codeFont), size: settings.codeFontSize, lineHeight: lineHeightFor(settings.codeFontSize, settings.lineSpacing), lineNumbers: settings.lineNumbers };
}
