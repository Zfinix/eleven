import { type ReactElement, useState } from "react";

import { MenuSurface, MENU_RADIUS } from "../components/ui";
import { t } from "../i18n";
import { stringField } from "../lib/guards";
import { useLoaded } from "../lib/useLoaded";
import { openLink } from "../settings/system";
import { useTheme } from "../theme";
import { favicon } from "./favicon";
import type { Block } from "./thread";

export type Source = { readonly href: string; readonly domain: string; readonly title: string | null };

const MAX_SOURCES = 8;
const MARKDOWN_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
const BARE_URL = /https?:\/\/[^\s<>()[\]"'`]+[^\s<>()[\]"'`.,;:!?]/g;

function domainOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

/** The web pages a reply drew on: links in its text and pages its tools fetched, first mention first. */
export function sourcesOf(blocks: readonly Block[]): readonly Source[] {
  const found = new Map<string, Source>();
  const add = (href: string, title: string | null): void => {
    const known = found.get(href);
    if (!known) found.set(href, { href, domain: domainOf(href), title });
    else if (!known.title && title) found.set(href, { ...known, title });
  };
  for (const block of blocks) {
    if (block.kind === "tool") {
      const url = stringField(block.step.input, "url");
      if (url && /^https?:\/\//.test(url)) add(url, null);
    }
    if (block.kind !== "text") continue;
    for (const [, title, href] of block.text.matchAll(MARKDOWN_LINK)) if (href) add(href, title ?? null);
    for (const [href] of block.text.matchAll(BARE_URL)) add(href, null);
  }
  return [...found.values()].slice(0, MAX_SOURCES);
}

function Badge({ domain, size }: { readonly domain: string; readonly size: number }): ReactElement {
  const { p } = useTheme();
  const icon = useLoaded(() => favicon(domain), domain);
  if (icon.kind === "ready" && icon.value) return <img src={icon.value} objectFit="contain" style={{ width: size, height: size, flexShrink: 0, borderRadius: 3, pointerEvents: "none" }} />;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: size, height: size, flexShrink: 0, borderRadius: size / 2, backgroundColor: p.sel2, fontSize: size * 0.6, fontWeight: 600, color: p.text3, pointerEvents: "none" }}>
      {domain.charAt(0).toUpperCase()}
    </div>
  );
}

/** One cited page: a small chip with its site, and on hover a card with the site, the page title and its address. */
function SourceChip({ source }: { readonly source: Source }): ReactElement {
  const { p } = useTheme();
  const [hovered, setHovered] = useState(false);
  const path = source.href.replace(/^https?:\/\/[^/]+/, "") || "/";
  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={() => openLink(source.href)} role="link" aria-label={t("chat.open", { name: source.href })} style={{ display: "flex", alignItems: "center", gap: 4, height: 20, maxWidth: 160, paddingLeft: 3, paddingRight: 8, borderRadius: 10, backgroundColor: hovered ? p.sel2 : p.fill2, fontSize: 12, color: hovered ? p.text : p.muted, cursor: "pointer" }}>
      <Badge domain={source.domain} size={14} />
      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", pointerEvents: "none" }}>{source.domain}</div>
      {hovered && (
        <anchored deferred side="top" align="start" gap={6} fit="switch" style={{ borderRadius: MENU_RADIUS }}>
          <MenuSurface width={320} padX={0}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Badge domain={source.domain} size={16} />
                <div style={{ fontSize: 13, color: p.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{source.domain}</div>
              </div>
              {source.title && <div style={{ fontSize: 13, fontWeight: 500, color: p.text }}>{source.title}</div>}
              <div style={{ fontSize: 12.5, color: p.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{path}</div>
            </div>
          </MenuSurface>
        </anchored>
      )}
    </div>
  );
}

/** The pages a reply cites, as a row of chips under it. */
export function Sources({ sources }: { readonly sources: readonly Source[] }): ReactElement | null {
  if (sources.length === 0) return null;
  return (
    <div role="list" aria-label={t("chat.sources")} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      {sources.map((source) => <SourceChip key={source.href} source={source} />)}
    </div>
  );
}
