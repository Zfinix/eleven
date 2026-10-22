import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { PlainId } from "../i18n";
import { isRecord } from "../lib/guards";
import { supportPath } from "../lib/support";
import type { Page } from "../settings/pages";

/** The picture at the top of a card: logos (paths under assets), or a screenshot from assets/news. */
export type NewsArt =
  | { readonly kind: "logos"; readonly files: readonly string[] }
  | { readonly kind: "shot"; readonly file: string };

/** What the card's button does: open a Settings page, or nothing. */
export type NewsAction =
  | { readonly kind: "settings"; readonly label: PlainId; readonly page: Page }
  | { readonly kind: "none" };

export type News = {
  readonly id: string;
  readonly title: PlainId;
  readonly body: PlainId;
  readonly art: NewsArt;
  readonly action: NewsAction;
};

/** Newest first; the card opens on the first one. */
export const NEWS: readonly [News, ...News[]] = [
  {
    id: "notifications",
    title: "news.notifications.title",
    body: "news.notifications.body",
    art: { kind: "logos", files: ["icons/thread.svg", "icons/new-chat.svg"] },
    action: { kind: "settings", label: "news.notifications.action", page: "chat" },
  },
  {
    id: "ask-about-lines",
    title: "news.askLines.title",
    body: "news.askLines.body",
    art: { kind: "shot", file: "ask.png" },
    action: { kind: "settings", label: "news.askLines.action", page: "agents" },
  },
  {
    id: "source-files",
    title: "news.sourceFiles.title",
    body: "news.sourceFiles.body",
    art: { kind: "logos", files: ["icons/lang-swift.svg", "icons/lang-objc.svg", "icons/lang-java.svg", "icons/lang-kotlin.svg"] },
    action: { kind: "none" },
  },
  {
    id: "android-apps",
    title: "news.android.title",
    body: "news.android.body",
    art: { kind: "logos", files: ["formats/android.svg"] },
    action: { kind: "none" },
  },
  {
    id: "binary-diffs",
    title: "news.diffs.title",
    body: "news.diffs.body",
    art: { kind: "logos", files: ["icons/binary.svg", "icons/split.svg"] },
    action: { kind: "none" },
  },
  {
    id: "gpu-kernels",
    title: "news.kernels.title",
    body: "news.kernels.body",
    art: { kind: "logos", files: ["formats/nvidia.svg", "formats/amd.svg"] },
    action: { kind: "none" },
  },
  {
    id: "model-files",
    title: "news.models.title",
    body: "news.models.body",
    art: { kind: "logos", files: ["formats/llama-cpp.svg", "formats/onnx.svg", "formats/pytorch.svg", "formats/huggingface.svg"] },
    action: { kind: "none" },
  },
  {
    id: "window-glass",
    title: "news.glass.title",
    body: "news.glass.body",
    art: { kind: "shot", file: "glass.png" },
    action: { kind: "settings", label: "news.glass.action", page: "appearance" },
  },
];

export const LATEST_NEWS: News = NEWS[0];

function dismissed(): readonly string[] {
  try {
    const json: unknown = JSON.parse(readFileSync(supportPath("news.json"), "utf8"));
    if (!isRecord(json) || !Array.isArray(json.dismissed)) return [];
    return json.dismissed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export function isNewsDismissed(id: string): boolean {
  return dismissed().includes(id);
}

export function dismissNews(id: string): void {
  try {
    const file = supportPath("news.json");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ dismissed: [...dismissed().filter((seen) => seen !== id), id] }, null, 2)}\n`);
  } catch {
    return;
  }
}
