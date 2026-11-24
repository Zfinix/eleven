import type { PermissionTool } from "../settings/store";

const READ_ONLY_REA = [
  "open_binary", "close_binary", "binary_overview", "binary_session", "list_", "procedure_", "read_", "search_",
  "inspect_", "xrefs", "get_", "find_", "analyze_", "demangle_", "address_", "current_", "resolve_", "compare_",
  "build_call_path",
] as const;

/** Eleven's own name for REA, so it never collides with an agent's built-in `rea` server. */
export const REA_SERVER = "eleven-rea";

export function reaToolName(tool: string): string | null {
  const name = tool.replace(/^mcp__(eleven-rea|rea)__/, "").replace(/^(eleven-rea|rea)[_:.]+/, "");
  return name === tool ? null : name;
}

const READ_ONLY_ELEVEN = ["open_function", "current_view", "set_view", "list_marks", "debug_state"] as const;

function elevenToolName(tool: string): string | null {
  const name = tool.replace(/^mcp__eleven__/, "").replace(/^eleven[_:.]+/, "");
  return name === tool ? null : name;
}

const SUGGESTS_ELEVEN = ["propose_patch"] as const;

const EDITS_ELEVEN = ["rename_function", "add_note", "add_comment", "bookmark", "set_code_type", "set_number_format", "define_c_type", "add_to_notebook", "set_breakpoint"] as const;

/** Eleven tools that only file a suggestion for review, so asking first would make the user approve it twice. */
export function onlySuggests(tool: string, reviewAgentEdits: boolean): boolean {
  const eleven = elevenToolName(tool);
  if (eleven === null) return false;
  return SUGGESTS_ELEVEN.some((name) => name === eleven) || (reviewAgentEdits && EDITS_ELEVEN.some((name) => name === eleven));
}

const TOOL_KIND: Readonly<Record<string, PermissionTool>> = {
  open_function: "view", current_view: "view", set_view: "view", list_marks: "view", search_projects: "view", export_report: "view", second_opinion: "view", read_crash_report: "view",
  rename_function: "rename", add_note: "notes", add_comment: "notes", bookmark: "notes", set_code_type: "notes", set_number_format: "notes", define_c_type: "notes", add_to_notebook: "notes",
  propose_patch: "patch", gpu_profile: "gpu",
  debug_start: "debug", debug_state: "view", debug_control: "debug", debug_evaluate: "debug", debug_memory: "view", set_breakpoint: "debug",
};

/** Which row of the Permissions page governs a tool call. */
export function permissionTool(tool: string): PermissionTool {
  const eleven = elevenToolName(tool);
  if (eleven !== null) return TOOL_KIND[eleven] ?? "shell";
  return isReadOnly(tool) ? "read" : "shell";
}

/** REA tools that only read the target run without asking; anything that writes or runs code asks first. */
export function isReadOnly(tool: string): boolean {
  const eleven = elevenToolName(tool);
  if (eleven !== null) return READ_ONLY_ELEVEN.some((name) => name === eleven);
  const name = reaToolName(tool);
  return name !== null && READ_ONLY_REA.some((prefix) => name.startsWith(prefix));
}
