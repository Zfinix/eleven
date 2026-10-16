import { createRoot, GpuixContext, flushSync, type MutationHost } from "@gpuix/react";
import { expect, test } from "bun:test";
import { type ReactElement, type ReactNode, useEffect } from "react";

import { useNow } from "../src/lib/useNow";

interface ClockRoot {
  readonly renderer: MutationHost;
  render(children: ReactNode): void;
  unmount(): void;
}

function createClockRoot(): ClockRoot {
  const renderer: MutationHost = { applyBatch: (): number[] => [] };
  const root = createRoot(renderer);

  return {
    renderer,
    render: (children): void => flushSync(() => root.render(children)),
    unmount: (): void => flushSync(() => root.unmount()),
  };
}

class WindowActivity {
  private changed: ((active: boolean) => void) | null = null;

  constructor(private active: boolean | null = false) {}

  get listening(): boolean {
    return this.changed !== null;
  }

  readonly isWindowActive = (): boolean | null => this.active;

  readonly setWindowActivation = (changed: ((active: boolean) => void) | null): void => {
    this.changed = changed;
  };

  activate(active: boolean): void {
    this.active = active;
    this.changed?.(active);
  }
}

function Clock({ record, active = true }: {
  readonly record: (now: number) => void;
  readonly active?: boolean;
}): ReactElement {
  const now = useNow(active, 20);
  useEffect(() => record(now), [now, record]);
  return <div>{String(now)}</div>;
}

async function settle(): Promise<void> {
  await Bun.sleep(120);
  flushSync(() => {});
}

test("animation clocks stop when the window is inactive and catch up on activation", async () => {
  const root = createClockRoot();
  const activity = new WindowActivity();
  const renderer = Object.assign(root.renderer, {
    isWindowActive: activity.isWindowActive,
    setWindowActivation: activity.setWindowActivation,
  });
  const ticks: number[] = [];
  const record = (now: number): void => {
    ticks.push(now);
  };

  try {
    root.render(
      <GpuixContext.Provider value={{ renderer }}>
        <Clock record={record} />
      </GpuixContext.Provider>,
    );
    await settle();
    ticks.length = 0;
    await settle();
    expect(ticks).toHaveLength(0);

    const resumedAt = Date.now();
    flushSync(() => activity.activate(true));
    await settle();
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(resumedAt);

    flushSync(() => activity.activate(false));
    await settle();
    ticks.length = 0;
    await settle();
    expect(ticks).toHaveLength(0);
  } finally {
    root.unmount();
  }
});

test("removing one clock preserves window activity for the remaining clock", async () => {
  const root = createClockRoot();
  const activity = new WindowActivity();
  const renderer = Object.assign(root.renderer, {
    isWindowActive: activity.isWindowActive,
    setWindowActivation: activity.setWindowActivation,
  });
  const ticks: number[] = [];
  const record = (now: number): void => {
    ticks.push(now);
  };
  const ignore = (): void => {};
  const render = (children: ReactNode): void => {
    root.render(<GpuixContext.Provider value={{ renderer }}>{children}</GpuixContext.Provider>);
  };

  try {
    render(<><Clock key="first" record={ignore} /><Clock key="second" record={record} /></>);
    await settle();
    render(<Clock key="second" record={record} />);
    await settle();
    ticks.length = 0;

    flushSync(() => activity.activate(true));
    await settle();
    expect(ticks.length).toBeGreaterThan(0);

    render(<Clock key="second" record={record} active={false} />);
    await settle();
    ticks.length = 0;
    flushSync(() => activity.activate(false));
    flushSync(() => activity.activate(true));
    await settle();
    expect(ticks).toHaveLength(0);

    render(<Clock key="second" record={record} />);
    await settle();
    expect(ticks.length).toBeGreaterThan(0);

    render(null);
    await settle();
    expect(activity.listening).toBe(false);
    ticks.length = 0;
    flushSync(() => activity.activate(false));
    flushSync(() => activity.activate(true));
    await settle();
    expect(ticks).toHaveLength(0);
  } finally {
    root.unmount();
  }
});

test.each(["unavailable", "unknown"])("clocks keep working when window activity is %s", async (support) => {
  const root = createClockRoot();
  const activity = new WindowActivity(null);
  const renderer = support === "unavailable" ? root.renderer : Object.assign(root.renderer, {
    isWindowActive: activity.isWindowActive,
    setWindowActivation: activity.setWindowActivation,
  });
  const ticks: number[] = [];
  const record = (now: number): void => {
    ticks.push(now);
  };

  try {
    root.render(<GpuixContext.Provider value={{ renderer }}><Clock record={record} /></GpuixContext.Provider>);
    await settle();
    ticks.length = 0;
    await settle();
    expect(ticks.length).toBeGreaterThan(0);
  } finally {
    root.unmount();
  }
});
