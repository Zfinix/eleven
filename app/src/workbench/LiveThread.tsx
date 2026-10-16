import type { ReactElement } from "react";

import { QueuePanel, runningTool, Working } from "../chat/Conversation";
import { MessageList } from "../chat/MessageList";
import { useBench } from "./parts";
import { Suggestions } from "./Suggestions";

const PAD = { width: "100%", paddingLeft: 16, paddingRight: 16 } as const;

/** The real conversation, following new messages as they arrive, with function links opening workbench tabs. */
export function LiveThread({ chatId }: { readonly chatId: string | null }): ReactElement {
  const { chat, addrOf, openFn } = useBench();
  const { thread, agents } = chat;
  const { messages, agent, queue } = thread.state;
  const open = (procedure: string): void => {
    const addr = addrOf(procedure);
    if (addr) openFn(addr, false);
  };
  return (
    <MessageList
      key={thread.id}
      messages={messages}
      agentName={agents.selected.name}
      onAnswer={thread.answer}
      onRetry={thread.retry}
      onOpen={open}
      footer={[
        <div key="suggestions" style={{ display: "flex", flexDirection: "column", ...PAD }}>
          <Suggestions chatId={chatId} />
        </div>,
        agent.kind === "working" && (
          <div
            key="working"
            style={{ display: "flex", flexDirection: "column", paddingBottom: 12, ...PAD }}
          >
            <Working since={agent.since} tool={runningTool(messages)} />
          </div>
        ),
        queue.length > 0 && (
          <div
            key="queue"
            style={{ display: "flex", flexDirection: "column", paddingBottom: 12, ...PAD }}
          >
            <QueuePanel queue={queue} onRemove={thread.unqueue} />
          </div>
        ),
      ].filter(Boolean)}
    />
  );
}
