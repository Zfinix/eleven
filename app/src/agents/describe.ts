import { stringField } from "../lib/guards";
import { reaToolName } from "./permissions";

const LABELS: Readonly<Record<string, readonly [label: string, arg?: string]>> = {
  procedure_pseudo_code: ["Read pseudocode", "procedure"],
  procedure_assembly: ["Read assembly", "procedure"],
  procedure_callers: ["Found who calls", "procedure"],
  procedure_callees: ["Found what it calls", "procedure"],
  procedure_info: ["Read function details", "procedure"],
  analyze_function: ["Studied a function", "procedure"],
  open_binary: ["Opened the file", "path"],
  binary_overview: ["Read the overview"],
  binary_session: ["Checked the session"],
  list_procedures: ["Listed functions"],
  list_strings: ["Listed strings"],
  list_segments: ["Listed segments"],
  search_strings: ["Searched strings", "pattern"],
  search_procedures: ["Searched functions", "pattern"],
  find_code_for_string: ["Found code using a string", "string"],
  xrefs: ["Found references", "address"],
  ToolSearch: ["Looked up its tools"],
};

/** The same tools while they run, for a live status line: "Reading assembly" rather than "Read assembly". */
const DOING: Readonly<Record<string, string>> = {
  procedure_pseudo_code: "Reading pseudocode",
  procedure_assembly: "Reading assembly",
  procedure_callers: "Finding who calls",
  procedure_callees: "Finding what it calls",
  procedure_info: "Reading function details",
  analyze_function: "Studying a function",
  open_binary: "Opening the file",
  binary_overview: "Reading the overview",
  binary_session: "Checking the session",
  list_procedures: "Listing functions",
  list_strings: "Listing strings",
  list_segments: "Listing segments",
  search_strings: "Searching strings",
  search_procedures: "Searching functions",
  find_code_for_string: "Finding code using a string",
  xrefs: "Finding references",
  ToolSearch: "Looking up its tools",
};

export type ToolLabel = { readonly label: string; readonly detail: string | null };
const LABEL_CHARS = 240;

function firstLine(text: string): string {
  return text.slice(0, LABEL_CHARS).trim().split("\n", 1)[0] ?? "";
}

/** Tool ids read as words; anything else, like a whole shell command an agent sent as the title, stays as written. */
function humanize(name: string): string {
  name = firstLine(name);
  if (!/^[\w.-]+$/.test(name)) return name;
  const label = name.replace(/^mcp__[^_]+__/, "").replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function shortPath(value: string): string {
  const tail = value.slice(-LABEL_CHARS);
  return tail.includes("/") ? (tail.split("/").pop() ?? tail) : tail;
}

/** Splits a raw tool call into the bold label and the grey detail people read. */
export function toolLabel(tool: string, input: unknown): ToolLabel {
  const command = stringField(input, "command");
  if (command !== undefined) {
    const description = firstLine(stringField(input, "description") ?? "");
    return description
      ? { label: description, detail: null }
      : { label: "Run a command", detail: firstLine(command) || null };
  }
  const title = tool.slice(0, LABEL_CHARS);
  const name = reaToolName(title) ?? title;
  const known = LABELS[name];
  if (!known) return { label: humanize(name), detail: null };
  const [label, key] = known;
  const value = key ? stringField(input, key) : undefined;
  return { label, detail: value ? shortPath(value) : null };
}

export function describe(tool: string, input: unknown): string {
  const { label, detail } = toolLabel(tool, input);
  return detail ? `${label} · ${detail}` : label;
}

/** What a running tool is doing right now, like "Reading assembly · FUN_100002404". */
export function doing(tool: string, input: unknown): string {
  const { label, detail } = toolLabel(tool, input);
  const title = tool.slice(0, LABEL_CHARS);
  const now = DOING[reaToolName(title) ?? title] ?? label;
  return detail ? `${now} · ${detail}` : now;
}
