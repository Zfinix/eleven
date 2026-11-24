import type { Server } from "node:net";

import type { Chat } from "../chat/useChat";
import { bridgeHandler } from "./handlers";
import { startBridge } from "./server";

let latest: Chat | null = null;

declare global {
  var elevenBridge: Server | undefined;
}

/** The window keeps one bridge across hot reloads; it always answers with the chat currently on screen. */
export function startAppBridge(): void {
  globalThis.elevenBridge ??= startBridge(bridgeHandler(() => {
    if (!latest) throw new Error("Eleven is still starting.");
    return latest;
  }));
}

export function useLiveChat(chat: Chat): void {
  latest = chat;
}

/** The chat on screen, for a message row that needs more than its own thread; null before the window starts. */
export function liveChat(): Chat | null {
  return latest;
}
