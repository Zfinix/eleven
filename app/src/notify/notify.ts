import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { t } from "../i18n";
import { currentDesktop, type Desktop } from "../lib/native";
import { supportDir, supportPath } from "../lib/support";
import { inFront, notify as notifyByScript } from "../lib/platform";
import { currentSettings, type Settings } from "../settings/store";
import { type Moment, noteFor } from "./moments";

/** What clicking a notification does, and what each of its buttons does. */
export type Reply = { readonly open: () => void; readonly buttons?: Readonly<Record<string, () => void>> };

const replies = new Map<string, Reply>();
/** Permission requests nobody answered yet; the Dock badge counts them. */
const waiting = new Set<string>();
const openers = new Set<(chat: string) => void>();

function wanted(moment: Moment, settings: Settings): boolean {
  switch (moment.kind) {
    case "agentDone":
    case "agentStopped":
      return settings.notifyWhenDone;
    case "agentNeedsYou":
      return settings.notifyWhenAsked;
    case "opened":
    case "openFailed":
      return settings.notifyWhenReady;
    default: {
      const unhandled: never = moment;
      return unhandled;
    }
  }
}

/** The window knows when it is in front. Without it (tests, or off the Mac) ask the system, which may say "unknown". */
async function away(desktop: Desktop | null): Promise<boolean> {
  const active = desktop?.isWindowActive() ?? null;
  return active === null ? !(await inFront()) : !active;
}

function showBadge(desktop: Desktop | null): void {
  desktop?.setDockBadge(waiting.size > 0 ? String(waiting.size) : null);
}

/** Tells you about `moment` when you're in another app and asked to hear about it. */
export async function tell(moment: Moment, reply: Reply): Promise<void> {
  const desktop = currentDesktop();
  const note = noteFor(moment);
  if (moment.kind === "agentNeedsYou") {
    waiting.add(note.tag);
    showBadge(desktop);
  }
  if (!wanted(moment, currentSettings()) || !(await away(desktop))) return;
  replies.set(note.tag, reply);
  if (desktop?.notificationsAvailable()) {
    desktop.showNotification({ tag: note.tag, title: note.title, body: note.body, actions: [...note.actions] });
    if (moment.kind === "agentNeedsYou") desktop.requestAttention(false);
    return;
  }
  await notifyByScript(note.title, note.body);
}

/** The question was answered or went away: its notification and its share of the Dock badge go too. */
export function settle(tag: string): void {
  replies.delete(tag);
  const desktop = currentDesktop();
  desktop?.dismissNotification(tag);
  if (waiting.delete(tag)) showBadge(desktop);
}

/** Routes clicks on notifications back to what posted them. */
export function listenForReplies(desktop: Desktop): () => void {
  if (!desktop.notificationsAvailable()) return () => undefined;
  desktop.setNotificationResponse((response) => {
    const reply = replies.get(response.tag);
    if (!reply) return;
    const button = response.actionId ? reply.buttons?.[response.actionId] : undefined;
    if (button) return button();
    desktop.activateWindow();
    reply.open();
  });
  return () => desktop.setNotificationResponse(null);
}

/** Brings a chat to the front, from a notification about it. */
export function openChat(chat: string): void {
  for (const open of openers) open(chat);
}

export function onOpenChat(open: (chat: string) => void): () => void {
  openers.add(open);
  return () => {
    openers.delete(open);
  };
}

const ASKED = "notifications-asked";

/**
 * macOS asks for permission before an app's first notification. Eleven sends
 * that first one as soon as notifications are on, so the question comes now,
 * not in the middle of an agent's work. Only once: macOS remembers the answer.
 */
export function askForNotifications(desktop: Desktop, settings: Settings = currentSettings()): boolean {
  if (!desktop.notificationsAvailable() || !(settings.notifyWhenDone || settings.notifyWhenAsked || settings.notifyWhenReady)) return false;
  const marker = supportPath(ASKED);
  if (existsSync(marker)) return false;
  mkdirSync(supportDir(), { recursive: true });
  writeFileSync(marker, "");
  desktop.showNotification({ tag: ASKED, title: t("notify.on.title"), body: t("notify.on.body"), actions: [] });
  return true;
}
