import type { EventPayload } from "@gpuix/react";
import { useState } from "react";

const OVERSCAN = 40;

type Range = { readonly start: number; readonly end: number };

export type ListWindow = Range & { readonly onVisibleRange: (event: EventPayload) => void };

/** The slice of a `<virtual-list>` worth mounting: what's visible plus a margin, moved only near its edges. */
export function useListWindow(count: number, overscan = OVERSCAN, startAtEnd = false): ListWindow {
  const [range, setRange] = useState<Range>(() => ({
    start: startAtEnd ? Math.max(0, count - overscan * 2) : 0,
    end: startAtEnd ? count : overscan * 2,
  }));
  const onVisibleRange = (event: EventPayload): void => {
    const first = event.startIndex ?? 0;
    const last = event.endIndex ?? first;
    setRange((current) => {
      const nearStart = current.start > 0 && first - current.start < overscan / 2;
      const nearEnd = current.end < count && current.end - last < overscan / 2;
      if (!nearStart && !nearEnd) return current;
      return { start: Math.max(0, first - overscan), end: last + overscan };
    });
  };
  const start = range.start < count ? range.start : Math.max(0, count - overscan * 2);
  return { start, end: Math.min(count, Math.max(range.end, start + overscan * 2)), onVisibleRange };
}
