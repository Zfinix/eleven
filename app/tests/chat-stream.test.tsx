import { expect, mock, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ReactElement, useState } from "react";

import type { AgentEvent } from "../src/agents/events";
import type { Message } from "../src/chat/thread";

process.env.ELEVEN_SUPPORT = mkdtempSync(join(tmpdir(), "eleven-stream-"));

const { createStreamBuffer, useStreamBuffer } = await import("../src/chat/streamBuffer");
const renders = new Map<string, number>();
mock.module("../src/chat/MessageView", () => ({
  MessageView: ({ message }: { readonly message: Message }): ReactElement => {
    const text = message.kind === "note" ? message.text : message.kind;
    renders.set(text, (renders.get(text) ?? 0) + 1);
    return <div>{text}</div>;
  },
}));
const { MessageRow, useRowActions } = await import("../src/chat/MessageRow");
const { Screen } = await import("./harness");

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("stream buffer: text chunks merge into one update after the delay", async () => {
  const applied: AgentEvent[] = [];
  const buffer = createStreamBuffer((event) => applied.push(event), 20);
  buffer.push({ kind: "text", text: "Hel" });
  buffer.push({ kind: "text", text: "lo" });
  buffer.push({ kind: "text", text: " there" });
  expect(applied).toEqual([]);
  await wait(60);
  expect(applied).toEqual([{ kind: "text", text: "Hello there" }]);
});

test("stream buffer: a change of kind keeps the order of text and thoughts", () => {
  const applied: AgentEvent[] = [];
  const buffer = createStreamBuffer((event) => applied.push(event), 1_000);
  buffer.push({ kind: "thought", text: "a" });
  buffer.push({ kind: "thought", text: "b" });
  buffer.push({ kind: "text", text: "c" });
  buffer.flush();
  expect(applied).toEqual([{ kind: "thought", text: "ab" }, { kind: "text", text: "c" }]);
});

test("stream buffer: turn end, permission and failure flush pending text first and pass through at once", () => {
  const applied: AgentEvent[] = [];
  const buffer = createStreamBuffer((event) => applied.push(event), 1_000);
  buffer.push({ kind: "text", text: "done" });
  buffer.push({ kind: "turnEnded", cancelled: false });
  expect(applied).toEqual([{ kind: "text", text: "done" }, { kind: "turnEnded", cancelled: false }]);
  buffer.push({ kind: "text", text: "x" });
  buffer.push({ kind: "permission", id: 1, tool: "Write", input: null, choices: [] });
  buffer.push({ kind: "failed", reason: "gone" });
  expect(applied.slice(2).map((event) => event.kind)).toEqual(["text", "permission", "failed"]);
});

const fromHook: AgentEvent[] = [];
let pushHeld: ((event: AgentEvent) => void) | null = null;

function Streaming(): ReactElement {
  const buffer = useStreamBuffer((event) => fromHook.push(event));
  pushHeld = buffer.push;
  return <div>streaming</div>;
}

test("stream buffer: unmounting flushes held text", async () => {
  const screen = new Screen().render(<Streaming />);
  await screen.until(() => screen.text().includes("streaming"), 5_000);
  pushHeld?.({ kind: "text", text: "last words" });
  expect(fromHook).toEqual([]);
  screen.render(<div>gone</div>);
  await screen.until(() => screen.text().includes("gone"), 5_000);
  expect(fromHook).toEqual([{ kind: "text", text: "last words" }]);
});

const FIRST: Message = { kind: "note", text: "First question", tone: "info" };
let grow: (() => void) | null = null;

function Rows(): ReactElement {
  const [tail, setTail] = useState("Thinking");
  grow = () => setTail((text) => `${text} more`);
  const actions = useRowActions({ onAnswer: () => {}, onRetry: () => {}, onOpen: () => {} });
  const messages: readonly Message[] = [FIRST, { kind: "note", text: tail, tone: "info" }];
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {messages.map((message, ix) => (
        <MessageRow key={ix} message={message} index={ix} agentName="Agent" last={ix === messages.length - 1} actions={actions} />
      ))}
    </div>
  );
}

test("message rows: growing the last message leaves earlier rows alone", async () => {
  const screen = new Screen().render(<Rows />);
  await screen.until(() => screen.text().includes("First question"), 20_000);
  grow?.();
  await screen.until(() => screen.text().includes("Thinking more"), 5_000);
  expect(renders.get("First question")).toBe(1);
  expect(renders.get("Thinking more")).toBe(1);
}, 30_000);
