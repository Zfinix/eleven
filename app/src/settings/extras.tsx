import type { LinearGradientBackground } from "@gpuix/react";
import type { ReactElement } from "react";

import { type PlainId, t, thisDevice } from "../i18n";
import { type Appearance, frostRadius, glassTint, MONO, onGlass, scrollbar, useTheme } from "../theme";
import { codeFamily, formatAddress, lineHeightFor, type Syntax, syntaxFor } from "./look";
import { PERMISSION_PRESETS, PERMISSION_TOOLS, type PermissionTable, type Settings } from "./store";

type Part = readonly [string, keyof Syntax | ""];

const CODE: readonly (readonly Part[])[] = [
  [["int ", "kind"], ["check_license", "call"], ["(", ""], ["char", "kind"], [" *key) {", ""]],
  [["  ", ""], ["size_t", "kind"], [" len = ", ""], ["strlen", "call"], ["(key);", ""]],
  [["  ", ""], ["if", "keyword"], [" (len != ", ""], ["16", "number"], [") ", ""], ["return", "keyword"], [" ", ""], ["0", "number"], [";", ""]],
  [["  ", ""], ["// the prefix every valid key starts with", "comment"]],
  [["  ", ""], ["return", "keyword"], [" ", ""], ["verify", "call"], ["(key, ", ""], ["\"ELEVEN-\"", "string"], [");", ""]],
  [["}", ""]],
];

export function CodePreview({ settings }: { readonly settings: Settings }): ReactElement {
  const { p } = useTheme();
  const syntax = syntaxFor(settings.colorScheme, p);
  const size = settings.codeFontSize;
  return (
    <div aria-label={t("settings.preview.code")} style={{ display: "flex", flexDirection: "column", marginTop: 12, paddingTop: 12, paddingBottom: 12, borderRadius: 12, backgroundColor: p.raised, fontFamily: codeFamily(settings.codeFont), fontSize: size, lineHeight: lineHeightFor(size, settings.lineSpacing), overflowX: "scroll", ...scrollbar(p) }}>
      {CODE.map((line, ix) => (
        <div key={ix} style={{ display: "flex", paddingLeft: 16, paddingRight: 16, whiteSpace: "nowrap" }}>
          {settings.lineNumbers && <div style={{ width: 28, flexShrink: 0, marginRight: 16, textAlign: "right", color: p.faint }}>{String(ix + 1)}</div>}
          {line.map(([text, kind], at) => <div key={at} style={{ color: kind === "" ? p.text3 : syntax[kind] }}>{text}</div>)}
        </div>
      ))}
    </div>
  );
}

const ADDRESSES = [[0x100003f2cn, "check_license", "55 48 89 e5"], [0x100003f30n, "verify", "f3 0f 1e fa"], [0x100004088n, "print_usage", "48 83 ec 18"]] as const;

export function AddressPreview({ settings }: { readonly settings: Settings }): ReactElement {
  const { p } = useTheme();
  return (
    <div aria-label={t("settings.preview.address")} style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12, paddingTop: 12, paddingBottom: 12, paddingLeft: 16, paddingRight: 16, borderRadius: 12, backgroundColor: p.raised, fontFamily: MONO, fontSize: 12 }}>
      {ADDRESSES.map(([address, name, bytes]) => (
        <div key={name} style={{ display: "flex", gap: 16, whiteSpace: "nowrap" }}>
          <div style={{ color: p.muted }}>{formatAddress(address, settings)}</div>
          <div style={{ color: "#61afef" }}>{name}</div>
          <div style={{ color: p.faint }}>{settings.addressUpper ? bytes.toUpperCase() : bytes}</div>
        </div>
      ))}
    </div>
  );
}

const WALLPAPER: LinearGradientBackground = {
  type: "linear-gradient",
  angle: 135,
  stops: [{ color: "#4b3bc4", position: 0 }, { color: "#f0874f", position: 1 }],
  colorSpace: "oklab",
};

const GLOWS = [
  { color: "#3fd0c9", place: { top: 18, right: 110 } },
  { color: "#ff5fa2", place: { top: 120, left: 70 } },
] as const;

const LIGHTS = ["#ff5f57", "#febc2e", "#28c840"] as const;

export function WindowPreview({ transparency, frost }: { readonly transparency: number; readonly frost: number }): ReactElement {
  const { p } = useTheme();
  const glass = onGlass(p, transparency);
  const blur = 4 + frostRadius(frost) * 2;
  const bar = (width: string, color: string): ReactElement => <div style={{ height: 5, width, borderRadius: 3, backgroundColor: color, pointerEvents: "none" }} />;
  return (
    <div aria-label={t("settings.preview.window")} style={{ position: "relative", height: 168, marginTop: 12, borderRadius: 12, overflow: "hidden", background: WALLPAPER }}>
      {GLOWS.map((glow) => (
        <div key={glow.color} style={{ position: "absolute", ...glow.place, width: 36, height: 36, borderRadius: 18, backgroundColor: glow.color, boxShadow: { offsetX: 0, offsetY: 0, blurRadius: blur, spreadRadius: blur / 3, color: glow.color }, pointerEvents: "none" }} />
      ))}
      <div style={{ position: "absolute", top: 22, left: 0, right: 0, bottom: -14, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ display: "flex", gap: 6, width: "84%", padding: 6, borderRadius: 10, backgroundColor: glassTint(p, transparency), boxShadow: { offsetX: 0, offsetY: 10, blurRadius: 30, spreadRadius: 0, color: "rgba(0,0,0,0.3)" }, pointerEvents: "none" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, width: "26%", paddingTop: 4, paddingLeft: 4, pointerEvents: "none" }}>
            <div style={{ display: "flex", gap: 5, marginBottom: 6, pointerEvents: "none" }}>
              {LIGHTS.map((color) => <div key={color} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, pointerEvents: "none" }} />)}
            </div>
            {bar("70%", glass.line3)}
            <div style={{ display: "flex", alignItems: "center", height: 15, marginLeft: -4, paddingLeft: 4, borderRadius: 5, backgroundColor: glass.sel2, pointerEvents: "none" }}>{bar("55%", glass.muted)}</div>
            {bar("80%", glass.line3)}
            {bar("60%", glass.line3)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, flexGrow: 1, padding: 12, borderWidth: 1, borderColor: p.sel, borderRadius: 8, backgroundColor: p.card, pointerEvents: "none" }}>
            {bar("34%", p.keyword)}
            {bar("62%", p.line3)}
            {bar("48%", p.string)}
            {bar("70%", p.line3)}
          </div>
        </div>
      </div>
    </div>
  );
}

const THEMES = [
  { value: "Dark", win: ["#171717"], card: ["#0f0f0f"], line: "#3a3a3a" },
  { value: "Light", win: ["#f3f3f1"], card: ["#ffffff"], line: "#d4d4d1" },
  { value: "System", win: ["#171717", "#f3f3f1"], card: ["#0f0f0f", "#ffffff"], line: "#8f8f8f" },
] as const;

function themeLabel(value: Appearance): string {
  switch (value) {
    case "Dark":
      return t("settings.theme.dark");
    case "Light":
      return t("settings.theme.light");
    case "System":
      return t("settings.theme.system", { device: thisDevice() });
    default: {
      const unhandled: never = value;
      return unhandled;
    }
  }
}

function Split({ colors }: { readonly colors: readonly string[] }): ReactElement {
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", pointerEvents: "none" }}>
      {colors.map((color) => <div key={color} style={{ flexGrow: 1, backgroundColor: color, pointerEvents: "none" }} />)}
    </div>
  );
}

export function ThemeCards({ value, onPick }: { readonly value: Appearance; readonly onPick: (next: Appearance) => void }): ReactElement {
  const { p } = useTheme();
  const bar = (width: string, color: string): ReactElement => <div style={{ height: 5, width, borderRadius: 3, backgroundColor: color, pointerEvents: "none" }} />;
  return (
    <div role="radiogroup" aria-label={t("settings.theme")} style={{ display: "flex", gap: 12, marginBottom: 26 }}>
      {THEMES.map((theme) => {
        const on = theme.value === value;
        const label = themeLabel(theme.value);
        return (
          <div key={theme.value} onClick={() => onPick(theme.value)} role="radio" aria-label={label} aria-selected={on} style={{ display: "flex", flexDirection: "column", gap: 10, flexGrow: 1, flexBasis: 0, minWidth: 0, paddingTop: 8, paddingLeft: 8, paddingRight: 8, paddingBottom: 10, borderWidth: 1.5, borderColor: on ? "transparent" : p.line2, borderRadius: 14, cursor: "pointer", hover: { opacity: 0.72 }, ...(on ? { backgroundColor: p.fill } : {}) }}>
            <div style={{ position: "relative", display: "flex", gap: 6, height: 84, padding: 8, borderRadius: 9, overflow: "hidden", pointerEvents: "none" }}>
              <Split colors={theme.win} />
              <div style={{ display: "flex", flexDirection: "column", gap: 5, width: "28%", paddingTop: 4, pointerEvents: "none" }}>
                {bar("80%", theme.line)}
                {bar("60%", theme.line)}
                {bar("70%", theme.line)}
              </div>
              <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 5, flexGrow: 1, padding: 8, borderRadius: 6, overflow: "hidden", pointerEvents: "none" }}>
                <Split colors={theme.card} />
                {bar("50%", "#c678dd")}
                {bar("75%", theme.line)}
                {bar("40%", "#98c379")}
              </div>
            </div>
            <div style={{ paddingLeft: 4, paddingRight: 4, fontWeight: 500, color: p.text }}>{label}</div>
          </div>
        );
      })}
    </div>
  );
}

type PresetId = keyof typeof PERMISSION_PRESETS;

const PRESETS: readonly { readonly id: PresetId; readonly title: PlainId; readonly desc: PlainId }[] = [
  { id: "careful", title: "settings.preset.careful", desc: "settings.preset.careful.desc" },
  { id: "balanced", title: "settings.preset.balanced", desc: "settings.preset.balanced.desc" },
  { id: "free", title: "settings.preset.free", desc: "settings.preset.free.desc" },
];

function sameTable(a: PermissionTable, b: PermissionTable): boolean {
  return PERMISSION_TOOLS.every((tool) => a[tool] === b[tool]);
}

export function PresetCards({ table, onPick }: { readonly table: PermissionTable; readonly onPick: (next: PermissionTable) => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div role="radiogroup" aria-label={t("settings.preset")} style={{ display: "flex", gap: 12, marginBottom: 26 }}>
      {PRESETS.map((preset) => {
        const on = sameTable(table, PERMISSION_PRESETS[preset.id]);
        return (
          <div key={preset.id} onClick={() => onPick(PERMISSION_PRESETS[preset.id])} role="radio" aria-label={t(preset.title)} aria-selected={on} style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1, flexBasis: 0, minWidth: 0, padding: 14, borderWidth: 1.5, borderColor: on ? "transparent" : p.line2, borderRadius: 14, cursor: "pointer", hover: { opacity: 0.72 }, ...(on ? { backgroundColor: p.fill } : {}) }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, pointerEvents: "none" }}>
              <div style={{ width: 14, height: 14, borderRadius: 7, flexShrink: 0, borderWidth: on ? 4 : 1.5, borderColor: on ? p.text : p.line3 }} />
              <div style={{ fontWeight: 600, color: p.text }}>{t(preset.title)}</div>
            </div>
            <div style={{ color: p.muted, fontSize: 12.5, pointerEvents: "none" }}>{t(preset.desc)}</div>
            {preset.id === "balanced" && <div style={{ display: "flex", alignSelf: "flex-start", alignItems: "center", height: 20, paddingLeft: 8, paddingRight: 8, borderRadius: 10, backgroundColor: p.fill2, color: p.text4, fontSize: 11.5, pointerEvents: "none" }}>{t("settings.preset.recommended")}</div>}
          </div>
        );
      })}
    </div>
  );
}
