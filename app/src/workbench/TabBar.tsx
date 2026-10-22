import { type ReactElement, useState } from "react";

import { TOOL_ICON, TOOL_LABEL } from "./dockOrder";
import { chatTitle } from "../chat/useChat";
import { type PlainId, t } from "../i18n";
import { useTheme } from "../theme";
import { Icon } from "../components/ui";
import type { CodeMode, ListKind, Tab } from "./model";
import { subjectMenu } from "./actions";
import { HOVER, IconButton, useBench } from "./parts";
import { shortName } from "../gpu/look";

const VIEW_ICON: Readonly<Record<CodeMode, string>> = { pseudo: "pseudocode", asm: "assembly", graph: "graph", hex: "hex" };
const LIST_ICON: Readonly<Record<ListKind, string>> = { strings: "strings", imports: "library", segments: "segments" };
export const LIST_TITLE: Readonly<Record<ListKind, PlainId>> = { strings: "workbench.side.list.strings", imports: "workbench.side.list.imports", segments: "workbench.side.list.segments" };

type Look = { readonly title: string; readonly icon: string; readonly iconColor: string | null };

function useLook(tab: Tab): Look {
  const { p } = useTheme();
  const { nameOf, chat } = useBench();
  switch (tab.kind) {
    case "fn":
      return { title: nameOf(tab.addr), icon: VIEW_ICON[tab.view], iconColor: p.call };
    case "thread":
      return { title: chatTitle(chat) ?? t("workbench.chrome.newChat"), icon: "thread", iconColor: null };
    case "list":
      return { title: t(LIST_TITLE[tab.list]), icon: LIST_ICON[tab.list], iconColor: null };
    case "shader":
      return { title: shortName(tab.name), icon: "gpu", iconColor: null };
    case "model":
      return { title: tab.name, icon: "model", iconColor: null };
    case "profile":
      return { title: tab.title, icon: "profile", iconColor: null };
    case "diff":
      return { title: t("workbench.chrome.compare"), icon: "split", iconColor: null };
    case "debug":
      return { title: t("workbench.chrome.debugger"), icon: "debug", iconColor: null };
    case "listing":
      return { title: t("workbench.chrome.listing"), icon: "assembly", iconColor: null };
    case "source":
      return { title: tab.file.split("/").pop() ?? tab.file, icon: "source", iconColor: null };
    case "resource":
      return { title: tab.file.split("/").pop() ?? tab.file, icon: tab.file.endsWith(".so") ? "library" : "source", iconColor: null };
    case "text":
      return { title: tab.title, icon: "text", iconColor: null };
    case "tool":
      return { title: t(TOOL_LABEL[tab.tool]), icon: TOOL_ICON[tab.tool], iconColor: null };
    default: {
      const unhandled: never = tab;
      return unhandled;
    }
  }
}

function TabItem({ tab, on, focused, menu, onClose }: {
  readonly tab: Tab;
  readonly on: boolean;
  readonly focused: boolean;
  readonly menu: ReturnType<typeof subjectMenu>;
  readonly onClose: () => void;
}): ReactElement {
  const { p } = useTheme();
  const [hovered, setHovered] = useState(false);
  const look = useLook(tab);
  const background = on ? (focused ? p.card : p.deep2) : null;
  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ position: "relative", display: "flex", alignItems: "center", flexShrink: on ? 0 : 1, minWidth: 72, height: "100%", ...(background ? { backgroundColor: background } : {}) }}>
      {on && <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 2, backgroundColor: focused ? p.call : p.line3, pointerEvents: "none" }} />}
      <div {...menu} role="tab" aria-selected={on} aria-label={tab.preview ? t("workbench.chrome.preview", { title: look.title }) : look.title} style={{ display: "flex", alignItems: "center", gap: 7, flexGrow: 1, minWidth: 0, height: "100%", paddingLeft: 12, paddingRight: 6, color: on ? p.text : p.muted, cursor: "pointer" }}>
        <Icon name={look.icon} size={14} color={look.iconColor ?? (on ? p.text : p.muted)} />
        <div style={{ flexShrink: 1, minWidth: 0, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...(tab.preview ? { fontStyle: "italic" } : {}) }}>{look.title}</div>
      </div>
      <div onClick={onClose} role="button" aria-label={t("workbench.chrome.close", { title: look.title })} style={{ display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, width: 22, height: 22, marginRight: 6, borderRadius: 5, opacity: hovered ? 1 : 0, cursor: "pointer", hover: HOVER }}>
        <Icon name="close" size={11} color={p.muted} />
      </div>
    </div>
  );
}

/** One pane's tab strip, with the split buttons on the right. */
export function TabBar({ pane }: { readonly pane: number }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { wb } = bench;
  const tabs = wb.s.panes[pane];
  return (
    <div style={{ display: "flex", alignItems: "stretch", height: 36, flexShrink: 0, backgroundColor: p.deep }}>
      <div role="tablist" aria-label={t("workbench.chrome.openTabs")} style={{ display: "flex", flexGrow: 1, minWidth: 0, overflowX: "scroll" }}>
        {tabs?.tabs.map((tab, ix) => (
          <TabItem key={tab.id} tab={tab} on={ix === tabs.active} focused={pane === wb.s.focus} menu={subjectMenu(bench, { kind: "tab", pane, index: ix }, () => wb.selectTab(pane, ix))} onClose={() => wb.closeTab(pane, ix)} />
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0, gap: 2, paddingLeft: 6, paddingRight: 6 }}>
        <IconButton icon="split" label={t("command.split")} onClick={() => wb.split(pane)} />
        {wb.s.panes.length > 1 && <IconButton icon="close" label={t("workbench.chrome.closeSplit")} iconSize={12} onClick={() => wb.closePane(pane)} />}
      </div>
    </div>
  );
}
