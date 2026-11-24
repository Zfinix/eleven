import { connect } from "node:net";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { isRecord } from "../lib/guards";
import { hidePaths } from "./privacy";
import { AGENT_ENV, BRIDGE_ENV, type BridgeCaller, type BridgeTool, CHAT_ENV } from "./protocol";

let nextId = 1;

const caller: BridgeCaller = { agent: process.env[AGENT_ENV] || "Agent", chat: process.env[CHAT_ENV] || null };

function ask(tool: BridgeTool, args: Readonly<Record<string, string>>): Promise<string> {
  const path = process.env[BRIDGE_ENV];
  if (!path) return Promise.reject(new Error("Eleven isn't running, so there is no view to drive."));
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    let buffer = "";
    socket.on("error", (err) => reject(new Error(`Eleven didn't answer: ${err.message}`)));
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const line = buffer.split("\n")[0];
      if (line === undefined || !buffer.includes("\n")) return;
      socket.end();
      const reply: unknown = JSON.parse(line);
      if (isRecord(reply) && reply.ok === true && typeof reply.text === "string") resolve(reply.text);
      else reject(new Error(isRecord(reply) && typeof reply.error === "string" ? reply.error : "Eleven couldn't do that."));
    });
    socket.write(`${JSON.stringify({ id: nextId++, tool, args, from: caller })}\n`);
  });
}

async function run(tool: BridgeTool, args: Readonly<Record<string, string>>): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    return { content: [{ type: "text", text: hidePaths(await ask(tool, args)) }] };
  } catch (err) {
    return { content: [{ type: "text", text: hidePaths(err instanceof Error ? err.message : String(err)) }], isError: true };
  }
}

const EVIDENCE = z.string().optional().describe('What in the binary this is based on: the addresses you read and what was there, comma separated, like 0x100004906 string "COLUMNS", 0x1000016d8 calls getenv. Leave it out only when you are guessing.');

/** Eleven's own MCP server: lets any agent see and move the user's view, and annotate the project. */
export async function runMcp(): Promise<void> {
  const server = new McpServer({ name: "eleven", version: "0.1.0" });
  server.registerTool("open_function", {
    description: "Show a function in the user's Eleven window (code canvas and workbench). Use it whenever you start discussing a function, so the user sees what you see.",
    inputSchema: { function: z.string().describe("Function name like entry or FUN_100001234, or its address like 0x100001234") },
  }, ({ function: fn }) => run("open_function", { function: fn }));
  server.registerTool("current_view", {
    description: "What the user is looking at right now in Eleven: the file, function, address and view.",
  }, () => run("current_view", {}));
  server.registerTool("set_view", {
    description: "Switch the user's code view to pseudocode, assembly, graph or hex.",
    inputSchema: { view: z.enum(["pseudocode", "assembly", "graph", "hex"]) },
  }, ({ view }) => run("set_view", { view }));
  server.registerTool("rename_function", {
    description: "Give a function a meaningful name in the user's Eleven project (never changes the binary). Use it once you understand what a FUN_ function does. Pass the evidence you read; a name with none is shown to the user as a guess.",
    inputSchema: { function: z.string(), new_name: z.string().describe("A C identifier, like check_license_key"), evidence: EVIDENCE },
  }, (args) => run("rename_function", { function: args.function, new_name: args.new_name, evidence: args.evidence ?? "" }));
  server.registerTool("add_note", {
    description: "Save a short note on a function in the user's Eleven project, shown beside the code. Pass the evidence you read; a note with none is shown to the user as a guess.",
    inputSchema: { function: z.string(), note: z.string(), evidence: EVIDENCE },
  }, (args) => run("add_note", { function: args.function, note: args.note, evidence: args.evidence ?? "" }));
  server.registerTool("add_comment", {
    description: "Comment one instruction or address in the user's Eleven project; it shows at the end of that line in assembly and the graph. An empty comment removes it.",
    inputSchema: { address: z.string().describe("Hexadecimal, like 0x100003f2c"), comment: z.string(), evidence: EVIDENCE },
  }, (args) => run("add_comment", { address: args.address, comment: args.comment, evidence: args.evidence ?? "" }));
  server.registerTool("bookmark", {
    description: "Bookmark a function or address in the user's Eleven sidebar, with a short label.",
    inputSchema: { address: z.string().describe("A function name or hexadecimal address"), label: z.string(), evidence: EVIDENCE },
  }, (args) => run("bookmark", { address: args.address, label: args.label, evidence: args.evidence ?? "" }));
  server.registerTool("propose_patch", {
    description: "Suggest new bytes at an address. The user reviews it before it is saved; the binary itself is never changed, only a patched copy is written.",
    inputSchema: { address: z.string().describe("Hexadecimal, like 0x100003f2c"), bytes: z.string().describe("Hex bytes, like 1f2003d5 or 90 90"), reason: z.string().describe("One sentence on what the patch does, shown to the user") },
  }, (args) => run("propose_patch", { address: args.address, bytes: args.bytes, reason: args.reason }));
  server.registerTool("set_code_type", {
    description: "Mark what the bytes at an address are in the user's Eleven project, like Hopper's Modify menu: code, procedure (start a function), byte, word, dword, qword, cstring or undefined. Leave type empty to read them as code again. Ghidra re-reads the code and the user can undo it.",
    inputSchema: { address: z.string().describe("Hexadecimal, like 0x100003f2c"), type: z.string().describe("code, procedure, byte, word, dword, qword, cstring, undefined, or empty") },
  }, (args) => run("set_code_type", { address: args.address, type: args.type }));
  server.registerTool("set_number_format", {
    description: "Choose how the number in the instruction at an address reads in the user's assembly: hex, decimal, char, offset or address. Leave format empty to show it as Ghidra prints it.",
    inputSchema: { address: z.string().describe("Hexadecimal, like 0x100003f2c"), format: z.string().describe("hex, decimal, char, offset, address, or empty") },
  }, (args) => run("set_number_format", { address: args.address, format: args.format }));
  server.registerTool("define_c_type", {
    description: "Write a C type (struct, union, enum or typedef) into the user's Eleven project, and optionally read the bytes at an address as it. Ghidra uses it in pseudocode and the listing, it is kept with the project, and the user can undo it. Saving the same name again replaces the type.",
    inputSchema: { declaration: z.string().describe("One C declaration, like struct header { uint32_t magic; uint16_t version; };"), address: z.string().optional().describe("Hexadecimal address to read as this type, like 0x100008000"), evidence: EVIDENCE },
  }, (args) => run("define_c_type", { declaration: args.declaration, address: args.address ?? "", evidence: args.evidence ?? "" }));
  server.registerTool("list_marks", {
    description: "The user's renames, bookmarks, notes and line comments for the open file, plus your suggestions still waiting for review.",
  }, () => run("list_marks", {}));
  server.registerTool("add_to_notebook", {
    description: "Add a paragraph of findings to the project's notebook in Eleven, a page the user keeps for this binary. Write addresses as 0x… so they link to the code. Use it for conclusions that span several functions.",
    inputSchema: { text: z.string(), evidence: EVIDENCE },
  }, (args) => run("add_to_notebook", { text: args.text, evidence: args.evidence ?? "" }));
  server.registerTool("export_report", {
    description: "Write a Markdown report of everything found in this project (names with their evidence, notes, the notebook, comments, bookmarks, patches, C types) to the user's exports folder, and return its path.",
  }, () => run("export_report", {}));
  server.registerTool("second_opinion", {
    description: "Decompile a function with a second decompiler (Rizin's), to compare with Ghidra's pseudocode where a reading is unclear: types, loops, calls. Where the two disagree, check the assembly.",
    inputSchema: { function: z.string().describe("Function name like FUN_100001234, or its address") },
  }, ({ function: fn }) => run("second_opinion", { function: fn }));
  server.registerTool("read_crash_report", {
    description: "Read a macOS crash report (.ips) for the open app: the exception, and the crashed thread's frames, each frame in this binary placed in its function by name and address.",
    inputSchema: { path: z.string().describe("Absolute path to the .ips file") },
  }, ({ path }) => run("read_crash_report", { path }));
  server.registerTool("search_projects", {
    description: "Search the user's other Eleven projects for names, notes, comments and bookmarks containing some text, to reuse what they already worked out in another binary. Returns where each match is.",
    inputSchema: { query: z.string().describe("At least three characters, like license or parse_config") },
  }, ({ query }) => run("search_projects", { query }));
  server.registerTool("gpu_profile", {
    description: "The newest GPU recording of the open app (Metal System Trace): frame time, how busy the GPU is, gaps between frames, and what the numbers suggest fixing.",
  }, () => run("gpu_profile", {}));
  server.registerTool("debug_start", {
    description: "Run the open file under the debugger in the user's Eleven window, or attach to a running process by pid. It stops at the user's breakpoints (add your own with set_breakpoint first). Returns where it first stops, or that it is still running. This runs the program on the user's machine.",
    inputSchema: { pid: z.string().describe("A process id to attach to, or empty to launch the open file") },
  }, ({ pid }) => run("debug_start", { pid }));
  server.registerTool("debug_state", {
    description: "The user's debug session in Eleven: whether the program is running or paused, where it is paused, the call stack, locals, registers and the newest program output.",
  }, () => run("debug_state", {}));
  server.registerTool("debug_control", {
    description: "Continue, pause or step the program in the user's debug session, then report where it is. Start a session with debug_start first.",
    inputSchema: { action: z.enum(["continue", "pause", "step_over", "step_into", "step_out", "step_instruction"]) },
  }, ({ action }) => run("debug_control", { action }));
  server.registerTool("debug_evaluate", {
    description: "Evaluate an lldb expression in the paused frame of the user's debug session, like x0, answer + 1 or *(int *)$sp. The user sees it in the Output tab.",
    inputSchema: { expression: z.string() },
  }, ({ expression }) => run("debug_evaluate", { expression }));
  server.registerTool("debug_memory", {
    description: "Read 256 bytes of the paused program's memory in the user's debug session, as hex and text rows. Give an address or an lldb expression for one, like $sp, &buffer or x1.",
    inputSchema: { where: z.string() },
  }, ({ where }) => run("debug_memory", { where }));
  server.registerTool("set_breakpoint", {
    description: "Add or remove a breakpoint at an instruction address in the user's Eleven project. It applies right away to a running session and the user can undo it.",
    inputSchema: { address: z.string().describe("Hexadecimal, like 0x100003f2c"), on: z.boolean().describe("false removes it"), condition: z.string().optional().describe("An lldb expression it stops only when true, like $x0 == 7; leave it out to stop every time") },
  }, (args) => run("set_breakpoint", { address: args.address, on: String(args.on), condition: args.condition ?? "" }));
  await server.connect(new StdioServerTransport());
}
