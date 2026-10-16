import { toolLabel } from "../agents/describe";
import type { PermissionChoice } from "../agents/events";
import { tr, trN } from "../i18n";
import { isRecord } from "../lib/guards";

export type ChatRef = { readonly id: string; readonly title: string; readonly project: string | null };

/** Something worth telling you about while you're in another app. */
export type Moment =
  | { readonly kind: "agentDone"; readonly chat: ChatRef; readonly agent: string; readonly answer: string }
  | { readonly kind: "agentNeedsYou"; readonly chat: ChatRef; readonly agent: string; readonly ask: number; readonly tool: string; readonly input: unknown; readonly choices: readonly PermissionChoice[] }
  | { readonly kind: "agentStopped"; readonly chat: ChatRef; readonly agent: string; readonly reason: string }
  | { readonly kind: "opened"; readonly project: string; readonly name: string; readonly engine: string; readonly functions: number }
  | { readonly kind: "openFailed"; readonly name: string; readonly advice: string };

export type Note = {
  readonly tag: string;
  readonly title: string;
  readonly body: string;
  readonly actions: readonly { readonly id: string; readonly label: string }[];
};

/** Notification Center cuts long text anyway; stopping at a sentence reads better. */
const BODY_LIMIT = 160;

function firstLine(text: string): string {
  const lines = text.split("\n").filter((part) => !/^\s*(#|```)/.test(part));
  const line = lines.map((part) => part.replace(/^[>*\-\s]+/, "").trim()).find((part) => part.length > 0) ?? "";
  if (line.length <= BODY_LIMIT) return line;
  const cut = line.slice(0, BODY_LIMIT);
  const stop = cut.lastIndexOf(". ");
  return stop > BODY_LIMIT / 2 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
}

/** A short name for what the agent wants to do. A raw shell command is never readable in a notification. */
function askedFor(tool: string, input: unknown): string {
  const { label } = toolLabel(tool, input);
  if (label.length <= 60 && !/[;|&$]/.test(label)) return label;
  if (isRecord(input) && "command" in input) return tr("Run a command");
  return /[;|&$]/.test(label) ? tr("Run a command") : `${label.slice(0, 59).trimEnd()}…`;
}

function chatTitle(chat: ChatRef, agent: string): string {
  return chat.title.trim() || chat.project || agent;
}

export function askTag(chat: string, ask: number): string {
  return `ask:${chat}:${ask}`;
}

/** The two buttons a notification offers for a permission request: the first way to allow it and the first way to refuse. */
export function askButtons(choices: readonly PermissionChoice[]): readonly PermissionChoice[] {
  const allow = choices.find((choice) => choice.allows);
  const refuse = choices.find((choice) => !choice.allows);
  return [allow, refuse].filter((choice): choice is PermissionChoice => choice !== undefined);
}

function functionCount(n: number): string {
  return trN(`{n} ${n === 1 ? "function" : "functions"}`, { n: n.toLocaleString("en-US") });
}

export function noteFor(moment: Moment): Note {
  switch (moment.kind) {
    case "agentDone": {
      const answer = firstLine(moment.answer);
      return { tag: `done:${moment.chat.id}`, title: chatTitle(moment.chat, moment.agent), body: answer ? `${moment.agent}: ${answer}` : trN("{agent} finished.", { agent: moment.agent }), actions: [] };
    }
    case "agentNeedsYou": {
      const where = moment.chat.project ? ` in ${moment.chat.project}` : "";
      return {
        tag: askTag(moment.chat.id, moment.ask),
        title: trN("{agent} needs your OK", { agent: moment.agent }),
        body: `${askedFor(moment.tool, moment.input)}${where}`,
        actions: askButtons(moment.choices).map((choice) => ({ id: choice.id, label: choice.label })),
      };
    }
    case "agentStopped":
      return { tag: `stopped:${moment.chat.id}`, title: trN("{agent} stopped", { agent: moment.agent }), body: firstLine(moment.reason) || tr("Open the chat to see what happened."), actions: [] };
    case "opened":
      return { tag: `opened:${moment.project}`, title: trN("{name} is ready", { name: moment.name }), body: trN("{engine} finished reading {count}.", { engine: moment.engine, count: functionCount(moment.functions) }), actions: [] };
    case "openFailed":
      return { tag: `openFailed:${moment.name}`, title: trN("Couldn't open {name}", { name: moment.name }), body: firstLine(moment.advice), actions: [] };
    default: {
      const unhandled: never = moment;
      return unhandled;
    }
  }
}
