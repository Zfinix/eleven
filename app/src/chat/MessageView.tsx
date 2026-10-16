import { memo, type ReactElement, useMemo, useState } from "react";

import { toolLabel } from "../agents/describe";
import { type MenuEntry, menuOn } from "../components/ContextMenu";
import { JumpButton, SuggestionCard, Tooltip } from "../components/kit";
import type { PermissionChoice } from "../agents/events";
import { stringField } from "../lib/guards";
import { seconds, useNow } from "../lib/useNow";
import { syntaxFor, useCodeLook } from "../settings/look";
import { useSettings } from "../settings/store";
import { openLink } from "../settings/system";
import { MONO, nativeTheme, useTheme } from "../theme";
import { Icon, Row, Spacer } from "../components/ui";
import type { Block, Message, Step } from "./thread";
import { ChainOfThought, ChainOfThoughtResults, ChainOfThoughtStep } from "./ChainOfThought";
import { Sources, sourcesOf } from "./Sources";
import { copyText } from "./useThread";
import { shownText } from "../skills/load";
import { ContentPages, PageControls } from "./ContentPages";
import { inputPreview } from "./inputPreview";

const STEPS_PER_PAGE = 32;
const METADATA_CHARS = 128_000;

type AgentTurn = Extract<Message, { kind: "agent" }>;
type PermissionMessage = Extract<Message, { kind: "permission" }>;

function timeOfDay(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function IconAction({
  icon,
  label,
  onClick,
}: {
  readonly icon: string;
  readonly label: string;
  readonly onClick: () => void;
}): ReactElement {
  const { p } = useTheme();
  return (
    <div
      onClick={onClick}
      aria-label={label}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: 6,
        cursor: "pointer",
        hover: { opacity: 0.72 },
      }}
    >
      <Icon name={icon} size={13} color={p.muted} />
    </div>
  );
}

function UserMessage({
  text: sent,
  at,
}: {
  readonly text: string;
  readonly at: number;
}): ReactElement {
  const { p } = useTheme();
  const text = shownText(sent);
  const { colorScheme } = useSettings().settings;
  const look = useCodeLook();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: "flex", flexDirection: "column", gap: 4 }}
    >
      <div
        {...menuOn(() => [
          { kind: "action", label: "Copy", icon: "copy", run: () => copyText(text) },
        ])}
        style={{
          display: "flex",
          flexDirection: "column",
          userSelect: "text",
          paddingTop: 10,
          paddingBottom: 10,
          paddingLeft: 14,
          paddingRight: 14,
          borderWidth: 1,
          borderColor: p.line2,
          borderRadius: 12,
          backgroundColor: p.raised,
        }}
      >
        <ContentPages text={text}>
          {(page) => (
            <markdown
              source={page}
              theme={nativeTheme(p, look, syntaxFor(colorScheme, p))}
              onLinkClick={(event) => event.value && openLink(event.value)}
              style={{ color: p.text }}
            />
          )}
        </ContentPages>
      </div>
      <Row gap={2} style={{ height: 24, opacity: hovered ? 1 : 0 }}>
        <Spacer />
        <div style={{ fontSize: 11.5, color: p.faint, marginRight: 4 }}>{timeOfDay(at)}</div>
        <IconAction icon="copy" label="Copy" onClick={() => copyText(text)} />
      </Row>
    </div>
  );
}

function IoSection({
  title,
  body,
}: {
  readonly title: string;
  readonly body: string;
}): ReactElement {
  const { p } = useTheme();
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        paddingTop: 8,
        paddingBottom: 8,
        paddingLeft: 10,
        paddingRight: 10,
      }}
    >
      <div
        style={{
          width: 26,
          flexShrink: 0,
          fontSize: 10.5,
          fontWeight: 600,
          color: p.faint,
          paddingTop: 1,
        }}
      >
        {title}
      </div>
      <div
        style={{
          flexGrow: 1,
          minWidth: 0,
          fontFamily: MONO,
          fontSize: 11.5,
          lineHeight: 17,
          color: p.text4,
        }}
      >
        <ContentPages text={body}>
          {(page) => <div style={{ maxHeight: 220, overflowY: "scroll" }}>{page}</div>}
        </ContentPages>
      </div>
    </div>
  );
}

/** How a tool call went, as the kit writes it: Working…, how long it took, or Didn't work. */
function stepState(step: Step): string {
  switch (step.status) {
    case "running":
      return "Working…";
    case "failed":
      return "Didn't work";
    case "done": {
      const took =
        Number.isFinite(step.startedAt) && step.endedAt !== null && Number.isFinite(step.endedAt)
          ? step.endedAt - step.startedAt
          : null;
      if (took === null) return "Done";
      return took < 10_000 ? `${Math.max(1, Math.round(took))} ms` : seconds(took);
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
  const name = tool.slice(0, 240).toLowerCase();
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

/** Functions and addresses a tool turned up, to show as badges. */
function found(step: Step): readonly string[] {
  if (step.status !== "done" || !step.output) return [];
  const names =
    step.output
      .slice(0, METADATA_CHARS)
      .match(/\b(?:FUN|thunk_FUN|LAB|DAT)_[0-9a-f]+\b|\b_[A-Za-z]\w{2,}\b/g) ?? [];
  return [...new Set(names)].slice(0, MAX_FOUND);
}

function ToolStep({
  step,
  onOpen,
}: {
  readonly step: Step;
  readonly onOpen: (procedure: string) => void;
}): ReactElement {
  const { p } = useTheme();
  const [open, setOpen] = useState(false);
  const { label, detail } = toolLabel(step.tool, step.input);
  const input = useMemo(() => (open ? inputPreview(step.input) : ""), [open, step.input]);
  const failed = step.status === "failed";
  const results = useMemo(() => found(step), [step.status, step.output]);
  const header = (
    <div
      onClick={() => setOpen(!open)}
      role="button"
      aria-expanded={open}
      aria-label={open ? "Hide what it sent and got back" : "Show what it sent and got back"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
        cursor: "pointer",
        hover: { opacity: 0.72 },
      }}
    >
      <div
        style={{
          flexShrink: 0,
          paddingLeft: 6,
          paddingRight: 6,
          paddingTop: 1,
          paddingBottom: 1,
          borderRadius: 5,
          backgroundColor: p.fill2,
          fontSize: 11,
          color: p.muted,
          pointerEvents: "none",
        }}
      >
        Tool
      </div>
      <Tooltip label={step.tool.slice(0, 240).trim().split("\n", 1)[0] ?? "Tool"}>
        <div
          style={{
            flexShrink: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
      </Tooltip>
      {detail && (
        <div
          style={{
            flexShrink: 1,
            minWidth: 0,
            fontSize: 12,
            color: p.faint,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {detail}
        </div>
      )}
      <Spacer />
      <div
        style={{
          flexShrink: 0,
          fontSize: 12,
          color: failed ? p.error : p.faint,
          whiteSpace: "nowrap",
        }}
      >
        {stepState(step)}
      </div>
      <Icon name={open ? "collapse" : "disclosure"} size={14} color={p.faint} />
    </div>
  );
  return (
    <ChainOfThoughtStep
      icon={toolIcon(step.tool) ?? "bolt"}
      label={header}
      status={step.status === "running" ? "active" : "complete"}
      tone={failed ? p.error : null}
    >
      {failed && (
        <div style={{ fontSize: 12, color: p.error }}>
          {step.output?.slice(0, 160).split("\n", 1)[0] ?? "The agent will try another way."}
        </div>
      )}
      {results.length > 0 && <ChainOfThoughtResults items={results} onPick={onOpen} />}
      {open && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            borderWidth: 1,
            borderColor: p.line2,
            borderRadius: 9,
            backgroundColor: p.deep,
          }}
        >
          {input && <IoSection title="IN" body={input} />}
          {input && step.output && <div style={{ height: 1, backgroundColor: p.line2 }} />}
          {step.output && <IoSection title="OUT" body={step.output} />}
          {!input && !step.output && (
            <IoSection
              title=""
              body={step.status === "running" ? "Waiting for the result…" : "No details."}
            />
          )}
        </div>
      )}
    </ChainOfThoughtStep>
  );
}

function ThoughtStep({
  text,
  startedAt,
  endedAt,
}: {
  readonly text: string;
  readonly startedAt: number;
  readonly endedAt: number | null;
}): ReactElement {
  const { p } = useTheme();
  const now = useNow(endedAt === null);
  const label =
    endedAt === null
      ? `Thinking for ${seconds(now - startedAt)}`
      : `Thought for ${seconds(endedAt - startedAt)}`;
  return (
    <ChainOfThoughtStep
      icon="thought"
      label={label}
      status={endedAt === null ? "active" : "complete"}
    >
      <ContentPages text={text} followTail={endedAt === null}>
        {(page) => <div style={{ fontSize: 12.5, lineHeight: 19, color: p.faint }}>{page}</div>}
      </ContentPages>
    </ChainOfThoughtStep>
  );
}

const StepView = memo(function StepView({
  block,
  onOpen,
}: {
  readonly block: Block;
  readonly onOpen: (procedure: string) => void;
}): ReactElement {
  switch (block.kind) {
    case "text":
      return (
        <ChainOfThoughtStep
          icon={null}
          label={<ContentPages text={block.text}>{(page) => page}</ContentPages>}
          status="complete"
        />
      );
    case "thought":
      return <ThoughtStep text={block.text} startedAt={block.startedAt} endedAt={block.endedAt} />;
    case "tool":
      return <ToolStep step={block.step} onOpen={onOpen} />;
    default: {
      const unhandled: never = block;
      return unhandled;
    }
  }
});

/** The answer: the text the agent wrote after its last step. Everything before it is how it got there. */
function splitAnswer(blocks: readonly Block[]): {
  readonly steps: readonly Block[];
  readonly answer: readonly Block[];
} {
  const lastWork = blocks.reduce((at, block, ix) => (block.kind === "text" ? at : ix), -1);
  return { steps: blocks.slice(0, lastWork + 1), answer: blocks.slice(lastWork + 1) };
}

function chainLabel(turn: AgentTurn, steps: number, now: number): string {
  const count = `${steps} ${steps === 1 ? "step" : "steps"}`;
  switch (turn.outcome) {
    case "running":
      return `Working for ${seconds(now - turn.startedAt)}`;
    case "cancelled":
      return `Stopped after ${count}`;
    case "done":
    case "failed":
      return `Worked through ${count}${turn.endedAt === null ? "" : ` in ${seconds(turn.endedAt - turn.startedAt)}`}`;
    default: {
      const unhandled: never = turn.outcome;
      return unhandled;
    }
  }
}

const MAX_JUMPS = 3;

/** The functions a finished reply points at: Ghidra names in its text, then the ones its tools read. */
function mentionedFunctions(turn: AgentTurn): readonly string[] {
  const names = new Set<string>();
  let remaining = METADATA_CHARS;
  for (const block of turn.blocks) {
    if (block.kind !== "text" || remaining === 0) continue;
    const text = block.text.slice(0, remaining);
    remaining -= text.length;
    for (const [name] of text.matchAll(/\b(?:FUN|thunk_FUN)_[0-9a-f]+\b/g)) {
      names.add(name);
      if (names.size === MAX_JUMPS) return [...names];
    }
  }
  for (const block of turn.blocks) {
    if (block.kind !== "tool") continue;
    const name = stringField(block.step.input, "procedure");
    if (name) names.add(name);
    if (names.size === MAX_JUMPS) break;
  }
  return [...names];
}

function replyText(turn: AgentTurn): string {
  return turn.blocks
    .flatMap((block) => (block.kind === "text" ? [block.text.trim()] : []))
    .join("\n\n");
}

function TurnFooter({
  turn,
  last,
  onRetry,
}: {
  readonly turn: AgentTurn;
  readonly last: boolean;
  readonly onRetry: () => void;
}): ReactElement | null {
  const { p } = useTheme();
  if (turn.outcome === "running" || turn.outcome === "failed") return null;
  const took = turn.endedAt === null ? "" : seconds(turn.endedAt - turn.startedAt);
  const worked = turn.blocks.some((block) => block.kind !== "text");
  const status =
    turn.outcome === "cancelled"
      ? "Interrupted"
      : turn.blocks.length === 0
        ? "No reply"
        : worked
          ? ""
          : `Answered in ${took}`;
  return (
    <Row gap={2} style={{ height: 26 }}>
      {status && (
        <div
          style={{
            fontSize: 11.5,
            color: turn.outcome === "cancelled" ? p.text4 : p.faint,
            marginRight: 6,
          }}
        >
          {status}
        </div>
      )}
      {turn.blocks.some((block) => block.kind === "text" && block.text.length > 0) && (
        <IconAction icon="copy" label="Copy reply" onClick={() => copyText(replyText(turn))} />
      )}
      {last && <IconAction icon="retry" label="Try again" onClick={onRetry} />}
    </Row>
  );
}

function ReplySteps({
  turn,
  steps,
  onOpen,
  menuFor,
}: {
  readonly turn: AgentTurn;
  readonly steps: readonly Block[];
  readonly onOpen: (procedure: string) => void;
  readonly menuFor: (block: Block) => readonly MenuEntry[];
}): ReactElement {
  const [opened, setOpened] = useState<boolean | null>(null);
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const running = turn.outcome === "running";
  const now = useNow(running);
  const open = opened ?? running;
  const lastPage = Math.max(0, Math.ceil(steps.length / STEPS_PER_PAGE) - 1);
  const page = Math.min(selectedPage ?? lastPage, lastPage);
  const start = page * STEPS_PER_PAGE;

  return (
    <ChainOfThought
      label={chainLabel(turn, steps.length, now)}
      open={open}
      onToggle={() => setOpened(!open)}
    >
      {open && steps.length > STEPS_PER_PAGE && (
        <PageControls
          label={`Steps ${start + 1}–${Math.min(start + STEPS_PER_PAGE, steps.length)} of ${steps.length}`}
          previous={page > 0 ? () => setSelectedPage(page - 1) : null}
          next={page < lastPage ? () => setSelectedPage(page + 1) : null}
          latest={selectedPage !== null ? () => setSelectedPage(null) : null}
        />
      )}
      {open &&
        steps.slice(start, start + STEPS_PER_PAGE).map((block, index) => (
          <div
            key={block.kind === "tool" ? block.step.id : `${block.kind}-${start + index}`}
            {...menuOn(() => menuFor(block))}
            style={{ display: "flex", flexDirection: "column" }}
          >
            <StepView block={block} onOpen={onOpen} />
          </div>
        ))}
    </ChainOfThought>
  );
}

function AgentReply({
  turn,
  last,
  onRetry,
  onOpen,
}: {
  readonly turn: AgentTurn;
  readonly last: boolean;
  readonly onRetry: () => void;
  readonly onOpen: (procedure: string) => void;
}): ReactElement {
  const { p } = useTheme();
  const { showThinking, colorScheme } = useSettings().settings;
  const look = useCodeLook();
  const running = turn.outcome === "running";
  const blocks = useMemo(
    () => turn.blocks.filter((block) => block.kind !== "thought" || showThinking),
    [turn.blocks, showThinking],
  );
  const { steps, answer } = useMemo(() => splitAnswer(blocks), [blocks]);
  const answerText = useMemo(
    () => answer.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join("\n\n"),
    [answer],
  );
  const sources = useMemo(() => (running ? [] : sourcesOf(blocks)), [running, blocks]);
  const jumps = useMemo(() => (turn.outcome === "done" ? mentionedFunctions(turn) : []), [turn]);
  const menuFor = (block: Block): readonly MenuEntry[] => {
    const procedure = block.kind === "tool" ? stringField(block.step.input, "procedure") : null;
    const output = block.kind === "tool" ? block.step.output : null;
    return [
      ...(procedure
        ? [
            {
              kind: "action",
              label: `Open ${procedure}`,
              icon: "open-tab",
              run: () => onOpen(procedure),
            } as const,
            { kind: "separator" } as const,
          ]
        : []),
      ...(block.kind === "text"
        ? [
            {
              kind: "action",
              label: "Copy this part",
              icon: "copy",
              run: () => copyText(block.text.trim()),
            } as const,
          ]
        : []),
      ...(output
        ? [
            {
              kind: "action",
              label: "Copy the tool's result",
              icon: "copy",
              run: () => copyText(output),
            } as const,
          ]
        : []),
      ...(turn.blocks.some((part) => part.kind === "text" && part.text.length > 0)
        ? [
            {
              kind: "action",
              label: "Copy reply",
              icon: "copy",
              run: () => copyText(replyText(turn)),
            } as const,
          ]
        : []),
      ...(last && !running
        ? [
            { kind: "separator" } as const,
            { kind: "action", label: "Try again", icon: "retry", run: onRetry } as const,
          ]
        : []),
    ];
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {steps.length > 0 && (
        <ReplySteps turn={turn} steps={steps} onOpen={onOpen} menuFor={menuFor} />
      )}
      {answerText && (
        <div
          {...menuOn(() => menuFor({ kind: "text", text: answerText }))}
          style={{ display: "flex", flexDirection: "column", userSelect: "text" }}
        >
          <ContentPages text={answerText} followTail={running}>
            {(text) => (
              <markdown
                source={text}
                theme={nativeTheme(p, look, syntaxFor(colorScheme, p))}
                onLinkClick={(event) => event.value && openLink(event.value)}
                style={{ color: p.text2 }}
              />
            )}
          </ContentPages>
        </div>
      )}
      <Sources sources={sources} />
      {jumps.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {jumps.map((name) => (
            <JumpButton key={name} label={`Open ${name}`} onClick={() => onOpen(name)} />
          ))}
        </div>
      )}
      <TurnFooter turn={turn} last={last} onRetry={onRetry} />
    </div>
  );
}

function ChoiceButton({
  choice,
  primary,
  onChoose,
}: {
  readonly choice: PermissionChoice;
  readonly primary: boolean;
  readonly onChoose: () => void;
}): ReactElement {
  const { p } = useTheme();
  const look = primary
    ? { backgroundColor: p.primary, color: p.onPrimary, fontWeight: 600 }
    : { borderWidth: 1, borderColor: p.line3, color: p.text };
  return (
    <div
      onClick={onChoose}
      style={{
        height: 28,
        display: "flex",
        alignItems: "center",
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: 8,
        fontSize: 12.5,
        cursor: "pointer",
        hover: { opacity: 0.72 },
        ...look,
      }}
    >
      {choice.label}
    </div>
  );
}

type Proposal = {
  readonly title: string;
  readonly reason: string;
  readonly apply: string;
  readonly applied: string;
};

/** An agent asking to change your project through Eleven's own tools reads as a suggestion, not a security prompt. */
function proposal(message: PermissionMessage, agentName: string): Proposal | null {
  const input = message.input;
  const fn = stringField(input, "function");
  const name = stringField(input, "new_name");
  if (fn && name)
    return {
      title: `Rename ${fn} to ${name}?`,
      reason: `${agentName} suggests this name. It's saved in your project file, not the binary.`,
      apply: "Rename",
      applied: `Renamed to ${name} everywhere.`,
    };
  const note = stringField(input, "note");
  if (fn && note)
    return {
      title: `Save a note on ${fn}?`,
      reason: note,
      apply: "Save note",
      applied: "Saved the note.",
    };
  const address = stringField(input, "address");
  const comment = stringField(input, "comment");
  if (address && comment !== undefined)
    return {
      title: comment ? `Comment ${address}?` : `Remove the comment at ${address}?`,
      reason: comment,
      apply: comment ? "Comment" : "Remove",
      applied: comment ? "Commented." : "Removed the comment.",
    };
  const label = stringField(input, "label");
  if (address && label !== undefined)
    return {
      title: `Bookmark ${label || address}?`,
      reason: `${agentName} wants to keep ${address} in your sidebar.`,
      apply: "Bookmark",
      applied: "Bookmarked.",
    };
  return null;
}

function SuggestionPrompt({
  message,
  offer,
  onAnswer,
}: {
  readonly message: PermissionMessage;
  readonly offer: Proposal;
  readonly onAnswer: (choice: PermissionChoice | null) => void;
}): ReactElement {
  const allow = message.choices.find((choice) => choice.allows) ?? null;
  const reject = message.choices.find((choice) => !choice.allows) ?? null;
  const answered = message.state.kind === "answered" ? message.state.label : null;
  const accepted =
    answered !== null &&
    message.choices.some((choice) => choice.allows && choice.label === answered);
  const state =
    answered === null
      ? ({ kind: "pending" } as const)
      : ({ kind: "done", result: accepted ? offer.applied : "Skipped." } as const);
  return (
    <SuggestionCard
      title={offer.title}
      reason={offer.reason}
      apply={offer.apply}
      state={state}
      onApply={() => onAnswer(allow)}
      onSkip={() => onAnswer(reject)}
    />
  );
}

function PermissionCard({
  message,
  agentName,
  onAnswer,
}: {
  readonly message: PermissionMessage;
  readonly agentName: string;
  readonly onAnswer: (choice: PermissionChoice | null) => void;
}): ReactElement {
  const { p } = useTheme();
  const offer = proposal(message, agentName);
  if (offer) return <SuggestionPrompt message={message} offer={offer} onAnswer={onAnswer} />;
  const { label, detail } = toolLabel(message.tool, message.input);
  const question = message.tool.trim().endsWith("?");
  const input = question ? "" : inputPreview(message.input).replace(/\s*\n\s*/g, " ");
  const firstAllow = question ? -1 : message.choices.findIndex((choice) => choice.allows);
  const title = question
    ? message.tool.trim()
    : `${agentName} wants to ${label.charAt(0).toLowerCase()}${label.slice(1)}${detail ? ` ${detail}` : ""}`;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        paddingTop: 12,
        paddingBottom: 12,
        paddingLeft: 14,
        paddingRight: 14,
        borderWidth: 1,
        borderColor: p.warnLine,
        borderRadius: 12,
        backgroundColor: p.warnBg,
      }}
    >
      <Row gap={8}>
        <Icon name={question ? "asks" : "shield-alert"} size={15} color={p.data} />
        <div style={{ fontWeight: 500, color: p.text }}>{title}</div>
      </Row>
      <div style={{ fontSize: 12, color: p.text4 }}>
        {question
          ? `${agentName} needs your answer to keep going.`
          : "It can change things or run code, so it asks first."}
      </div>
      {input && (
        <div
          style={{
            display: "flex",
            padding: 9,
            borderRadius: 8,
            backgroundColor: p.deep,
            fontFamily: MONO,
            fontSize: 11.5,
            lineHeight: 17,
            color: p.text4,
            overflowX: "scroll",
          }}
        >
          <div style={{ whiteSpace: "nowrap" }}>{input}</div>
        </div>
      )}
      {message.state.kind === "answered" ? (
        <Row gap={6} style={{ fontSize: 12, color: p.muted }}>
          <Icon name="check" size={12} color={p.muted} />
          <div>{message.state.label}</div>
        </Row>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 6,
              flexGrow: 1,
              minWidth: 0,
            }}
          >
            {message.choices.map((choice, ix) => (
              <ChoiceButton
                key={choice.id}
                choice={choice}
                primary={ix === firstAllow}
                onChoose={() => onAnswer(choice)}
              />
            ))}
          </div>
          <div
            onClick={() => onAnswer(null)}
            style={{
              display: "flex",
              alignItems: "center",
              height: 28,
              flexShrink: 0,
              fontSize: 12,
              color: p.muted,
              cursor: "pointer",
              hover: { opacity: 0.72 },
            }}
          >
            Skip
          </div>
        </div>
      )}
    </div>
  );
}

function ErrorNote({
  text,
  onRetry,
}: {
  readonly text: string;
  readonly onRetry: () => void;
}): ReactElement {
  const { p } = useTheme();
  const [headline, ...rest] = text.split(/(?<=\.)\s+/);
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: 12,
        paddingRight: 12,
        borderWidth: 1,
        borderColor: p.line2,
        borderRadius: 12,
      }}
    >
      <div style={{ display: "flex", paddingTop: 2 }}>
        <Icon name="problem" size={15} color={p.error} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, minWidth: 0 }}>
        <div style={{ color: p.text }}>{headline ?? text}</div>
        {rest.length > 0 && (
          <div style={{ fontFamily: MONO, fontSize: 11.5, lineHeight: 17, color: p.muted }}>
            {rest.join(" ")}
          </div>
        )}
      </div>
      <div
        onClick={onRetry}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 26,
          paddingLeft: 10,
          paddingRight: 10,
          borderWidth: 1,
          borderColor: p.line3,
          borderRadius: 8,
          fontSize: 12,
          color: p.text,
          flexShrink: 0,
          cursor: "pointer",
          hover: { opacity: 0.72 },
        }}
      >
        <Icon name="retry" size={12} color={p.text} />
        <div>Try again</div>
      </div>
    </div>
  );
}

export type MessageActions = {
  readonly onAnswer: (choice: PermissionChoice | null) => void;
  readonly onRetry: () => void;
  readonly onOpen: (procedure: string) => void;
};

export function MessageView({
  message,
  agentName,
  last,
  actions,
}: {
  readonly message: Message;
  readonly agentName: string;
  readonly last: boolean;
  readonly actions: MessageActions;
}): ReactElement {
  const { p } = useTheme();
  switch (message.kind) {
    case "user":
      return <UserMessage text={message.text} at={message.at} />;
    case "agent":
      return (
        <AgentReply turn={message} last={last} onRetry={actions.onRetry} onOpen={actions.onOpen} />
      );
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
