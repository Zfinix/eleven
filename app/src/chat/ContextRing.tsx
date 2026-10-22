import { type ReactElement, useState } from "react";

import type { Usage } from "../agents/events";
import { t } from "../i18n";
import { useTheme } from "../theme";
import { MENU_RADIUS, MenuSurface } from "../components/ui";

const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function ring(fraction: number): string {
  const dash = fraction >= 1 ? "" : ` stroke-dasharray="${(CIRCUMFERENCE * fraction).toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="${RADIUS}" transform="rotate(-90 12 12)"${dash}/></svg>`;
}

const TRACK = ring(1);

function tokens(count: number): string {
  return count >= 1000 ? `${Math.round(count / 1000)}k` : `${count}`;
}

/** How full the agent's memory of this chat is, with the numbers on hover. */
export function ContextRing({ usage }: { readonly usage: Usage }): ReactElement {
  const { p } = useTheme();
  const [hovered, setHovered] = useState(false);
  const fraction = usage.size > 0 ? Math.min(1, usage.used / usage.size) : 0;
  const percent = Math.round(fraction * 100);
  const tone = percent >= 85 ? p.error : percent >= 65 ? p.data : p.text3;
  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} aria-label={t("chat.memory.used", { percent })} style={{ display: "flex", position: "relative", width: 30, height: 30, alignItems: "center", justifyContent: "center" }}>
      <svg source={TRACK} style={{ position: "absolute", left: 6, top: 6, width: 18, height: 18, color: p.line3 }} />
      {fraction > 0 && <svg source={ring(fraction)} style={{ position: "absolute", left: 6, top: 6, width: 18, height: 18, color: tone }} />}
      {hovered && (
        <anchored deferred side="top" align="center" gap={8} fit="switch" style={{ borderRadius: MENU_RADIUS }}>
          <MenuSurface width={220}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: 6 }}>
              <div style={{ color: p.text }}>{t("chat.memory.title", { percent })}</div>
              <div style={{ fontSize: 11.5, color: p.muted }}>{usage.cost ? t("chat.memory.tokensCost", { used: tokens(usage.used), size: tokens(usage.size), cost: usage.cost }) : t("chat.memory.tokens", { used: tokens(usage.used), size: tokens(usage.size) })}</div>
              <div style={{ fontSize: 11.5, color: p.faint, marginTop: 4 }}>{t("chat.memory.hint")}</div>
            </div>
          </MenuSurface>
        </anchored>
      )}
    </div>
  );
}
