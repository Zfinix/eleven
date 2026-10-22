import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ReactElement, useState } from "react";

import { t } from "../src/i18n";
import { dismissNews, isNewsDismissed, LATEST_NEWS, NEWS } from "../src/home/news";
import { WhatsNew } from "../src/home/WhatsNew";
import type { Page } from "../src/settings/pages";
import { onOpenSettings } from "../src/settings/open";
import { DARK, ThemeContext } from "../src/theme";
import { Screen } from "./harness";

process.env.ELEVEN_SUPPORT = mkdtempSync(join(tmpdir(), "eleven-news-"));

function Card(): ReactElement {
  const [open, setOpen] = useState(!isNewsDismissed(LATEST_NEWS.id));
  const close = (): void => {
    dismissNews(LATEST_NEWS.id);
    setOpen(false);
  };
  return (
    <ThemeContext.Provider value={{ p: DARK, appearance: "Dark", setAppearance: () => {} }}>
      <div style={{ position: "relative", display: "flex", width: 600, height: 600 }}>
        {open && <WhatsNew news={LATEST_NEWS} onClose={close} />}
      </div>
    </ThemeContext.Provider>
  );
}

function titleOf(index: number): string {
  const item = NEWS[index];
  return item ? t(item.title) : "?";
}

let screen: Screen;

beforeAll(() => {
  screen = new Screen().render(<Card />);
});

afterAll(() => screen.unmount());

const opened: Page[] = [];
const stop = onOpenSettings((page) => opened.push(page));
afterAll(() => stop());

test("what's new: the card opens on the newest news, one of several", async () => {
  expect(NEWS.length).toBeGreaterThan(1);
  await screen.until(() => screen.text().includes(t(LATEST_NEWS.title)), 5_000);
  expect(screen.text()).toContain(`What's new · 1 of ${NEWS.length}`);
});

test("what's new: you can page through the cards, and a plain card's button moves on", async () => {
  screen.clickLabel("Next");
  await screen.until(() => screen.text().includes(`2 of ${NEWS.length}`), 5_000);
  const plain = NEWS.findIndex((item, index) => item.action.kind === "none" && index < NEWS.length - 1);
  screen.clickLabel(`Card ${plain + 1} of ${NEWS.length}`);
  await screen.until(() => screen.text().includes(titleOf(plain)), 5_000);
  screen.click("Next");
  await screen.until(() => screen.text().includes(`${plain + 2} of ${NEWS.length}`), 5_000);
});

test("what's new: a settings button opens that Settings page and closes the card", async () => {
  const index = NEWS.findIndex((item) => item.action.kind === "settings");
  const item = NEWS[index];
  if (!item || item.action.kind !== "settings") throw new Error("no settings card");
  screen.clickLabel(`Card ${index + 1} of ${NEWS.length}`);
  await screen.until(() => screen.text().includes(t(item.title)), 5_000);
  screen.click(t(item.action.label));
  await screen.until(() => !screen.text().includes(t(item.title)), 5_000);
  expect(opened).toContain(item.action.page);
  expect(isNewsDismissed(LATEST_NEWS.id)).toBe(true);
});
