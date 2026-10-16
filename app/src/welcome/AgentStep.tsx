import { type ReactElement, useState } from "react";

import type { AgentEntry } from "../agents/registry";
import { AgentLogo, Icon } from "../components/ui";
import type { Chat } from "../chat/useChat";
import { useSettings } from "../settings/store";
import { tr, trN, useLanguage } from "../i18n";
import { useTheme } from "../theme";
import { agentDetail, type AgentStatus } from "./agentSetup";
import { glass, HOVER, lineHeight } from "./look";
import { Note, OutlineButton, Panel, Percent, PrimaryButton, Progress, StepHeading } from "./SetupParts";
import type { AgentSetup } from "./useAgentSetup";
import { THIS_DEVICE } from "../lib/platform";

const FEW = 6;

function Trailing({ status, agent, setup }: { readonly status: AgentStatus; readonly agent: AgentEntry; readonly setup: AgentSetup }): ReactElement | null {
  const { p } = useTheme();
  switch (status.kind) {
    case "ready":
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, fontSize: 12, color: p.string }}>
          <Icon name="check" size={13} color={p.string} />
          <div>Ready</div>
        </div>
      );
    case "install":
      return <OutlineButton label={tr("Install")} onClick={() => setup.install(agent)} />;
    case "failed":
      return <OutlineButton label={tr("Try again")} onClick={() => setup.install(agent)} />;
    case "installing":
      return <Percent progress={null} />;
    case "signin":
      return <PrimaryButton label={tr("Sign in")} onClick={() => setup.signIn(agent)} />;
    case "unavailable":
      return null;
  }
}

function Row({ agent, chat, setup, first }: { readonly agent: AgentEntry; readonly chat: Chat; readonly setup: AgentSetup; readonly first: boolean }): ReactElement {
  const { p } = useTheme();
  const g = glass(p);
  const { update } = useSettings();
  const { agents } = chat;
  const status = setup.status(agent);
  const on = agent.id === agents.selected.id;
  const pick = (): void => {
    chat.pickAgent(agent.id);
    update({ defaultAgent: agent.id });
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 56, paddingTop: 8, paddingBottom: 8, paddingLeft: 16, paddingRight: 16, borderTopWidth: first ? 0 : 1, borderColor: g.line, backgroundColor: on ? g.tile : "transparent" }}>
      <div onClick={pick} role="radio" aria-selected={on} aria-label={agent.name} style={{ display: "flex", alignItems: "center", gap: 12, flexGrow: 1, minWidth: 0, cursor: "pointer", hover: HOVER }}>
        <div style={{ width: 16, height: 16, borderRadius: 8, flexShrink: 0, borderWidth: on ? 5 : 1.5, borderColor: on ? p.text : p.line3, pointerEvents: "none" }} />
        <AgentLogo icon={agents.icons.get(agent.id) ?? null} size={28} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <div style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{agent.name}</div>
            <div style={{ minWidth: 0, fontSize: 12, lineHeight: lineHeight(12), color: p.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{agentDetail(status)}</div>
          </div>
          {status.kind === "installing" && <Progress progress={null} />}
        </div>
      </div>
      <Trailing status={status} agent={agent} setup={setup} />
    </div>
  );
}

function hint(agent: AgentEntry, status: AgentStatus): string | null {
  switch (status.kind) {
    case "install":
    case "failed":
      return trN("{name} isn't installed yet. Install it, or pick one that's ready.", { name: agent.name });
    case "signin":
      return tr("Sign in opens your browser, then brings you back here.");
    case "installing":
      return trN("You can keep going while {name} installs.", { name: agent.name });
    case "unavailable":
      return trN("{name} can't run on {device} yet. {detail}. Pick one that's ready.", { name: agent.name, device: tr(THIS_DEVICE), detail: status.detail });
    case "ready":
      return null;
  }
}

/** Every agent gets the same tools, so this only picks which one Eleven starts with. */
export function AgentStep({ chat, setup }: { readonly chat: Chat; readonly setup: AgentSetup }): ReactElement {
  const { p } = useTheme();
  useLanguage();
  const g = glass(p);
  const [all, setAll] = useState(false);
  const { list, selected } = chat.agents;
  const shown = all ? list : list.slice(0, FEW);
  const warning = hint(selected, setup.status(selected));
  return (
    <>
      <StepHeading title={tr("Pick your agent")} detail={tr("It reads the code with you and can move around the window for you. Every agent gets the same tools, and you can switch any time.")} />
      <Panel label={tr("Agent")}>
        {shown.map((agent, index) => <Row key={agent.id} agent={agent} chat={chat} setup={setup} first={index === 0} />)}
        {list.length > FEW && (
          <div onClick={() => setAll(!all)} role="button" aria-label={all ? tr("Show fewer") : tr("Show all agents")} style={{ display: "flex", alignItems: "center", height: 40, paddingLeft: 16, paddingRight: 16, borderTopWidth: 1, borderColor: g.line, color: p.muted, cursor: "pointer", hover: HOVER }}>
            {all ? tr("Show fewer") : trN("All {n} agents", { n: list.length })}
          </div>
        )}
      </Panel>
      {warning && <Note tone="muted" text={warning} />}
    </>
  );
}
