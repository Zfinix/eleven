import type * as acp from "@agentclientprotocol/sdk";

import { isRecord, stringField } from "../lib/guards";
import { codexGoalEvent } from "./codex";
import type { AgentEvent, OptionCategory, OptionChoice, PlanItem, SessionOption, StepStatus } from "./events";

const MAX_OUTPUT = 4000;

export function stepStatus(status: acp.ToolCallStatus | null | undefined): StepStatus {
  if (status === "completed") return "done";
  if (status === "failed") return "failed";
  return "running";
}

function contentText(content: readonly acp.ToolCallContent[] | null | undefined): string | null {
  if (!content) return null;
  const text = content.flatMap((item) => (item.type === "content" && item.content.type === "text" ? [item.content.text] : [])).join("\n");
  return text ? text.slice(0, MAX_OUTPUT) : null;
}

function rawOutputText(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const text = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
  return text.slice(0, MAX_OUTPUT);
}

function category(value: string | null | undefined): OptionCategory {
  return value === "model" || value === "mode" || value === "thought_level" ? value : "other";
}

function choices(options: acp.SessionConfigSelectOptions): readonly OptionChoice[] {
  const flat = options.flatMap((entry): acp.SessionConfigSelectOption[] => ("group" in entry ? entry.options : [entry]));
  return flat.map((option) => ({ value: option.value, name: option.name, description: option.description ?? null }));
}

export function configOptions(options: readonly acp.SessionConfigOption[] | null | undefined): readonly SessionOption[] {
  return (options ?? []).flatMap((option): SessionOption[] =>
    option.type === "select"
      ? [{ id: option.id, name: option.name, category: category(option.category), current: option.currentValue, choices: choices(option.options), legacyMode: false }]
      : [],
  );
}

export function legacyModes(modes: acp.SessionModeState | null | undefined): readonly SessionOption[] {
  if (!modes) return [];
  const list = modes.availableModes.map((mode) => ({ value: mode.id, name: mode.name, description: mode.description ?? null }));
  return [{ id: "mode", name: "Mode", category: "mode", current: modes.currentModeId, choices: list, legacyMode: true }];
}

/** Config options win; session modes only fill in when an agent has no mode option. */
export function mergeOptions(config: readonly SessionOption[], modes: readonly SessionOption[]): readonly SessionOption[] {
  return config.some((option) => option.category === "mode") ? config : [...config, ...modes];
}

function plan(entries: readonly acp.PlanEntry[]): readonly PlanItem[] {
  return entries.map((entry) => ({ content: entry.content, status: entry.status }));
}

function costText(cost: unknown): string | null {
  if (!isRecord(cost)) return null;
  const amount = cost.amount;
  return typeof amount === "number" ? `$${amount.toFixed(2)}` : stringField(cost, "amount") ?? null;
}

/** Maps one ACP session update to Eleven's event, or null when Eleven doesn't show it. */
export function translate(update: acp.SessionNotification["update"], currentModes: readonly SessionOption[]): AgentEvent | null {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return update.content.type === "text" ? { kind: "text", text: update.content.text } : null;
    case "agent_thought_chunk":
      return update.content.type === "text" ? { kind: "thought", text: update.content.text } : null;
    case "tool_call":
      return { kind: "step", id: update.toolCallId, tool: update.title, status: stepStatus(update.status), input: update.rawInput, output: contentText(update.content) };
    case "tool_call_update":
      return { kind: "step", id: update.toolCallId, tool: update.title ?? "", status: stepStatus(update.status), input: update.rawInput, output: contentText(update.content) ?? rawOutputText(update.rawOutput) };
    case "plan":
      return { kind: "plan", items: plan(update.entries) };
    case "available_commands_update":
      return { kind: "commands", commands: update.availableCommands.map((c) => ({ name: c.name, description: c.description, hint: c.input?.hint ?? null })) };
    case "config_option_update":
      return { kind: "options", options: mergeOptions(configOptions(update.configOptions), currentModes) };
    case "current_mode_update":
      return { kind: "options", options: currentModes.map((option) => (option.legacyMode ? { ...option, current: update.currentModeId } : option)) };
    case "usage_update":
      return { kind: "usage", usage: { used: update.used, size: update.size, cost: costText(update.cost) } };
    case "session_info_update":
      return codexGoalEvent(update._meta);
    case "notice":
      return { kind: "notice", text: update.description ? `${update.title}. ${update.description}` : update.title };
    default:
      return null;
  }
}
