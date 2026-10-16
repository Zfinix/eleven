import { useEffect, useRef } from "react";

import type { SavedThread } from "./history";
import { threadRevision } from "./history";
import { releaseThreadSnapshot, saveThreadAsync } from "./historyAsync";
import type { ThreadState } from "./thread";
import { shownText } from "../skills/load";

type PendingSave = { readonly thread: SavedThread; readonly revision: number };
const AUTOSAVE_MS = 5000;

export function useThreadPersistence({
  id,
  state,
  live,
  target,
  project,
  onError,
}: {
  readonly id: string;
  readonly state: ThreadState;
  readonly live: boolean;
  readonly target: string | null;
  readonly project: string | null;
  readonly onError: (error: unknown) => void;
}): void {
  const pending = useRef<PendingSave | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const status = useRef({ id, failed: false, messageCount: 0 });
  const report = useRef(onError);
  report.current = onError;
  if (status.current.id !== id) status.current = { id, failed: false, messageCount: 0 };

  const persist = async (snapshot: PendingSave): Promise<void> => {
    try {
      await saveThreadAsync(snapshot.thread, snapshot.revision);
      if (status.current.id === snapshot.thread.id) status.current.failed = false;
    } catch (error) {
      if (status.current.id !== snapshot.thread.id || status.current.failed) return;
      status.current.failed = true;
      report.current(error);
    }
  };

  const flush = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const snapshot = pending.current;
    pending.current = null;
    if (snapshot) void persist(snapshot);
  };

  useEffect(() => {
    const first = state.messages.find((message) => message.kind === "user");
    if (!live || first?.kind !== "user") return;
    pending.current = {
      revision: threadRevision(id),
      thread: {
        id,
        title: shownText(first.text).split("\n", 1)[0] ?? "",
        target,
        project,
        messages: state.messages,
        updatedAt: Date.now(),
      },
    };
    const addedMessage = status.current.messageCount !== state.messages.length;
    status.current.messageCount = state.messages.length;
    if (addedMessage || state.agent.kind !== "working") flush();
    else timer.current ??= setTimeout(flush, AUTOSAVE_MS);
  }, [id, state.messages, state.agent.kind, target, project, live]);

  useEffect(
    () => () => {
      flush();
      releaseThreadSnapshot(id);
    },
    [id],
  );
}
