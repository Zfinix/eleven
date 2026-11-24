import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ELEVEN_SUPPORT = mkdtempSync(join(tmpdir(), "eleven-private-"));
const { loadSettings, saveSettings } = await import("../src/settings/store");
const { keepsToThisMac, LOCAL_MODEL_AGENTS } = await import("../src/lib/private");
const { favicon } = await import("../src/chat/favicon");

test("keeping everything on this Mac stops Eleven's own requests and leaves only local-model agents", async () => {
  expect(keepsToThisMac()).toBe(false);
  saveSettings({ ...loadSettings(), keepOnThisMac: true });
  expect(keepsToThisMac()).toBe(true);
  const originalFetch = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = Object.assign(async (): Promise<Response> => {
    asked++;
    return new Response("");
  }, { preconnect: originalFetch.preconnect });
  try {
    expect(await favicon("example.com")).toBeNull();
    expect(asked).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
  expect([...LOCAL_MODEL_AGENTS].sort()).toEqual(["aster", "custom-agent", "goose", "opencode"]);
});
