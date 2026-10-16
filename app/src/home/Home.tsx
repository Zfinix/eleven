import { type ReactElement, useEffect, useState } from "react";

import { reportView } from "../bridge/view";
import type { Page } from "../settings/pages";
import { useSettings } from "../settings/store";
import { ProjectsPage } from "../projects/ProjectsPage";
import { Shell } from "../Shell";
import type { ProjectEntry } from "../engine/project";
import type { Target } from "../engine/target";
import { AgentActivity } from "./AgentActivity";
import { Canvas } from "./Canvas";
import { Composer } from "../chat/Composer";
import { Conversation } from "../chat/Conversation";
import { Landing } from "./Landing";
import { dismissNews, isNewsDismissed, LATEST_NEWS } from "./news";
import { Sidebar } from "./Sidebar";
import { threadMenu } from "../chat/threadMenu";
import { type Chat, chatTitle } from "../chat/useChat";
import { WhatsNew } from "./WhatsNew";

export type HomeRoutes = {
  readonly onWorkbench: (target: Target) => void;
  readonly onSetup: () => void;
  readonly onSettings: (page: Page) => void;
};

/** Chat first; the canvas appears when the chat starts or the agent opens code. */
export function Home({ chat, routes }: { readonly chat: Chat; readonly routes: HomeRoutes }): ReactElement {
  const { agents, thread, target } = chat;
  const { messages, tabs, active, canvasOpen } = thread.state;
  const showing = tabs[active]?.procedure ?? null;
  const { settings } = useSettings();
  const [news, setNews] = useState(() => settings.showWhatsNew && !isNewsDismissed(LATEST_NEWS.id));
  const [projectsOpen, setProjectsOpen] = useState(false);
  const closeNews = (): void => {
    dismissNews(LATEST_NEWS.id);
    setNews(false);
  };
  useEffect(() => {
    reportView({ fn: showing, address: null, view: showing ? "pseudocode" : null });
  }, [showing]);
  const composer = (
    <Composer place={messages.length === 0 ? "landing" : "conversation"} target={target} agents={agents} thread={thread} onAttach={chat.openFile} onDetach={chat.detach} onPickAgent={chat.pickAgent} />
  );
  const openProject = (entry: ProjectEntry): void => {
    const opened = chat.openProject(entry);
    if (opened) routes.onWorkbench(opened);
  };
  const toWorkbench = (next: Target): void => {
    setProjectsOpen(false);
    routes.onWorkbench(next);
  };
  const drop = (path: string): void => {
    if (!projectsOpen) {
      chat.choose(path);
      return;
    }
    const next = chat.choose(path, toWorkbench);
    if (next) toWorkbench(next);
  };
  const running = new Set(chat.tabs.filter((tab) => tab.busy).map((tab) => tab.id));
  const menu = { onSettings: () => routes.onSettings("general"), onSetup: routes.onSetup, onWhatsNew: () => setNews(true) };
  const side = <Sidebar projects={chat.projects} project={chat.project} chats={chat.allChats} threads={chat.saved} current={thread.id} running={running} activity={<AgentActivity tabs={chat.tabs} project={chat.project} logoOf={(id) => agents.icons.get(id) ?? null} agentName={(id) => agents.list.find((agent) => agent.id === id)?.name ?? id} onOpenChat={chat.openThread} />} onNewThread={() => { setProjectsOpen(false); thread.reset(); }} onOpen={chat.openFile} onOpenProject={openProject} onSeeAll={() => setProjectsOpen(true)} onOpenThread={chat.openThread} onClearChats={chat.deleteChats} onError={thread.note} menu={menu} threadMenu={(saved, rename) => threadMenu(chat, saved.id, saved.title, rename, () => chat.openThread(saved.id))} />;
  const overlay = news ? <WhatsNew news={LATEST_NEWS} onClose={closeNews} /> : null;
  return (
    <Shell side={side} overlay={overlay} onDrop={(e) => e.paths?.[0] && drop(e.paths[0])}>
      <div style={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
        {projectsOpen ? <ProjectsPage chat={chat} onOpen={(next) => { setProjectsOpen(false); routes.onWorkbench(next); }} /> : messages.length === 0 ? <Landing composer={composer} file={target?.name ?? null} model={target?.kind === "model"} onSuggest={thread.send} showSuggestions={settings.showSuggestions} /> : <Conversation thread={thread} title={chatTitle(chat) ?? ""} agentName={agents.selected.name} composer={composer} onWorkbench={target ? () => routes.onWorkbench(target) : null} />}
        {canvasOpen && tabs.length > 0 && <Canvas tabs={tabs} active={active} target={target} onSelect={thread.selectTab} onLink={thread.openFunction} onWorkbench={target ? () => routes.onWorkbench(target) : null} onClose={thread.closeCanvas} />}
      </div>
    </Shell>
  );
}
