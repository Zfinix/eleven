import { type ReactElement, useEffect, useState } from "react";

import type { AgentIcon } from "../agents/icons";
import type { ChatTab } from "../chat/useChat";
import { authorName, describeEdit, type Edit } from "../engine/edits";
import { loadProject, onProjectChange } from "../engine/project";
import { t } from "../i18n";
import { useTheme } from "../theme";
import { AgentLogo, Dot } from "../components/ui";

const SHOWN_EDITS = 3;

function agentEdits(project: string | null): readonly Edit[] {
  if (!project) return [];
  try {
    return loadProject(project).edits.filter((edit) => edit.by.kind === "agent" && (edit.status === "applied" || edit.status === "proposed")).slice(-SHOWN_EDITS).reverse();
  } catch {
    return [];
  }
}

function useAgentEdits(project: string | null): readonly Edit[] {
  const [edits, setEdits] = useState(() => agentEdits(project));
  useEffect(() => {
    setEdits(agentEdits(project));
    return onProjectChange((id) => {
      if (id === project) setEdits(agentEdits(project));
    });
  }, [project]);
  return edits;
}

function ActivityRow({ logo, title, detail, busy, onClick }: {
  readonly logo: AgentIcon | null;
  readonly title: string;
  readonly detail: string;
  readonly busy: boolean;
  readonly onClick: (() => void) | null;
}): ReactElement {
  const { p } = useTheme();
  return (
    <div {...(onClick ? { onClick, role: "button" } : {})} aria-label={title} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, flexShrink: 0, paddingTop: 4, paddingBottom: 4, paddingLeft: 8, paddingRight: 8, borderRadius: 8, borderWidth: 1, borderColor: "transparent", ...(onClick ? { cursor: "pointer", hover: { opacity: 0.72 } } : {}) }}>
      <div style={{ display: "flex", justifyContent: "center", width: 17, flexShrink: 0, pointerEvents: "none" }}>
        <AgentLogo icon={logo} size={16} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, lineHeight: 16 }}>
        <div style={{ color: p.text3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        <div style={{ fontSize: 11.5, color: p.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{detail}</div>
      </div>
      {busy && <Dot color={p.data} />}
    </div>
  );
}

/** What each agent is doing or found in this project: open chats first, then its latest edits. */
export function AgentActivity({ tabs, project, logoOf, agentName, onOpenChat }: {
  readonly tabs: readonly ChatTab[];
  readonly project: string | null;
  readonly logoOf: (agent: string) => AgentIcon | null;
  readonly agentName: (agent: string) => string;
  readonly onOpenChat: (id: string) => void;
}): ReactElement | null {
  const { p } = useTheme();
  const edits = useAgentEdits(project);
  const working = tabs.filter((tab) => tab.busy || tab.found);
  if (working.length === 0 && edits.length === 0) return null;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", height: 26, flexShrink: 0, marginTop: 14, paddingLeft: 8, paddingRight: 8, fontSize: 12, fontWeight: 500, color: p.faint }}>{t("home.agents")}</div>
      {working.map((tab) => (
        <ActivityRow key={tab.id} logo={logoOf(tab.agent)} title={`${agentName(tab.agent)} · ${tab.title}`} detail={tab.found ?? t("home.workingOnIt")} busy={tab.busy} onClick={() => onOpenChat(tab.id)} />
      ))}
      {edits.map((edit) => {
        const chat = edit.by.kind === "agent" ? edit.by.chat : null;
        const agent = edit.by.kind === "agent" ? edit.by.agent : "";
        const what = describeEdit(edit, (key) => key);
        const detail = edit.status === "proposed" ? t("home.waitingForYou", { what }) : what;
        return <ActivityRow key={edit.id} logo={logoOf(agent)} title={agentName(authorName(edit.by))} detail={detail} busy={false} onClick={chat ? () => onOpenChat(chat) : null} />;
      })}
    </>
  );
}
