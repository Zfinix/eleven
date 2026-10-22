import { type PlainId, t } from "../i18n";
import { stringField } from "../lib/guards";
import { reaToolName } from "./permissions";

const LABELS: Readonly<Record<string, readonly [label: PlainId, doing: PlainId, arg?: string]>> = {
  procedure_pseudo_code: ["tool.pseudocode", "tool.doing.pseudocode", "procedure"],
  procedure_assembly: ["tool.assembly", "tool.doing.assembly", "procedure"],
  procedure_callers: ["tool.callers", "tool.doing.callers", "procedure"],
  procedure_callees: ["tool.callees", "tool.doing.callees", "procedure"],
  procedure_info: ["tool.info", "tool.doing.info", "procedure"],
  analyze_function: ["tool.analyze", "tool.doing.analyze", "procedure"],
  open_binary: ["tool.open", "tool.doing.open", "path"],
  binary_overview: ["tool.overview", "tool.doing.overview"],
  binary_session: ["tool.session", "tool.doing.session"],
  list_procedures: ["tool.listFunctions", "tool.doing.listFunctions"],
  list_strings: ["tool.listStrings", "tool.doing.listStrings"],
  list_segments: ["tool.listSegments", "tool.doing.listSegments"],
  search_strings: ["tool.searchStrings", "tool.doing.searchStrings", "pattern"],
  search_procedures: ["tool.searchFunctions", "tool.doing.searchFunctions", "pattern"],
  find_code_for_string: ["tool.codeForString", "tool.doing.codeForString", "string"],
  xrefs: ["tool.xrefs", "tool.doing.xrefs", "address"],
  ToolSearch: ["tool.toolSearch", "tool.doing.toolSearch"],
};

/** `command` is the shell line a call ran, kept apart from `detail` so it can be drawn in the code font. */
export type ToolLabel = { readonly label: string; readonly detail: string | null; readonly command: string | null };

/** True for a tool id like procedure_pseudo_code or mcp__eleven__set_view, false for a shell line sent as the title. */
export function isToolId(name: string): boolean {
  return /^[\w.-]+$/.test(name);
}

function humanize(name: string): string {
  const label = name.replace(/^mcp__[^_]+__/, "").replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? text;
}

function shortPath(value: string): string {
  return value.includes("/") ? (value.split("/").pop() ?? value) : value;
}

/** The shell line a call ran, and the agent's own words for it when it gave any. */
function shellCall(tool: string, input: unknown, summary: string | null): { readonly command: string; readonly said: string | null } | null {
  const command = stringField(input, "command") ?? (isToolId(tool.trim()) ? undefined : tool);
  if (command === undefined) return null;
  return { command: firstLine(command), said: stringField(input, "description")?.trim() || summary || null };
}

/**
 * Splits a raw tool call into the bold label and the grey detail people read.
 * Some agents send a shell command as the title with an empty input, so the title counts as the command too.
 */
export function toolLabel(tool: string, input: unknown, summary: string | null = null): ToolLabel {
  const shell = shellCall(tool, input, summary);
  if (shell) return { label: shell.said ?? t("tool.runCommand"), detail: null, command: shell.command };
  const name = reaToolName(tool) ?? tool;
  const known = LABELS[name];
  if (!known) return { label: humanize(name), detail: null, command: null };
  const [label, , key] = known;
  const value = key ? stringField(input, key) : undefined;
  return { label: t(label), detail: value ? shortPath(value) : null, command: null };
}

/** A shell call the agent gave no words for, so its command line is the only detail there is. */
function unnamedCommand(tool: string, input: unknown): string | null {
  const shell = shellCall(tool, input, null);
  return shell && shell.said === null ? shell.command : null;
}

export function describe(tool: string, input: unknown): string {
  const { label, detail } = toolLabel(tool, input);
  const rest = detail ?? unnamedCommand(tool, input);
  return rest ? `${label} · ${rest}` : label;
}

/** What a running tool is doing right now, like "Reading assembly · FUN_100002404". */
export function doing(tool: string, input: unknown): string {
  const { label, detail } = toolLabel(tool, input);
  const bare = unnamedCommand(tool, input);
  const known = LABELS[reaToolName(tool) ?? tool];
  const now = known ? t(known[1]) : bare !== null ? t("tool.runningCommand") : label;
  const rest = detail ?? bare;
  return rest ? `${now} · ${rest}` : now;
}
