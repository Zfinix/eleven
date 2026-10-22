import { existsSync } from "node:fs";

import { useGpuix } from "@gpuix/react";
import { useEffect, useMemo, useState } from "react";

import type { AgentEntry } from "../agents/registry";
import { documentPath } from "../engine/document";
import { listProjects, onProjectListChange, type ProjectEntry, projectId, rememberProject } from "../engine/project";
import { prepareTarget, type Target } from "../engine/target";
import { t } from "../i18n";
import { errorMessage } from "../lib/guards";
import { pickToOpen } from "../lib/pick";
import { currentSettings, loadSettings, saveSettings, useSettings } from "../settings/store";
import { archsOf } from "../welcome/files";
import type { SliceChoice } from "../welcome/SliceDialog";
import { sliceChoice } from "../welcome/slices";
import { deleteThread, listThreads, loadThread, onThreadsChange, type ThreadSummary } from "./history";
import type { Message } from "./thread";
import { type Agents, useAgents } from "./useAgents";
import { type Thread, useThread } from "./useThread";
import { shownText } from "../skills/load";

const SLOTS = 6;
const SLOT_INDEXES: readonly number[] = Array.from({ length: SLOTS }, (_, slot) => slot);

/** Open chats by slot. Each keeps its own agent, so switching tabs never restarts another tab's agent. */
type Tabs = {
  readonly order: readonly number[];
  readonly active: number;
  readonly agentIds: readonly string[];
};

export type SlicePrompt = {
  readonly choice: SliceChoice;
  readonly pick: (arch: string) => void;
  readonly toggleMatch: () => void;
  readonly cancel: () => void;
  readonly open: () => void;
};

type Slicing = { readonly path: string; readonly choice: SliceChoice; readonly opened: string; readonly then: (target: Target) => void };

export type ChatTab = { readonly id: string; readonly title: string; readonly busy: boolean; readonly active: boolean; readonly agent: string; readonly found: string | null };

function lastFinding(messages: readonly Message[]): string | null {
  for (let at = messages.length - 1; at >= 0; at--) {
    const message = messages[at];
    if (message?.kind !== "agent") continue;
    const text = message.blocks.filter((block) => block.kind === "text").map((block) => block.text).join(" ").trim();
    if (text) return text.replace(/\s+/g, " ").slice(0, 160);
  }
  return null;
}

/** The open project's chats, shared by every screen that shows them. `thread` is the active one; every tab works on `target`. */
export type Chat = {
  readonly agents: Agents;
  readonly thread: Thread;
  readonly tabs: readonly ChatTab[];
  readonly target: Target | null;
  /** The open project's id, or null in the lobby, before any file is open. */
  readonly project: string | null;
  /** Saved chats of the open project, or the lobby's chats when none is open. */
  readonly saved: readonly ThreadSummary[];
  readonly allChats: readonly ThreadSummary[];
  readonly projects: readonly ProjectEntry[];
  readonly openProject: (project: ProjectEntry) => Target | null;
  readonly newTab: () => void;
  readonly selectTab: (id: string) => void;
  readonly closeTab: (id: string) => void;
  readonly openThread: (id: string) => void;
  /** Deletes chats for good, resetting any tab that has one open so it can't save itself back. */
  readonly deleteChats: (ids: readonly string[]) => void;
  readonly choose: (path: string, then?: (target: Target) => void) => Target | null;
  readonly slicePrompt: SlicePrompt | null;
  readonly openFile: () => void;
  readonly detach: () => void;
  readonly pickAgent: (id: string) => void;
};

function replaced<T>(list: readonly T[], index: number, value: T): readonly T[] {
  return list.map((item, ix) => (ix === index ? value : item));
}

function titleOf(thread: Thread, saved: readonly ThreadSummary[]): string | null {
  const named = saved.find((summary) => summary.id === thread.id)?.title;
  if (named) return named;
  const first = thread.state.messages.find((message) => message.kind === "user");
  return first?.kind === "user" ? (shownText(first.text).split("\n")[0] ?? null) : null;
}

function idOf(target: Target | null): string | null {
  if (!target) return null;
  try {
    return projectId(target);
  } catch {
    return null;
  }
}

export function useChat(target: Target | null, onTarget: (target: Target | null) => void): Chat {
  const { renderer } = useGpuix();
  const agents = useAgents();
  const [tabs, setTabs] = useState<Tabs>(() => ({ order: [0], active: 0, agentIds: SLOT_INDEXES.map(() => agents.selected.id) }));
  const [all, setAll] = useState(listThreads);
  const [projects, setProjects] = useState(listProjects);
  const [slicing, setSlicing] = useState<Slicing | null>(null);
  useEffect(() => onThreadsChange(() => setAll(listThreads())), []);
  useEffect(() => onProjectListChange(() => setProjects(listProjects())), []);
  const project = useMemo(() => idOf(target), [target?.path]);
  useEffect(() => {
    if (!target) return;
    try {
      rememberProject(target);
    } catch {
      return;
    }
  }, [project]);
  // A binary changed in place (an agent patching it) hashes to a new project; its chats stay with the file you picked.
  const sameFile = useMemo(() => {
    const opened = projects.find((entry) => entry.id === project);
    if (!opened) return new Set<string | null>([project]);
    return new Set<string | null>([project, ...projects.filter((entry) => entry.original === opened.original).map((entry) => entry.id)]);
  }, [project, projects]);
  const saved = all.filter((summary) => sameFile.has(summary.project));
  const { keepAgentsRunning } = useSettings().settings;
  const agentAt = (slot: number): AgentEntry => agents.list.find((agent) => agent.id === tabs.agentIds[slot]) ?? agents.selected;
  // The slot count never changes, so one useThread per slot keeps the hook order stable.
  // Every slot works on the project's file; only the active chat's agent can move the window to another file.
  const threads = SLOT_INDEXES.map((slot) => {
    const open = tabs.order.includes(slot);
    const active = slot === tabs.active;
    const agent = open ? agentAt(slot) : agents.selected;
    return useThread(agent, agents.installed.get(agent.id)?.command ?? null, target, active ? (next) => retarget(next) : (next) => at(slot).note(t("chat.note.agentWantedOpen", { name: next.name })), open && (active || keepAgentsRunning));
  });
  const at = (slot: number): Thread => {
    const found = threads[slot];
    if (!found) throw new Error(`No chat in slot ${slot}.`);
    return found;
  };
  const thread = at(tabs.active);
  const slotOf = (id: string): number | undefined => tabs.order.find((slot) => at(slot).id === id);
  const idleSlot = (): number | undefined => SLOT_INDEXES.find((slot) => !tabs.order.includes(slot));
  const tooMany = (): void => thread.note(t("chat.note.tooMany", { count: SLOTS }));

  const projectOfChat = (id: string): string | null => all.find((summary) => summary.id === id)?.project ?? null;

  /** Opening another project swaps the whole window: only the chat in front comes along. */
  const show = (slot: number, next: Target | null, order: readonly number[]): void => {
    const moving = idOf(next) !== project;
    setTabs((prev) => ({ ...prev, order: moving ? [slot] : order, active: slot }));
    if (next?.path !== target?.path) onTarget(next);
  };

  /** A chat that already belongs to another project stays there; the new project starts a fresh one. */
  const retarget = (next: Target | null): void => {
    const owner = projectOfChat(thread.id);
    if (owner !== null && owner !== idOf(next)) thread.reset();
    show(tabs.active, next, tabs.order);
  };

  const selectTab = (id: string): void => {
    const slot = slotOf(id);
    if (slot !== undefined && slot !== tabs.active) setTabs((prev) => ({ ...prev, active: slot }));
  };

  const newTab = (): void => {
    const slot = idleSlot();
    if (slot === undefined) return tooMany();
    at(slot).reset();
    setTabs((prev) => ({ ...prev, agentIds: replaced(prev.agentIds, slot, agents.selected.id) }));
    setTabs((prev) => ({ ...prev, order: [...prev.order, slot], active: slot }));
  };

  const closeTab = (id: string): void => {
    const slot = slotOf(id);
    if (slot === undefined) return;
    if (tabs.order.length === 1) return at(slot).reset();
    const order = tabs.order.filter((open) => open !== slot);
    const index = Math.min(tabs.order.indexOf(slot), order.length - 1);
    const neighbor = slot === tabs.active ? (order[index] ?? order[0] ?? 0) : tabs.active;
    setTabs((prev) => ({ ...prev, order, active: neighbor }));
  };

  const openThread = (id: string): void => {
    const open = slotOf(id);
    if (open !== undefined) return selectTab(id);
    const found = loadThread(id);
    if (!found) return;
    const slot = idleSlot();
    if (slot === undefined) return tooMany();
    at(slot).restore(found);
    setTabs((prev) => ({ ...prev, agentIds: replaced(prev.agentIds, slot, agents.selected.id) }));
    if (sameFile.has(found.project)) return show(slot, target, [...tabs.order, slot]);
    let next: Target | null = null;
    try {
      next = found.target ? prepareTarget(found.target) : null;
    } catch {
      at(slot).note(t("chat.note.fileGone", { path: found.target ?? "" }));
    }
    show(slot, next, [...tabs.order, slot]);
  };

  const deleteChats = (ids: readonly string[]): void => {
    const gone = new Set(ids);
    const hit = tabs.order.filter((slot) => gone.has(at(slot).id));
    for (const slot of hit) at(slot).reset();
    const order = tabs.order.filter((slot) => !hit.includes(slot) || slot === tabs.active);
    if (order.length !== tabs.order.length) setTabs((prev) => ({ ...prev, order }));
    for (const id of ids) deleteThread(id);
  };

  const archsToAsk = (path: string): readonly string[] => {
    if (currentSettings().universalApps !== "Ask each time") return [];
    try {
      return archsOf(path);
    } catch {
      return [];
    }
  };
  const openSlice = (path: string, slice: string | null): Target | null => {
    try {
      const next = prepareTarget(path, slice);
      retarget(next);
      return next;
    } catch (err) {
      thread.note(t("chat.note.cantOpenFile", { error: errorMessage(err) }));
      return null;
    }
  };
  const choose = (path: string, then: (target: Target) => void = () => undefined): Target | null => {
    const archs = archsToAsk(path);
    if (archs.length < 2) return openSlice(path, null);
    const choice = sliceChoice(path, archs, false);
    const next = openSlice(path, choice.chosen);
    if (!next) return null;
    setSlicing({ path, choice, opened: choice.chosen, then });
    return next;
  };
  const slicePrompt: SlicePrompt | null = slicing && {
    choice: slicing.choice,
    pick: (arch) => setSlicing({ ...slicing, choice: { ...slicing.choice, chosen: arch } }),
    toggleMatch: () => setSlicing({ ...slicing, choice: { ...slicing.choice, matchThisMac: !slicing.choice.matchThisMac } }),
    cancel: () => setSlicing(null),
    open: () => {
      setSlicing(null);
      if (slicing.choice.matchThisMac) saveSettings({ ...loadSettings(), universalApps: "Open the one for this Mac" });
      if (slicing.choice.chosen === slicing.opened) return;
      const next = openSlice(slicing.path, slicing.choice.chosen);
      if (next) slicing.then(next);
    },
  };

  const openProject = (entry: ProjectEntry): Target | null => {
    if (entry.id === project) return target;
    try {
      const next = prepareTarget(existsSync(entry.original) ? entry.original : (documentPath(entry.id) ?? entry.original));
      if (thread.state.messages.length > 0) thread.reset();
      show(tabs.active, next, tabs.order);
      return next;
    } catch (err) {
      thread.note(t("chat.note.cantOpen", { name: entry.name, error: errorMessage(err) }));
      return null;
    }
  };
  const openFile = async (): Promise<void> => {
    try {
      const first = await pickToOpen(renderer, t("chat.picker.open"));
      if (first) choose(first);
    } catch (err) {
      thread.note(t("chat.note.noPicker", { error: errorMessage(err) }));
    }
  };
  const pickAgent = (id: string): void => {
    if (id === agentAt(tabs.active).id) return;
    agents.select(id);
    setTabs((prev) => ({ ...prev, agentIds: replaced(prev.agentIds, prev.active, id) }));
    if (thread.state.messages.length > 0) thread.note(t("chat.note.switchedAgents"));
  };
  const list = tabs.order.map((slot): ChatTab => {
    const open = at(slot);
    return { id: open.id, title: titleOf(open, saved) ?? t("chat.untitled"), busy: open.busy, active: slot === tabs.active, agent: agentAt(slot).id, found: lastFinding(open.state.messages) };
  });
  return {
    agents: { ...agents, selected: agentAt(tabs.active) },
    thread,
    tabs: list,
    target,
    project,
    saved,
    allChats: all,
    projects,
    openProject,
    newTab,
    selectTab,
    closeTab,
    openThread,
    deleteChats,
    choose,
    openFile: () => void openFile(),
    detach: () => retarget(null),
    pickAgent,
    slicePrompt,
  };
}

export function chatTitle(chat: Chat): string | null {
  return titleOf(chat.thread, chat.saved);
}
