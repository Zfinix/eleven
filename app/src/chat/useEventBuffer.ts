import { useEffect, useRef } from "react";

import type { AgentEvent } from "../agents/events";
import type { ThreadAction } from "./thread";

type TimedEvent = { readonly event: AgentEvent; readonly at: number };
type EventBuffer = { readonly push: (event: AgentEvent) => void; readonly flush: () => void };

/** Stream updates share a frame; permissions and completion flush everything in order. */
export function useEventBuffer(dispatch: (action: ThreadAction) => void): EventBuffer {
  const pending = useRef<TimedEvent[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const events = pending.current;
    pending.current = [];
    if (events.length > 0) dispatch({ type: "events", events });
  };

  const push = (event: AgentEvent): void => {
    const at = Date.now();
    const last = pending.current[pending.current.length - 1];
    if ((event.kind === "text" || event.kind === "thought") && last?.event.kind === event.kind) {
      pending.current[pending.current.length - 1] = {
        at: last.at,
        event: { ...event, text: last.event.text + event.text },
      };
    } else {
      pending.current.push({ event, at });
    }
    const streaming = event.kind === "text" || event.kind === "thought" || event.kind === "step";
    if (!streaming || pending.current.length >= 32) flush();
    else timer.current ??= setTimeout(flush, 50);
  };

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      pending.current = [];
    },
    [],
  );

  return { push, flush };
}
