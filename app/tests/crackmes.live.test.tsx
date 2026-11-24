import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReactElement } from "react";

import { adoptLoginShell } from "../src/agents/detect";
import { startAppBridge, useLiveChat } from "../src/bridge/live";
import { type Chat, useChat } from "../src/chat/useChat";
import { prepareTarget, type Target } from "../src/engine/target";
import { adoptToolchain } from "../src/engine/toolchain";
import { loadSkills, skillPrompt } from "../src/skills/load";
import { Screen } from "./harness";

/** Crackmes with answers that are checked by running them, so a score can't come from a confident wrong reply. */
const ALL = ["plain", "xor", "table", "stack", "rot", "checksum"] as const;
const PICKED = process.env.CRACKMES ? ALL.filter((name) => process.env.CRACKMES?.split(",").includes(name)) : ALL;
const SOURCES = join(import.meta.dir, "fixtures", "crackmes");
const BUILT = mkdtempSync(join(tmpdir(), "eleven-crackmes-"));
const TURN_MS = 6 * 60_000;

const PROMPT = "This program prints Correct for one input passed as its only argument, and Wrong otherwise. Find an input that makes it print Correct by reading the code with your tools. Don't run the program. End your reply with one line: ANSWER: <the input>";

/** The question, run through one of Eleven's playbooks when CRACKME_SKILL names one, to measure what it adds. */
function prompt(): string {
  const wanted = process.env.CRACKME_SKILL;
  if (!wanted) return PROMPT;
  const skill = loadSkills().find((item) => item.name === wanted);
  if (!skill) throw new Error(`No skill called ${wanted}.`);
  return skillPrompt(skill, PROMPT);
}

type Result = { readonly crackme: string; readonly answer: string | null; readonly solved: boolean; readonly seconds: number };

function answerIn(reply: string): string | null {
  const lines = reply.split("\n").map((line) => line.trim()).filter((line) => /^\**ANSWER:?\**/i.test(line));
  const last = lines.at(-1);
  return last ? last.replace(/^\**ANSWER:?\**\s*/i, "").replace(/^`+|`+$/g, "").trim() || null : null;
}

async function build(name: string): Promise<string> {
  const out = join(BUILT, name);
  for (const command of [["xcrun", "clang", "-O1", "-o", out, join(SOURCES, `${name}.c`)], ["strip", out]]) {
    const proc = Bun.spawn(command, { stdout: "ignore", stderr: "pipe" });
    if ((await proc.exited) !== 0) throw new Error(`${command.join(" ")} failed: ${await new Response(proc.stderr).text()}`);
  }
  return out;
}

async function says(binary: string, input: string): Promise<boolean> {
  const proc = Bun.spawn([binary, input], { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text.trim() === "Correct";
}

function replyOf(chat: Chat): string | null {
  const last = chat.thread.state.messages.at(-1);
  if (last?.kind !== "agent" || last.outcome === "running") return null;
  return last.blocks.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join("\n");
}

/** Whether the check came true before the turn limit, instead of failing the test on a timeout. */
async function within(screen: Screen, check: () => boolean): Promise<boolean> {
  try {
    await screen.until(check, TURN_MS);
    return true;
  } catch {
    return false;
  }
}

let chat: Chat | null = null;

function Live({ target }: { readonly target: Target }): ReactElement {
  const live = useChat(target, () => {});
  useLiveChat(live);
  chat = live;
  return <div>{`agent=${live.thread.state.agent.kind}`}</div>;
}

beforeAll(async () => {
  await adoptLoginShell();
  adoptToolchain();
  startAppBridge();
});

const results: Result[] = [];

afterAll(() => {
  console.table(results);
  console.log(`solved ${results.filter((r) => r.solved).length} of ${results.length}`);
});

for (const name of PICKED) {
  test(`crackme ${name}`, async () => {
    const binary = await build(name);
    const screen = new Screen().render(<Live target={prepareTarget(binary)} />);
    try {
      await screen.until(() => screen.text().includes("agent=ready") || screen.text().includes("agent=idle"), 120_000);
      const started = Date.now();
      chat?.thread.send(prompt());
      const finished = await within(screen, () => chat !== null && chat.thread.state.messages.some((m) => m.kind === "user") && replyOf(chat) !== null);
      if (!finished) chat?.thread.stop();
      const answer = finished && chat ? answerIn(replyOf(chat) ?? "") : null;
      results.push({ crackme: name, answer: finished ? answer : "timed out", solved: answer !== null && (await says(binary, answer)), seconds: Math.round((Date.now() - started) / 1000) });
      expect(results.at(-1)?.crackme).toBe(name);
    } finally {
      screen.unmount();
    }
  }, TURN_MS + 180_000);
}
