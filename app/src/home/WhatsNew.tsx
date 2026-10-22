import { join } from "node:path";

import { type ReactElement, useState } from "react";

import { t } from "../i18n";
import { ASSETS } from "../lib/assets";
import { useTheme } from "../theme";
import { Icon } from "../components/ui";
import { NEWS, type News, type NewsArt } from "./news";
import { openSettings } from "../settings/open";

const WIDTH = 300;
const HERO = 172;
const BADGE = 60;
const LOGO = 30;
const BADGE_GAP = 10;
const PAPER = "#f2f2f1";
const RADIUS = 16;

function dots(): string {
  const step = 12;
  const marks: string[] = [];
  for (let y = step / 2; y < HERO; y += step) {
    for (let x = step / 2; x < WIDTH; x += step) marks.push(`<circle cx="${x}" cy="${y}" r="0.8"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HERO}" viewBox="0 0 ${WIDTH} ${HERO}" fill="black">${marks.join("")}</svg>`;
}

function rings(): string {
  const circles = [
    { cx: 120, cy: 40, r: 110 },
    { cx: 150, cy: 120, r: 76 },
    { cx: 210, cy: 96, r: 120 },
  ].map(({ cx, cy, r }) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HERO}" viewBox="0 0 ${WIDTH} ${HERO}" fill="none" stroke="black" stroke-width="1">${circles.join("")}</svg>`;
}

const DOTS = dots();
const RINGS = rings();

function artSource(art: NewsArt): readonly string[] {
  switch (art.kind) {
    case "logos":
      return art.files.map((file) => join(ASSETS, file));
    case "shot":
      return [];
    default: {
      const unhandled: never = art;
      return unhandled;
    }
  }
}

function Badge({ children }: { readonly children: ReactElement }): ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: BADGE, height: BADGE, borderRadius: BADGE / 2, flexShrink: 0, backgroundColor: "#ffffff", pointerEvents: "none" }}>
      {children}
    </div>
  );
}

function Hero({ art, onClose }: { readonly art: NewsArt; readonly onClose: () => void }): ReactElement {
  const layer = { position: "absolute", top: 0, left: 0, width: WIDTH, height: HERO } as const;
  return (
    <div style={{ position: "relative", height: HERO, flexShrink: 0, overflow: "hidden", borderTopLeftRadius: RADIUS - 1, borderTopRightRadius: RADIUS - 1, backgroundColor: PAPER }}>
      <svg source={DOTS} style={{ ...layer, color: "#d6d6d4" }} />
      <svg source={RINGS} style={{ ...layer, color: "#e0e0de" }} />
      <div style={{ position: "absolute", top: (HERO - BADGE) / 2, left: 0, width: WIDTH, display: "flex", justifyContent: "center", gap: BADGE_GAP, pointerEvents: "none" }}>
        {art.kind !== "shot" && artSource(art).map((src) => <Badge key={src}><img src={src} objectFit="contain" style={{ width: LOGO, height: LOGO }} /></Badge>)}
      </div>
      {art.kind === "shot" && <img src={join(ASSETS, "news", art.file)} objectFit="cover" style={{ ...layer, pointerEvents: "none" }} />}
      <div onClick={onClose} role="button" aria-label={t("news.close")} style={{ position: "absolute", top: 10, right: 10, display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, cursor: "pointer", hover: { opacity: 0.72 } }}>
        <Icon name="close" size={13} color={art.kind === "shot" ? "#e6e6e6" : "#b8b8b6"} />
      </div>
    </div>
  );
}

function Pager({ at, count, onGo }: { readonly at: number; readonly count: number; readonly onGo: (index: number) => void }): ReactElement {
  const { p } = useTheme();
  const step = (icon: string, label: string, to: number): ReactElement => {
    const live = to >= 0 && to < count;
    return (
      <div onClick={() => live && onGo(to)} role="button" aria-label={label} aria-disabled={!live} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 7, cursor: live ? "pointer" : "default", opacity: live ? 1 : 0.35, ...(live ? { hover: { opacity: 0.72 } } : {}) }}>
        <Icon name={icon} size={14} color={p.muted} />
      </div>
    );
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
      {step("back", t("news.previous"), at - 1)}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {Array.from({ length: count }, (_, index) => (
          <div key={index} onClick={() => onGo(index)} role="button" aria-label={t("news.card", { index: index + 1, count })} aria-selected={index === at} style={{ width: 6, height: 6, borderRadius: 3, cursor: "pointer", backgroundColor: index === at ? p.text : p.line3 }} />
        ))}
      </div>
      {step("forward", t("news.next"), at + 1)}
    </div>
  );
}

/** Aside-style announcement cards that float over the sidebar, newest first, until closed or acted on. */
export function WhatsNew({ news, onClose }: {
  readonly news: News;
  readonly onClose: () => void;
}): ReactElement {
  const { p } = useTheme();
  const [at, setAt] = useState(() => Math.max(0, NEWS.findIndex((item) => item.id === news.id)));
  const item = NEWS[at] ?? news;
  const last = at >= NEWS.length - 1;
  const act = (): void => {
    const action = item.action;
    switch (action.kind) {
      case "settings":
        onClose();
        return openSettings(action.page);
      case "none":
        return last ? onClose() : setAt(at + 1);
      default: {
        const unhandled: never = action;
        return unhandled;
      }
    }
  };
  const label = item.action.kind === "none" ? (last ? t("news.done") : t("news.next")) : t(item.action.label);
  const shadow = { offsetX: 0, offsetY: 16, blurRadius: 40, spreadRadius: 0, color: "rgba(0,0,0,0.35)" };
  return (
    <div role="dialog" aria-label={t(item.title)} style={{ position: "absolute", left: 10, bottom: 10, display: "flex", flexDirection: "column", width: WIDTH, borderWidth: 1, borderColor: p.line2, borderRadius: RADIUS, backgroundColor: p.raised2, overflow: "hidden", boxShadow: shadow }}>
      <Hero art={item.art} onClose={onClose} />
      <div style={{ display: "flex", flexDirection: "column", paddingTop: 18, paddingLeft: 16, paddingRight: 16, paddingBottom: 12 }}>
        <div style={{ fontSize: 12.5, color: p.muted }}>{t("news.position", { index: at + 1, count: NEWS.length })}</div>
        <div style={{ marginTop: 2, fontSize: 18, lineHeight: 26, fontWeight: 500, color: p.text }}>{t(item.title)}</div>
        <div style={{ marginTop: 6, minHeight: 60, color: p.text3 }}>{t(item.body)}</div>
        <div onClick={act} role="button" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 36, marginTop: 16, borderRadius: 10, backgroundColor: p.sel2, color: p.text, cursor: "pointer", hover: { opacity: 0.72 } }}>
          <div style={{ pointerEvents: "none" }}>{label}</div>
        </div>
        <Pager at={at} count={NEWS.length} onGo={setAt} />
      </div>
    </div>
  );
}
