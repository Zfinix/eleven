import type { ReactElement } from "react";

import { QueuePanel, runningTool, Working } from "../chat/Conversation";
import { MessageRow, useRowActions } from "../chat/MessageRow";
import { scrollbar, useTheme } from "../theme";
import { useBench } from "./parts";
import { Suggestions } from "./Suggestions";

const PAD = { width: "100%", paddingLeft: 16, paddingRight: 16 } as const;

/** The real conversation, following new messages as they arrive, with function links opening workbench tabs. */
export function LiveThread({ chatId }: { readonly chatId: string | null }): ReactElement {
  const { p } = useTheme();
  const { wb, chat, addrOf, openFn } = useBench();
  const { thread, agents } = chat;
  const { messages, agent, queue } = thread.state;
  const open = (procedure: string): void => {
    const addr = addrOf(procedure);
    if (addr) openFn(addr, false);
  };
  const actions = useRowActions({ onAnswer: thread.answer, onRetry: thread.retry, onOpen: open, onOpenText: (title, text) => wb.open({ kind: "text", title, text }, false) });
  return (
    <virtual-list followTail alignment="top" estimatedItemHeight={80} style={{ ...scrollbar(p), flexGrow: 1, minHeight: 0 }}>
      {messages.map((message, ix) => (
        <div key={ix} style={{ display: "flex", flexDirection: "column", paddingTop: ix === 0 ? 8 : 0, paddingBottom: 16, ...PAD }}>
          <MessageRow message={message} index={ix} agentName={agents.selected.name} last={ix === messages.length - 1} actions={actions} />
        </div>
      ))}
      <div key="suggestions" style={{ display: "flex", flexDirection: "column", ...PAD }}>
        <Suggestions chatId={chatId} />
      </div>
      {agent.kind === "working" && (
        <div key="working" style={{ display: "flex", flexDirection: "column", paddingBottom: 12, ...PAD }}>
          <Working since={agent.since} tool={runningTool(messages)} />
        </div>
      )}
      {queue.length > 0 && (
        <div key="queue" style={{ display: "flex", flexDirection: "column", paddingBottom: 12, ...PAD }}>
          <QueuePanel queue={queue} onRemove={thread.unqueue} />
        </div>
      )}
    </virtual-list>
  );
}
