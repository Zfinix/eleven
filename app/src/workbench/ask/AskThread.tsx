import type { EventPayload, StyleDesc } from "@gpuix/react";
import { type ReactElement, useEffect, useState } from "react";

import { Shimmer } from "../../chat/Conversation";
import { type Syntax, tokenize } from "../../components/code";
import type { AgentIcon } from "../../agents/icons";
import { AgentLogo, Icon } from "../../components/ui";
import { inlineRuns, pieces, proseBlocks, type Quote } from "../../engine/ask";
import { accept, decline, undo } from "../../engine/history";
import { comboFor, comboText } from "../../keys/keymaps";
import { errorMessage } from "../../lib/guards";
import { noteTyping, useCommand } from "../../lib/shortcuts";
import { useNow } from "../../lib/useNow";
import { syntaxFor, useCodeLook } from "../../settings/look";
import { currentSettings, useSettings } from "../../settings/store";
import { SANS, useTheme } from "../../theme";
import { ask, copy } from "../actions";
import { useProject } from "../useProject";
import { type Bench, HOVER, IconButton, TextButton, useBench } from "../parts";
import { useTypewriter } from "../RewriteView";
import type { LineRange } from "../state";
import { type AskPlace, closeAsk, openAsk, rangeText, sameRange, askRange } from "./place";
import { isPinned, pinAnswer, pinnedLines, unpinAnswer } from "./pins";
import { EXPLAIN, suggestedQuestions } from "./questions";
import { askInThread, forgetThread, type Turn, turnsOf, useTurns, warmFor } from "./threads";

const BAR_HEIGHT = 30;
const SHADOW = { offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: 0, color: "rgba(0,0,0,0.45)" };

function fenceSyntax(fence: string, fallback: Syntax): Syntax {
  if (/^(c|h|cpp|c\+\+|objc)$/i.test(fence)) return "c";
  if (/^ptx$/i.test(fence)) return "ptx";
  if (/^(asm|s|x86|arm|arm64|nasm)$/i.test(fence)) return "asm";
  return fence ? "code" : fallback;
}

function Colored({ text, syntax }: { readonly text: string; readonly syntax: Syntax }): ReactElement {
  const { p } = useTheme();
  const { settings } = useSettings();
  const parts = text.length === 0 ? [] : tokenize(text, syntax, p, syntaxFor(settings.colorScheme, p));
  return <>{parts.map((part, ix) => <div key={ix} style={{ color: part.kind === "text" ? part.color : p.call, whiteSpace: "nowrap", pointerEvents: "none" }}>{part.text}</div>)}</>;
}

/** A paragraph whose `backticked` names and numbers are drawn in the code font, coloured like the code view. */
function Prose({ text, syntax, color }: { readonly text: string; readonly syntax: Syntax; readonly color: string }): ReactElement {
  const { p } = useTheme();
  const look = useCodeLook();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", color, userSelect: "text" }}>
      {inlineRuns(text).flatMap((run, ix) => (run.code
        ? [<div key={ix} style={{ display: "flex", paddingLeft: 5, paddingRight: 5, borderRadius: 5, backgroundColor: p.fill2, fontFamily: look.family, fontSize: Math.min(look.size, 12) }}><Colored text={run.text} syntax={syntax} /></div>]
        : (run.text.match(/\s*\S+\s*/g) ?? [run.text]).map((word, n) => <div key={`${ix}.${n}`} style={{ whiteSpace: "nowrap", ...(run.bold ? { fontWeight: 600 } : {}) }}>{word}</div>)))}
    </div>
  );
}

function CodeBlock({ fence, lines, syntax }: { readonly fence: string; readonly lines: readonly string[]; readonly syntax: Syntax }): ReactElement {
  const { p } = useTheme();
  const look = useCodeLook();
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingTop: 8, paddingBottom: 8, borderRadius: 8, backgroundColor: p.deep, fontFamily: look.family, fontSize: Math.min(look.size, 12), lineHeight: 19, userSelect: "text" }}>
      {fence && <div style={{ paddingLeft: 12, paddingBottom: 4, fontSize: 11, color: p.faint }}>{fence.toUpperCase()}</div>}
      {lines.map((line, ix) => <div key={ix} style={{ display: "flex", paddingLeft: 12, paddingRight: 12 }}><Colored text={line} syntax={syntax} /></div>)}
    </div>
  );
}

function Answer({ text, syntax, color }: { readonly text: string; readonly syntax: Syntax; readonly color: string }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {pieces(text).flatMap((piece, ix) => (piece.kind === "code"
        ? [<CodeBlock key={ix} fence={piece.fence} lines={piece.lines} syntax={fenceSyntax(piece.fence, syntax)} />]
        : proseBlocks(piece.text).map((block, n) => (block.kind === "para"
          ? <Prose key={`${ix}.${n}`} text={block.text} syntax={syntax} color={color} />
          : (
            <div key={`${ix}.${n}`} style={{ display: "flex", gap: 8 }}>
              <div style={{ flexShrink: 0, minWidth: 12, color: p.muted }}>{block.marker}</div>
              <div style={{ display: "flex", flexGrow: 1, flexShrink: 1, minWidth: 0 }}><Prose text={block.text} syntax={syntax} color={color} /></div>
            </div>
          )))))}
    </div>
  );
}

function Caret(): ReactElement {
  const { p } = useTheme();
  const on = Math.floor(useNow(true, 500) / 500) % 2 === 0;
  return <div style={{ width: 7, height: 14, marginTop: 2, borderRadius: 2, backgroundColor: p.number, opacity: on ? 1 : 0 }} />;
}

function Reading({ agent, step }: { readonly agent: string; readonly step: string | null }): ReactElement {
  const { p } = useTheme();
  const now = useNow(true, 33);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <Shimmer text={`${agent} is reading the code`} color={p.text3} now={now} />
      {step && <div style={{ flexShrink: 1, minWidth: 0, fontSize: 12, color: p.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{step}</div>}
    </div>
  );
}

/** The rename an answer suggests, decided here like every agent edit; History keeps it either way. */
function RenameCard({ editId, word }: { readonly editId: string; readonly word: string }): ReactElement | null {
  const { p } = useTheme();
  const look = useCodeLook();
  const { program, wb } = useBench();
  const [problem, setProblem] = useState<string | null>(null);
  const edit = useProject(program.id).edits.find((entry) => entry.id === editId);
  if (!edit) return null;
  const act = (work: () => void): void => {
    try {
      work();
      setProblem(null);
    } catch (err) {
      setProblem(errorMessage(err));
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginLeft: 22, paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12, borderWidth: 1, borderColor: p.line2, borderRadius: 12, backgroundColor: p.raised2 }}>
      <div style={{ fontSize: 12, color: p.muted }}>Rename</div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", fontFamily: look.family, fontSize: 12 }}>
        <div style={{ color: p.muted, textDecoration: "line-through" }}>{edit.before ?? word}</div>
        <div style={{ color: p.faint, whiteSpace: "nowrap" }}>{" → "}</div>
        <div style={{ color: p.text }}>{edit.after ?? ""}</div>
      </div>
      {edit.status === "proposed" && (
        <div style={{ display: "flex", gap: 8 }}>
          <TextButton label="Accept" tone="primary" onClick={() => act(() => accept(program.id, [edit.id]))} />
          <TextButton label="Decline" tone="outline" onClick={() => act(() => decline(program.id, [edit.id]))} />
        </div>
      )}
      {edit.status === "applied" && (
        <div style={{ display: "flex", gap: 10, fontSize: 12 }}>
          <div style={{ color: p.string }}>Renamed everywhere in this project.</div>
          <div onClick={() => act(() => { undo(program.id, edit.id); wb.notify(`Put back ${edit.before ?? edit.key}`, null); })} role="button" style={{ color: p.link, cursor: "pointer", hover: HOVER }}>Undo</div>
        </div>
      )}
      {edit.status === "rejected" && <div style={{ fontSize: 12, color: p.muted }}>Kept the old name.</div>}
      {edit.status === "undone" && <div style={{ fontSize: 12, color: p.muted }}>Undone</div>}
      {problem && <div role="alert" style={{ fontSize: 12, color: p.error }}>{`Couldn't do that. ${problem}`}</div>}
    </div>
  );
}

function TurnView({ turn, syntax, agent, onRetry }: { readonly turn: Turn; readonly syntax: Syntax; readonly agent: { readonly name: string; readonly icon: AgentIcon | null }; readonly onRetry: () => void }): ReactElement {
  const { p } = useTheme();
  const live = turn.state === "asking";
  const shown = useTypewriter(turn.answer, live, turn.question);
  const text = turn.answer.slice(0, shown);
  return (
    <>
      <div style={{ alignSelf: "flex-end", marginLeft: 48, paddingTop: 6, paddingBottom: 6, paddingLeft: 11, paddingRight: 11, borderRadius: 12, backgroundColor: p.fill }}>
        <Prose text={turn.question} syntax={syntax} color={p.text} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ display: "flex", flexShrink: 0, marginTop: 2 }}><AgentLogo icon={agent.icon} size={14} /></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1, minWidth: 0 }}>
          {live && !turn.answer && <Reading agent={agent.name} step={turn.step} />}
          {text && <Answer text={text} syntax={syntax} color={p.text2} />}
          {(live || shown < turn.answer.length) && turn.answer && <Caret />}
          {turn.state === "failed" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div role="alert" style={{ fontSize: 12.5, color: p.error, userSelect: "text" }}>{`${agent.name} couldn't answer. ${turn.problem ?? ""}`}</div>
              <div style={{ display: "flex" }}><TextButton label="Try again" tone="outline" onClick={onRetry} /></div>
            </div>
          )}
        </div>
      </div>
      {turn.rename && turn.state === "done" && <RenameCard editId={turn.rename.edit} word={turn.rename.from} />}
    </>
  );
}

function threadId(b: Bench, range: LineRange): string {
  return `${b.program.id}|${range.fn}|${range.view}|${range.from}-${range.to}`;
}

function quoteOf(place: AskPlace, range: LineRange, lines: readonly string[]): Quote {
  return { about: place.about, from: range.from, to: range.to, lines: lines.slice(range.from - 1, range.to), code: lines, fence: place.fence };
}

function chatPrompt(place: AskPlace, quote: Quote, turns: readonly Turn[]): string {
  return [
    `About ${rangeText(quote)} of ${place.about}:`,
    `\`\`\`${quote.fence}`,
    ...quote.lines,
    "```",
    ...turns.flatMap((turn) => (turn.state === "done" ? [`I asked: ${turn.question}`, `You answered: ${turn.answer}`] : [])),
    "Let's keep going on this here.",
  ].join("\n");
}

/** The thread under the picked lines: the quote, suggested questions, answers streaming in place, and follow-ups on the same lines. */
export function AskThread({ place, range, lines, start }: { readonly place: AskPlace; readonly range: LineRange; readonly lines: readonly string[]; readonly start: string | null }): ReactElement {
  const { p } = useTheme();
  const look = useCodeLook();
  const bench = useBench();
  const { wb, chat } = bench;
  const id = threadId(bench, range);
  const turns = useTurns(id);
  const [draft, setDraft] = useState("");
  const quote = quoteOf(place, range, lines);
  const busy = turns.some((turn) => turn.state === "asking");
  const send = (question: string): void => {
    if (!question.trim() || busy) return;
    setDraft("");
    void askInThread(bench, id, quote, question.trim());
  };
  useEffect(() => {
    if (start && turnsOf(id).length === 0) send(start);
  }, [id]);
  const close = (): void => {
    forgetThread(id);
    closeAsk(wb);
  };
  useCommand("dismiss", close);
  const onKeyDown = (event: EventPayload): void => {
    noteTyping(event);
    if (event.key === "escape") close();
  };
  const agent = { name: chat.agents.selected.name, icon: chat.agents.icons.get(chat.agents.selected.id) ?? null };
  const answered = turns.filter((turn) => turn.state === "done");
  const last = answered.at(-1);
  const note = place.owner ? (wb.s.notes.get(place.owner) ?? "") : "";
  const pinned = isPinned(note, place.label, range.from, range.to);
  const pin = (): void => {
    const owner = place.owner;
    if (!owner || !last) return;
    wb.setNote(owner, pinned ? unpinAnswer(note, place.label, range.from, range.to) : pinAnswer(note, place.label, range.from, range.to, last.answer));
    wb.notify(pinned ? `Unpinned the answer on ${rangeText(range)}` : `Pinned the answer to ${rangeText(range)} in ${bench.nameOf(owner)}'s note`, () => wb.setNote(owner, note));
  };
  const toChat = (): void => {
    ask(bench, chatPrompt(place, quote, turns));
    close();
  };
  const asked = new Set(turns.map((turn) => turn.question));
  const chips = suggestedQuestions(quote.lines, place.syntax).filter((question) => !asked.has(question));
  return (
    <div role="dialog" aria-label={`Ask about ${rangeText(range)}`} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 700, marginTop: 6, marginBottom: 12, marginLeft: 50, marginRight: 16, paddingTop: 12, paddingBottom: 12, paddingLeft: 14, paddingRight: 14, borderWidth: 1, borderColor: p.line3, borderRadius: 12, backgroundColor: p.raised, boxShadow: { ...SHADOW, offsetY: 12, blurRadius: 32 }, fontSize: 13, lineHeight: 19 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flexShrink: 0, fontSize: 12, color: p.muted }}>{range.from === range.to ? `Line ${range.from}` : `Lines ${range.from}–${range.to}`}</div>
        <div style={{ display: "flex", flexShrink: 1, minWidth: 0, overflow: "hidden", fontFamily: look.family, fontSize: 12 }}>
          <Colored text={quote.lines.map((line) => line.trim()).filter(Boolean).join("  ")} syntax={place.syntax} />
        </div>
        <div style={{ flexGrow: 1 }} />
        <div style={{ flexShrink: 0, fontSize: 11.5, color: p.faint }}>{agent.name}</div>
        <IconButton icon="close" label="Close" tip={false} size={22} iconSize={10} onClick={close} />
      </div>
      {turns.map((turn, ix) => <TurnView key={ix} turn={turn} syntax={place.syntax} agent={agent} onRetry={() => send(turn.question)} />)}
      {!busy && chips.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {chips.map((question) => (
            <div key={question} onClick={() => send(question)} role="button" style={{ display: "flex", alignItems: "center", height: 26, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.line2, borderRadius: 13, fontSize: 12, color: p.text3, cursor: "pointer", hover: HOVER }}>
              <div style={{ whiteSpace: "nowrap" }}>{question}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input autoFocus value={draft} placeholder={turns.length === 0 ? "Ask about the selected code" : "Ask a follow-up"} aria-label="Your question about the selection" onKeyDown={onKeyDown} onChange={(event) => setDraft(event.value ?? "")} onSubmit={() => send(draft)} style={{ flexGrow: 1, height: 32, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.sel, borderRadius: 9, backgroundColor: p.win, fontSize: 13, color: p.text }} />
        {last && place.owner && <TextButton label={pinned ? "Unpin" : "Pin as note"} tone="outline" onClick={pin} />}
        {last && <TextButton label="Continue in chat" tone="outline" onClick={toChat} />}
      </div>
    </div>
  );
}

/** Ask, Explain and Copy, floating at the end of the picked lines. */
export function AskBar({ place, range, lines }: { readonly place: AskPlace; readonly range: LineRange; readonly lines: readonly string[] }): ReactElement {
  const { p } = useTheme();
  const look = useCodeLook();
  const bench = useBench();
  const settings = currentSettings();
  const keys = comboText(comboFor("agent", settings.keymap ?? "eleven", settings.shortcuts));
  const button: StyleDesc = { display: "flex", alignItems: "center", gap: 6, height: 24, paddingLeft: 8, paddingRight: 8, borderRadius: 6, cursor: "pointer", hover: HOVER };
  const picked = lines.slice(range.from - 1, range.to).join("\n");
  useEffect(() => warmFor(bench), [bench.program.id, bench.chat.agents.selected.id]);
  return (
    <div style={{ position: "relative", width: 0, height: look.lineHeight, flexShrink: 0 }}>
      <div role="toolbar" aria-label="Ask about the selection" style={{ position: "absolute", left: 14, top: Math.round((look.lineHeight - BAR_HEIGHT) / 2), display: "flex", alignItems: "center", gap: 2, height: BAR_HEIGHT, paddingLeft: 2, paddingRight: 2, borderWidth: 1, borderColor: p.line3, borderRadius: 8, backgroundColor: p.raised, boxShadow: SHADOW, fontSize: 12, lineHeight: 16 }}>
        <div onClick={() => openAsk(bench.wb, null)} role="button" aria-label="Ask" style={{ ...button, color: p.text }}>
          <Icon name="spark" size={12} color={p.data} />
          <div style={{ whiteSpace: "nowrap" }}>Ask</div>
          {keys && <div style={{ whiteSpace: "nowrap", fontFamily: SANS, fontSize: 11, color: p.muted }}>{keys}</div>}
        </div>
        <div onClick={() => openAsk(bench.wb, EXPLAIN)} role="button" aria-label="Explain" style={{ ...button, color: p.text3 }}>
          <div style={{ whiteSpace: "nowrap" }}>Explain</div>
        </div>
        <div onClick={() => copy(bench, picked, rangeText(range))} role="button" aria-label="Copy" style={{ ...button, color: p.text3 }}>
          <div style={{ whiteSpace: "nowrap" }}>Copy</div>
        </div>
      </div>
    </div>
  );
}

/** What one line of a code view adds for asking: the bar, the thread under it, its pin dot, and line picking for views without their own. */
export type AskRow = {
  readonly bar: ReactElement | null;
  readonly below: ReactElement | null;
  readonly pinned: boolean;
  readonly picked: boolean;
  readonly pick: (event?: EventPayload) => void;
};

export function useAskRows(place: AskPlace, lines: readonly string[]): (number: number) => AskRow;
export function useAskRows(place: AskPlace | null, lines: readonly string[]): (number: number) => AskRow | null;
export function useAskRows(place: AskPlace | null, lines: readonly string[]): (number: number) => AskRow | null {
  const bench = useBench();
  const { wb } = bench;
  const s = wb.s;
  const { keepAgentsRunning } = useSettings().settings;
  const askable = place !== null;
  useEffect(() => {
    if (askable && keepAgentsRunning) warmFor(bench);
  }, [askable, keepAgentsRunning, bench.program.id, bench.chat.agents.selected.id]);
  if (!place) return () => null;
  const here = (range: LineRange | null): LineRange | null => (range && range.fn === place.fn && range.view === place.view ? range : null);
  const bar = here(askRange(s));
  const open = here(s.asking?.range ?? null);
  const pins = pinnedLines(place.owner ? (s.notes.get(place.owner) ?? "") : "", place.label);
  const picked = here(s.lineRange);
  return (number) => ({
    bar: bar && !open && number === bar.to ? <AskBar place={place} range={bar} lines={lines} /> : null,
    below: open && number === open.to && s.asking ? <AskThread key={`${open.from}-${open.to}`} place={place} range={open} lines={lines} start={s.asking.start} /> : null,
    pinned: pins.has(number),
    picked: picked !== null && number >= picked.from && number <= picked.to,
    pick: (event) => {
      const anchor = picked?.from ?? null;
      const range = event?.modifiers?.shift && anchor !== null
        ? { fn: place.fn, view: place.view, from: Math.min(anchor, number), to: Math.max(anchor, number) }
        : { fn: place.fn, view: place.view, from: number, to: number };
      if (sameRange(range, picked)) return;
      wb.patch({ lineRange: range, asking: null, selected: null });
    },
  });
}

/** The small yellow dot in a line's gutter that marks a pinned answer. */
export function PinDot(): ReactElement {
  const { p } = useTheme();
  const look = useCodeLook();
  return <div aria-label="Has a pinned answer" style={{ position: "absolute", left: 10, top: Math.round((look.lineHeight - 6) / 2), width: 6, height: 6, borderRadius: 3, backgroundColor: p.data, pointerEvents: "none" }} />;
}
