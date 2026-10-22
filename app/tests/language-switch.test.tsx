import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ELEVEN_SUPPORT = mkdtempSync(join(tmpdir(), "eleven-language-"));

const { App } = await import("../src/App");
const { LATEST_NEWS } = await import("../src/home/news");
const { setLanguage, t } = await import("../src/i18n");
const { en } = await import("../src/i18n/en");
const { runCommand } = await import("../src/lib/shortcuts");
const { loadSettings, saveSettings } = await import("../src/settings/store");
const { markWelcomeDone } = await import("../src/welcome/store");
const { Screen } = await import("./harness");

markWelcomeDone();

test("language: a switch in Settings carries over to Home after Back", async () => {
  const screen = new Screen().render(<App initial={null} />);
  await screen.until(() => screen.text().includes(en["landing.title"]), 20_000);
  expect(screen.text()).toContain(en[LATEST_NEWS.title]);
  runCommand("settings");
  await screen.until(() => screen.labelled(en["settings.back"]) !== null, 10_000);
  saveSettings({ ...loadSettings(), language: "zh" });
  await screen.until(() => screen.labelled(t("settings.back")) !== null && t("settings.back") !== en["settings.back"], 10_000);
  screen.clickLabel(t("settings.back"));
  await screen.until(() => screen.text().includes(t("landing.title")), 10_000);
  const text = screen.text();
  expect(text).toContain(t(LATEST_NEWS.title));
  expect(text).not.toContain(en["landing.title"]);
  expect(text).not.toContain(en[LATEST_NEWS.title]);
  screen.unmount();
  saveSettings({ ...loadSettings(), language: "auto" });
  setLanguage("en");
}, 60_000);
