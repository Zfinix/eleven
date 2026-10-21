import type { ReactElement } from "react";

import { Icon, Row } from "../components/ui";
import { t } from "../i18n";
import { TYPING } from "../lib/shortcuts";
import { useTheme } from "../theme";
import { inks } from "./controls";
import { NAV_GROUPS, type Page, pageIcon, pageTitle } from "./pages";

function NavRow({ page, active, badge, onOpen }: { readonly page: Page; readonly active: boolean; readonly badge: boolean; readonly onOpen: (page: Page) => void }): ReactElement {
  const { p } = useTheme();
  const color = active ? p.text : p.text3;
  return (
    <div onClick={() => onOpen(page)} role="button" aria-label={pageTitle(page)} aria-selected={active} style={{ display: "flex", alignItems: "center", gap: 10, height: 32, flexShrink: 0, paddingLeft: 10, paddingRight: 10, borderRadius: 8, cursor: "pointer", hover: { opacity: 0.72 }, ...(active ? { backgroundColor: p.sel } : {}) }}>
      <svg source={pageIcon(page)} style={{ width: 16, height: 16, flexShrink: 0, color }} />
      <div style={{ flexGrow: 1, whiteSpace: "nowrap", color }}>{pageTitle(page)}</div>
      {badge && <div aria-label={t("settings.needsAttention")} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: inks(p).warn }} />}
    </div>
  );
}

/** The settings column: back, search and the page list, sitting on the frosted backdrop. */
export function Nav({ page, query, shown, badges, onQuery, onOpen, onBack }: {
  readonly page: Page;
  readonly query: string;
  readonly shown: (page: Page) => boolean;
  readonly badges: ReadonlySet<Page>;
  readonly onQuery: (query: string) => void;
  readonly onOpen: (page: Page) => void;
  readonly onBack: () => void;
}): ReactElement {
  const { p } = useTheme();
  const searching = query.trim() !== "";
  const groups = NAV_GROUPS.map((group) => group.filter(shown)).filter((group) => group.length > 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 248, flexShrink: 0, paddingLeft: 10, paddingRight: 10, paddingBottom: 10 }}>
      <div style={{ height: 46, flexShrink: 0 }} />
      <div onClick={onBack} role="button" aria-label={t("settings.back")} style={{ display: "flex", alignItems: "center", gap: 6, height: 30, flexShrink: 0, paddingLeft: 6, paddingRight: 6, color: p.muted, cursor: "pointer", hover: { opacity: 0.72 } }}>
        <Icon name="back" size={15} color={p.muted} />
        <div>{t("settings.back")}</div>
      </div>
      <Row gap={8} style={{ height: 32, flexShrink: 0, marginTop: 8, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.line2, borderRadius: 10, backgroundColor: p.card }}>
        <Icon name="search" size={14} color={p.faint} />
        <input {...TYPING} aria-label={t("settings.search")} value={query} placeholder={t("settings.searchPlaceholder")} onChange={(e) => onQuery(e.value ?? "")} style={{ flexGrow: 1, minWidth: 0, color: p.text, backgroundColor: p.card }} />
      </Row>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14, flexGrow: 1, minHeight: 0, overflowY: "scroll" }}>
        {groups.map((group) => (
          <div key={group.join()} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {group.map((item) => <NavRow key={item} page={item} active={!searching && item === page} badge={badges.has(item)} onOpen={onOpen} />)}
          </div>
        ))}
        {groups.length === 0 && <div style={{ paddingLeft: 10, fontSize: 12.5, color: p.faint }}>{t("settings.noMatch")}</div>}
      </div>
    </div>
  );
}
