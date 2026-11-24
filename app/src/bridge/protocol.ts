import { join } from "node:path";
import { cacheRoot, OS } from "../lib/platform";

export const BRIDGE_ENV = "ELEVEN_BRIDGE";

export const AGENT_ENV = "ELEVEN_AGENT";

export const CHAT_ENV = "ELEVEN_CHAT";

export const ELEVEN_SERVER = "eleven";

export type BridgeTool = "open_function" | "current_view" | "set_view" | "rename_function" | "add_note" | "add_comment" | "bookmark" | "propose_patch" | "set_code_type" | "set_number_format" | "define_c_type" | "list_marks" | "search_projects" | "add_to_notebook" | "export_report" | "second_opinion" | "read_crash_report" | "gpu_profile" | "debug_start" | "debug_state" | "debug_control" | "debug_evaluate" | "debug_memory" | "set_breakpoint";

/** Which agent, in which chat, sent a request. */
export type BridgeCaller = { readonly agent: string; readonly chat: string | null };

export type BridgeRequest = { readonly id: number; readonly tool: BridgeTool; readonly args: Readonly<Record<string, string>>; readonly from: BridgeCaller };

export type BridgeReply = { readonly id: number; readonly ok: true; readonly text: string } | { readonly id: number; readonly ok: false; readonly error: string };

export function bridgePath(): string {
  return OS === "windows" ? `\\\\.\\pipe\\eleven-bridge-${process.pid}` : join(cacheRoot(), `bridge-${process.pid}.sock`);
}

const TOOLS: readonly BridgeTool[] = ["open_function", "current_view", "set_view", "rename_function", "add_note", "add_comment", "bookmark", "propose_patch", "set_code_type", "set_number_format", "define_c_type", "list_marks", "search_projects", "add_to_notebook", "export_report", "second_opinion", "read_crash_report", "gpu_profile", "debug_start", "debug_state", "debug_control", "debug_evaluate", "debug_memory", "set_breakpoint"];

export function isBridgeTool(value: unknown): value is BridgeTool {
  return TOOLS.some((tool) => tool === value);
}
