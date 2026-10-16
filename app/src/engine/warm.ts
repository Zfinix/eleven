import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

import { doing } from "../agents/describe";
import type { AgentEvent, SessionOption } from "../agents/events";
import { isReadOnly } from "../agents/permissions";
import { AgentSession } from "../agents/session";
import { currentSettings } from "../settings/store";
import type { QuietAsk, RewriteProgress } from "./rewrite";

/** A started agent with no tool servers, waiting for its one question; dropped after this long unused. Model and fast mode are set when the question comes. */
const IDLE_MS = 2 * 60_000;

type Spare = {
  readonly session: AgentSession;
  readonly route: { handler: ((event: AgentEvent) => void) | null; dead: boolean; options: readonly SessionOption[] | null; tuned: Promise<void> };
  readonly timer: ReturnType<typeof setTimeout>;
};

/** How the quick answer is set up: a model from Settings or the chat's (null keeps the agent's own), and fast mode. */
export type Tune = { readonly model: string | null; readonly fast: boolean };

export type QuickAsk = QuietAsk & { readonly tune: Tune };

type Pick = { readonly option: SessionOption; readonly value: string };

const QUICK_EFFORT = ["low", "minimal", "none", "off"];

function choose(option: SessionOption | undefined, value: string | undefined): readonly Pick[] {
  return option && value && option.current !== value && option.choices.some((choice) => choice.value === value) ? [{ option, value }] : [];
}

/** The chosen model, the agent's lowest thinking level, and fast mode where the agent has one; the model goes first since it changes the rest. */
export function quickSetup(options: readonly SessionOption[], tune: Tune): readonly Pick[] {
  const effort = options.find((option) => option.category === "thought_level");
  const fast = options.find((option) => option.category === "other" && /fast/i.test(`${option.id} ${option.name}`) && option.choices.some((choice) => choice.value === "on"));
  return [
    ...choose(options.find((option) => option.category === "model"), tune.model ?? undefined),
    ...choose(effort, QUICK_EFFORT.find((level) => effort?.choices.some((choice) => choice.value === level))),
    ...choose(fast, tune.fast ? "on" : "off"),
  ];
}

const spares = new Map<string, Spare>();

function keyOf(req: QuickAsk): string {
  return JSON.stringify([req.agent.id, req.native, req.projectId, req.binary.path]);
}

/** Applies one setting at a time, reading the agent's options again after each; settings it already has are skipped. */
async function tune(session: AgentSession, route: Spare["route"], wanted: Tune): Promise<void> {
  const tried = new Set<string>();
  for (;;) {
    const next = quickSetup(route.options ?? [], wanted).find((pick) => !tried.has(pick.option.id));
    if (!next) break;
    tried.add(next.option.id);
    try {
      await session.setOption(next.option, next.value);
    } catch {
      continue;
    }
  }
}

function spawn(req: QuickAsk, key: string): Spare {
  let settle = (): void => {};
  const route: Spare["route"] = { handler: null, dead: false, options: null, tuned: new Promise((resolve) => (settle = resolve)) };
  const session: AgentSession = new AgentSession(req.agent, req.native, dirname(req.binary.path), (event) => {
    if (event.kind === "failed") {
      route.dead = true;
      settle();
    }
    if (event.kind === "options") {
      const first = route.options === null;
      route.options = event.options;
      if (first) {
        void (async (): Promise<void> => {
          await tune(session, route, req.tune);
          settle();
        })();
      }
    }
    route.handler?.(event);
  }, `ask-${randomUUID()}`, req.projectId, req.binary.path, false);
  const timer = setTimeout(() => {
    if (spares.get(key)?.session !== session) return;
    spares.delete(key);
    session.stop();
  }, IDLE_MS);
  return { session, route, timer };
}

/** Starts an agent ahead of time, so the next question skips launching it. Tests turn this off. */
export function warmAsk(req: QuickAsk): void {
  if (process.env.ELEVEN_NO_PREWARM || !currentSettings().keepAgentsRunning) return;
  const key = keyOf(req);
  if (spares.get(key)?.route.dead === false) return;
  spares.set(key, spawn(req, key));
}

function take(req: QuickAsk): Spare {
  const key = keyOf(req);
  const spare = spares.get(key);
  spares.delete(key);
  if (spare) clearTimeout(spare.timer);
  const ready = spare && !spare.route.dead ? spare : spawn(req, key);
  clearTimeout(ready.timer);
  warmAsk(req);
  return ready;
}

/** One prompt to a warm agent: the reply's text streams back, then that agent stops and a fresh one waits for the next. */
export function askWarm(req: QuickAsk, prompt: string, onProgress: (progress: RewriteProgress) => void): Promise<string> {
  const { session, route } = take(req);
  return new Promise((resolve, reject) => {
    let reply = "";
    let step: string | null = null;
    route.handler = (event): void => {
      switch (event.kind) {
        case "text":
          reply += event.text;
          onProgress({ step, code: null, reply });
          return;
        case "step":
          if (event.status === "running") {
            step = doing(event.tool, event.input);
            onProgress({ step, code: null, reply });
          }
          return;
        case "permission":
          session.answer(event.id, isReadOnly(event.tool) ? (event.choices.find((choice) => choice.allows)?.id ?? null) : null);
          return;
        case "turnEnded":
          session.stop();
          if (reply.trim()) resolve(reply);
          else reject(new Error(`${req.agent.name} didn't send anything back.`));
          return;
        case "failed":
          session.stop();
          reject(new Error(event.reason));
          return;
        default:
          return;
      }
    };
    void (async (): Promise<void> => {
      try {
        await route.tuned;
        await tune(session, route, req.tune);
        await session.prompt(prompt);
      } catch (err) {
        session.stop();
        reject(err);
      }
    })();
  });
}
