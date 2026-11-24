import { useEffect, useState } from "react";

import { detectInstalled, type Presence } from "../agents/detect";
import { type AgentIcon, loadIcons } from "../agents/icons";
import { type AgentEntry, customAgentEntry, DEFAULT_AGENT_ID, fallbackAgents, loadAgents } from "../agents/registry";
import { loadSettings, useSettings } from "../settings/store";
import { LOCAL_MODEL_AGENTS } from "../lib/private";

export type Agents = {
  readonly list: readonly AgentEntry[];
  readonly icons: ReadonlyMap<string, AgentIcon>;
  readonly installed: ReadonlyMap<string, Presence>;
  readonly selected: AgentEntry;
  readonly select: (id: string) => void;
};

function pick(list: readonly AgentEntry[], id: string): AgentEntry {
  const found = list.find((agent) => agent.id === id) ?? list[0];
  if (!found) throw new Error("No agents are available.");
  return found;
}

function installedFirst(list: readonly AgentEntry[], installed: ReadonlyMap<string, Presence>): readonly AgentEntry[] {
  return [...list.filter((agent) => installed.has(agent.id)), ...list.filter((agent) => !installed.has(agent.id))];
}

/** Zed's ACP agent registry plus local agents, with their official logos. */
export function useAgents(): Agents {
  const [list, setList] = useState<readonly AgentEntry[]>(fallbackAgents);
  const [icons, setIcons] = useState<ReadonlyMap<string, AgentIcon>>(new Map());
  const [installed, setInstalled] = useState<ReadonlyMap<string, Presence>>(new Map());
  const [selectedId, setSelectedId] = useState<string>(loadSettings().defaultAgent ?? DEFAULT_AGENT_ID);

  useEffect(() => {
    const load = async (): Promise<void> => {
      const agents = await loadAgents();
      setList(agents);
      const [found, logos] = await Promise.all([detectInstalled(agents), loadIcons(agents)]);
      setInstalled(found);
      setList(installedFirst(agents, found));
      setIcons(logos);
    };
    void load();
  }, []);

  const { customAgent, keepOnThisMac } = useSettings().settings;
  const custom = customAgentEntry(customAgent);
  const every = custom ? [custom, ...list] : list;
  const local = every.filter((agent) => LOCAL_MODEL_AGENTS.has(agent.id));
  const all = keepOnThisMac && local.length > 0 ? local : every;
  return { list: all, icons, installed, selected: pick(all, selectedId), select: setSelectedId };
}
