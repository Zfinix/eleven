import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Desktop } from "../src/lib/native";
import { DEFAULT_SETTINGS } from "../src/settings/store";

process.env.ELEVEN_SUPPORT = mkdtempSync(join(tmpdir(), "eleven-notify-"));
const { askForNotifications } = await import("../src/notify/notify");

function desktop(available: boolean, shown: string[]): Desktop {
  return {
    setMenus: () => {},
    setMenuAction: () => {},
    notificationsAvailable: () => available,
    showNotification: (spec) => {
      shown.push(spec.tag);
    },
    dismissNotification: () => {},
    setNotificationResponse: () => {},
    isWindowActive: () => true,
    setWindowActivation: () => {},
    setDockBadge: () => {},
    requestAttention: () => {},
    activateWindow: () => {},
  };
}

test("notify: macOS's own permission question comes once, as soon as notifications are on", () => {
  const shown: string[] = [];
  const off = { ...DEFAULT_SETTINGS, notifyWhenDone: false, notifyWhenAsked: false, notifyWhenReady: false };
  expect(askForNotifications(desktop(false, shown), DEFAULT_SETTINGS)).toBe(false);
  expect(askForNotifications(desktop(true, shown), off)).toBe(false);
  expect(askForNotifications(desktop(true, shown), DEFAULT_SETTINGS)).toBe(true);
  expect(askForNotifications(desktop(true, shown), DEFAULT_SETTINGS)).toBe(false);
  expect(shown).toEqual(["notifications-asked"]);
});
