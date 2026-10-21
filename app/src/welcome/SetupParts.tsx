import type { ReactElement, ReactNode } from "react";

import { Icon } from "../components/ui";
import { t } from "../i18n";
import { MONO, type Palette, useTheme } from "../theme";
import { glass, HOVER, lineHeight } from "./look";
import { type StepId, STEPS } from "./steps";

export function StepHeading({ title, detail }: { readonly title: string; readonly detail: string }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
      <div style={{ fontSize: 26, lineHeight: 32, fontWeight: 600 }}>{title}</div>
      <div style={{ marginTop: 6, maxWidth: 520, fontSize: 14, lineHeight: lineHeight(14), color: p.muted }}>{detail}</div>
    </div>
  );
}

export function Panel({ children, label }: { readonly children: ReactNode; readonly label: string }): ReactElement {
  const { p } = useTheme();
  const g = glass(p);
  return (
    <div role="group" aria-label={label} style={{ display: "flex", flexDirection: "column", borderWidth: 1, borderColor: g.edge, borderRadius: 14, backgroundColor: g.card, overflow: "hidden" }}>
      {children}
    </div>
  );
}

export function Note({ text, tone = "faint" }: { readonly text: string; readonly tone?: "faint" | "muted" }): ReactElement {
  const { p } = useTheme();
  return <div style={{ marginTop: -6, paddingLeft: 2, paddingRight: 2, fontSize: 12, lineHeight: lineHeight(12), color: tone === "faint" ? p.faint : p.muted }}>{text}</div>;
}

export function PrimaryButton({ label, onClick, height = 30 }: { readonly label: string; readonly onClick: () => void; readonly height?: number }): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onClick} role="button" aria-label={label} style={{ display: "flex", alignItems: "center", flexShrink: 0, height, paddingLeft: 14, paddingRight: 14, borderRadius: 8, backgroundColor: p.primary, color: p.onPrimary, fontWeight: 600, cursor: "pointer", hover: HOVER }}>{label}</div>
  );
}

export function OutlineButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onClick} role="button" aria-label={label} style={{ display: "flex", alignItems: "center", flexShrink: 0, height: 30, paddingLeft: 12, paddingRight: 12, borderWidth: 1, borderColor: p.line3, borderRadius: 8, fontWeight: 500, cursor: "pointer", hover: HOVER }}>{label}</div>
  );
}

export function Progress({ progress }: { readonly progress: number | null }): ReactElement {
  const { p } = useTheme();
  const g = glass(p);
  return (
    <div role="progressbar" style={{ height: 4, borderRadius: 2, backgroundColor: g.tile, overflow: "hidden" }}>
      <div style={{ height: 4, width: progress === null ? "100%" : `${Math.round(progress * 100)}%`, borderRadius: 2, backgroundColor: p.link, opacity: progress === null ? 0.35 : 1, pointerEvents: "none" }} />
    </div>
  );
}

export function percentLabel(progress: number | null): string {
  return progress === null ? t("setup.working") : `${Math.round(progress * 100)}%`;
}

export function ReadyMark(): ReactElement {
  const { p } = useTheme();
  return (
    <div role="img" aria-label={t("setup.ready")} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 11, flexShrink: 0, backgroundColor: "rgba(152,195,121,0.14)", pointerEvents: "none" }}>
      <Icon name="check" size={12} color={p.string} />
    </div>
  );
}

export function Percent({ progress }: { readonly progress: number | null }): ReactElement {
  const { p } = useTheme();
  return <div style={{ flexShrink: 0, minWidth: 40, fontFamily: MONO, fontSize: 12, color: p.text4, textAlign: "right" }}>{percentLabel(progress)}</div>;
}

export function TextButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }): ReactElement {
  const { p } = useTheme();
  return <div onClick={onClick} role="button" aria-label={label} style={{ flexShrink: 0, color: p.muted, cursor: "pointer", hover: HOVER }}>{label}</div>;
}

/** The board marks Java and the bundled analysis tools with a short name on a tile; Rizin and Ghidra get their logos. */
function pillColors(p: Palette, current: boolean, done: boolean): { readonly bg: string; readonly fg: string; readonly dotBg: string; readonly dotFg: string } {
  const g = glass(p);
  if (current) return { bg: g.tile, fg: p.text, dotBg: p.primary, dotFg: p.onPrimary };
  if (done) return { bg: "transparent", fg: p.muted, dotBg: "rgba(152,195,121,0.14)", dotFg: p.string };
  return { bg: "transparent", fg: p.muted, dotBg: "transparent", dotFg: p.muted };
}

export function StepNav({ current, onGo }: { readonly current: StepId; readonly onGo: (id: StepId) => void }): ReactElement {
  const { p } = useTheme();
  const at = STEPS.findIndex((step) => step.id === current);
  return (
    <div role="tablist" aria-label={t("setup.steps")} style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
      {STEPS.map((step, index) => {
        const on = index === at;
        const done = index < at;
        const c = pillColors(p, on, done);
        return (
          <div key={step.id} onClick={() => onGo(step.id)} role="tab" aria-selected={on} aria-label={t(step.label)} style={{ display: "flex", alignItems: "center", gap: 8, height: 28, paddingLeft: 6, paddingRight: 12, borderRadius: 14, backgroundColor: c.bg, color: c.fg, cursor: "pointer", hover: HOVER }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 9, backgroundColor: c.dotBg, color: c.dotFg, fontSize: 11, fontWeight: 600, pointerEvents: "none" }}>
              {done ? <Icon name="check" size={11} color={c.dotFg} /> : <div>{String(index + 1)}</div>}
            </div>
            <div>{t(step.label)}</div>
          </div>
        );
      })}
    </div>
  );
}
