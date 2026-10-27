import "./fixtures/isolate";
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const CHECK = `
const setup = await import(process.env.ELEVEN_SETUP);
const registry = await import(process.env.ELEVEN_REGISTRY);
const { mkdirSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const entry = registry.fallbackAgents().find((agent) => agent.id === "commandcode");
const facts = { native: { path: "/x/commandcode", args: ["acp"] }, downloaded: false, installing: false, failed: false };
const read = () => ({ signedIn: setup.signedIn(entry), status: setup.agentStatus(entry, facts).kind });
const before = read();
mkdirSync(join(process.env.HOME, ".commandcode"), { recursive: true });
writeFileSync(join(process.env.HOME, ".commandcode", "auth.json"), JSON.stringify({ apiKey: "test-key" }));
const after = read();
console.log(JSON.stringify({ before, after }));
`;

test("Command Code login state comes from its auth file under home", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "-e", CHECK],
    env: {
      ...process.env,
      HOME: home,
      ELEVEN_SETUP: join(import.meta.dir, "..", "src", "welcome", "agentSetup.ts"),
      ELEVEN_REGISTRY: join(import.meta.dir, "..", "src", "agents", "registry.ts"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  const output = result.stdout.toString();
  const parsed: unknown = JSON.parse(output);
  if (!isRecord(parsed) || !isRecord(parsed.before) || !isRecord(parsed.after)) throw new Error(`Unexpected login check output: ${output}`);
  const before = parsed.before;
  const after = parsed.after;
  if (typeof before.status !== "string" || typeof after.status !== "string") throw new Error(`Unexpected login check output: ${output}`);
  expect(before.signedIn).toBe(false);
  expect(["ready", "signin"]).toContain(before.status);
  expect(after.signedIn).toBe(true);
  expect(after.status).toBe("ready");
});
