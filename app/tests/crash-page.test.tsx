import { afterAll, expect, test } from "bun:test";
import type { ReactElement } from "react";

import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { DARK, ThemeContext } from "../src/theme";
import { Screen } from "./harness";

let broken = true;
let homes = 0;

function Fragile(): ReactElement {
  if (broken) throw new Error("boom");
  return <div>Home screen</div>;
}

function App(): ReactElement {
  return (
    <ThemeContext.Provider value={{ p: DARK, appearance: "Dark", setAppearance: () => {} }}>
      <ErrorBoundary dev={false} onHome={() => { broken = false; homes += 1; }}>
        <Fragile />
      </ErrorBoundary>
    </ThemeContext.Provider>
  );
}

const screen = new Screen().render(<App />);
afterAll(() => screen.unmount());

test("a crash in the app shows the crash page, and Back to Home recovers", async () => {
  await screen.until(() => screen.text().includes("This screen stopped working"), 5000);
  expect(screen.text()).not.toContain("boom");
  screen.click("Back to Home");
  await screen.until(() => screen.text().includes("Home screen"), 5000);
  expect(homes).toBe(1);
});
