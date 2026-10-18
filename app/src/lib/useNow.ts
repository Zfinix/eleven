import { useEffect, useState } from "react";

import { useWindowActive } from "./windowActivity";

/** The current time, refreshed every `everyMs` while `active` and the window is in front. */
export function useNow(active: boolean, everyMs = 1000): number {
  const inFront = useWindowActive();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active || !inFront) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs, inFront]);
  return now;
}

export function seconds(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}
