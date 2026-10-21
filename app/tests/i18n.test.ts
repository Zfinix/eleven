import { afterEach, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { en } from "../src/i18n/en";
import { adoptLanguage, getLanguage, isMessageId, LANGUAGE_CODES, LANGUAGE_NAMES, LANGUAGE_SETTINGS, listOf, parseLocale, setLanguage, systemLanguage, t, translate } from "../src/i18n";
import { isRecord } from "../src/lib/guards";
import { DEFAULT_SETTINGS } from "../src/settings/store";

const LOCALES = join(import.meta.dir, "..", "locales");

function slots(text: string): readonly string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();
}

function localeFiles(): readonly string[] {
  return readdirSync(LOCALES).filter((name) => name.endsWith(".json"));
}

afterEach(() => {
  setLanguage("en");
});

test("i18n: every id in a locale file is a real message, with the same placeholders as English", () => {
  expect(localeFiles().length).toBeGreaterThan(0);
  for (const file of localeFiles()) {
    const raw: unknown = JSON.parse(readFileSync(join(LOCALES, file), "utf8"));
    if (!isRecord(raw)) throw new Error(`${file} is not an object of id to text`);
    for (const [id, text] of Object.entries(raw)) {
      expect([file, id, isMessageId(id)]).toEqual([file, id, true]);
      expect([file, id, typeof text]).toEqual([file, id, "string"]);
      if (isMessageId(id) && typeof text === "string") expect([file, id, slots(text)]).toEqual([file, id, slots(en[id])]);
    }
  }
});

test("i18n: each language in the menu has a locale file and each locale file is in the menu", () => {
  const codes = localeFiles().map((file) => file.replace(/\.json$/, ""));
  expect([...codes].sort()).toEqual(LANGUAGE_CODES.filter((code) => code !== "en").sort());
  for (const code of LANGUAGE_CODES) expect(LANGUAGE_NAMES[code]).toBeTruthy();
  expect(LANGUAGE_SETTINGS[0]).toBe("auto");
  expect(DEFAULT_SETTINGS.language).toBe("auto");
});

test("i18n: English is the default and fills its placeholders", () => {
  expect(getLanguage()).toBe("en");
  expect(t("settings.language")).toBe("Language");
  expect(t("kit.step", { current: 2, count: 5 })).toBe("Step 2 of 5");
});

test("i18n: Chinese comes from the locale file, values still filled in", () => {
  setLanguage("zh");
  expect(t("settings.language")).toBe("语言");
  expect(t("kit.skip")).toBe("跳过");
  expect(t("kit.step", { current: 2, count: 5 })).toBe("第 2 步，共 5 步");
  expect(t("device.mac")).toBe("这台 Mac 电脑");
});

test("i18n: a message a translation lacks falls back to English", () => {
  const partial = parseLocale({ "settings.language": "语言" });
  expect(translate(partial, "settings.language")).toBe("语言");
  expect(translate(partial, "settings.language.desc")).toBe("The language menus and buttons speak.");
  expect(translate(partial, "kit.step", { current: 1, count: 2 })).toBe("Step 1 of 2");
});

test("i18n: unknown ids, inherited names, wrong placeholders and non-strings never make it in", () => {
  expect(isMessageId("constructor")).toBe(false);
  expect(isMessageId("toString")).toBe(false);
  expect(isMessageId("__proto__")).toBe(false);
  const raw: unknown = JSON.parse('{"constructor":"x","__proto__":"y","toString":"z","not.a.message":"n","kit.step":"第 {n} 步","settings.language":7,"kit.skip":"跳过"}');
  const parsed = parseLocale(raw);
  expect([...parsed.keys()]).toEqual(["kit.skip"]);
  expect(parseLocale(null).size).toBe(0);
  expect(parseLocale(["a"]).size).toBe(0);
});

test("i18n: the setting maps to a language, Automatic follows the system", () => {
  adoptLanguage("zh");
  expect(getLanguage()).toBe("zh");
  adoptLanguage("en");
  expect(getLanguage()).toBe("en");
  adoptLanguage("auto");
  expect(getLanguage()).toBe(systemLanguage());
  expect(systemLanguage()).toBe("en");
});

test("i18n: lists join the way the language does", () => {
  expect(listOf(["Rizin"])).toBe("Rizin");
  expect(listOf(["Ghidra 12.1", "Java 21"])).toBe("Ghidra 12.1 and Java 21");
  setLanguage("zh");
  expect(listOf(["Ghidra 12.1", "Java 21"])).toBe("Ghidra 12.1和Java 21");
});
