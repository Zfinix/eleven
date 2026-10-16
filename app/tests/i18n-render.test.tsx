import { expect, test } from "bun:test";

import { Screen } from "./harness";
import { setLanguage } from "../src/i18n";
import { DARK, ThemeContext } from "../src/theme";
import { EmptyState, StepProgress } from "../src/components/kit";

test("i18n render: kit components draw Chinese when the language is on", () => {
  setLanguage("zh");
  try {
    const screen = new Screen();
    screen.render(
      <ThemeContext.Provider value={{ p: DARK, appearance: "Dark", setAppearance: () => {} }}>
        <div style={{ display: "flex", flexDirection: "column", width: 600 }}>
          <StepProgress title="Opening Notes" steps={[{ label: "Reading the binary", state: "done" as const }, { label: "Finding functions", state: "next" as const }]} note="The first open takes a few seconds." />
          <EmptyState title="No chats" hint="Ask something to start one." />
        </div>
      </ThemeContext.Provider>,
    );
    const text = screen.text();
    expect(text).toContain("正在打开 Notes");
    expect(text).toContain("第 2 步，共 2 步");
    expect(text).toContain("读取二进制文件");
    expect(text).toContain("首次打开需要几秒钟。");
    expect(text).toContain("还没有聊天");
    expect(text).toContain("提问即可开始。");
    screen.unmount();
  } finally {
    setLanguage("en");
  }
});

test("i18n render: the same components stay English by default", () => {
  const screen = new Screen();
  screen.render(
    <ThemeContext.Provider value={{ p: DARK, appearance: "Dark", setAppearance: () => {} }}>
      <EmptyState title="No chats" hint="Ask something to start one." />
    </ThemeContext.Provider>,
  );
  expect(screen.text()).toContain("No chats");
  screen.unmount();
});
