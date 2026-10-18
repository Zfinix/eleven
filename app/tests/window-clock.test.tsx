import { expect, test } from "bun:test";
import type { ReactElement } from "react";

import { adoptDesktop } from "../src/lib/native";
import { useNow } from "../src/lib/useNow";
import { Screen } from "./harness";

let active = true;
let notify: ((active: boolean) => void) | null = null;
const none = (): void => {};
adoptDesktop({
  setMenus: none,
  setMenuAction: none,
  notificationsAvailable: (): boolean => false,
  showNotification: none,
  dismissNotification: none,
  setNotificationResponse: none,
  isWindowActive: (): boolean => active,
  setWindowActivation: (changed: ((active: boolean) => void) | null): void => {
    notify = changed;
  },
  setDockBadge: none,
  requestAttention: none,
  activateWindow: none,
});

let ticks = 0;

function Clock(): ReactElement {
  const now = useNow(true, 10);
  ticks += 1;
  return <div>{`tick ${now}`}</div>;
}

function setActive(next: boolean): void {
  active = next;
  notify?.(next);
}

test("clocks stop while the window is in the background and pick up again in front", async () => {
  const screen = new Screen().render(<Clock />);
  await Bun.sleep(60);
  expect(notify).not.toBeNull();
  expect(ticks).toBeGreaterThan(2);

  setActive(false);
  await Bun.sleep(30);
  const paused = ticks;
  await Bun.sleep(80);
  expect(ticks).toBe(paused);

  setActive(true);
  await Bun.sleep(60);
  expect(ticks).toBeGreaterThan(paused);

  screen.unmount();
  expect(notify).toBeNull();
});
