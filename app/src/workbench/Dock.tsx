import { type ReactElement, useState } from "react";

import type { ThreadSummary } from "../chat/history";
import type { ChatTab } from "../chat/useChat";
import { scrollbar, useTheme } from "../theme";
import { AgentLogo, Dot, Icon, MenuSurface, Popover, usePopover } from "../components/ui";
import { TYPING } from "../lib/shortcuts";
import { ago } from "../welcome/files";
import { menuOn } from "../components/ContextMenu";
import { toolMenu } from "./actions";
import { type Tool, TOOL_ICON, TOOL_LABEL } from "./dockOrder";
import { fillsSpace, ToolBody } from "./Tools";
import { ELLIPSIS, HOVER, IconButton, useBench } from "./parts";
import { ResizeHandle } from "./Resize";
import { t } from "../i18n";

/** One chat on this project, as an editor tab: the agent's logo, the title, a dot while it works. */
function ChatTabView({ tab, onPick, onClose }: { readonly tab: ChatTab; readonly onPick: () => void; readonly onClose: () => void }): ReactElement {
  const { p } = useTheme();
  const { chat } = useBench();
  return (
    <div role="tab" aria-label={tab.title} aria-selected={tab.active} style={{ display: "flex", alignItems: "center", gap: 6, height: 30, minWidth: 0, flexShrink: 1, paddingRight: 4, borderRadius: 7, fontSize: 12.5, color: tab.active ? p.text : p.muted, ...(tab.active ? { backgroundColor: p.sel } : {}) }}>
      <div onClick={onPick} style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, height: 30, paddingLeft: 10, cursor: "pointer", hover: HOVER }}>
        <AgentLogo icon={chat.agents.icons.get(tab.agent) ?? null} size={14} />
        <div style={{ minWidth: 0, ...ELLIPSIS }}>{tab.title}</div>
        {tab.busy && <Dot color={p.data} size={6} />}
      </div>
      <div onClick={onClose} role="button" aria-label={t("workbench.dock.closeChat", { title: tab.title })} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, flexShrink: 0, borderRadius: 5, cursor: "pointer", hover: HOVER }}>
        <Icon name="close" size={9} color={p.faint} />
      </div>
    </div>
  );
}

/** A past chat: click to open it. Hovering shows Delete, which asks once more before it removes the chat. */
export function PastChat({ summary, when, onOpen, onDelete }: { readonly summary: ThreadSummary; readonly when: string; readonly onOpen: () => void; readonly onDelete: () => void }): ReactElement {
  const { p } = useTheme();
  const [hovered, setHovered] = useState(false);
  const [armed, setArmed] = useState(false);
  const leave = (): void => {
    setHovered(false);
    setArmed(false);
  };
  const press = (): void => {
    if (!armed) return setArmed(true);
    setArmed(false);
    onDelete();
  };
  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={leave} style={{ display: "flex", alignItems: "center", gap: 6, height: 34, flexShrink: 0, paddingRight: 4, borderRadius: 7, ...(hovered ? { backgroundColor: p.fill } : {}) }}>
      <div onClick={onOpen} role="button" aria-label={summary.title} style={{ display: "flex", alignItems: "center", gap: 10, flexGrow: 1, minWidth: 0, height: 34, paddingLeft: 8, cursor: "pointer", hover: HOVER }}>
        <div style={{ flexGrow: 1, minWidth: 0, color: p.text3, ...ELLIPSIS }}>{summary.title}</div>
        {!hovered && <div style={{ flexShrink: 0, paddingRight: 4, fontSize: 11.5, color: p.faint }}>{when}</div>}
      </div>
      {hovered && (armed
        ? <div onClick={press} role="button" aria-label={t("workbench.dock.deleteChatNamed", { title: summary.title })} style={{ flexShrink: 0, paddingLeft: 6, paddingRight: 6, fontSize: 12, color: p.error, cursor: "pointer", hover: HOVER }}>{t("workbench.dock.confirmDelete")}</div>
        : <IconButton icon="trash" label={t("workbench.dock.deleteChat")} iconSize={13} color={p.faint} onClick={press} />)}
    </div>
  );
}

function PastChats({ onDone }: { readonly onDone: () => void }): ReactElement {
  const { p } = useTheme();
  const { chat, program } = useBench();
  const [query, setQuery] = useState("");
  const now = Date.now();
  const words = query.trim().toLowerCase();
  const shown = [...chat.saved].sort((a, b) => b.updatedAt - a.updatedAt).filter((summary) => !words || summary.title.toLowerCase().includes(words));
  return (
    <MenuSurface width={320} maxHeight={460}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, height: 32, paddingLeft: 8, paddingRight: 8, marginBottom: 4, borderRadius: 8, backgroundColor: p.fill }}>
        <Icon name="search" size={13} color={p.muted} />
        <input {...TYPING} autoFocus value={query} placeholder={t("workbench.dock.searchChats", { name: program.name })} onChange={(e) => setQuery(e.value ?? "")} style={{ flexGrow: 1, fontSize: 12.5, color: p.text, backgroundColor: p.fill }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", overflowY: "scroll", ...scrollbar(p), minHeight: 0 }}>
        {shown.map((summary) => <PastChat key={summary.id} summary={summary} when={ago(summary.updatedAt, now)} onOpen={() => { onDone(); chat.openThread(summary.id); }} onDelete={() => chat.deleteChats([summary.id])} />)}
        {shown.length === 0 && <div style={{ paddingTop: 12, paddingBottom: 12, paddingLeft: 8, fontSize: 12.5, color: p.muted }}>{words ? t("workbench.dock.noMatch") : t("workbench.dock.noChats")}</div>}
      </div>
    </MenuSurface>
  );
}

function ToolToggle({ tool, back }: { readonly tool: Tool; readonly back: boolean }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { wb } = bench;
  const on = wb.s.right === tool;
  return (
    <div {...menuOn(() => toolMenu(bench, tool))} style={{ display: "flex", borderRadius: 7, ...(on ? { backgroundColor: p.sel } : {}) }}>
      <IconButton icon={TOOL_ICON[tool]} label={on && back ? t("workbench.dock.backToAgent") : t(TOOL_LABEL[tool])} iconSize={16} color={on ? p.text : p.muted} onClick={() => wb.reveal(on && back ? "agent" : tool)} />
    </div>
  );
}

function Header(): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { chat, wb } = bench;
  const past = usePopover();
  const tools = wb.s.docks.right;
  const active = wb.s.right;
  const hasAgent = tools.includes("agent");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, height: 44, flexShrink: 0, paddingLeft: 8, paddingRight: 8 }}>
      <div {...menuOn(() => toolMenu(bench, active))} role="tablist" aria-label={t("workbench.dock.chats")} style={{ display: "flex", alignItems: "center", gap: 2, flexGrow: 1, minWidth: 0, overflow: "hidden" }}>
        {active === "agent"
          ? chat.tabs.map((tab) => <ChatTabView key={tab.id} tab={tab} onPick={() => chat.selectTab(tab.id)} onClose={() => chat.closeTab(tab.id)} />)
          : <div style={{ paddingLeft: 8, fontSize: 13, fontWeight: 500, color: p.text2 }}>{t(TOOL_LABEL[active])}</div>}
      </div>
      {hasAgent && (
        <div onMouseDown={past.onTriggerDown} style={{ display: "flex", position: "relative", borderRadius: 7, ...(past.open ? { backgroundColor: p.sel } : {}) }}>
          <IconButton icon="history" label={t("workbench.dock.pastChats")} iconSize={16} onClick={past.onTriggerClick} />
          {past.open && (
            <Popover side="bottom" align="end" onDismiss={past.dismiss}>
              <PastChats onDone={past.close} />
            </Popover>
          )}
        </div>
      )}
      {hasAgent && <IconButton icon="new-chat" label={t("workbench.dock.newChat")} iconSize={16} onClick={() => { chat.newTab(); wb.reveal("agent"); }} />}
      {tools.filter((tool) => tool !== "agent").map((tool) => <ToolToggle key={tool} tool={tool} back={hasAgent} />)}
      <IconButton icon="close" label={t("workbench.dock.closePanel")} iconSize={12} onClick={() => wb.patch({ rightOpen: false, pickerOpen: false })} />
    </div>
  );
}

/** The right panel: the chats working on this file, with the inspector one click away. Opens on the agent. */
export function Dock(): ReactElement {
  const { p } = useTheme();
  const { wb } = useBench();
  const tool = wb.s.right;
  return (
    <div role="complementary" aria-label={t("workbench.dock.label")} style={{ position: "relative", display: "flex", flexDirection: "column", width: wb.s.sizes.dock, flexShrink: 0, borderLeftWidth: 1, borderColor: p.fill, backgroundColor: p.card }}>
      <ResizeHandle edge="dock" />
      <Header />
      <div style={fillsSpace(tool) ? { display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 } : { display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflow: "scroll", ...scrollbar(p), paddingTop: 4, paddingLeft: 8, paddingRight: 8, paddingBottom: 10 }}>
        <ToolBody tool={tool} />
      </div>
    </div>
  );
}
