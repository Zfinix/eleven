import "./fixtures/isolate";

import { afterAll, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

const received: { readonly path: string; readonly body: Record<string, unknown> }[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    received.push({ path: new URL(request.url).pathname, body: await request.json() });
    return new Response(null, { status: 204 });
  },
});
process.env.ELEVEN_TELEMETRY = `http://localhost:${server.port}/api`;
afterAll(() => server.stop(true));

const { crashReport, deviceId, recordCrash, scrub, sendCrashes, signature } = await import("../src/lib/telemetry");
const { currentSettings, saveSettings } = await import("../src/settings/store");
const { supportPath } = await import("../src/lib/support");

function thrown(): Error {
  try {
    JSON.parse("{");
  } catch (error) {
    if (error instanceof Error) return error;
  }
  return new Error("unreachable");
}

test("the device ID is random and stays the same", () => {
  const id = deviceId();
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  expect(deviceId()).toBe(id);
});

test("reports never carry your home folder or user name", () => {
  expect(scrub(`open ${homedir()}/Downloads/app failed`)).toBe("open ~/Downloads/app failed");
  expect(scrub("at /Users/someone/x.ts:1:2")).toBe("at ~/x.ts:1:2");
  expect(scrub("C:\\Users\\someone\\x.ts")).toBe("~\\x.ts");
  const error = new Error(`no file at ${homedir()}/secret.bin`);
  expect(crashReport("exception", error).message).not.toContain(homedir());
});

test("the same crash groups together whatever the line numbers or message", () => {
  const a = thrown();
  const b = new SyntaxError("other");
  b.stack = (a.stack ?? "").replace(/:\d+:\d+/g, ":999:9");
  expect(signature(a)).toBe(signature(b));
  expect(signature(a)).toStartWith("SyntaxError ");
  expect(signature("plain 123")).toBe("Error: plain #");
});

test("crashes wait on disk until crash reports are on, then send once", async () => {
  recordCrash("screen", new Error("off"));
  expect(existsSync(supportPath("crashes"))).toBe(false);

  saveSettings({ ...currentSettings(), crashReports: true });
  recordCrash("screen", thrown(), "in Workbench");
  expect(readdirSync(supportPath("crashes"))).toHaveLength(1);

  await sendCrashes();
  const crash = received.find((r) => r.path === "/api/crash");
  expect(crash?.body.kind).toBe("screen");
  expect(crash?.body.device).toBe(deviceId());
  expect(String(crash?.body.stack)).toContain("in Workbench");
  expect(readdirSync(supportPath("crashes"))).toHaveLength(0);
});
