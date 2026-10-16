import { useEffect, useRef } from "react";

import type { AgentEvent } from "../agents/events";

type Apply = (event: AgentEvent, at: number) => void;
type Pending = { readonly event: AgentEvent; readonly at: number };

export type StreamBuffer = {
  readonly push: (event: AgentEvent) => void;
  readonly flush: () => void;
};

/** Streamed text and thoughts merge into one update per `delay` ms; every other event flushes them first and applies at once. */
export function createStreamBuffer(apply: Apply, delay = 50): StreamBuffer {
  let pending: Pending | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const held = pending;
    pending = null;
    if (held) apply(held.event, held.at);
  };

  const push = (event: AgentEvent): void => {
    if (event.kind !== "text" && event.kind !== "thought") {
      flush();
      apply(event, Date.now());
      return;
    }
    if (pending && pending.event.kind === event.kind) {
      pending = { at: pending.at, event: { kind: event.kind, text: pending.event.text + event.text } };
    } else {
      flush();
      pending = { event, at: Date.now() };
    }
    timer ??= setTimeout(flush, delay);
  };

  return { push, flush };
}

export function useStreamBuffer(apply: Apply): StreamBuffer {
  const latest = useRef(apply);
  latest.current = apply;
  const buffer = useRef<StreamBuffer | null>(null);
  buffer.current ??= createStreamBuffer((event, at) => latest.current(event, at));
  const current = buffer.current;
  useEffect(() => current.flush, [current]);
  return current;
}
