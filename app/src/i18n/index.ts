import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { useSyncExternalStore } from "react";

import { isRecord } from "../lib/guards";
import { OS } from "../lib/platform";
import { runSync } from "../lib/process";
import { en, type MessageId } from "./en";

export type { MessageId } from "./en";

/** Each language has a file in app/locales named by its code. English is the source in en.ts. */
export const LANGUAGE_CODES = ["en", "zh"] as const;

export type Language = (typeof LANGUAGE_CODES)[number];

export const LANGUAGE_SETTINGS = ["auto", ...LANGUAGE_CODES] as const;

export type LanguageSetting = (typeof LANGUAGE_SETTINGS)[number];

/** Each language names itself in the menu, as its speakers expect. */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = { en: "English", zh: "简体中文" };

type Slots<Text extends string> = Text extends `${string}{${infer Name}}${infer Rest}` ? Name | Slots<Rest> : never;

export type Values<Id extends MessageId> = { readonly [Name in Slots<(typeof en)[Id]>]: string | number };

type Args<Id extends MessageId> = [Slots<(typeof en)[Id]>] extends [never] ? [] : [values: Values<Id>];

/** A message with no {placeholders}, for tables of labels. */
export type PlainId = { [Id in MessageId]: [Slots<(typeof en)[Id]>] extends [never] ? Id : never }[MessageId];

export type Messages = ReadonlyMap<MessageId, string>;

const SLOT = /\{(\w+)\}/g;

export function isMessageId(value: string): value is MessageId {
  return Object.hasOwn(en, value);
}

function slotsOf(text: string): string {
  return [...text.matchAll(SLOT)].map((match) => match[1] ?? "").sort().join(",");
}

/** The entries of a locale file that name a real message and keep its {placeholders}; anything else is dropped. */
export function parseLocale(raw: unknown): Messages {
  if (!isRecord(raw)) return new Map();
  return new Map(Object.entries(raw).flatMap(([id, text]) => (isMessageId(id) && typeof text === "string" && slotsOf(text) === slotsOf(en[id]) ? [[id, text] as const] : [])));
}

function fill(text: string, values: Readonly<Record<string, string | number>>): string {
  return text.replace(SLOT, (whole, name: string) => (Object.hasOwn(values, name) ? String(values[name]) : whole));
}

/** The message in the given translation, or the English when it has none. */
export function translate<Id extends MessageId>(messages: Messages, id: Id, ...args: Args<Id>): string {
  const [values] = args;
  const text = messages.get(id) ?? en[id];
  return values ? fill(text, values) : text;
}

function localeDir(): string {
  const bundled = join(dirname(process.execPath), "..", "Resources", "locales");
  return existsSync(bundled) ? bundled : join(import.meta.dir, "..", "..", "locales");
}

function readLocale(language: Language): Messages {
  if (language === "en") return new Map();
  try {
    return parseLocale(JSON.parse(readFileSync(join(localeDir(), `${language}.json`), "utf8")));
  } catch {
    return new Map();
  }
}

let current: { readonly language: Language; readonly messages: Messages } = { language: "en", messages: new Map() };

const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current.language;
}

export function setLanguage(next: Language): void {
  if (next === current.language) return;
  current = { language: next, messages: readLocale(next) };
  for (const listen of listeners) listen();
}

function subscribe(listen: () => void): () => void {
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
  };
}

/** Reads the language in a component, so switching it re-renders whatever called this. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, getLanguage);
}

/** An interface message in the current language, with {placeholders} filled from values. */
export function t<Id extends MessageId>(id: Id, ...args: Args<Id>): string {
  return translate(current.messages, id, ...args);
}

/** Names joined the way the current language lists them: "Rizin and Ghidra". */
export function listOf(names: readonly string[]): string {
  return new Intl.ListFormat(current.language, { type: "conjunction" }).format(names);
}

/** How copy refers to the machine: "this Mac" on a Mac, "this computer" elsewhere. */
export function thisDevice(): string {
  return OS === "mac" ? t("device.mac") : t("device.computer");
}

function asLanguage(tag: string): Language | null {
  const code = tag.toLowerCase().split(/[-_.]/)[0] ?? "";
  return LANGUAGE_CODES.find((known) => known === code) ?? null;
}

function preferredTags(): readonly string[] {
  const tags: string[] = [];
  if (OS === "mac") {
    try {
      // A GUI app's LANG often says en_US whatever the user picked, so ask macOS for its list.
      const listed = runSync("defaults", ["read", "-g", "AppleLanguages"], { stdio: ["ignore", "pipe", "ignore"] });
      tags.push(...listed.split("\n").map((line) => line.replace(/[\s",()]/g, "")).filter((tag) => tag !== ""));
    } catch {
      // No preference list; the environment below still says something.
    }
  }
  for (const value of [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG]) if (value) tags.push(value);
  tags.push(Intl.DateTimeFormat().resolvedOptions().locale);
  return tags;
}

/** The first of the system's preferred languages that Eleven has, else English. Tests always get English. */
export function systemLanguage(): Language {
  if (process.env.NODE_ENV === "test") return "en";
  for (const tag of preferredTags()) {
    const language = asLanguage(tag);
    if (language) return language;
  }
  return "en";
}

/** Applies the saved setting: "auto" follows the system, anything else is that language. */
export function adoptLanguage(setting: LanguageSetting): void {
  setLanguage(setting === "auto" ? systemLanguage() : setting);
}
