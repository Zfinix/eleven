import { memo, type ReactElement, useEffect, useState } from "react";

import { Shimmer } from "../chat/Conversation";
import { type Syntax, tokenize } from "../components/code";
import { ErrorCard } from "../components/kit";
import { Icon } from "../components/ui";
import { loadProject } from "../engine/project";
import { forgetRewrite, rewrite, type RewriteKey, type RewriteLanguage, type RewriteRequest, savedRewrite } from "../engine/rewrite";
import { errorMessage } from "../lib/guards";
import { useNow } from "../lib/useNow";
import { syntaxFor, useCodeLook } from "../settings/look";
import { useSettings } from "../settings/store";
import { scrollbar, useTheme } from "../theme";
import { t } from "../i18n";
import { copy } from "./actions";
import type { Refs } from "./model";
import { type Bench, TextButton, useBench } from "./parts";
import { SourceLines } from "./SourceView";
import { rewritePlace } from "./ask/place";

const NO_REFS: Refs = { callers: [], callees: [] };
const SIGN_IN = /auth|sign.?in|log.?in|credential|api key/i;
const GUTTER = 50;
const FRAME_MS = 33;
const WAVE_MS = 1600;
/** How far down the lines the wave lags per line, as a fraction of one sweep. */
const WAVE_LAG = 0.06;
const WAVE_TRAVEL = 760;
const BANDS = [{ width: 120, opacity: 0.35 }, { width: 70, opacity: 0.5 }, { width: 30, opacity: 0.7 }] as const;
const MAX_BAR = 560;
/** The typewriter: one step per frame, at least this many characters, faster when the agent is far ahead. */
const TYPE_MS = 16;
const TYPE_MIN = 8;
const TYPE_CATCH_UP = 12;
export const PLACEHOLDER_LINES = ["xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "{", "  xxxxxxxxxxxxxxx", "  xxxxxxxxxxxxxxxxxxxxxx", "", "  xxxxxxxxxxxxxxxxxxxxxxxxxxx", "  xxxx (xxxxxxxxxxxx) {", "    xxxxxxxxxxxxxxxxxxxxx", "  }", "  xxxxxxxxxxxxx", "}"];

type Phase =
  | { readonly kind: "reading"; readonly step: string | null }
  | { readonly kind: "writing"; readonly step: string | null; readonly code: string }
  | { readonly kind: "done"; readonly code: string }
  | { readonly kind: "failed"; readonly message: string };

async function refsOf(bench: Bench, addr: string): Promise<Refs> {
  try {
    return await bench.program.refs(addr);
  } catch {
    return NO_REFS;
  }
}

/** The part of a request that's cheap to build: enough to find a saved rewrite without touching the engine or an agent. */
async function keyFor(bench: Bench, addr: string, language: RewriteLanguage): Promise<RewriteKey> {
  const { program, nameOf, chat } = bench;
  const note = loadProject(program.id).notes.get(addr);
  return { projectId: program.id, agent: chat.agents.selected, language, fn: { name: nameOf(addr), addr }, pseudocode: await program.code(addr, "pseudo"), notes: note ? [note] : [] };
}

/** Everything the agent gets: the key plus the file, and who calls the function and what it calls. */
async function requestFor(bench: Bench, key: RewriteKey): Promise<RewriteRequest> {
  const { program, nameOf, chat } = bench;
  const refs = await refsOf(bench, key.fn.addr);
  return {
    ...key,
    native: chat.agents.installed.get(key.agent.id)?.command ?? null,
    binary: { path: program.path, name: program.name, arch: program.arch },
    callers: [...new Set(refs.callers.map((caller) => nameOf(caller.addr)))],
    callees: [...new Set(refs.callees.map((callee) => nameOf(callee)))],
  };
}

/** Runs the rewrite and follows it live: reading, then the code as the agent writes it, then the finished code. */
function useRewrite(bench: Bench, addr: string, language: RewriteLanguage, attempt: number): { readonly phase: Phase; readonly shape: readonly string[] } {
  const [phase, setPhase] = useState<Phase>({ kind: "reading", step: null });
  const [shape, setShape] = useState<readonly string[]>(PLACEHOLDER_LINES);
  const agentId = bench.chat.agents.selected.id;
  useEffect(() => {
    let live = true;
    setPhase({ kind: "reading", step: null });
    const run = async (): Promise<void> => {
      try {
        const key = await keyFor(bench, addr, language);
        const saved = await savedRewrite(key);
        if (!live) return;
        if (saved !== null) return setPhase({ kind: "done", code: saved });
        setShape(key.pseudocode.split("\n"));
        const req = await requestFor(bench, key);
        if (!live) return;
        const code = await rewrite(req, ({ step, code: sofar }) => {
          if (live) setPhase(sofar === null ? { kind: "reading", step } : { kind: "writing", step, code: sofar });
        });
        if (live) setPhase({ kind: "done", code });
      } catch (err) {
        if (live) setPhase({ kind: "failed", message: errorMessage(err) });
      }
    };
    void run();
    return () => {
      live = false;
    };
  }, [bench.program.id, addr, language, agentId, attempt]);
  return { phase, shape };
}

function syntaxOf(language: RewriteLanguage): Syntax {
  return language === "C" || language === "C++" ? "c" : "code";
}

/** How much of `text` to show: types it out at a steady pace while `active`, all of it otherwise. */
export function useTypewriter(text: string, active: boolean, restart: string): number {
  const [shown, setShown] = useState(0);
  useEffect(() => setShown(0), [restart]);
  const now = useNow(active && shown < text.length, TYPE_MS);
  useEffect(() => {
    if (active) setShown((n) => (n >= text.length ? n : Math.min(text.length, n + Math.max(TYPE_MIN, Math.ceil((text.length - n) / TYPE_CATCH_UP)))));
  }, [now]);
  return active ? Math.min(shown, text.length) : text.length;
}

/** "Claude is rewriting entry in Rust", shimmering, with the step it's on beside it. */
function Status({ title, step }: { readonly title: string; readonly step: string | null }): ReactElement {
  const { p } = useTheme();
  const now = useNow(true, FRAME_MS);
  const pulse = Math.floor(now / 600) % 2 === 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 30, paddingTop: 10, paddingBottom: 6, paddingLeft: 16, paddingRight: 16 }}>
      <div style={{ display: "flex", opacity: pulse ? 1 : 0.45 }}>
        <Icon name="spark" size={14} color={p.data} />
      </div>
      <Shimmer text={title} color={p.text} now={now} />
      {step && <div style={{ flexShrink: 1, minWidth: 0, fontSize: 12, color: p.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{step}</div>}
    </div>
  );
}

/** One line of the code the agent has written, coloured as it arrives; memoized so the wave doesn't redraw it. */
const WrittenLine = memo(function WrittenLine({ text, number, caret, syntax }: { readonly text: string; readonly number: number; readonly caret: boolean; readonly syntax: Syntax }): ReactElement {
  const { p } = useTheme();
  const { settings } = useSettings();
  const look = useCodeLook();
  const parts = text.length === 0 ? [] : tokenize(text, syntax, p, syntaxFor(settings.colorScheme, p));
  return (
    <div style={{ display: "flex", alignItems: "center", height: look.lineHeight, flexShrink: 0, fontFamily: look.family, fontSize: look.size }}>
      <div style={{ display: "flex", justifyContent: "flex-end", width: GUTTER, flexShrink: 0, paddingRight: 16, color: p.gutter }}>{String(number)}</div>
      <div style={{ display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
        {parts.map((part, ix) => <div key={ix} style={{ color: part.kind === "text" ? part.color : p.call, whiteSpace: "nowrap" }}>{part.text}</div>)}
        {caret && <Caret />}
      </div>
    </div>
  );
});

function Caret(): ReactElement {
  const { p } = useTheme();
  const look = useCodeLook();
  const on = Math.floor(useNow(true, 500) / 500) % 2 === 0;
  return <div style={{ width: Math.round(look.size * 0.6), height: look.size + 2, marginLeft: 1, borderRadius: 2, backgroundColor: p.number, opacity: on ? 1 : 0 }} />;
}

/** The lines still to come, drawn in the pseudocode's shape, with a shimmer running down them like a wave. */
function Skeleton({ lines, from }: { readonly lines: readonly string[]; readonly from: number }): ReactElement {
  const { p } = useTheme();
  const look = useCodeLook();
  const now = useNow(true, FRAME_MS);
  const char = look.size * 0.6;
  return (
    <>
      {lines.map((line, ix) => {
        const index = from + ix;
        const indent = (/^ */.exec(line)?.[0].length ?? 0) * char;
        const width = Math.min(line.trim().length * char, MAX_BAR);
        const sweep = ((now / WAVE_MS - index * WAVE_LAG) % 1 + 1) % 1;
        const center = sweep * (WAVE_TRAVEL + BANDS[0].width) - BANDS[0].width / 2 - indent;
        return (
          <div key={index} style={{ display: "flex", alignItems: "center", height: look.lineHeight, flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "flex-end", width: GUTTER, flexShrink: 0, paddingRight: 16, fontFamily: look.family, fontSize: look.size, color: p.gutter, opacity: 0.5 }}>{String(index + 1)}</div>
            {width > 0 && (
              <div style={{ position: "relative", marginLeft: indent, width, height: Math.round(look.size * 0.8), borderRadius: 5, backgroundColor: p.raised2, overflow: "hidden" }}>
                {BANDS.map((band) => <div key={band.width} style={{ position: "absolute", top: 0, bottom: 0, left: center - band.width / 2, width: band.width, backgroundColor: p.sel2, opacity: band.opacity, pointerEvents: "none" }} />)}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** While the agent works: the code typed so far with a cursor, then the rest of the expected shape still shimmering. */
export function Working({ code, step, shape, title, syntax }: {
  readonly code: string;
  readonly step: string | null;
  readonly shape: readonly string[];
  readonly title: string;
  readonly syntax: Syntax;
}): ReactElement {
  const { p } = useTheme();
  const written = code.length > 0 ? code.split("\n") : [];
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <Status title={title} step={step} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, paddingTop: 4, paddingBottom: 28, overflowY: "scroll", ...scrollbar(p) }}>
        {written.map((line, ix) => <WrittenLine key={ix} text={line} number={ix + 1} caret={ix === written.length - 1} syntax={syntax} />)}
        <Skeleton lines={shape.slice(written.length)} from={written.length} />
      </div>
    </div>
  );
}

/** The pseudocode rewritten in another language by the chat's agent, in place of the pseudocode. */
export function RewriteView({ addr, language }: { readonly addr: string; readonly language: RewriteLanguage }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const agent = bench.chat.agents.selected;
  const [attempt, setAttempt] = useState(0);
  const name = bench.nameOf(addr);
  const { phase, shape } = useRewrite(bench, addr, language, attempt);
  const restart = `${bench.program.id}:${addr}:${language}:${agent.id}:${attempt}`;
  const live = phase.kind === "reading" || phase.kind === "writing";
  const [typing, setTyping] = useState(false);
  useEffect(() => setTyping(false), [restart]);
  useEffect(() => {
    if (live) setTyping(true);
  }, [live]);
  const full = phase.kind === "writing" || phase.kind === "done" ? phase.code : "";
  const shown = useTypewriter(full, typing, restart);
  const again = (): void => {
    void (async (): Promise<void> => {
      await forgetRewrite(await keyFor(bench, addr, language));
      setAttempt((n) => n + 1);
    })();
  };
  if (live || (phase.kind === "done" && typing && shown < full.length)) {
    return <Working code={full.slice(0, shown)} step={live ? phase.step : null} shape={shape} title={t("workbench.view.rewrite.working", { agent: agent.name, name, language })} syntax={syntaxOf(language)} />;
  }
  switch (phase.kind) {
    case "failed":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
          <ErrorCard title={t("workbench.view.rewrite.failed", { name, language })} detail={SIGN_IN.test(phase.message) ? t("workbench.view.rewrite.signIn", { agent: agent.name }) : t("workbench.view.rewrite.failed.detail")} raw={phase.message} />
          <div style={{ display: "flex" }}><TextButton label={t("workbench.view.tryAgain")} tone="outline" onClick={() => setAttempt((n) => n + 1)} /></div>
        </div>
      );
    case "done":
      return (
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 8, paddingLeft: 16, paddingRight: 12 }}>
            <div style={{ flexGrow: 1, fontSize: 12, color: p.muted }}>{t("workbench.view.rewrite.done", { language, agent: agent.name })}</div>
            <TextButton label={t("workbench.view.copy")} tone="ghost" onClick={() => copy(bench, phase.code, t("workbench.view.rewrite.copied", { name, language }))} />
            <TextButton label={t("workbench.view.rewrite.again")} tone="ghost" onClick={again} />
          </div>
          <SourceLines source={{ text: phase.code, starts: [] }} syntax={syntaxOf(language)} ask={rewritePlace(bench, addr, language, syntaxOf(language))} />
        </div>
      );
    default: {
      const unhandled: never = phase;
      return unhandled;
    }
  }
}
