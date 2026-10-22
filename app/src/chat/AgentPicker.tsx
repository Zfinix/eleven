import { type ReactElement, useState } from "react";

import type { AgentIcon } from "../agents/icons";
import type { AgentEntry } from "../agents/registry";
import { t } from "../i18n";
import { scrollbar, useTheme } from "../theme";
import { AgentLogo, Icon, MenuSurface, Popover, Row, usePopover } from "../components/ui";
import type { Agents } from "./useAgents";
import { TYPING } from "../lib/shortcuts";

const AGENT_ROW = 32;
const ROWS_MAX = 372;

function AgentRow({ agent, icon, installed, selected, onPick }: {
  readonly agent: AgentEntry;
  readonly icon: AgentIcon | null;
  readonly installed: boolean;
  readonly selected: boolean;
  readonly onPick: () => void;
}): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onPick} style={{ display: "flex", alignItems: "center", gap: 9, height: AGENT_ROW, paddingLeft: 14, paddingRight: 14, flexShrink: 0, cursor: "pointer", hover: { opacity: 0.72 }, ...(selected ? { backgroundColor: p.sel } : {}) }}>
      <AgentLogo icon={icon} size={15} />
      <div style={{ flexGrow: 1, minWidth: 0, color: p.text, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{agent.name}</div>
      <div style={{ display: "flex", width: 14, flexShrink: 0 }}>{installed && <Icon name="check" size={14} color={p.muted} />}</div>
    </div>
  );
}

function AgentMenu({ agents, onPick }: { readonly agents: Agents; readonly onPick: (id: string) => void }): ReactElement {
  const { p } = useTheme();
  const [query, setQuery] = useState("");
  const shown = agents.list.filter((agent) => agent.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <MenuSurface width={240} padX={0}>
      <Row gap={8} style={{ flexShrink: 0, height: 32, marginLeft: 6, marginRight: 6, paddingLeft: 8, paddingRight: 8, marginBottom: 4, borderRadius: 8, backgroundColor: p.fill }}>
        <Icon name="search" size={13} />
        <input {...TYPING} autoFocus value={query} placeholder={t("chat.agents.search", { count: agents.list.length })} onChange={(e) => setQuery(e.value ?? "")} style={{ flexGrow: 1, fontSize: 12.5, color: p.text, backgroundColor: p.fill }} />
      </Row>
      <div style={{ display: "flex", flexDirection: "column", overflowY: "scroll", ...scrollbar(p), maxHeight: ROWS_MAX, minHeight: 0 }}>
        {shown.map((agent) => (
          <AgentRow key={agent.id} agent={agent} icon={agents.icons.get(agent.id) ?? null} installed={agents.installed.has(agent.id)} selected={agent.id === agents.selected.id} onPick={() => onPick(agent.id)} />
        ))}
      </div>
    </MenuSurface>
  );
}

/** The composer's agent switcher; locked while the agent is working. Compact shows only the logo. */
export function AgentPicker({ agents, locked, compact, onPick }: {
  readonly agents: Agents;
  readonly locked: boolean;
  readonly compact: boolean;
  readonly onPick: (id: string) => void;
}): ReactElement {
  const { p } = useTheme();
  const menu = usePopover();
  const choose = (id: string): void => {
    menu.close();
    onPick(id);
  };
  return (
    <div style={{ display: "flex", position: "relative", flexShrink: 0 }}>
      <Row gap={7} style={{ height: 30, paddingLeft: 9, paddingRight: 8, borderRadius: 15, fontSize: 12.5, color: p.text3, cursor: locked ? "default" : "pointer", opacity: locked ? 0.5 : 1, hover: { opacity: locked ? 0.5 : 0.72 }, ...(menu.open ? { backgroundColor: p.fill2 } : {}) }}>
        <div onMouseDown={menu.onTriggerDown} onClick={() => !locked && menu.onTriggerClick()} aria-label={t("chat.agents.pick")} style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <AgentLogo icon={agents.icons.get(agents.selected.id) ?? null} />
          {!compact && <div style={{ whiteSpace: "nowrap" }}>{agents.selected.name}</div>}
          <Icon name="disclosure" size={11} color={p.faint} />
        </div>
      </Row>
      {menu.open && (
        <Popover side="top" align="end" onDismiss={menu.dismiss}>
          <AgentMenu agents={agents} onPick={choose} />
        </Popover>
      )}
    </div>
  );
}
