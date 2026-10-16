import { afterEach, expect, test } from "bun:test";

import { adoptLanguage, getLanguage, setLanguage, systemLanguage, tr, trN, type LanguageSetting } from "../src/i18n";
import { LANGUAGES, LANGUAGE_LABELS } from "../src/i18n";
import { DEFAULT_SETTINGS } from "../src/settings/store";

afterEach(() => {
  setLanguage("en");
});

test("i18n: English passes through untouched", () => {
  expect(getLanguage()).toBe("en");
  expect(tr("New chat")).toBe("New chat");
  expect(tr("nothing in the dictionary")).toBe("nothing in the dictionary");
});

test("i18n: Chinese translates dictionary hits and keeps misses in English", () => {
  setLanguage("zh");
  expect(tr("New chat")).toBe("新聊天");
  expect(tr("nothing in the dictionary")).toBe("nothing in the dictionary");
});

test("i18n: inherited property names fall back to English, not to Object's members", () => {
  setLanguage("zh");
  expect(tr("constructor")).toBe("constructor");
  expect(tr("toString")).toBe("toString");
  expect(trN("value: {toString}", {})).toBe("value: {toString}");
  expect(trN("value: {hasOwnProperty}", { n: 1 })).toBe("value: {hasOwnProperty}");
});

test("i18n: patterns fill their values in either language", () => {
  expect(trN("Step {n} of {m}", { n: 2, m: 5 })).toBe("Step 2 of 5");
  setLanguage("zh");
  expect(trN("Step {n} of {m}", { n: 2, m: 5 })).toBe("第 2 步，共 5 步");
  expect(trN("not in the dictionary: {x}", { x: 1 })).toBe("not in the dictionary: 1");
});

test("i18n: the setting maps to the language, auto follows the system", () => {
  adoptLanguage("zh");
  expect(getLanguage()).toBe("zh");
  adoptLanguage("en");
  expect(getLanguage()).toBe("en");
  adoptLanguage("auto");
  expect(getLanguage()).toBe(systemLanguage());
});

test("i18n: settings carry the language, defaulting to auto", () => {
  expect(DEFAULT_SETTINGS.language).toBe("auto");
  for (const value of LANGUAGES) expect(LANGUAGE_LABELS[value as LanguageSetting]).toBeTruthy();
});
