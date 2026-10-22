import type { EventPayload } from "@gpuix/react";
import { type ReactElement, useEffect, useRef, useState } from "react";

import { Button } from "../components/kit";
import { Icon } from "../components/ui";
import type { Block } from "../engine/dossier";
import { inputTemplate, type Walk, walkPath, type WalkRequest } from "../engine/walk";
import { errorMessage } from "../lib/guards";
import { noteTyping, useCommand } from "../lib/shortcuts";
import { MONO, useTheme } from "../theme";
import { t } from "../i18n";
import { requestFor, warmFor } from "./ask/threads";
import { linesIn } from "./cfg";
import { Busy } from "./KernelBar";
import { ELLIPSIS, IconButton, TextButton, useBench } from "./parts";

const PLAY_MS = 700;
const BADGE_STEPS = 3;

export type WalkRun =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly agent: string; readonly step: string | null }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly agent: string; readonly walk: Walk };

export type Walker = {
  readonly open: boolean;
  readonly inputs: string;
  readonly run: WalkRun;
  /** The step on screen, from 0. */
  readonly at: number;
  readonly playing: boolean;
  readonly show: () => void;
  readonly close: () => void;
  readonly setInputs: (text: string) => void;
  readonly start: (blocks: readonly Block[], assembly: string) => void;
  readonly go: (at: number) => void;
  readonly setPlaying: (on: boolean) => void;
};

type State = Pick<Walker, "open" | "inputs" | "run" | "at" | "playing">;

const CLOSED: State = { open: false, inputs: "", run: { kind: "idle" }, at: 0, playing: false };

/** A walk through one function's graph for inputs you type; it lives only while the bar is open and the function stays the same. */
export function useWalk(fn: string): Walker {
  const bench = useBench();
  const [state, setState] = useState<State>(CLOSED);
  const token = useRef(0);
  const pseudo = useRef<Promise<string> | null>(null);
  const pseudoOf = (): Promise<string> => (pseudo.current ??= bench.program.code(fn, "pseudo"));
  useEffect(() => {
    token.current += 1;
    pseudo.current = null;
    setState(CLOSED);
  }, [fn]);
  useEffect(() => {
    if (!state.playing || state.run.kind !== "ready") return;
    const last = state.run.walk.steps.length - 1;
    if (state.at >= last) return setState((s) => ({ ...s, playing: false }));
    const timer = setTimeout(() => setState((s) => ({ ...s, at: Math.min(s.at + 1, last) })), PLAY_MS);
    return () => clearTimeout(timer);
  }, [state.playing, state.at, state.run]);
  const show = (): void => {
    const mine = token.current;
    setState((s) => ({ ...s, open: true }));
    warmFor(bench);
    void (async (): Promise<void> => {
      try {
        const template = inputTemplate(await pseudoOf());
        if (token.current === mine) setState((s) => (s.inputs ? s : { ...s, inputs: template }));
      } catch {
        pseudo.current = null;
      }
    })();
  };
  const close = (): void => {
    token.current += 1;
    setState(CLOSED);
  };
  const setInputs = (text: string): void => {
    token.current += 1;
    setState((s) => ({ ...s, inputs: text, run: { kind: "idle" }, at: 0, playing: false }));
  };
  const start = (blocks: readonly Block[], assembly: string): void => {
    const mine = ++token.current;
    const base = requestFor(bench);
    const agent = base.agent.name;
    const inputs = state.inputs;
    const live = (): boolean => token.current === mine;
    setState((s) => ({ ...s, run: { kind: "working", agent, step: null }, at: 0, playing: false }));
    void (async (): Promise<void> => {
      try {
        const lines = assembly.split("\n");
        const req: WalkRequest = {
          ...base,
          fn,
          name: bench.nameOf(fn),
          pseudo: await pseudoOf(),
          inputs,
          blocks: blocks.map((block) => ({ start: block.start, successors: block.successors, lines: linesIn(lines, block).map(([at, text]) => `${at}: ${text}`) })),
        };
        const walk = await walkPath(req, ({ step }) => {
          if (live()) setState((s) => ({ ...s, run: { kind: "working", agent, step } }));
        });
        if (!live()) return;
        setState((s) => ({ ...s, run: walk ? { kind: "ready", agent, walk } : { kind: "failed", message: t("workbench.walk.unreadable", { agent }) } }));
      } catch (err) {
        if (live()) setState((s) => ({ ...s, run: { kind: "failed", message: errorMessage(err) } }));
      }
    })();
  };
  const go = (at: number): void => setState((s) => (s.run.kind === "ready" ? { ...s, at: Math.max(0, Math.min(at, s.run.walk.steps.length - 1)), playing: false } : s));
  const setPlaying = (on: boolean): void => setState((s) => (s.run.kind !== "ready" ? s : { ...s, playing: on, at: on && s.at >= s.run.walk.steps.length - 1 ? 0 : s.at }));
  return { ...state, show, close, setInputs, start, go, setPlaying };
}

/** The step numbers a block was visited at, short enough for its corner: "1", "2, 5" or "2, 5, 8 +4". */
export function visitText(steps: readonly number[]): string {
  const shown = steps.slice(0, BADGE_STEPS).join(", ");
  return steps.length > BADGE_STEPS ? `${shown} ${t("workbench.walk.more", { count: steps.length - BADGE_STEPS })}` : shown;
}

export function edgeKey(from: string, to: string): string {
  return `${from}>${to}`;
}

/** What the graph draws for a walk: the steps each block was visited at, the block on screen now, and the edges the walk took. */
export type WalkMarks = { readonly visits: ReadonlyMap<string, readonly number[]>; readonly current: string | null; readonly edges: ReadonlySet<string> };

/** `homeOf` maps a block to the node drawing it, so a step inside a folded group lights the group. */
export function walkMarks(walk: Walk, at: number, homeOf: (start: string) => string): WalkMarks {
  const homes = walk.steps.map((step) => homeOf(step.block));
  const visits = new Map<string, number[]>();
  homes.forEach((home, ix) => visits.set(home, [...(visits.get(home) ?? []), ix + 1]));
  const edges = new Set(homes.slice(1).map((home, ix) => edgeKey(homes[ix] ?? "", home)));
  return { visits, current: homes[at] ?? null, edges };
}

function Chip({ text }: { readonly text: string }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", flexShrink: 1, minWidth: 0, height: 22, paddingLeft: 8, paddingRight: 8, borderRadius: 11, backgroundColor: p.fill, fontFamily: MONO, fontSize: 11.5, color: p.text3 }}>
      <div style={{ ...ELLIPSIS, pointerEvents: "none" }}>{text}</div>
    </div>
  );
}

function Steps({ walker, walk, agent }: { readonly walker: Walker; readonly walk: Walk; readonly agent: string }): ReactElement {
  const { p } = useTheme();
  const count = walk.steps.length;
  const step = walk.steps[walker.at];
  const last = walker.at >= count - 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 12, paddingRight: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <IconButton icon="back" label={t("workbench.walk.back")} size={24} iconSize={13} radius={6} color={walker.at > 0 ? p.text3 : p.faint} onClick={() => walker.go(walker.at - 1)} />
        <IconButton icon={walker.playing ? "debug-pause" : "play"} label={walker.playing ? t("workbench.walk.pause") : t("workbench.walk.play")} size={24} iconSize={13} radius={6} color={p.text3} onClick={() => walker.setPlaying(!walker.playing)} />
        <IconButton icon="forward" label={t("workbench.walk.next")} size={24} iconSize={13} radius={6} color={last ? p.faint : p.text3} onClick={() => walker.go(walker.at + 1)} />
        <div style={{ flexShrink: 0, fontSize: 12, color: p.text }}>{t("kit.step", { current: walker.at + 1, count })}</div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
          {(step?.values ?? []).map((value) => <Chip key={value.name} text={`${value.name} = ${value.value}`} />)}
        </div>
        <div style={{ flexShrink: 0, fontSize: 11.5, color: p.faint }}>{t("workbench.walk.simulated", { agent })}</div>
      </div>
      {step?.note && <div style={{ fontSize: 12.5, color: p.text3 }}>{step.note}</div>}
      {last && walk.result && <div style={{ fontSize: 12.5, color: p.text }}>{t("workbench.walk.result", { result: walk.result })}</div>}
    </div>
  );
}

function Status({ walker, onWalk }: { readonly walker: Walker; readonly onWalk: () => void }): ReactElement {
  const { p } = useTheme();
  const { chat } = useBench();
  const run = walker.run;
  switch (run.kind) {
    case "idle":
      return <div style={{ paddingLeft: 12, paddingRight: 12, fontSize: 12, color: p.muted }}>{t("workbench.walk.hint", { agent: chat.agents.selected.name })}</div>;
    case "working":
      return <Busy title={t("workbench.walk.working", { agent: run.agent })} step={run.step} />;
    case "failed":
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 12 }}>
          <div style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, fontSize: 12, color: p.error }}>{t("workbench.walk.failed", { error: run.message })}</div>
          <TextButton label={t("workbench.view.tryAgain")} tone="ghost" onClick={onWalk} />
        </div>
      );
    case "ready":
      return <Steps walker={walker} walk={run.walk} agent={run.agent} />;
    default: {
      const unhandled: never = run;
      return unhandled;
    }
  }
}

/** The bar over the graph: inputs to walk with, the agent's progress, then the walk one step at a time. */
export function WalkBar({ walker, onWalk }: { readonly walker: Walker; readonly onWalk: () => void }): ReactElement {
  const { p } = useTheme();
  useCommand("dismiss", walker.close);
  const onKeyDown = (event: EventPayload): void => {
    noteTyping(event);
    if (event.key === "escape") walker.close();
  };
  const busy = walker.run.kind === "working";
  return (
    <div role="group" aria-label={t("workbench.walk.open")} style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0, paddingTop: 8, paddingBottom: 10, backgroundColor: p.raised }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 8 }}>
        <Icon name="spark" size={13} color={p.data} />
        <div style={{ flexShrink: 0, fontSize: 12, color: p.muted }}>{t("workbench.walk.inputs")}</div>
        <input autoFocus onKeyDown={onKeyDown} value={walker.inputs} placeholder={t("workbench.walk.placeholder")} aria-label={t("workbench.walk.inputsLabel")} onChange={(event) => walker.setInputs(event.value ?? "")} onSubmit={onWalk} style={{ flexGrow: 1, minWidth: 0, height: 28, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.line3, borderRadius: 7, backgroundColor: p.deep, fontFamily: MONO, fontSize: 12.5, color: p.text }} />
        <Button label={t("workbench.walk.go")} tone="primary" size="compact" disabled={busy} onClick={onWalk} />
        <IconButton icon="close" label={t("workbench.walk.close")} tip={false} size={24} iconSize={10} onClick={walker.close} />
      </div>
      <Status walker={walker} onWalk={onWalk} />
    </div>
  );
}
