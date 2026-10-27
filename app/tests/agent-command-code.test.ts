import "./fixtures/isolate";
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadIcon } from "../src/agents/icons";
import { fallbackAgents, parseRegistry, sortAgents, type AgentEntry } from "../src/agents/registry";
import { isRecord } from "../src/lib/guards";

const home = mkdtempSync(join(tmpdir(), "eleven-commandcode-"));

afterAll(() => rmSync(home, { recursive: true, force: true }));

const OPENCODE = { agents: [{ id: "opencode", name: "OpenCode", distribution: { npx: { package: "opencode-ai" } } }] };

function commandCode(entries: readonly AgentEntry[]): AgentEntry {
  const entry = entries.find((item) => item.id === "commandcode");
  if (!entry) throw new Error("Command Code is not in the agent list");
  return entry;
}

test("Command Code ranks between opencode and Aster and starts its own command", () => {
  const sorted = sortAgents([...parseRegistry(OPENCODE), ...fallbackAgents()]);
  const entry = commandCode(sorted);
  expect(entry.name).toBe("Command Code");
  expect(entry.description).toBe("Your local Command Code agent");
  expect(entry.iconUrl).toBeNull();
  const dist = entry.distribution;
  expect(dist.kind).toBe("command");
  if (dist.kind !== "command") throw new Error("Command Code should run a local command");
  expect(dist.command).toBe("commandcode");
  expect(dist.args).toEqual(["acp"]);
  const ids = sorted.map((item) => item.id);
  expect(ids.indexOf("commandcode")).toBeGreaterThan(ids.indexOf("opencode"));
  expect(ids.indexOf("commandcode")).toBeLessThan(ids.indexOf("aster"));
});

test("Command Code ships one logo for light windows and a second for dark ones", async () => {
  const icon = await loadIcon(commandCode(fallbackAgents()));
  if (icon?.kind !== "color") throw new Error("Command Code should use a shipped logo");
  expect(existsSync(icon.light)).toBe(true);
  expect(existsSync(icon.dark)).toBe(true);
  expect(icon.dark).not.toBe(icon.light);
  expect(readFileSync(icon.dark, "utf8")).not.toBe(readFileSync(icon.light, "utf8"));
});

const CHECK = `
const setup = await import(process.env.ELEVEN_SETUP);
const registry = await import(process.env.ELEVEN_REGISTRY);
const { mkdirSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const entry = registry.fallbackAgents().find((agent) => agent.id === "commandcode");
const facts = { native: { path: "/x/commandcode", args: ["acp"] }, downloaded: false, installing: false, failed: false };
if (process.env.ELEVEN_AUTH !== undefined) {
  mkdirSync(join(process.env.HOME, ".commandcode"), { recursive: true });
  writeFileSync(join(process.env.HOME, ".commandcode", "auth.json"), process.env.ELEVEN_AUTH);
}
console.log(JSON.stringify({ signedIn: setup.signedIn(entry), status: setup.agentStatus(entry, facts).kind }));
`;

type CheckOptions = { readonly home: string; readonly auth?: string; readonly apiKey?: string };
type CheckResult = { readonly signedIn: unknown; readonly status: string };

function runCheck(options: CheckOptions): CheckResult {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: options.home,
    ELEVEN_SETUP: join(import.meta.dir, "..", "src", "welcome", "agentSetup.ts"),
    ELEVEN_REGISTRY: join(import.meta.dir, "..", "src", "agents", "registry.ts"),
  };
  delete env.COMMAND_CODE_API_KEY;
  delete env.ELEVEN_AUTH;
  if (options.auth !== undefined) env.ELEVEN_AUTH = options.auth;
  if (options.apiKey !== undefined) env.COMMAND_CODE_API_KEY = options.apiKey;
  const result = Bun.spawnSync({ cmd: [process.execPath, "-e", CHECK], env, stdout: "pipe", stderr: "pipe" });
  const output = result.stdout.toString();
  expect(result.exitCode).toBe(0);
  const parsed: unknown = JSON.parse(output);
  if (!isRecord(parsed) || typeof parsed.status !== "string") throw new Error(`Unexpected login check output: ${output}`);
  return { signedIn: parsed.signedIn, status: parsed.status };
}

test("Command Code without an auth file is not signed in", () => {
  const result = runCheck({ home: join(home, "missing") });
  expect(result.signedIn).toBe(false);
  expect(["ready", "signin"]).toContain(result.status);
});

test("Command Code with a null or empty apiKey is not signed in", () => {
  const nullKey = runCheck({ home: join(home, "null-key"), auth: JSON.stringify({ apiKey: null }) });
  expect(nullKey.signedIn).toBe(false);
  expect(["ready", "signin"]).toContain(nullKey.status);
  const emptyKey = runCheck({ home: join(home, "empty-key"), auth: JSON.stringify({ apiKey: "" }) });
  expect(emptyKey.signedIn).toBe(false);
  expect(["ready", "signin"]).toContain(emptyKey.status);
});

test("Command Code with an apiKey in its auth file is ready", () => {
  const result = runCheck({ home: join(home, "signed-in"), auth: JSON.stringify({ apiKey: "test-key" }) });
  expect(result.signedIn).toBe(true);
  expect(result.status).toBe("ready");
});

test("Command Code with only COMMAND_CODE_API_KEY is signed in", () => {
  const result = runCheck({ home: join(home, "env-key"), apiKey: "test-key" });
  expect(result.signedIn).toBe(true);
  expect(result.status).toBe("ready");
});
