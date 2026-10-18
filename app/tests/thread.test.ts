import { expect, test } from "bun:test";

import type { SessionOption } from "../src/agents/events";
import { translate } from "../src/agents/translate";
import { sourcesOf } from "../src/chat/Sources";
import { type Block, EMPTY_THREAD, isCommand, threadReducer } from "../src/chat/thread";

const text = (value: string): Block => ({ kind: "text", text: value });

test("sources: markdown links keep their title, bare links show their site", () => {
  const sources = sourcesOf([text("See [Ghidra's docs](https://www.ghidra-sre.org/docs) and https://github.com/NationalSecurityAgency/ghidra.")]);
  expect(sources).toEqual([
    { href: "https://www.ghidra-sre.org/docs", domain: "ghidra-sre.org", title: "Ghidra's docs" },
    { href: "https://github.com/NationalSecurityAgency/ghidra", domain: "github.com", title: null },
  ]);
});

test("sources: a page the agent fetched counts, and a repeat link adds its title once", () => {
  const fetched: Block = { kind: "tool", step: { id: "1", tool: "WebFetch", input: { url: "https://example.com/a" }, output: "", status: "done", startedAt: 0, endedAt: 1 } };
  const sources = sourcesOf([fetched, text("As [the example](https://example.com/a) says, https://example.com/a")]);
  expect(sources).toEqual([{ href: "https://example.com/a", domain: "example.com", title: "the example" }]);
});

test("sources: no links, no sources", () => {
  expect(sourcesOf([text("FUN_100004088 prints usage and exits.")])).toEqual([]);
});

const model: SessionOption = { id: "model", name: "Model", category: "model", current: "flash", choices: [{ value: "flash", name: "Deepseek Flash Medium", description: null }], legacyMode: false };

test("thread: switching agents drops the old agent's model, mode and commands", () => {
  const ready = threadReducer(threadReducer(EMPTY_THREAD, { type: "event", event: { kind: "connected", agent: "DeepSeek" }, at: 0 }), { type: "event", event: { kind: "options", options: [model] }, at: 0 });
  expect(ready.options).toEqual([model]);
  const switched = threadReducer(ready, { type: "switchAgent" });
  expect(switched.options).toEqual([]);
  expect(switched.commands).toEqual([]);
  expect(switched.agent).toEqual({ kind: "idle" });
});

test("thread: an agent notice shows as a note, never inside the reply", () => {
  const event = translate({ sessionUpdate: "notice", severity: "warning", title: "Fast mode turned off", description: "Requires extra usage to be enabled for this account." }, []);
  expect(event).toEqual({ kind: "notice", text: "Fast mode turned off. Requires extra usage to be enabled for this account." });
  if (!event) return;
  const state = threadReducer(EMPTY_THREAD, { type: "event", event, at: 0 });
  expect(state.messages).toEqual([{ kind: "note", text: "Fast mode turned off. Requires extra usage to be enabled for this account.", tone: "info" }]);
});

test("slash commands: only text that starts with / is a command", () => {
  expect(isCommand("/goal find the license check")).toBe(true);
  expect(isCommand("  /compact")).toBe(true);
  expect(isCommand("what does /usr/lib hold?")).toBe(false);
  expect(isCommand("@main /goal")).toBe(false);
  expect(isCommand("/usr/lib/libswiftCore.dylib, what does this do?")).toBe(false);
  expect(isCommand("/ what")).toBe(false);
  expect(isCommand("/goal")).toBe(true);
});
