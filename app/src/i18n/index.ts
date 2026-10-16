import { execSync } from "node:child_process";
import { useSyncExternalStore } from "react";

import { ZH } from "./zh";

export type Language = "en" | "zh";

export type LanguageSetting = "auto" | Language;

/** The languages offered in Settings, in menu order. */
export const LANGUAGES: readonly LanguageSetting[] = ["auto", "en", "zh"];

/** What each choice shows in the menu; Chinese names itself, as its speakers expect. */
export const LANGUAGE_LABELS: Readonly<Record<LanguageSetting, string>> = { auto: "Automatic", en: "English", zh: "简体中文" };

let language: Language = "en";

const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return language;
}

export function setLanguage(next: Language): void {
  if (next === language) return;
  language = next;
  for (const listen of listeners) listen();
}

function subscribe(listen: () => void): () => void {
  listeners.add(listen);
  return () => { listeners.delete(listen); };
}

/** Reads the language in a component, so switching it re-renders whatever called this. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, getLanguage);
}

/** The Chinese for an interface string, or the string itself when English is on or no entry exists. */
export function tr(text: string): string {
  return language === "zh" ? ZH[text] ?? text : text;
}

/** The same for a sentence with values in it, like trN("Step {n} of {m}", { n: 2, m: 5 }). */
export function trN(pattern: string, args: Readonly<Record<string, string | number>>): string {
  return tr(pattern).replace(/\{(\w+)\}/g, (whole, key: string) => key in args ? String(args[key]) : whole);
}

/** The system's language, for the Automatic setting. */
export function systemLanguage(): Language {
  // macOS GUI apps can run with a LANG that ignores the user's system language, so ask it directly.
  if (process.platform === "darwin") {
    try {
      const listed = execSync("defaults read -g AppleLanguages", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const first = listed.match(/"[^"]+"/)?.[0] ?? "";
      if (/^"zh/i.test(first)) return "zh";
    } catch {
      // fall through to the locale checks below
    }
  }
  for (const setting of [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG]) {
    if (setting !== undefined && /^zh/i.test(setting)) return "zh";
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

/** Applies the saved setting: "auto" follows the system, anything else is that language. */
export function adoptLanguage(setting: LanguageSetting): void {
  setLanguage(setting === "auto" ? systemLanguage() : setting);
}
