import { memo, type ReactElement, type ReactNode, useCallback, useMemo, useRef } from "react";

import type { PermissionChoice } from "../agents/events";
import { useListWindow } from "../lib/useListWindow";
import { MessageView } from "./MessageView";
import type { Message } from "./thread";

type Actions = {
  readonly onAnswer: (index: number, permissionId: number, choice: PermissionChoice | null) => void;
  readonly onRetry: () => void;
  readonly onOpen: (procedure: string) => void;
};

const MessageRow = memo(function MessageRow({
  message,
  index,
  last,
  agentName,
  centered,
  onAnswer,
  onRetry,
  onOpen,
}: Actions & {
  readonly message: Message;
  readonly index: number;
  readonly last: boolean;
  readonly agentName: string;
  readonly centered: boolean;
}): ReactElement {
  const actions = useMemo(
    () => ({
      onAnswer: (choice: PermissionChoice | null): void => {
        if (message.kind === "permission") onAnswer(index, message.id, choice);
      },
      onRetry,
      onOpen,
    }),
    [message, index, onAnswer, onRetry, onOpen],
  );

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        width: "100%",
        paddingLeft: centered ? 20 : 16,
        paddingRight: centered ? 20 : 16,
        paddingTop: index === 0 ? (centered ? 22 : 8) : 0,
        paddingBottom: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          ...(centered ? { maxWidth: 680 } : {}),
        }}
      >
        <MessageView message={message} agentName={agentName} last={last} actions={actions} />
      </div>
    </div>
  );
});

/** Both chat surfaces mount only the messages near the viewport. */
export function MessageList({
  messages,
  agentName,
  centered = false,
  footer,
  ...actions
}: Actions & {
  readonly messages: readonly Message[];
  readonly agentName: string;
  readonly centered?: boolean;
  readonly footer: readonly ReactNode[];
}): ReactElement {
  const count = messages.length + footer.length;
  const shown = useListWindow(count, 4, true);
  const latest = useRef(actions);
  latest.current = actions;

  const onAnswer = useCallback(
    (index: number, id: number, choice: PermissionChoice | null): void => {
      latest.current.onAnswer(index, id, choice);
    },
    [],
  );
  const onRetry = useCallback((): void => latest.current.onRetry(), []);
  const onOpen = useCallback((procedure: string): void => latest.current.onOpen(procedure), []);

  return (
    <virtual-list
      followTail
      alignment="top"
      itemCount={count}
      windowStart={shown.start}
      estimatedItemHeight={120}
      onVisibleRange={shown.onVisibleRange}
      style={{ flexGrow: 1, minHeight: 0 }}
    >
      {Array.from({ length: shown.end - shown.start }, (_, offset) => {
        const index = shown.start + offset;
        const message = messages[index];
        return message ? (
          <MessageRow
            key={index}
            message={message}
            index={index}
            last={index === messages.length - 1}
            agentName={agentName}
            centered={centered}
            onAnswer={onAnswer}
            onRetry={onRetry}
            onOpen={onOpen}
          />
        ) : (
          <div
            key={`footer-${index - messages.length}`}
            style={{ display: "flex", flexDirection: "column", width: "100%" }}
          >
            {footer[index - messages.length]}
          </div>
        );
      })}
    </virtual-list>
  );
}
