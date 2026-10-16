import { useEffect, useState } from "react";

import { useWindowActivity } from "./windowActivity";

/** The current time, refreshed while the animation and its window are active. */
export function useNow(active: boolean, everyMs = 1000): number {
  const windowActive = useWindowActivity();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!active || !windowActive) return;

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs, windowActive]);

  return now;
}

export function seconds(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}
