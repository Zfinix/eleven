import { useEffect, useState } from "react";

import { answerSoFar, askAbout, type Exchange, type Quote, splitAnswer } from "../../engine/ask";
import { propose } from "../../engine/history";
import { type QuickAsk, warmAsk } from "../../engine/warm";
import { currentSettings } from "../../settings/store";
import { errorMessage } from "../../lib/guards";
import type { Bench } from "../parts";
import { wordAddress } from "../subject";

export type Turn = {
  readonly question: string;
  readonly answer: string;
  readonly step: string | null;
  readonly state: "asking" | "done" | "failed";
  readonly problem: string | null;
  /** The rename the answer suggested, waiting in the project's changes, and the word it renames. */
  readonly rename: { readonly edit: string; readonly from: string } | null;
};

/** Suggestions from these threads stay out of the chat's own list; they show under the code instead. */
export const ASK_CHAT = "ask";

type Thread = { readonly seq: number; readonly turns: readonly Turn[] };

const threads = new Map<string, Thread>();
const watchers = new Set<() => void>();
let seq = 0;

function changed(): void {
  for (const watch of watchers) watch();
}

export function turnsOf(id: string): readonly Turn[] {
  return threads.get(id)?.turns ?? [];
}

/** Drops the thread; answers still arriving for it are ignored. */
export function forgetThread(id: string): void {
  threads.delete(id);
  changed();
}

export function useTurns(id: string): readonly Turn[] {
  const [turns, setTurns] = useState(() => turnsOf(id));
  useEffect(() => {
    setTurns(turnsOf(id));
    const watch = (): void => setTurns(turnsOf(id));
    watchers.add(watch);
    return () => {
      watchers.delete(watch);
    };
  }, [id]);
  return turns;
}

function writeTurn(id: string, owner: number, index: number, change: Partial<Turn>): void {
  const thread = threads.get(id);
  if (thread?.seq !== owner) return;
  threads.set(id, { ...thread, turns: thread.turns.map((turn, ix) => (ix === index ? { ...turn, ...change } : turn)) });
  changed();
}

function proposeRename(b: Bench, from: string, to: string, quote: Quote): Turn["rename"] {
  const addr = b.addrOf(from) ?? wordAddress(from);
  if (!addr || b.nameOf(addr) === to) return null;
  const by = { kind: "agent", agent: b.chat.agents.selected.name, chat: ASK_CHAT } as const;
  const edit = propose(b.program.id, "names", addr, to, by, `Suggested while answering about lines ${quote.from} to ${quote.to}.`);
  return { edit: edit.id, from };
}

/** The chat's agent, with the model picked for quick answers in Settings, else the one the chat is using. */
export function requestFor(b: Bench): QuickAsk {
  const agent = b.chat.agents.selected;
  const settings = currentSettings();
  const chatModel = b.chat.thread.state.options.find((option) => option.category === "model")?.current ?? null;
  return {
    agent,
    native: b.chat.agents.installed.get(agent.id)?.command ?? null,
    projectId: b.program.id,
    binary: { path: b.program.path },
    tune: { model: settings.askModels[agent.id] ?? chatModel, fast: settings.askFast },
  };
}

/** Gets the chat's agent started while you pick lines, so asking doesn't wait for it to launch. */
export function warmFor(b: Bench): void {
  warmAsk(requestFor(b));
}

/** Asks the chat's agent about the quoted lines, keeping earlier answers in the thread as context. */
export async function askInThread(b: Bench, id: string, quote: Quote, question: string): Promise<void> {
  const before = threads.get(id);
  const earlier: readonly Exchange[] = (before?.turns ?? []).flatMap((turn) => (turn.state === "done" ? [{ question: turn.question, answer: turn.answer }] : []));
  const owner = before?.seq ?? ++seq;
  const turns = [...(before?.turns ?? []).filter((turn) => turn.state !== "failed"), { question, answer: "", step: null, state: "asking", problem: null, rename: null } as const];
  threads.set(id, { seq: owner, turns });
  changed();
  const index = turns.length - 1;
  const req = requestFor(b);
  let seen = 0;
  let after = 0;
  const latest = (reply: string): string => reply.slice(after).trim() || reply;
  try {
    const reply = await askAbout(req, quote, earlier, question, ({ step, reply: sofar }) => {
      if (sofar.length === seen) after = sofar.length;
      seen = sofar.length;
      writeTurn(id, owner, index, { step, answer: answerSoFar(sofar.slice(after)) });
    });
    const { text, rename } = splitAnswer(latest(reply));
    const suggested = rename && threads.get(id)?.seq === owner ? proposeRename(b, rename.from, rename.to, quote) : null;
    writeTurn(id, owner, index, { answer: text, step: null, state: "done", rename: suggested });
  } catch (err) {
    writeTurn(id, owner, index, { step: null, state: "failed", problem: errorMessage(err) });
  }
}
