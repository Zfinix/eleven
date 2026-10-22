import { memo, type ReactElement, useCallback, useMemo, useRef } from "react";

import type { PermissionChoice } from "../agents/events";
import { useLanguage } from "../i18n";
import { MessageView } from "./MessageView";
import type { Message } from "./thread";

export type RowActions = {
  readonly onAnswer: (index: number, permissionId: number, choice: PermissionChoice | null) => void;
  readonly onRetry: () => void;
  readonly onOpen: (procedure: string) => void;
  readonly onOpenText: (title: string, text: string) => void;
};

/** Callbacks that keep their identity across renders and always call the newest handlers. */
export function useRowActions(actions: RowActions): RowActions {
  const latest = useRef(actions);
  latest.current = actions;
  const onAnswer = useCallback((index: number, id: number, choice: PermissionChoice | null): void => latest.current.onAnswer(index, id, choice), []);
  const onRetry = useCallback((): void => latest.current.onRetry(), []);
  const onOpen = useCallback((procedure: string): void => latest.current.onOpen(procedure), []);
  const onOpenText = useCallback((title: string, text: string): void => latest.current.onOpenText(title, text), []);
  return useMemo(() => ({ onAnswer, onRetry, onOpen, onOpenText }), [onAnswer, onRetry, onOpen, onOpenText]);
}

/** One message; skipped on re-render unless its own message, its props or the language change. */
export const MessageRow = memo(function MessageRow({ message, index, last, agentName, actions }: {
  readonly message: Message;
  readonly index: number;
  readonly last: boolean;
  readonly agentName: string;
  readonly actions: RowActions;
}): ReactElement {
  useLanguage();
  const view = useMemo(
    () => ({
      onAnswer: (choice: PermissionChoice | null): void => {
        if (message.kind === "permission") actions.onAnswer(index, message.id, choice);
      },
      onRetry: actions.onRetry,
      onOpen: actions.onOpen,
      onOpenText: actions.onOpenText,
    }),
    [message, index, actions],
  );
  return <MessageView message={message} agentName={agentName} last={last} actions={view} />;
});
