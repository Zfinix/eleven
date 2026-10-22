import { type ReactElement, useState } from "react";

import type { Attachment } from "../agents/attachments";
import { isToolId, toolLabel } from "../agents/describe";
import { SentAttachments } from "./Attachments";
import { type MenuEntry, menuOn } from "../components/ContextMenu";
import { JumpButton, SuggestionCard, Tooltip } from "../components/kit";
import { Markdown } from "../components/Markdown";
import { type PlainId, t } from "../i18n";
import type { PermissionChoice, ToolKind } from "../agents/events";
import { stringField } from "../lib/guards";
import { seconds, useNow } from "../lib/useNow";
import { useSettings } from "../settings/store";
import { MONO, scrollbar, useTheme } from "../theme";
import { Icon, Row, Spacer } from "../components/ui";
import type { Block, Message, Step } from "./thread";
import { ChainOfThought, ChainOfThoughtResults, ChainOfThoughtStep } from "./ChainOfThought";
import { Sources, sourcesOf } from "./Sources";
import { copyText } from "./useThread";
import { shownText } from "../skills/load";

const PREVIEW_CHARS = 1200;

type AgentTurn = Extract<Message, { kind: "agent" }>;
type PermissionMessage = Extract<Message, { kind: "permission" }>;

function preview(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : (stringField(value, "command") ?? JSON.stringify(value, null, 2));
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}\n…` : text;
}

function timeOfDay(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function IconAction({ icon, label, onClick }: { readonly icon: string; readonly label: string; readonly onClick: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onClick} aria-label={label} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 6, cursor: "pointer", hover: { opacity: 0.72 } }}>
      <Icon name={icon} size={13} color={p.muted} />
    </div>
  );
}

function UserMessage({ text: sent, at, attachments }: { readonly text: string; readonly at: number; readonly attachments: readonly Attachment[] }): ReactElement {
  const { p } = useTheme();
  const text = shownText(sent);
  const [hovered, setHovered] = useState(false);
  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div {...menuOn(() => [{ kind: "action", label: t("chat.copy"), icon: "copy", run: () => copyText(text) }])} style={{ display: "flex", flexDirection: "column", gap: 10, userSelect: "text", paddingTop: 10, paddingBottom: 10, paddingLeft: 14, paddingRight: 14, borderWidth: 1, borderColor: p.line2, borderRadius: 12, backgroundColor: p.raised }}>
        <SentAttachments files={attachments} />
        <Markdown source={text.trim()} color={p.text} />
      </div>
      <Row gap={2} style={{ height: 24, opacity: hovered ? 1 : 0 }}>
        <Spacer />
        <div style={{ fontSize: 11.5, color: p.faint, marginRight: 4 }}>{timeOfDay(at)}</div>
        <IconAction icon="copy" label={t("chat.copy")} onClick={() => copyText(text)} />
      </Row>
    </div>
  );
}

function IoSection({ title, body, onOpen = null }: { readonly title: string; readonly body: string; readonly onOpen?: (() => void) | null }): ReactElement {
  const { p } = useTheme();
  return (
    <div {...(onOpen ? { onClick: onOpen, role: "button", "aria-label": t("chat.openResult") } : {})} style={{ display: "flex", gap: 10, paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 6, ...(onOpen ? { cursor: "pointer", hover: { opacity: 0.72 } } : {}) }}>
      <div style={{ width: 26, flexShrink: 0, fontSize: 10.5, fontWeight: 600, color: p.faint, paddingTop: 1 }}>{title}</div>
      <div style={{ flexGrow: 1, minWidth: 0, maxHeight: 220, overflowY: "scroll", ...scrollbar(p), fontFamily: MONO, fontSize: 11.5, lineHeight: 17, color: p.text4 }}>{body}</div>
      {onOpen && <Icon name="open-tab" size={13} color={p.muted} />}
    </div>
  );
}

/** How a tool call went, as the kit writes it: Working…, how long it took, or Didn't work. */
function stepState(step: Step): string {
  switch (step.status) {
    case "running":
      return t("chat.step.working");
    case "failed":
      return t("chat.step.failed");
    case "done": {
      const took = Number.isFinite(step.startedAt) && step.endedAt !== null && Number.isFinite(step.endedAt) ? step.endedAt - step.startedAt : null;
      if (took === null) return t("chat.step.done");
      return took < 10_000 ? t("chat.step.ms", { count: Math.max(1, Math.round(took)) }) : seconds(took);
    }
    default: {
      const unhandled: never = step.status;
      return unhandled;
    }
  }
}

const MAX_FOUND = 6;

/** The icon for a tool call, picked from what the tool does. */
function toolIcon(tool: string): string | null {
  const name = tool.toLowerCase();
  const rules: readonly (readonly [RegExp, string])[] = [
    [/pseudo|decompil/, "pseudocode"],
    [/assembl|instruction|disassembl/, "assembly"],
    [/caller|callee|xref|reference|call_graph|call_path/, "references"],
    [/string/, "strings"],
    [/search|find|toolsearch|lookup/, "search"],
    [/rename|name/, "rename"],
    [/note|comment/, "note"],
    [/bookmark/, "bookmark"],
    [/segment|section/, "segments"],
    [/bytes|hex|memory/, "hex"],
    [/open|binary|overview|session|inspect|document/, "binary"],
    [/function|procedure|analy/, "function"],
    [/run|bash|exec|terminal|shell|command/, "run"],
    [/gpu|shader|metal/, "gpu"],
  ];
  return rules.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

/** When the tool's name says nothing, the kind the agent reported picks the icon. */
const KIND_ICON: Readonly<Partial<Record<ToolKind, string>>> = {
  execute: "run",
  read: "source",
  search: "search",
  fetch: "external",
  edit: "note",
  delete: "trash",
  move: "forward",
  think: "thought",
  switch_mode: "settings",
};

function stepIcon(step: Step): string {
  if (step.toolKind === "execute") return "run";
  return toolIcon(step.tool) ?? (step.toolKind ? KIND_ICON[step.toolKind] : undefined) ?? "bolt";
}

/** Agents wrap results in ``` fences; the view draws its own box, so they come off. */
function unfenced(text: string): string {
  const trimmed = text.trim();
  const match = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return (match?.[1] ?? trimmed).trim();
}

function capped(text: string): string {
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}\n…` : text;
}

/** What the agent sent: the whole command when it ran one, else its input, and nothing for an empty input. */
function sentText(step: Step, command: string | null): string | null {
  const whole = stringField(step.input, "command") ?? (command ? step.tool : null);
  if (whole?.trim()) return capped(whole.trim());
  const text = preview(step.input);
  return text && text !== "{}" ? text : null;
}

/** Functions and addresses an engine tool turned up, to show as badges; command output is never scanned. */
function found(step: Step): readonly string[] {
  if (step.status !== "done" || !step.output || step.toolKind === "execute" || !isToolId(step.tool.trim())) return [];
  const names = step.output.match(/\b(?:FUN|thunk_FUN|LAB|DAT)_[0-9a-f]+\b|\b_[A-Za-z]\w{2,}\b/g) ?? [];
  return [...new Set(names)].slice(0, MAX_FOUND);
}

function ToolStep({ step, onOpen, onOpenText }: { readonly step: Step; readonly onOpen: (procedure: string) => void; readonly onOpenText: (title: string, text: string) => void }): ReactElement {
  const { p } = useTheme();
  const [open, setOpen] = useState(false);
  const { label, detail, command } = toolLabel(step.tool, step.input, step.summary);
  const sent = sentText(step, command);
  const got = step.output ? unfenced(step.output) : null;
  const failed = step.status === "failed";
  const results = found(step);
  const title = detail ? `${label} · ${detail}` : label;
  const header = (
    <div onClick={() => setOpen(!open)} role="button" aria-expanded={open} aria-label={open ? t("chat.step.hide") : t("chat.step.show")} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, cursor: "pointer", hover: { opacity: 0.72 } }}>
      <div style={{ flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
      {command && (
        <Tooltip label={command}>
          <div style={{ flexShrink: 1, minWidth: 0, fontFamily: MONO, fontSize: 12, color: p.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{command}</div>
        </Tooltip>
      )}
      {detail && <div style={{ flexShrink: 1, minWidth: 0, fontSize: 12, color: p.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</div>}
      <Spacer />
      <div style={{ flexShrink: 0, fontSize: 12, color: failed ? p.error : p.faint, whiteSpace: "nowrap" }}>{stepState(step)}</div>
      <Icon name={open ? "collapse" : "disclosure"} size={14} color={p.faint} />
    </div>
  );
  return (
    <ChainOfThoughtStep icon={stepIcon(step)} label={header} status={step.status === "running" ? "active" : "complete"} tone={failed ? p.error : null}>
      {failed && <div style={{ fontSize: 12, color: p.error }}>{got?.split("\n")[0]?.slice(0, 160) || t("chat.step.tryAnother")}</div>}
      {results.length > 0 && <ChainOfThoughtResults items={results} onPick={onOpen} />}
      {open && (
        <div style={{ display: "flex", flexDirection: "column", borderWidth: 1, borderColor: p.line2, borderRadius: 9, backgroundColor: p.deep }}>
          {sent && <IoSection title={t("chat.step.in")} body={sent} />}
          {sent && got && <div style={{ height: 1, backgroundColor: p.line2 }} />}
          {got && <IoSection title={t("chat.step.out")} body={capped(got)} onOpen={() => onOpenText(title, got)} />}
          {!sent && !got && <IoSection title="" body={step.status === "running" ? t("chat.step.waiting") : t("chat.step.noDetails")} />}
        </div>
      )}
    </ChainOfThoughtStep>
  );
}

function ThoughtStep({ text, startedAt, endedAt }: { readonly text: string; readonly startedAt: number; readonly endedAt: number | null }): ReactElement {
  const { p } = useTheme();
  const now = useNow(endedAt === null);
  const label = endedAt === null ? t("chat.thinking", { time: seconds(now - startedAt) }) : t("chat.thought", { time: seconds(endedAt - startedAt) });
  return (
    <ChainOfThoughtStep icon="thought" label={label} status={endedAt === null ? "active" : "complete"}>
      <div style={{ fontSize: 12.5, lineHeight: 19, color: p.faint }}>{text.trim()}</div>
    </ChainOfThoughtStep>
  );
}

function StepView({ block, onOpen, onOpenText }: { readonly block: Block; readonly onOpen: (procedure: string) => void; readonly onOpenText: (title: string, text: string) => void }): ReactElement {
  switch (block.kind) {
    case "text":
      return <ChainOfThoughtStep icon={null} label={block.text.trim()} status="complete" />;
    case "thought":
      return <ThoughtStep text={block.text} startedAt={block.startedAt} endedAt={block.endedAt} />;
    case "tool":
      return <ToolStep step={block.step} onOpen={onOpen} onOpenText={onOpenText} />;
    default: {
      const unhandled: never = block;
      return unhandled;
    }
  }
}

/** The answer: the text the agent wrote after its last step. Everything before it is how it got there. */
function splitAnswer(blocks: readonly Block[]): { readonly steps: readonly Block[]; readonly answer: readonly Block[] } {
  const lastWork = blocks.reduce((at, block, ix) => (block.kind === "text" ? at : ix), -1);
  return { steps: blocks.slice(0, lastWork + 1), answer: blocks.slice(lastWork + 1) };
}

function chainLabel(turn: AgentTurn, steps: number, now: number): string {
  const count = steps === 1 ? t("chat.chain.oneStep") : t("chat.chain.steps", { count: steps });
  switch (turn.outcome) {
    case "running":
      return t("chat.chain.working", { time: seconds(now - turn.startedAt) });
    case "cancelled":
      return t("chat.chain.stopped", { steps: count });
    case "done":
    case "failed":
      return turn.endedAt === null ? t("chat.chain.worked", { steps: count }) : t("chat.chain.workedIn", { steps: count, time: seconds(turn.endedAt - turn.startedAt) });
    default: {
      const unhandled: never = turn.outcome;
      return unhandled;
    }
  }
}

const MAX_JUMPS = 3;

/** The functions a finished reply points at: Ghidra names in its text, then the ones its tools read. */
function mentionedFunctions(turn: AgentTurn): readonly string[] {
  const named = replyText(turn).match(/\b(?:FUN|thunk_FUN)_[0-9a-f]+\b/g) ?? [];
  const read = turn.blocks.flatMap((block) => (block.kind === "tool" ? [stringField(block.step.input, "procedure")] : [])).filter((name): name is string => typeof name === "string");
  return [...new Set([...named, ...read])].slice(0, MAX_JUMPS);
}

function replyText(turn: AgentTurn): string {
  return turn.blocks.flatMap((block) => (block.kind === "text" ? [block.text.trim()] : [])).join("\n\n");
}

function TurnFooter({ turn, last, onRetry }: { readonly turn: AgentTurn; readonly last: boolean; readonly onRetry: () => void }): ReactElement | null {
  const { p } = useTheme();
  if (turn.outcome === "running" || turn.outcome === "failed") return null;
  const took = turn.endedAt === null ? "" : seconds(turn.endedAt - turn.startedAt);
  const worked = turn.blocks.some((block) => block.kind !== "text");
  const status = turn.outcome === "cancelled" ? t("chat.turn.interrupted") : turn.blocks.length === 0 ? t("chat.turn.noReply") : worked ? "" : t("chat.turn.answeredIn", { time: took });
  return (
    <Row gap={2} style={{ height: 26 }}>
      {status && <div style={{ fontSize: 11.5, color: turn.outcome === "cancelled" ? p.text4 : p.faint, marginRight: 6 }}>{status}</div>}
      {replyText(turn) && <IconAction icon="copy" label={t("chat.copyReply")} onClick={() => copyText(replyText(turn))} />}
      {last && <IconAction icon="retry" label={t("chat.tryAgain")} onClick={onRetry} />}
    </Row>
  );
}

function AgentReply({ turn, last, onRetry, onOpen, onOpenText }: {
  readonly turn: AgentTurn;
  readonly last: boolean;
  readonly onRetry: () => void;
  readonly onOpen: (procedure: string) => void;
  readonly onOpenText: (title: string, text: string) => void;
}): ReactElement {
  const { p } = useTheme();
  const { showThinking } = useSettings().settings;
  const [opened, setOpened] = useState<boolean | null>(null);
  const running = turn.outcome === "running";
  const now = useNow(running);
  const blocks = turn.blocks.filter((block) => (block.kind === "text" ? block.text.trim() : block.kind !== "thought" || showThinking));
  const { steps, answer } = splitAnswer(blocks);
  const open = opened ?? running;
  const menuFor = (block: Block): readonly MenuEntry[] => {
    const procedure = block.kind === "tool" ? stringField(block.step.input, "procedure") : null;
    const output = block.kind === "tool" ? block.step.output : null;
    return [
      ...(procedure ? [{ kind: "action", label: t("chat.open", { name: procedure }), icon: "open-tab", run: () => onOpen(procedure) } as const, { kind: "separator" } as const] : []),
      ...(block.kind === "text" ? [{ kind: "action", label: t("chat.copyPart"), icon: "copy", run: () => copyText(block.text.trim()) } as const] : []),
      ...(output ? [{ kind: "action", label: t("chat.copyToolResult"), icon: "copy", run: () => copyText(output) } as const] : []),
      ...(replyText(turn) ? [{ kind: "action", label: t("chat.copyReply"), icon: "copy", run: () => copyText(replyText(turn)) } as const] : []),
      ...(last && !running ? [{ kind: "separator" } as const, { kind: "action", label: t("chat.tryAgain"), icon: "retry", run: onRetry } as const] : []),
    ];
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {steps.length > 0 && (
        <ChainOfThought label={chainLabel(turn, steps.length, now)} open={open} onToggle={() => setOpened(!open)}>
          {steps.map((block, ix) => (
            <div key={block.kind === "tool" ? block.step.id : `${block.kind}-${ix}`} {...menuOn(() => menuFor(block))} style={{ display: "flex", flexDirection: "column" }}>
              <StepView block={block} onOpen={onOpen} onOpenText={onOpenText} />
            </div>
          ))}
        </ChainOfThought>
      )}
      {answer.map((block, ix) => block.kind === "text" && (
        <div key={`answer-${ix}`} {...menuOn(() => menuFor(block))} style={{ display: "flex", flexDirection: "column", userSelect: "text" }}>
          <Markdown source={block.text.trim()} color={p.text2} />
        </div>
      ))}
      <Sources sources={sourcesOf(blocks)} />
      {turn.outcome === "done" && mentionedFunctions(turn).length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {mentionedFunctions(turn).map((name) => <JumpButton key={name} label={t("chat.open", { name })} onClick={() => onOpen(name)} />)}
        </div>
      )}
      <TurnFooter turn={turn} last={last} onRetry={onRetry} />
    </div>
  );
}

function ChoiceButton({ choice, primary, onChoose }: { readonly choice: PermissionChoice; readonly primary: boolean; readonly onChoose: () => void }): ReactElement {
  const { p } = useTheme();
  const look = primary ? { backgroundColor: p.primary, color: p.onPrimary, fontWeight: 600 } : { borderWidth: 1, borderColor: p.line3, color: p.text };
  return (
    <div onClick={onChoose} style={{ height: 28, display: "flex", alignItems: "center", paddingLeft: 12, paddingRight: 12, borderRadius: 8, fontSize: 12.5, cursor: "pointer", hover: { opacity: 0.72 }, ...look }}>
      {choice.label}
    </div>
  );
}

type Proposal = { readonly title: string; readonly reason: string; readonly apply: string; readonly applied: string };

/** An agent asking to change your project through Eleven's own tools reads as a suggestion, not a security prompt. */
function proposal(message: PermissionMessage, agentName: string): Proposal | null {
  const input = message.input;
  const fn = stringField(input, "function");
  const name = stringField(input, "new_name");
  if (fn && name) return { title: t("chat.suggest.rename", { from: fn, to: name }), reason: t("chat.suggest.rename.reason", { agent: agentName }), apply: t("chat.suggest.rename.apply"), applied: t("chat.suggest.rename.done", { name }) };
  const note = stringField(input, "note");
  if (fn && note) return { title: t("chat.suggest.note", { name: fn }), reason: note, apply: t("chat.suggest.note.apply"), applied: t("chat.suggest.note.done") };
  const address = stringField(input, "address");
  const comment = stringField(input, "comment");
  if (address && comment !== undefined) return comment
    ? { title: t("chat.suggest.comment", { address }), reason: comment, apply: t("chat.suggest.comment.apply"), applied: t("chat.suggest.comment.done") }
    : { title: t("chat.suggest.uncomment", { address }), reason: comment, apply: t("chat.suggest.uncomment.apply"), applied: t("chat.suggest.uncomment.done") };
  const label = stringField(input, "label");
  if (address && label !== undefined) return { title: t("chat.suggest.bookmark", { name: label || address }), reason: t("chat.suggest.bookmark.reason", { agent: agentName, address }), apply: t("chat.suggest.bookmark.apply"), applied: t("chat.suggest.bookmark.done") };
  return null;
}

function SuggestionPrompt({ message, offer, onAnswer }: {
  readonly message: PermissionMessage;
  readonly offer: Proposal;
  readonly onAnswer: (choice: PermissionChoice | null) => void;
}): ReactElement {
  const allow = message.choices.find((choice) => choice.allows) ?? null;
  const reject = message.choices.find((choice) => !choice.allows) ?? null;
  const answered = message.state.kind === "answered" ? message.state.label : null;
  const accepted = answered !== null && message.choices.some((choice) => choice.allows && choice.label === answered);
  const state = answered === null ? { kind: "pending" } as const : { kind: "done", result: accepted ? offer.applied : t("chat.suggest.skipped"), skipped: !accepted } as const;
  return <SuggestionCard title={offer.title} reason={offer.reason} apply={offer.apply} state={state} onApply={() => onAnswer(allow)} onSkip={() => onAnswer(reject)} />;
}

/** Eleven saves these two answers in English, so a saved chat reads the same in any language. */
const SAVED_ANSWERS: ReadonlyMap<string, PlainId> = new Map<string, PlainId>([["No answer", "chat.answer.none"], ["Not allowed", "chat.answer.refused"]]);

function answeredLabel(label: string): string {
  const id = SAVED_ANSWERS.get(label);
  return id ? t(id) : label;
}

function PermissionCard({ message, agentName, onAnswer }: {
  readonly message: PermissionMessage;
  readonly agentName: string;
  readonly onAnswer: (choice: PermissionChoice | null) => void;
}): ReactElement {
  const { p } = useTheme();
  const offer = proposal(message, agentName);
  if (offer) return <SuggestionPrompt message={message} offer={offer} onAnswer={onAnswer} />;
  const { label, detail } = toolLabel(message.tool, message.input);
  const question = message.tool.trim().endsWith("?");
  const input = question ? "" : preview(message.input).replace(/\s*\n\s*/g, " ");
  const firstAllow = question ? -1 : message.choices.findIndex((choice) => choice.allows);
  const title = question ? message.tool.trim() : t("chat.permission.wants", { agent: agentName, action: `${label.charAt(0).toLowerCase()}${label.slice(1)}${detail ? ` ${detail}` : ""}` });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 12, paddingBottom: 12, paddingLeft: 14, paddingRight: 14, borderWidth: 1, borderColor: p.warnLine, borderRadius: 12, backgroundColor: p.warnBg }}>
      <Row gap={8}>
        <Icon name={question ? "asks" : "shield-alert"} size={15} color={p.data} />
        <div style={{ fontWeight: 500, color: p.text }}>{title}</div>
      </Row>
      <div style={{ fontSize: 12, color: p.text4 }}>{question ? t("chat.permission.needsAnswer", { agent: agentName }) : t("chat.permission.asksFirst")}</div>
      {input && (
        <div style={{ display: "flex", padding: 9, borderRadius: 8, backgroundColor: p.deep, fontFamily: MONO, fontSize: 11.5, lineHeight: 17, color: p.text4, overflowX: "scroll", ...scrollbar(p) }}>
          <div style={{ whiteSpace: "nowrap" }}>{input}</div>
        </div>
      )}
      {message.state.kind === "answered" ? (
        <Row gap={6} style={{ fontSize: 12, color: p.muted }}>
          <Icon name="check" size={12} color={p.muted} />
          <div>{answeredLabel(message.state.label)}</div>
        </Row>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, flexGrow: 1, minWidth: 0 }}>
            {message.choices.map((choice, ix) => <ChoiceButton key={choice.id} choice={choice} primary={ix === firstAllow} onChoose={() => onAnswer(choice)} />)}
          </div>
          <div onClick={() => onAnswer(null)} style={{ display: "flex", alignItems: "center", height: 28, flexShrink: 0, fontSize: 12, color: p.muted, cursor: "pointer", hover: { opacity: 0.72 } }}>{t("kit.skip")}</div>
        </div>
      )}
    </div>
  );
}

function ErrorNote({ text, onRetry }: { readonly text: string; readonly onRetry: () => void }): ReactElement {
  const { p } = useTheme();
  const [headline, ...rest] = text.split(/(?<=\.)\s+/);
  return (
    <div style={{ display: "flex", gap: 10, paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12, borderWidth: 1, borderColor: p.line2, borderRadius: 12 }}>
      <div style={{ display: "flex", paddingTop: 2 }}>
        <Icon name="problem" size={15} color={p.error} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, minWidth: 0 }}>
        <div style={{ color: p.text }}>{headline ?? text}</div>
        {rest.length > 0 && <div style={{ fontFamily: MONO, fontSize: 11.5, lineHeight: 17, color: p.muted }}>{rest.join(" ")}</div>}
      </div>
      <div onClick={onRetry} style={{ display: "flex", alignItems: "center", gap: 6, height: 26, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.line3, borderRadius: 8, fontSize: 12, color: p.text, flexShrink: 0, cursor: "pointer", hover: { opacity: 0.72 } }}>
        <Icon name="retry" size={12} color={p.text} />
        <div>{t("chat.tryAgain")}</div>
      </div>
    </div>
  );
}

export type MessageActions = {
  readonly onAnswer: (choice: PermissionChoice | null) => void;
  readonly onRetry: () => void;
  readonly onOpen: (procedure: string) => void;
  readonly onOpenText: (title: string, text: string) => void;
};

export function MessageView({ message, agentName, last, actions }: {
  readonly message: Message;
  readonly agentName: string;
  readonly last: boolean;
  readonly actions: MessageActions;
}): ReactElement {
  const { p } = useTheme();
  switch (message.kind) {
    case "user":
      return <UserMessage text={message.text} at={message.at} attachments={message.attachments ?? []} />;
    case "agent":
      return <AgentReply turn={message} last={last} onRetry={actions.onRetry} onOpen={actions.onOpen} onOpenText={actions.onOpenText} />;
    case "permission":
      return <PermissionCard message={message} agentName={agentName} onAnswer={actions.onAnswer} />;
    case "note":
      return message.tone === "error" ? (
        <ErrorNote text={message.text} onRetry={actions.onRetry} />
      ) : (
        <Row gap={8} style={{ fontSize: 12.5, color: p.muted }}>
          <Icon name="note" size={13} />
          <div>{message.text}</div>
        </Row>
      );
    default: {
      const unhandled: never = message;
      return unhandled;
    }
  }
}
