import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { detectInstalled, standaloneAcp } from "../src/agents/detect";
import type { AgentEntry } from "../src/agents/registry";

const home = mkdtempSync(join(tmpdir(), "eleven-grok-"));
const inherited = process.env.PATH;

afterAll(() => rmSync(home, { recursive: true, force: true }));

const grok: AgentEntry = { id: "grok-build", name: "Grok Build", description: "", version: "1.0.0", iconUrl: null, distribution: { kind: "npx", run: { package: "@xai-official/grok@1.0.0", args: ["agent", "stdio"], env: {} } } };

function tool(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "grok");
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, 0o755);
  return path;
}

test.skipIf(process.platform === "win32" || standaloneAcp("grok-build") !== null)("a grok from another project is not taken for xAI's ACP agent", async () => {
  const other = tool(join(home, "other"));
  process.env.PATH = `${join(home, "other")}${delimiter}${inherited ?? ""}`;
  try {
    const found = (await detectInstalled([grok])).get("grok-build");
    expect(found?.command ?? null).toBeNull();
    expect(found?.cli).toBe(other);
  } finally {
    if (inherited === undefined) delete process.env.PATH;
    else process.env.PATH = inherited;
  }
});

test.skipIf(process.platform === "win32")("xai's standalone grok install starts as its own ACP agent", () => {
  const bin = tool(join(home, ".grok", "bin"));
  expect(standaloneAcp("grok-build", home)).toEqual({ path: bin, args: ["agent", "stdio"] });
  expect(standaloneAcp("claude-acp", home)).toBeNull();
});
