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
  const fetched: Block = { kind: "tool", step: { id: "1", tool: "WebFetch", toolKind: null, input: { url: "https://example.com/a" }, summary: null, output: "", status: "done", startedAt: 0, endedAt: 1 } };
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

test("thread: a command sent as the title keeps the agent's one-line description apart from its result", () => {
  const command = "dns-sd -B _services._dns-sd._udp local. > /tmp/m1.txt 2>&1 & P=$!; sleep 4; kill $P";
  const start = translate({ sessionUpdate: "tool_call", toolCallId: "t1", title: command, kind: "execute", status: "pending", rawInput: {}, content: [{ type: "content", content: { type: "text", text: "Browse all mDNS service types on the LAN" } }] }, []);
  const finish = translate({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", content: [{ type: "content", content: { type: "text", text: "```console\n_airplay._tcp.local.\n_raop._tcp.local.\n```" } }] }, []);
  if (!start || !finish) throw new Error("expected step events");
  const started = threadReducer(EMPTY_THREAD, { type: "event", event: start, at: 1 });
  const done = threadReducer(started, { type: "event", event: finish, at: 2 });
  const turn = done.messages[0];
  if (turn?.kind !== "agent" || turn.blocks[0]?.kind !== "tool") throw new Error("expected a tool step");
  const step = turn.blocks[0].step;
  expect(step.tool).toBe(command);
  expect(step.toolKind).toBe("execute");
  expect(step.summary).toBe("Browse all mDNS service types on the LAN");
  expect(step.output).toBe("```console\n_airplay._tcp.local.\n_raop._tcp.local.\n```");
  expect(step.status).toBe("done");
});

test("thread: a tool result opens as its own canvas tab, and the same title replaces it", () => {
  const first = threadReducer(EMPTY_THREAD, { type: "openText", title: "Browse mDNS", text: "one" });
  expect(first.tabs).toEqual([{ kind: "result", procedure: "Browse mDNS", code: { kind: "ready", text: "one" } }]);
  expect(first.canvasOpen).toBe(true);
  const again = threadReducer(first, { type: "openText", title: "Browse mDNS", text: "two" });
  expect(again.tabs).toHaveLength(1);
  expect(again.tabs[0]?.code).toEqual({ kind: "ready", text: "two" });
  expect(again.active).toBe(0);
});

test("thread: what you attach travels with the message, and waits in the queue with it", () => {
  const shot = { path: "/tmp/shot.png", name: "shot.png", mime: "image/png", kind: "image" as const, bytes: 10 };
  const sent = threadReducer(EMPTY_THREAD, { type: "sent", draft: { text: "What is this?", attachments: [shot] }, at: 5 });
  expect(sent.messages[0]).toEqual({ kind: "user", text: "What is this?", at: 5, attachments: [shot] });
  const plain = threadReducer(EMPTY_THREAD, { type: "sent", draft: { text: "Hi", attachments: [] }, at: 5 });
  expect(plain.messages[0]).toEqual({ kind: "user", text: "Hi", at: 5 });
  const queued = threadReducer(sent, { type: "queued", draft: { text: "And this", attachments: [shot] } });
  expect(queued.queue).toEqual([{ text: "And this", attachments: [shot] }]);
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

function answered(reply: string, refused = false): string | null {
  const asked = threadReducer(threadReducer(EMPTY_THREAD, { type: "event", event: { kind: "connected", agent: "Claude" }, at: 0 }), { type: "sent", draft: { text: "what does FUN_1000 do?", attachments: [] }, at: 1 });
  const wrote = threadReducer(asked, { type: "event", event: { kind: "text", text: reply }, at: 2 });
  const last = threadReducer(wrote, { type: "event", event: { kind: "turnEnded", cancelled: false, refused }, at: 3 }).messages.at(-1);
  return last?.kind === "agent" ? last.outcome : null;
}

test("thread: a provider refusal, by stop reason or by its words, ends the turn as refused", () => {
  expect(answered("FUN_1000 parses the license key.")).toBe("done");
  expect(answered("", true)).toBe("refused");
  expect(answered("API Error: Claude Code is unable to respond to this request, which appears to violate our Usage Policy.")).toBe("refused");
  expect(answered("The app refuses to run without a license, which is the check we want.")).toBe("done");
});
