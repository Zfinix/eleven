import type { Attachment } from "../agents/attachments";
import type { AgentEvent, PermissionChoice, PlanItem, SessionOption, SlashCommand, StepStatus, ToolKind, Usage } from "../agents/events";
import { stringField } from "../lib/guards";
import { refusedReply } from "./refusal";

export type Step = {
  readonly id: string;
  readonly tool: string;
  readonly toolKind: ToolKind | null;
  readonly input: unknown;
  /** The one line an agent sends while a tool runs to say what it is for, like "Browse mDNS services". */
  readonly summary: string | null;
  readonly output: string | null;
  readonly status: StepStatus;
  readonly startedAt: number;
  /** When it finished or failed; null while it runs. */
  readonly endedAt: number | null;
};

export type Block =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "thought"; readonly text: string; readonly startedAt: number; readonly endedAt: number | null }
  | { readonly kind: "tool"; readonly step: Step };

/** `refused` is a turn the agent's provider declined, so another agent may still answer it. */
export type TurnOutcome = "running" | "done" | "cancelled" | "failed" | "refused";

export type PermissionState = { readonly kind: "pending" } | { readonly kind: "answered"; readonly label: string };

export type Message =
  | { readonly kind: "user"; readonly text: string; readonly at: number; readonly attachments?: readonly Attachment[] }
  | { readonly kind: "agent"; readonly blocks: readonly Block[]; readonly startedAt: number; readonly endedAt: number | null; readonly outcome: TurnOutcome }
  | {
      readonly kind: "permission";
      readonly id: number;
      readonly tool: string;
      readonly input: unknown;
      readonly choices: readonly PermissionChoice[];
      readonly state: PermissionState;
    }
  | { readonly kind: "note"; readonly text: string; readonly tone: "info" | "error" };

/** A message waiting its turn: what you typed and what you attached. */
export type Draft = { readonly text: string; readonly attachments: readonly Attachment[] };

export type CodeState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly text: string }
  | { readonly kind: "failed"; readonly message: string };

/** A function the agent read, or a whole tool result opened from the chat; `procedure` is the tab title either way. */
export type CanvasTab = { readonly kind: "function" | "result"; readonly procedure: string; readonly code: CodeState };

export type AgentStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "starting" }
  | { readonly kind: "ready"; readonly name: string }
  | { readonly kind: "working"; readonly name: string; readonly since: number };

export type ThreadState = {
  readonly messages: readonly Message[];
  readonly agent: AgentStatus;
  readonly tabs: readonly CanvasTab[];
  readonly active: number;
  readonly canvasOpen: boolean;
  readonly plan: readonly PlanItem[];
  readonly commands: readonly SlashCommand[];
  readonly options: readonly SessionOption[];
  readonly usage: Usage | null;
  readonly queue: readonly Draft[];
  /** Bumps on every open, so screens follow the agent even back to a tab that is already open. */
  readonly opened: number;
};

export type ThreadAction =
  | { readonly type: "starting" }
  | { readonly type: "sent"; readonly draft: Draft; readonly at: number }
  | { readonly type: "queued"; readonly draft: Draft }
  | { readonly type: "dequeued" }
  | { readonly type: "unqueued"; readonly index: number }
  | { readonly type: "event"; readonly event: AgentEvent; readonly at: number }
  | { readonly type: "answered"; readonly index: number; readonly label: string }
  | { readonly type: "note"; readonly text: string; readonly tone: "info" | "error" }
  | { readonly type: "reset" }
  | { readonly type: "restore"; readonly messages: readonly Message[] }
  | { readonly type: "retarget" }
  | { readonly type: "switchAgent" }
  | { readonly type: "codeLoaded"; readonly procedure: string; readonly code: CodeState }
  | { readonly type: "openTab"; readonly procedure: string }
  | { readonly type: "openText"; readonly title: string; readonly text: string }
  | { readonly type: "selectTab"; readonly index: number }
  | { readonly type: "closeCanvas" };

type AgentMessage = Extract<Message, { kind: "agent" }>;

export const EMPTY_THREAD: ThreadState = {
  messages: [],
  agent: { kind: "idle" },
  tabs: [],
  active: 0,
  canvasOpen: true,
  plan: [],
  commands: [],
  options: [],
  usage: null,
  queue: [],
  opened: 0,
};

/** Agents read a slash command only when it starts the prompt, so nothing goes before it. */
export function isCommand(text: string): boolean {
  return /^\/[a-z][\w-]*(\s|$)/i.test(text.trimStart());
}

export function isBusy(state: ThreadState): boolean {
  return state.agent.kind === "working";
}

export function agentName(status: AgentStatus): string | null {
  return status.kind === "ready" || status.kind === "working" ? status.name : null;
}

function currentTurn(messages: readonly Message[], at: number): { readonly rest: readonly Message[]; readonly turn: AgentMessage } {
  const last = messages[messages.length - 1];
  if (last?.kind === "agent" && last.outcome === "running") return { rest: messages.slice(0, -1), turn: last };
  return { rest: messages, turn: { kind: "agent", blocks: [], startedAt: at, endedAt: null, outcome: "running" } };
}

function closeThoughts(blocks: readonly Block[], at: number): readonly Block[] {
  return blocks.map((block) => (block.kind === "thought" && block.endedAt === null ? { ...block, endedAt: at } : block));
}

function appendText(blocks: readonly Block[], kind: "text" | "thought", text: string, at: number): readonly Block[] {
  const last = blocks[blocks.length - 1];
  if (last?.kind === kind) return [...blocks.slice(0, -1), { ...last, text: last.text + text }];
  const settled = kind === "text" ? closeThoughts(blocks, at) : blocks;
  return kind === "text" ? [...settled, { kind: "text", text }] : [...settled, { kind: "thought", text, startedAt: at, endedAt: null }];
}

function hasArgs(input: unknown): boolean {
  return ["procedure", "pattern", "address", "path", "command", "url", "file_path", "query"].some((key) => stringField(input, key) !== undefined);
}

const SUMMARY_MAX = 160;

type StepEvent = Extract<AgentEvent, { kind: "step" }>;

/** A short line sent while the tool still runs is what the agent says the call is for, not its result. */
function summaryOf(event: StepEvent): string | null {
  const text = event.output?.trim() ?? "";
  if (event.status !== "running" || !text || text.length > SUMMARY_MAX || text.includes("\n") || text.startsWith("```")) return null;
  return text;
}

function upsertStep(blocks: readonly Block[], event: StepEvent, at: number): readonly Block[] {
  const exists = blocks.some((block) => block.kind === "tool" && block.step.id === event.id);
  const ended = event.status === "running" ? null : at;
  const summary = summaryOf(event);
  const output = summary ? null : event.output;
  if (!exists) return [...closeThoughts(blocks, at), { kind: "tool", step: { id: event.id, tool: event.tool, toolKind: event.toolKind, input: event.input, summary, output, status: event.status, startedAt: at, endedAt: ended } }];
  return blocks.map((block) => {
    if (block.kind !== "tool" || block.step.id !== event.id) return block;
    const step = block.step;
    return {
      kind: "tool",
      step: {
        ...step,
        status: event.status,
        endedAt: step.endedAt ?? ended,
        tool: event.tool || step.tool,
        toolKind: event.toolKind ?? step.toolKind,
        input: hasArgs(event.input) ? event.input : step.input,
        summary: summary ?? step.summary,
        output: output ?? step.output,
      },
    };
  });
}

function updateTurn(state: ThreadState, at: number, change: (blocks: readonly Block[]) => readonly Block[]): ThreadState {
  const { rest, turn } = currentTurn(state.messages, at);
  return { ...state, messages: [...rest, { ...turn, blocks: change(turn.blocks) }] };
}

function openTab(state: ThreadState, procedure: string): ThreadState {
  const at = state.tabs.findIndex((tab) => tab.procedure === procedure);
  const opened = state.opened + 1;
  if (at >= 0) return { ...state, active: at, canvasOpen: true, opened };
  return { ...state, tabs: [...state.tabs, { kind: "function", procedure, code: { kind: "loading" } }], active: state.tabs.length, canvasOpen: true, opened };
}

/** A whole tool result as its own canvas tab, titled by what the tool did; the same title replaces its tab. */
function openText(state: ThreadState, title: string, text: string): ThreadState {
  const tab: CanvasTab = { kind: "result", procedure: title, code: { kind: "ready", text } };
  const at = state.tabs.findIndex((candidate) => candidate.procedure === title);
  const opened = state.opened + 1;
  if (at >= 0) return { ...state, tabs: state.tabs.map((candidate, ix) => (ix === at ? tab : candidate)), active: at, canvasOpen: true, opened };
  return { ...state, tabs: [...state.tabs, tab], active: state.tabs.length, canvasOpen: true, opened };
}

function withTurn(state: ThreadState): readonly Message[] {
  const last = state.messages[state.messages.length - 1];
  if (state.agent.kind !== "working" || (last?.kind === "agent" && last.outcome === "running")) return state.messages;
  return [...state.messages, { kind: "agent", blocks: [], startedAt: state.agent.since, endedAt: null, outcome: "running" }];
}

function runningText(state: ThreadState): string {
  const turn = state.messages.at(-1);
  if (turn?.kind !== "agent" || turn.outcome !== "running") return "";
  return turn.blocks.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join("\n");
}

function finishTurn(state: ThreadState, outcome: TurnOutcome, at: number): ThreadState {
  const messages = withTurn(state).map((message) =>
    message.kind === "agent" && message.outcome === "running" ? { ...message, outcome, endedAt: at, blocks: closeThoughts(message.blocks, at) } : message,
  );
  const name = agentName(state.agent);
  return { ...state, messages, agent: name ? { kind: "ready", name } : { kind: "idle" } };
}

function onStep(state: ThreadState, event: Extract<AgentEvent, { kind: "step" }>, at: number): ThreadState {
  const next = updateTurn(state, at, (blocks) => upsertStep(blocks, event, at));
  const procedure = stringField(event.input, "procedure");
  return procedure ? openTab(next, procedure) : next;
}

function onEvent(state: ThreadState, event: AgentEvent, at: number): ThreadState {
  switch (event.kind) {
    case "connected":
      return { ...state, agent: state.agent.kind === "working" ? { ...state.agent, name: event.agent } : { kind: "ready", name: event.agent } };
    case "text":
      return updateTurn(state, at, (blocks) => appendText(blocks, "text", event.text, at));
    case "thought":
      return updateTurn(state, at, (blocks) => appendText(blocks, "thought", event.text, at));
    case "step":
      return onStep(state, event, at);
    case "permission":
      return { ...state, messages: [...state.messages, { kind: "permission", id: event.id, tool: event.tool, input: event.input, choices: event.choices, state: { kind: "pending" } }] };
    case "plan":
      return { ...state, plan: event.items };
    case "commands":
      return { ...state, commands: event.commands };
    case "options":
      return { ...state, options: event.options };
    case "usage":
      return { ...state, usage: event.usage };
    case "notice":
      return { ...state, messages: [...state.messages, { kind: "note", text: event.text, tone: "info" }] };
    case "turnEnded":
      return finishTurn(state, event.cancelled ? "cancelled" : event.refused || refusedReply(runningText(state)) ? "refused" : "done", at);
    case "failed": {
      const ended = finishTurn(state, "failed", at);
      return { ...ended, agent: { kind: "idle" }, messages: [...ended.messages, { kind: "note", text: event.reason, tone: "error" }] };
    }
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

function answer(state: ThreadState, index: number, label: string): ThreadState {
  const answered: PermissionState = { kind: "answered", label };
  return { ...state, messages: state.messages.map((m, ix) => (ix === index && m.kind === "permission" ? { ...m, state: answered } : m)) };
}

function sent(state: ThreadState, draft: Draft, at: number): ThreadState {
  const name = agentName(state.agent) ?? "";
  const message: Message = draft.attachments.length > 0 ? { kind: "user", text: draft.text, at, attachments: draft.attachments } : { kind: "user", text: draft.text, at };
  return { ...state, agent: { kind: "working", name, since: at }, messages: [...state.messages, message] };
}

export function threadReducer(state: ThreadState, action: ThreadAction): ThreadState {
  switch (action.type) {
    case "starting":
      return state.agent.kind === "idle" ? { ...state, agent: { kind: "starting" } } : state;
    case "sent":
      return sent(state, action.draft, action.at);
    case "queued":
      return { ...state, queue: [...state.queue, action.draft] };
    case "dequeued":
      return { ...state, queue: state.queue.slice(1) };
    case "unqueued":
      return { ...state, queue: state.queue.filter((_, ix) => ix !== action.index) };
    case "event":
      return onEvent(state, action.event, action.at);
    case "answered":
      return answer(state, action.index, action.label);
    case "note":
      return { ...state, messages: [...state.messages, { kind: "note", text: action.text, tone: action.tone }] };
    case "reset":
      return { ...EMPTY_THREAD, options: state.options, commands: state.commands };
    case "restore":
      return { ...EMPTY_THREAD, options: state.options, commands: state.commands, messages: action.messages };
    case "retarget":
      return { ...state, tabs: [], active: 0, canvasOpen: true };
    case "switchAgent":
      return { ...state, agent: { kind: "idle" }, options: [], commands: [], usage: null };
    case "codeLoaded":
      return { ...state, tabs: state.tabs.map((tab) => (tab.procedure === action.procedure ? { ...tab, code: action.code } : tab)) };
    case "openTab":
      return openTab(state, action.procedure);
    case "openText":
      return openText(state, action.title, action.text);
    case "selectTab":
      return { ...state, active: action.index };
    case "closeCanvas":
      return { ...state, canvasOpen: false };
    default: {
      const unhandled: never = action;
      return unhandled;
    }
  }
}
