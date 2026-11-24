import { basename } from "node:path";

import { bundleExecutable } from "../gpu/live";
import { DEBUG_ACTIONS, debugControl, isDebugAction, startDebugging } from "../debug/live";
import { describeFindings, listRuns, readGpuRun } from "../gpu/trace";
import type { Chat } from "../chat/useChat";
import { loadProcedures, type Procedure } from "../engine/procedures";
import { DALVIK, jadxProcedures } from "../engine/jadx";
import { cTypeName } from "../engine/cTypes";
import { searchProjects } from "../engine/searchProjects";
import { parseCrash, placeFrames } from "../engine/crash";
import { rizinPseudocode } from "../engine/rizin";
import { rizinInstalled } from "../analysis/engines";
import { imageBase } from "../workbench/frida";
import { programSegments } from "../workbench/layout";
import { readFile } from "node:fs/promises";
import { writeReport } from "../workbench/export";
import { type Author, describeEdit, type EditField, isClaim, parseEvidence, setValue, unbacked } from "../engine/edits";
import { pending, propose } from "../engine/history";
import { listProjects, loadProject, type Project, projectId, updateProject } from "../engine/project";
import { loadSettings } from "../settings/store";
import { CODE_TYPES, describeType, isCodeType } from "../engine/codeTypes";
import { describeFormat, isOperandFormat, OPERAND_FORMATS } from "../engine/operands";
import { parseBytes } from "../workbench/patch";
import type { BridgeCaller, BridgeTool } from "./protocol";
import { currentView, switchView, type ViewName } from "./view";

const NO_SESSION = "There is no debug session. Start one with debug_start.";

const VIEWS: readonly ViewName[] = ["pseudocode", "assembly", "graph", "hex"];

function find(procedures: readonly Procedure[], project: Project, wanted: string): Procedure {
  const key = wanted.trim().toLowerCase();
  const hit = procedures.find((p) => p.address.toLowerCase() === key || p.name.toLowerCase() === key || project.names.get(p.address)?.toLowerCase() === key);
  if (!hit) throw new Error(`There is no function called ${wanted} in this file.`);
  return hit;
}

/** What a mark stands on, from the edit that set it: its evidence, or that an agent guessed. */
function basis(project: Project, field: EditField, key: string): string {
  const edit = [...project.edits].reverse().find((entry) => entry.status === "applied" && entry.field === field && entry.key === key);
  if (!edit) return "";
  if (unbacked(edit)) return ` [a guess by ${edit.by.kind === "agent" ? edit.by.agent : "an agent"}, no evidence]`;
  return edit.evidence ? ` [based on ${edit.evidence.join("; ")}]` : "";
}

function marks(project: Project, procedures: readonly Procedure[]): string {
  const nameOf = (addr: string): string => project.names.get(addr) ?? procedures.find((p) => p.address === addr)?.name ?? addr;
  const lines = [
    ...[...project.names].map(([addr, name]) => `renamed ${addr} to ${name}${basis(project, "names", addr)}`),
    ...project.bookmarks.map((b) => `bookmarked ${nameOf(b.addr)} (${b.addr})${basis(project, "bookmarks", b.addr)}`),
    ...[...project.notes].map(([addr, note]) => `note on ${nameOf(addr)}: ${note}${basis(project, "notes", addr)}`),
    ...[...project.comments].map(([addr, comment]) => `comment at ${addr}: ${comment}${basis(project, "comments", addr)}`),
    ...[...project.types].map(([addr, type]) => `marked ${addr} as ${describeType(type)}`),
    ...[...project.formats].map(([addr, format]) => `number at ${addr} shown as ${describeFormat(format)}`),
    ...pending(project).map((edit) => `waiting for the user's review: ${describeEdit(edit, nameOf, (addr) => procedures.find((p) => p.address === addr)?.name ?? addr)}`),
  ];
  const notebook = project.pages.get("notebook");
  const all = notebook ? [...lines, `notebook:\n${notebook}`] : lines;
  return all.length > 0 ? all.join("\n") : "Nothing renamed, bookmarked, noted or commented yet.";
}

function hexAddress(value: string | undefined): string {
  const address = (value ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(address)) throw new Error("Give a hexadecimal address, like 0x100003f2c.");
  return address;
}

const SEARCH_HITS = 25;

const UNBACKED = " You gave no evidence, so the user sees it marked as a guess. Next time pass the addresses you read in evidence.";

/** Applies an agent's edit under its name, or files it for review when the user asked to see every edit first. */
function agentEdit(id: string, by: Author, field: EditField, key: string, value: string | null, done: string, evidenceText = ""): string {
  const evidence = parseEvidence(evidenceText);
  const said = value !== null && isClaim(field) && evidence.length === 0 ? `${done}${UNBACKED}` : done;
  if (!loadSettings().reviewAgentEdits) {
    updateProject(id, (project) => setValue(project, field, key, value), by, evidence);
    return said;
  }
  propose(id, field, key, value, by, undefined, evidence);
  return `Suggested to the user, who reviews it in Changes before it is saved: ${said}`;
}

/** Answers the `eleven` MCP tools against the live window and the open file's project. */
export function bridgeHandler(chat: () => Chat): (tool: BridgeTool, args: Readonly<Record<string, string>>, from: BridgeCaller) => Promise<string> {
  return async (tool, args, from) => {
    const by: Author = { kind: "agent", agent: from.agent, chat: from.chat };
    const target = chat().target;
    if (!target) throw new Error("No file is open in Eleven. Ask the user to open one.");
    const id = projectId(target);
    const procedures = target.arch === DALVIK ? await jadxProcedures(target.path, id) : await loadProcedures(target.path, id);
    switch (tool) {
      case "open_function": {
        const fn = find(procedures, loadProject(id), args.function ?? "");
        chat().thread.openFunction(fn.name);
        return `Showing ${fn.name} (${fn.address}) to the user.`;
      }
      case "current_view": {
        const view = currentView();
        return JSON.stringify({ file: target.original, function: view.fn, address: view.address, view: view.view });
      }
      case "set_view": {
        const view = VIEWS.find((v) => v === args.view);
        if (!view) throw new Error("Pick pseudocode, assembly, graph or hex.");
        return switchView(view) ? `Switched to ${view}.` : "The workbench isn't open, so the user is reading pseudocode on the canvas.";
      }
      case "rename_function": {
        const fn = find(procedures, loadProject(id), args.function ?? "");
        const name = (args.new_name ?? "").trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("Use a C identifier, like check_license_key.");
        return agentEdit(id, by, "names", fn.address, name, `Renamed ${fn.name} to ${name} in the user's project.`, args.evidence);
      }
      case "add_note": {
        const fn = find(procedures, loadProject(id), args.function ?? "");
        const note = (args.note ?? "").trim();
        return agentEdit(id, by, "notes", fn.address, note || null, note ? `Saved a note on ${fn.name}.` : `Removed the note on ${fn.name}.`, args.evidence);
      }
      case "add_comment": {
        const address = hexAddress(args.address);
        const comment = (args.comment ?? "").trim();
        return agentEdit(id, by, "comments", address, comment || null, comment ? `Commented ${address}.` : `Removed the comment at ${address}.`, args.evidence);
      }
      case "bookmark": {
        const wanted = (args.address ?? "").trim();
        const address = /^0x[0-9a-f]+$/i.test(wanted) ? wanted.toLowerCase() : find(procedures, loadProject(id), wanted).address;
        const label = (args.label ?? "").trim() || address;
        return agentEdit(id, by, "bookmarks", address, label, `Bookmarked ${label} (${address}).`, args.evidence);
      }
      case "set_code_type": {
        const address = hexAddress(args.address);
        const type = (args.type ?? "").trim().toLowerCase();
        if (type && !isCodeType(type)) throw new Error(`Pick one of ${CODE_TYPES.join(", ")}, or leave it empty.`);
        return agentEdit(id, by, "types", address, type || null, type ? `Marked ${address} as ${describeType(type)}.` : `Put ${address} back to code.`);
      }
      case "define_c_type": {
        const declaration = (args.declaration ?? "").trim();
        const name = cTypeName(declaration);
        if (!name) throw new Error("Give one named struct, union, enum or typedef, like struct header { int magic; };");
        const saved = agentEdit(id, by, "ctypes", name, declaration, `Saved the C type ${name}.`, args.evidence);
        if (!(args.address ?? "").trim()) return saved;
        const address = hexAddress(args.address);
        return `${saved} ${agentEdit(id, by, "ctypeAt", address, name, `Reading ${address} as ${name}.`, args.evidence)}`;
      }
      case "set_number_format": {
        const address = hexAddress(args.address);
        const format = (args.format ?? "").trim().toLowerCase();
        if (format && !isOperandFormat(format)) throw new Error(`Pick one of ${OPERAND_FORMATS.join(", ")}, or leave it empty.`);
        return agentEdit(id, by, "formats", address, format || null, format ? `Showing the number at ${address} as ${describeFormat(format)}.` : `Showing the number at ${address} as Ghidra prints it.`);
      }
      case "propose_patch": {
        const address = hexAddress(args.address);
        const bytes = parseBytes(args.bytes ?? "").map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
        propose(id, "patches", address, bytes, by, (args.reason ?? "").trim() || undefined);
        return `Suggested patching ${address} to ${bytes}. The user reviews it in Changes; nothing is saved until they accept, and the binary itself is never changed.`;
      }
      case "list_marks":
        return marks(loadProject(id), procedures);
      case "add_to_notebook": {
        const text = (args.text ?? "").trim();
        if (!text) throw new Error("Give the paragraph to add.");
        const page = loadProject(id).pages.get("notebook");
        return agentEdit(id, by, "pages", "notebook", page ? `${page.trimEnd()}\n\n${text}` : text, "Added it to the notebook.", args.evidence);
      }
      case "second_opinion": {
        const fn = find(procedures, loadProject(id), args.function ?? "");
        if (!rizinInstalled()) throw new Error("Rizin isn't installed, so there's no second decompiler. Read the assembly with procedure_assembly instead.");
        return `Rizin's reading of ${fn.name} (${fn.address}):\n${await rizinPseudocode(target.path, fn.address)}`;
      }
      case "read_crash_report": {
        const file = (args.path ?? "").trim();
        if (!file) throw new Error("Give the crash report's path, like ~/Library/Logs/DiagnosticReports/App-2026-11-18.ips.");
        const crash = parseCrash(await readFile(file, "utf8"));
        const image = basename(target.kind === "app" ? (bundleExecutable(target.original) ?? target.original) : target.original);
        const names = new Map(procedures.map((procedure) => [procedure.address, loadProject(id).names.get(procedure.address) ?? procedure.name]));
        const frames = placeFrames(crash.thread, image, imageBase(await programSegments(target.path, id)), procedures.map((procedure) => procedure.address));
        const lines = frames.map((frame, ix) => `${ix}  ${frame.fn ? `${names.get(frame.fn) ?? frame.fn} (${frame.addr})` : `${frame.symbol ?? "?"} in ${frame.image}`}`);
        return `${crash.app} crashed with ${crash.exception}. Crashed thread, top first:\n${lines.join("\n")}`;
      }
      case "search_projects": {
        const query = (args.query ?? "").trim();
        if (query.length < 3) throw new Error("Search with at least three characters.");
        const hits = searchProjects(query, listProjects(), loadProject, id, SEARCH_HITS);
        if (hits.length === 0) return `Nothing in the user's other projects mentions ${query}.`;
        return hits.map((hit) => `${hit.project.name} (${hit.project.original}): ${hit.kind} at ${hit.addr}: ${hit.text}`).join("\n");
      }
      case "export_report": {
        const original = new Map(procedures.map((procedure) => [procedure.address, procedure.name]));
        return `Wrote the report to ${await writeReport(target.name, id, (addr) => original.get(addr) ?? addr)}.`;
      }
      case "gpu_profile": {
        const exe = target.kind === "app" ? bundleExecutable(target.original) : null;
        const trace = exe ? listRuns(basename(exe))[0] : undefined;
        if (!trace) return "There's no GPU recording of this app yet. Ask the user to press Record a GPU run in the workbench sidebar.";
        return describeFindings((await readGpuRun(trace, "")).findings);
      }
      case "debug_start": {
        const wanted = (args.pid ?? "").trim();
        const pid = wanted ? Number(wanted) : null;
        if (pid !== null && !(Number.isInteger(pid) && pid > 0)) throw new Error("Give a process id, like 48213, or leave it empty to launch the open file.");
        return startDebugging(pid);
      }
      case "debug_state":
        return (await debugControl()?.describe()) ?? NO_SESSION;
      case "debug_control": {
        const action = (args.action ?? "").trim();
        if (!isDebugAction(action)) throw new Error(`Pick one of ${DEBUG_ACTIONS.join(", ")}.`);
        const control = debugControl();
        if (!control) throw new Error(NO_SESSION);
        return control.act(action);
      }
      case "debug_memory": {
        const control = debugControl();
        if (!control) throw new Error(NO_SESSION);
        const where = (args.where ?? "").trim();
        if (!where) throw new Error("Give an address or expression, like 0x16fdff000, $sp or &buffer.");
        return control.memory(where);
      }
      case "debug_evaluate": {
        const control = debugControl();
        if (!control) throw new Error(NO_SESSION);
        const expression = (args.expression ?? "").trim();
        if (!expression) throw new Error("Give an expression, like x0 or *(int *)$sp.");
        return control.evaluate(expression);
      }
      case "set_breakpoint": {
        const address = hexAddress(args.address);
        const on = args.on !== "false";
        const condition = (args.condition ?? "").trim();
        const done = !on ? `Removed the breakpoint at ${address}.` : condition ? `Added a breakpoint at ${address} that stops only when ${condition}.` : `Added a breakpoint at ${address}.`;
        return agentEdit(id, by, "breakpoints", address, on ? condition || "on" : null, done);
      }
      default: {
        const unhandled: never = tool;
        return unhandled;
      }
    }
  };
}
