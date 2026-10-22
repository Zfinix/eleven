import { Tooltip as TipRoot, TooltipContent, TooltipTrigger } from "@gpuix/react";
import type { StyleDesc } from "@gpuix/react";
import { type ReactElement, type ReactNode, useState } from "react";

import { t } from "../i18n";
import { dashedOutline, usePaintedSize } from "../lib/dashed";
import { useNow } from "../lib/useNow";
import { MONO, type Palette, SANS, useTheme } from "../theme";
import { Icon } from "./ui";

const HOVER = { opacity: 0.72 } as const;

export type ButtonTone = "primary" | "outline" | "ghost" | "ask" | "warn" | "danger";

export type ButtonSize = "regular" | "compact" | "small";

const HEIGHT: Readonly<Record<ButtonSize, number>> = { regular: 32, compact: 28, small: 26 };

function toneStyle(tone: ButtonTone, p: Palette): StyleDesc {
  switch (tone) {
    case "primary":
      return { backgroundColor: p.primary, color: p.onPrimary, fontWeight: 600 };
    case "outline":
      return { borderWidth: 1, borderColor: p.line2, color: p.text };
    case "ghost":
      return { color: p.text4 };
    case "ask":
      return { borderWidth: 1, borderColor: p.line3, backgroundColor: p.sel, color: p.text };
    case "warn":
      return { backgroundColor: p.data, color: p.onWarn, fontWeight: 600 };
    case "danger":
      return { borderWidth: 1, borderColor: p.errLine, backgroundColor: p.errBg, color: p.error };
    default: {
      const unhandled: never = tone;
      return unhandled;
    }
  }
}

/** The kit's buttons: primary, outline, ghost, ask, warn (permissions) and danger, in three heights. Disabled reads as busy. */
export function Button({ label, tone, size = "regular", icon = null, disabled = false, onClick }: {
  readonly label: string;
  readonly tone: ButtonTone;
  readonly size?: ButtonSize;
  readonly icon?: string | null;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}): ReactElement {
  const { p } = useTheme();
  const look = disabled ? { backgroundColor: p.line2, color: p.faint } : { ...toneStyle(tone, p), cursor: "pointer" as const, hover: HOVER };
  return (
    <div {...(disabled ? {} : { onClick })} role="button" aria-label={label} aria-disabled={disabled} style={{ display: "flex", alignItems: "center", gap: 7, height: HEIGHT[size], paddingLeft: size === "regular" ? 14 : size === "compact" ? 12 : 10, paddingRight: size === "regular" ? 14 : size === "compact" ? 12 : 10, borderRadius: size === "regular" ? 8 : 7, flexShrink: 0, fontSize: size === "small" ? 12 : 13, ...look }}>
      {icon && <Icon name={icon} size={13} color={disabled ? p.faint : (tone === "primary" ? p.onPrimary : p.text3)} />}
      <div style={{ whiteSpace: "nowrap" }}>{label}</div>
    </div>
  );
}

/** One keycap, like ⌘K, bordered as the kit draws it. */
export function Keycap({ text }: { readonly text: string }): ReactElement {
  const { p } = useTheme();
  return (
    <div aria-label={text} style={{ paddingLeft: 6, paddingRight: 6, paddingTop: 1, paddingBottom: 1, borderWidth: 1, borderColor: p.sel2, borderRadius: 5, fontFamily: SANS, fontSize: 11, color: p.text4, flexShrink: 0 }}>
      {text}
    </div>
  );
}

export type BadgeTone = "outline" | "ok" | "neutral" | "mono" | "mention";

/** A small label: a format or arch, a state like Cached, an evidence id, or an @mention. */
export function Badge({ label, tone }: { readonly label: string; readonly tone: BadgeTone }): ReactElement {
  const { p } = useTheme();
  const base = { paddingLeft: 7, paddingRight: 7, paddingTop: 1, paddingBottom: 1, borderRadius: 6, fontSize: 11.5, flexShrink: 0, whiteSpace: "nowrap" } as const;
  const looks: Readonly<Record<BadgeTone, StyleDesc>> = {
    outline: { borderWidth: 1, borderColor: p.sel2, color: p.text4 },
    ok: { color: p.string, backgroundColor: p.sel },
    neutral: { color: p.text, backgroundColor: p.sel },
    mono: { paddingLeft: 8, paddingRight: 8, backgroundColor: p.raised2, fontFamily: MONO, color: p.text3 },
    mention: { paddingLeft: 8, paddingRight: 8, backgroundColor: p.fill2, fontFamily: MONO, color: p.text },
  };
  return <div style={{ ...base, ...looks[tone] }}>{label}</div>;
}

export type DotTone = "ok" | "working" | "stopped" | "changed" | "idle";

export function dotColor(tone: DotTone, p: Palette): string {
  switch (tone) {
    case "ok":
      return p.string;
    case "working":
      return p.data;
    case "stopped":
      return p.error;
    case "changed":
      return p.primary;
    case "idle":
      return p.faint;
    default: {
      const unhandled: never = tone;
      return unhandled;
    }
  }
}

/** A colored dot and a word: Connected, Working, Stopped, Changed by agent. */
export function StatusDot({ tone, label }: { readonly tone: DotTone; readonly label: string }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, color: p.muted }}>
      <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dotColor(tone, p) }} />
      <div style={{ whiteSpace: "nowrap" }}>{label}</div>
    </div>
  );
}

/** The kit's tooltip: a rounded card under the thing you hover, after a short pause. A long label wraps into a few lines. */
export function Tooltip({ label, children, side = "bottom" }: { readonly label: string; readonly children: ReactElement; readonly side?: "top" | "bottom" }): ReactElement {
  const { p } = useTheme();
  return (
    <TipRoot delayDuration={450}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={8} style={{ maxWidth: 280, paddingLeft: 13, paddingRight: 13, paddingTop: 10, paddingBottom: 10, borderRadius: 10, borderWidth: 1, borderColor: p.line2, backgroundColor: p.raised2, color: p.text, fontSize: 13, lineHeight: 19, whiteSpace: "normal", boxShadow: { offsetX: 0, offsetY: 10, blurRadius: 28, spreadRadius: 0, color: "rgba(0,0,0,0.35)" } }}>
        {label}
      </TooltipContent>
    </TipRoot>
  );
}

/** What went wrong in one plain sentence, what to do next, and the raw detail folded underneath. */
export function ErrorCard({ title, detail, raw = null }: { readonly title: string; readonly detail: string; readonly raw?: string | null }): ReactElement {
  const { p } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <div role="alert" style={{ display: "flex", flexDirection: "column", paddingTop: 12, paddingBottom: 12, paddingLeft: 14, paddingRight: 14, borderWidth: 1, borderColor: p.errLine, borderRadius: 10, backgroundColor: p.errBg }}>
      <div style={{ fontWeight: 500, color: p.text }}>{title}</div>
      <div style={{ marginTop: 2, color: p.text2, userSelect: "text" }}>{detail}</div>
      {raw && (
        <div onClick={() => setOpen(!open)} role="button" aria-expanded={open} style={{ alignSelf: "flex-start", marginTop: 8, fontSize: 12, color: p.muted, textDecoration: "underline", cursor: "pointer", hover: HOVER }}>
          {open ? t("kit.hideDetails") : t("kit.showDetails")}
        </div>
      )}
      {raw && open && (
        <div style={{ marginTop: 8, paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 10, borderRadius: 7, backgroundColor: p.deep, fontFamily: MONO, fontSize: 11.5, color: p.muted, userSelect: "text" }}>
          {raw}
        </div>
      )}
    </div>
  );
}

/** Something to set up before this works, with the one place to go fix it. */
export function WarnCard({ title, detail, action = null }: { readonly title: string; readonly detail: string; readonly action?: { readonly label: string; readonly run: () => void } | null }): ReactElement {
  const { p } = useTheme();
  return (
    <div role="status" style={{ display: "flex", flexDirection: "column", paddingTop: 12, paddingBottom: 12, paddingLeft: 14, paddingRight: 14, borderWidth: 1, borderColor: p.warnLine, borderRadius: 10, backgroundColor: p.warnBg }}>
      <div style={{ fontWeight: 500, color: p.text }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, color: p.text2 }}>
        <div>{detail}</div>
        {action && <div onClick={action.run} role="link" style={{ color: p.link, textDecoration: "underline", cursor: "pointer", hover: HOVER }}>{action.label}</div>}
      </div>
    </div>
  );
}

const SPIN_FRAMES = 12;

function arc(frame: number): string {
  const angle = (360 / SPIN_FRAMES) * frame;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="black" stroke-width="2" stroke-linecap="round"><path d="M8 2 A6 6 0 0 1 14 8" transform="rotate(${angle} 8 8)"/></svg>`;
}

const RING = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="black" stroke-width="2"><circle cx="8" cy="8" r="6"/></svg>`;

/** A small ring with a turning arc, for work that has no percentage to show. */
export function Spinner({ size = 12 }: { readonly size?: number }): ReactElement {
  const { p } = useTheme();
  const frame = Math.floor(useNow(true, 80) / 80) % SPIN_FRAMES;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg source={RING} style={{ position: "absolute", left: 0, top: 0, width: size, height: size, color: p.line3 }} />
      <svg source={arc(frame)} style={{ position: "absolute", left: 0, top: 0, width: size, height: size, color: p.text }} />
    </div>
  );
}

export type StepState = "done" | "now" | "next";

export type ProgressStep = { readonly label: string; readonly state: StepState };

/** A long first open, told step by step: which step it's on, a bar, each step's state, and what happens next time. */
export function StepProgress({ title, steps, note }: { readonly title: string; readonly steps: readonly ProgressStep[]; readonly note: string }): ReactElement {
  const { p } = useTheme();
  const done = steps.filter((step) => step.state === "done").length;
  const current = Math.min(steps.length, done + 1);
  const fraction = steps.length === 0 ? 0 : (done + 0.5) / steps.length;
  const mark: Readonly<Record<StepState, { readonly glyph: string; readonly color: string }>> = {
    done: { glyph: "✓", color: p.string },
    now: { glyph: "", color: p.text },
    next: { glyph: "○", color: p.faint },
  };
  return (
    <div role="status" aria-label={title} style={{ display: "flex", flexDirection: "column", padding: 14, borderWidth: 1, borderColor: p.sel, borderRadius: 10, backgroundColor: p.card }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <div style={{ fontWeight: 500, color: p.text }}>{title}</div>
        <div style={{ color: p.muted, whiteSpace: "nowrap" }}>{t("kit.step", { current, count: steps.length })}</div>
      </div>
      <div style={{ display: "flex", height: 6, borderRadius: 3, backgroundColor: p.raised2, overflow: "hidden" }}>
        <div style={{ flexGrow: fraction, flexBasis: 0, backgroundColor: p.primary }} />
        <div style={{ flexGrow: 1 - fraction, flexBasis: 0 }} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10, fontSize: 12 }}>
        {steps.map((step) => step.state === "now" ? (
          <div key={step.label} style={{ display: "flex", alignItems: "center", gap: 6, color: mark.now.color, whiteSpace: "nowrap" }}>
            <Spinner />
            <div>{step.label}</div>
          </div>
        ) : (
          <div key={step.label} style={{ color: mark[step.state].color, whiteSpace: "nowrap" }}>{`${mark[step.state].glyph} ${step.label}`}</div>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: p.muted }}>{note}</div>
    </div>
  );
}

/** Nothing to show: say what is empty and what to try instead, inside a dashed box. */
export function EmptyState({ title, hint }: { readonly title: string; readonly hint: string }): ReactElement {
  const { p } = useTheme();
  const { ref, size } = usePaintedSize();
  return (
    <div ref={ref} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: 22, borderRadius: 10 }}>
      {size && <svg source={dashedOutline(size, 10, 1, "4 3")} style={{ position: "absolute", top: 0, left: 0, width: size.width, height: size.height, color: p.sel2 }} />}
      <div style={{ fontWeight: 500, color: p.text, textAlign: "center" }}>{title}</div>
      <div style={{ fontSize: 12, color: p.muted, textAlign: "center" }}>{hint}</div>
    </div>
  );
}

/** An agent's proposed change, applied only when you say so. */
export function SuggestionCard({ title, reason, apply, state, onApply, onSkip }: {
  readonly title: string;
  readonly reason: string;
  readonly apply: string;
  readonly state: { readonly kind: "pending" } | { readonly kind: "done"; readonly result: string; readonly skipped: boolean };
  readonly onApply: () => void;
  readonly onSkip: () => void;
}): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12, borderWidth: 1, borderColor: p.line3, borderRadius: 10, backgroundColor: p.raised }}>
      <div style={{ fontWeight: 500, color: p.text }}>{title}</div>
      {reason && <div style={{ marginTop: 2, fontSize: 12, color: p.muted }}>{reason}</div>}
      {state.kind === "pending" ? (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <Button label={apply} tone="primary" size="compact" onClick={onApply} />
          <Button label={t("kit.skip")} tone="outline" size="compact" onClick={onSkip} />
        </div>
      ) : (
        <div style={{ marginTop: 6, fontSize: 12, color: state.skipped ? p.muted : p.string }}>{state.result}</div>
      )}
    </div>
  );
}

/** The agent pointing at code: one click shows it. */
export function JumpButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onClick} role="button" aria-label={label} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 8, height: 28, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.line2, borderRadius: 8, color: p.text, cursor: "pointer", hover: HOVER }}>
      <Icon name="arrow-right" size={13} color={p.link} />
      <div style={{ whiteSpace: "nowrap" }}>{label}</div>
    </div>
  );
}

/** A field label sitting inside the field, like Filter, for inputs that need no caption above them. */
export function FieldFrame({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 30, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.line2, borderRadius: 8, backgroundColor: p.card }}>
      <div style={{ color: p.muted, fontSize: 12, flexShrink: 0 }}>{label}</div>
      {children}
    </div>
  );
}

/** The focused look for a text field: a solid edge and a soft ring; red when the value can't be used. */
export function fieldLook(p: Palette, focused: boolean, invalid: boolean): StyleDesc {
  if (invalid) return { borderWidth: 1, borderColor: p.error };
  if (focused) return { borderWidth: 1, borderColor: p.text, boxShadow: { offsetX: 0, offsetY: 0, blurRadius: 0, spreadRadius: 3, color: p.ring } };
  return { borderWidth: 1, borderColor: p.line3 };
}
