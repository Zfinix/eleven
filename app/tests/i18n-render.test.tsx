import { afterEach, expect, test } from "bun:test";
import type { ReactElement } from "react";

import { Screen } from "./harness";
import { setLanguage, useLanguage } from "../src/i18n";
import { EmptyState, StepProgress } from "../src/components/kit";
import { Landing } from "../src/home/Landing";
import { Nav } from "../src/settings/Nav";
import { DARK, ThemeContext } from "../src/theme";

afterEach(() => {
  setLanguage("en");
});

/** The app root reads the language, so everything under it redraws when it changes. */
function Root(): ReactElement {
  useLanguage();
  return (
    <ThemeContext.Provider value={{ p: DARK, appearance: "Dark", setAppearance: () => {} }}>
      <div style={{ display: "flex", width: 1200, height: 860 }}>
        <Nav page="general" query="" shown={() => true} badges={new Set()} onQuery={() => {}} onOpen={() => {}} onBack={() => {}} />
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
          <Landing composer={null} file="/bin/ls" onSuggest={() => {}} />
          <StepProgress title="Opening ls" steps={[{ label: "Reading the binary", state: "done" }, { label: "Finding functions", state: "next" }]} note="The first open takes a few seconds." />
        </div>
      </div>
    </ThemeContext.Provider>
  );
}

test("i18n render: switching to Chinese redraws the interface's own words", async () => {
  const screen = new Screen().render(<Root />);
  await screen.until(() => screen.text().includes("What should we take apart?"));
  expect(screen.text()).toContain("General");
  expect(screen.text()).toContain("Step 2 of 2");
  setLanguage("zh");
  await screen.until(() => screen.text().includes("今天拆点什么？"));
  const text = screen.text();
  expect(text).toContain("通用");
  expect(text).toContain("外观");
  expect(text).toContain("第 2 步，共 2 步");
  expect(text).toContain("/bin/ls 启动时做了什么？");
  expect(text).not.toContain("What should we take apart?");
  setLanguage("en");
  await screen.until(() => screen.text().includes("What should we take apart?"));
  screen.unmount();
});

test("i18n render: names and text handed to the kit stay as they are", async () => {
  setLanguage("zh");
  const screen = new Screen().render(
    <ThemeContext.Provider value={{ p: DARK, appearance: "Dark", setAppearance: () => {} }}>
      <div style={{ display: "flex", flexDirection: "column", width: 600 }}>
        <StepProgress title="Opening Notes" steps={[{ label: "Reading the binary", state: "done" }, { label: "Finding functions", state: "next" }]} note="The first open takes a few seconds." />
        <EmptyState title="constructor" hint="No chats" />
      </div>
    </ThemeContext.Provider>,
  );
  await screen.until(() => screen.text().includes("第 2 步，共 2 步"));
  const text = screen.text();
  expect(text).toContain("Opening Notes");
  expect(text).toContain("Reading the binary");
  expect(text).toContain("constructor");
  expect(text).toContain("No chats");
  screen.unmount();
});
