import { useGpuix } from "@gpuix/react";
import { useSyncExternalStore } from "react";

interface WindowActivityHost {
  isWindowActive(): boolean | null;
  setWindowActivation(changed: ((active: boolean) => void) | null): void;
}

function supportsWindowActivity(renderer: unknown): renderer is WindowActivityHost {
  return typeof renderer === "object"
    && renderer !== null
    && "isWindowActive" in renderer
    && typeof renderer.isWindowActive === "function"
    && "setWindowActivation" in renderer
    && typeof renderer.setWindowActivation === "function";
}

class WindowActivityStore {
  private readonly listeners = new Set<() => void>();

  constructor(private readonly renderer: WindowActivityHost) {}

  readonly getSnapshot = (): boolean => this.renderer.isWindowActive() ?? true;

  private readonly notify = (): void => {
    for (const listener of this.listeners) listener();
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    // The native API has one callback slot, shared by every animation clock.
    if (this.listeners.size === 0) this.renderer.setWindowActivation(this.notify);
    this.listeners.add(listener);

    return (): void => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.renderer.setWindowActivation(null);
    };
  };
}

const stores = new WeakMap<WindowActivityHost, WindowActivityStore>();
const alwaysActive = (): boolean => true;
const unsubscribe = (): void => {};
const subscribeWithoutWindow = (): (() => void) => unsubscribe;

export function useWindowActivity(): boolean {
  const { renderer } = useGpuix();
  let store: WindowActivityStore | undefined;

  if (supportsWindowActivity(renderer)) {
    store = stores.get(renderer);
    if (!store) {
      store = new WindowActivityStore(renderer);
      stores.set(renderer, store);
    }
  }

  return useSyncExternalStore(
    store?.subscribe ?? subscribeWithoutWindow,
    store?.getSnapshot ?? alwaysActive,
    alwaysActive,
  );
}
