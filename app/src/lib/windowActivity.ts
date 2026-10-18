import { useSyncExternalStore } from "react";

import { currentDesktop } from "./native";

const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** The window has one activation callback, so every clock shares this one. */
function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) currentDesktop()?.setWindowActivation(changed);
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
    if (listeners.size === 0) currentDesktop()?.setWindowActivation(null);
  };
}

function windowActive(): boolean {
  return currentDesktop()?.isWindowActive() ?? true;
}

/** Whether the window is in front. Always true where there is no native window. */
export function useWindowActive(): boolean {
  return useSyncExternalStore(subscribe, windowActive, windowActive);
}
