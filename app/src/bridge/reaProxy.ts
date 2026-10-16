import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, type CallToolResult, CallToolResultSchema, ListToolsRequestSchema, type ListToolsResult } from "@modelcontextprotocol/sdk/types.js";

import { reaCallOptions, reaEnv, reaLaunch } from "../engine/rea";
import { hidePaths } from "./privacy";

/** REA tools that would write names, comments and bookmarks behind Eleven's back, and the `eleven` tool to use instead. */
export const ELEVEN_OWNED: ReadonlyMap<string, string> = new Map([
  ["set_address_name", "rename_function"],
  ["set_addresses_names", "rename_function"],
  ["set_comment", "add_comment"],
  ["set_inline_comment", "add_comment"],
  ["set_bookmark", "bookmark"],
  ["unset_bookmark", "bookmark"],
  ["set_code_type", "set_code_type"],
]);

function refusal(tool: string, instead: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: `${tool} isn't available here. Eleven keeps names, comments and bookmarks in the user's project, where they can see and undo them. Use the eleven server's ${instead} tool instead.` }] };
}

function env(): Record<string, string> {
  return { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ...reaEnv() };
}

/** REA for agents: every tool passes through except the ones whose changes belong in Eleven's project. */
export async function runReaProxy(): Promise<void> {
  const { command, args } = reaLaunch();
  const rea = new Client({ name: "eleven", version: "0.1.0" });
  await rea.connect(new StdioClientTransport({ command, args: [...args], env: env(), stderr: "inherit" }));
  const instructions = rea.getInstructions();
  const server = new Server(
    { name: "rea", version: rea.getServerVersion()?.version ?? "0" },
    { capabilities: { tools: {} }, ...(instructions ? { instructions } : {}) },
  );
  server.setRequestHandler(ListToolsRequestSchema, async (request): Promise<ListToolsResult> => {
    const listed = await rea.listTools(request.params);
    return { ...listed, tools: listed.tools.filter((tool) => !ELEVEN_OWNED.has(tool.name)) };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
    const instead = ELEVEN_OWNED.get(request.params.name);
    if (instead) return refusal(request.params.name, instead);
    const token = request.params._meta?.progressToken;
    const result = await rea.callTool(request.params, undefined, {
      signal: extra.signal,
      ...reaCallOptions(),
      onprogress: (progress) => {
        if (token !== undefined) void extra.sendNotification({ method: "notifications/progress", params: { ...progress, progressToken: token } });
      },
    });
    const parsed = CallToolResultSchema.safeParse(JSON.parse(hidePaths(JSON.stringify(result))));
    return parsed.success ? parsed.data : { content: [{ type: "text", text: hidePaths(JSON.stringify(result)) }] };
  });
  const shutdown = async (): Promise<void> => {
    try {
      await rea.close();
    } finally {
      process.exit(0);
    }
  };
  process.stdin.once("end", () => void shutdown());
  process.stdin.once("close", () => void shutdown());
  await server.connect(new StdioServerTransport());
}
