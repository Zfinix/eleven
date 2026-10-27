import "./fixtures/isolate";
import { beforeEach, expect, mock, test } from "bun:test";
import { createTestRoot, type TestRoot } from "@gpuix/react/testing";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ReactElement, useState } from "react";

import type { NativeCommand } from "../src/agents/detect";
import type { AgentEvent, SessionOption } from "../src/agents/events";
import type { AgentEntry } from "../src/agents/registry";
import type { Thread } from "../src/chat/useThread";
import type { Target } from "../src/engine/target";
import { loadSettings, saveSettings } from "../src/settings/store";

const MODEL: SessionOption = {
  id: "model",
  name: "Model",
  category: "model",
  current: "opus",
  choices: [
    { value: "opus", name: "Opus", description: null },
    { value: "haiku", name: "Haiku", description: null },
  ],
  legacyMode: false,
};

type Run = { readonly agentId: string; readonly native: NativeCommand | null; stopped: boolean };

const runs: Run[] = [];

class FakeAgentSession {
  readonly run: Run;

  constructor(agent: AgentEntry, native: NativeCommand | null, _cwd: string, sink: (event: AgentEvent) => void) {
    this.run = { agentId: agent.id, native, stopped: false };
    runs.push(this.run);
    sink({ kind: "options", options: [MODEL] });
  }

  restore(): void {}

  stop(): void {
    this.run.stopped = true;
  }
}

mock.module("../src/agents/session", () => ({ AgentSession: FakeAgentSession }));

const { useThread } = await import("../src/chat/useThread");

function agent(id: string, name: string): AgentEntry {
  return { id, name, description: "", version: "1", iconUrl: null, distribution: { kind: "command", command: id, args: [] } };
}

function targetNamed(name: string): Target {
  const path = join(mkdtempSync(join(tmpdir(), "eleven-switch-")), name);
  writeFileSync(path, name);
  return { original: path, path, name, meta: "", arch: "x86_64", kind: "binary" };
}

const CLAUDE = agent("claude-acp", "Claude");
const CODEX = agent("codex-acp", "Codex");
const FIRST = targetNamed("first.bin");
const SECOND = targetNamed("second.bin");

let shown: Thread | null = null;
let chooseAgent: ((id: string) => void) | null = null;
let openTarget: ((target: Target) => void) | null = null;
let detectCommand: ((native: NativeCommand) => void) | null = null;

function Chat(): ReactElement {
  const [agentId, setAgentId] = useState(CLAUDE.id);
  const [target, setTarget] = useState(FIRST);
  const [native, setNative] = useState<NativeCommand | null>(null);
  chooseAgent = setAgentId;
  openTarget = setTarget;
  detectCommand = setNative;
  const thread = useThread(agentId === CODEX.id ? CODEX : CLAUDE, native, target, () => {}, true);
  shown = thread;
  return <div>{`${target.name} ${thread.state.options.length}`}</div>;
}

async function until(ui: TestRoot, check: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    ui.renderer.dispatchNativeEvents();
    ui.renderer.flush();
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out; screen shows: ${ui.renderer.getAllText().join(" | ")}`);
}

beforeEach(() => {
  runs.length = 0;
  shown = null;
  saveSettings({ ...loadSettings(), startAgentWithProject: false });
});

test("switching agent with a file open starts its session, so the options show", async () => {
  const ui = createTestRoot({ width: 600, height: 200 });
  ui.render(<Chat />);
  await until(ui, () => shown !== null);
  expect(runs).toEqual([]);
  expect(shown?.state.options).toEqual([]);

  chooseAgent?.(CODEX.id);
  await until(ui, () => shown?.state.options.length === 1);
  expect(runs.map((run) => run.agentId)).toEqual([CODEX.id]);
  expect(shown?.state.options.map((option) => option.name)).toEqual(["Model"]);

  chooseAgent?.(CLAUDE.id);
  await until(ui, () => runs.length === 2);
  expect(runs.map((run) => run.agentId)).toEqual([CODEX.id, CLAUDE.id]);
  expect(runs[0]?.stopped).toBe(true);
  expect(runs[1]?.stopped).toBe(false);
  ui.unmount();
});

test("opening another file with the gate off starts no session", async () => {
  const ui = createTestRoot({ width: 600, height: 200 });
  ui.render(<Chat />);
  await until(ui, () => shown !== null);
  openTarget?.(SECOND);
  await until(ui, () => ui.renderer.getAllText().join(" ").includes(SECOND.name));
  expect(runs).toEqual([]);
  ui.unmount();
});

test("the command arriving after a switch restarts the session even with the gate off", async () => {
  const command: NativeCommand = { path: "/usr/local/bin/codex-acp", args: [] };
  const ui = createTestRoot({ width: 600, height: 200 });
  ui.render(<Chat />);
  await until(ui, () => shown !== null);

  chooseAgent?.(CODEX.id);
  await until(ui, () => runs.length === 1);
  expect(runs[0]?.native).toBeNull();

  detectCommand?.(command);
  await until(ui, () => runs.length === 2);
  expect(runs.map((run) => run.native)).toEqual([null, command]);
  expect(runs[0]?.stopped).toBe(true);
  expect(runs[1]?.stopped).toBe(false);
  await until(ui, () => shown?.state.options.length === 1);
  ui.unmount();
});

test("the command arriving with no session running starts none with the gate off", async () => {
  const ui = createTestRoot({ width: 600, height: 200 });
  ui.render(<Chat />);
  await until(ui, () => shown !== null);
  detectCommand?.({ path: "/usr/local/bin/claude-acp", args: [] });
  await new Promise((resolve) => setTimeout(resolve, 100));
  ui.renderer.flush();
  expect(runs).toEqual([]);
  ui.unmount();
});
