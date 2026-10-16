import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { detectInstalled } from "../src/agents/detect";
import type { AgentEntry } from "../src/agents/registry";

const grok: AgentEntry = { id: "grok-build", name: "Grok Build", description: "", version: "1.0.0", iconUrl: null, distribution: { kind: "npx", run: { package: "@xai-official/grok@1.0.0", args: ["agent", "stdio"], env: {} } } };

test.skipIf(process.platform === "win32")("a standalone grok install starts as its own ACP agent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "eleven-grok-"));
  const bin = join(dir, "grok");
  writeFileSync(bin, "#!/bin/sh\n");
  chmodSync(bin, 0o755);
  const before = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${before ?? ""}`;
  try {
    const found = (await detectInstalled([grok])).get("grok-build");
    expect(found?.command).toEqual({ path: bin, args: ["agent", "stdio"] });
    expect(found?.cli).toBe(bin);
  } finally {
    process.env.PATH = before;
  }
});
