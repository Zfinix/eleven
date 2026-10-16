
import { forgetCode, rea, type Opened } from "../engine/rea";
import { type CodeType, isCodeType } from "../engine/codeTypes";
import { bundleOf, type Target } from "../engine/target";
import { type ApkFiles } from "../engine/apk";
import { bundleFiles } from "../engine/apple";
import { loadDossier } from "../engine/dossier";
import { loadProject, projectId } from "../engine/project";
import { codeUsingString, hexRows, programSegments, programStrings } from "./layout";
import type { Fn, Program, TableRow } from "./model";
import { forgetProcedures, loadProcedures, type Procedure } from "../engine/procedures";
import { activeBackend, rizinInstalled } from "../analysis/engines";
import { isAndroidCode, openJadx } from "../engine/jadx";
import { rizinBytes, rizinClose, rizinDisassembly, rizinFunctions, rizinHasDecompiler, rizinLightOn, rizinPseudocode, rizinRefs, rizinReplayOn, rizinRetype, rizinSegments, rizinStrings } from "../engine/rizin";

const RIZIN_HEX_BYTES = 256;
const CODE_USING_LIMIT = 12;

const LOG_WIDTH = 37;

/** The types saved in a project, in the order they were set, to mark again when the engine reopens the file. */
function savedTypes(id: string): () => readonly (readonly [string, CodeType])[] {
  return () => [...loadProject(id).types].flatMap(([addr, type]) => (isCodeType(type) ? [[addr, type] as const] : []));
}

function logLine(op: string, ms: number, note = ""): string {
  return `${op.padEnd(LOG_WIDTH)}${String(ms).padStart(5)} ms${note ? `  ${note}` : ""}`;
}

async function timed<T>(log: string[], op: string, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const value = await work();
  log.push(logLine(op, Date.now() - started));
  return value;
}

async function appFiles(target: Target): Promise<ApkFiles | undefined> {
  const app = bundleOf(target);
  return app ? bundleFiles(app) : undefined;
}

function importRow(procedure: Procedure): TableRow {
  const [library = "", symbol = procedure.name] = procedure.name.split("::");
  const file = library.split("/").at(-1) ?? library;
  return { a: file.replace(/\..*$/, ""), b: symbol };
}

const PREVIEW_NOTE = "// Ghidra is still reading this file. Its pseudocode replaces this view when it finishes. Until then, here is the disassembly.";
const RIZIN_NOTE = "// This engine reads disassembly with no JVM. Right-click a line to have the agent explain or decompile it, or install rz-ghidra for a built-in pseudocode view.";

/** Builds the workbench's view with the native rizin backend: no JVM, disassembly now, pseudocode when a decompiler plugin is present. */
async function loadProgramRizin(target: Target, preview = false): Promise<Program> {
  const log: string[] = [];
  const sha256 = projectId(target);
  if (preview) rizinLightOn(target.path);
  rizinReplayOn(target.path, savedTypes(sha256));
  const [functions, strings, segments, resources] = await Promise.all([
    timed(log, "functions (rizin)", () => rizinFunctions(target.path)),
    timed(log, "strings (rizin)", () => rizinStrings(target.path)),
    timed(log, "segments (rizin)", () => rizinSegments(target.path)),
    timed(log, "app files", () => appFiles(target)),
  ]);
  const hasDecompiler = !preview && (await rizinHasDecompiler(target.path).catch(() => false));
  const code = async (addr: string, view: "pseudo" | "asm"): Promise<string> => {
    if (view === "asm") return timed(log, `disassembly ${addr}`, () => rizinDisassembly(target.path, addr));
    if (hasDecompiler) return timed(log, `pseudocode ${addr}`, () => rizinPseudocode(target.path, addr));
    const asm = await timed(log, `disassembly ${addr}`, () => rizinDisassembly(target.path, addr));
    return `${preview ? PREVIEW_NOTE : RIZIN_NOTE}\n\n${asm}`;
  };
  return {
    id: sha256,
    path: target.path,
    origin: target.original,
    name: target.name,
    arch: target.arch,
    total: functions.length,
    functions,
    strings,
    imports: functions.filter((fn) => fn.kind === "thunk").map((fn) => ({ a: "", b: fn.name })),
    segments,
    evidence: `${sha256.slice(0, 8)}… · Rizin`,
    engine: "Rizin",
    ...(preview ? { preview } : {}),
    ...(resources ? { resources } : {}),
    log: () => log,
    code,
    refs: (addr) => timed(log, `xrefs ${addr}`, () => rizinRefs(target.path, addr)),
    dossier: null,
    hex: (addr) => rizinBytes(target.path, addr, RIZIN_HEX_BYTES),
    focusLine: () => -1,
    retype: preview ? null : (addr, next, previous) => rizinRetype(target.path, addr, next, previous),
  };
}

/** Builds the workbench's view of an Android app with jadx: Java/Kotlin per method, Dalvik bytecode, callers and callees. */
async function loadProgramJadx(target: Target): Promise<Program> {
  const log: string[] = [];
  const sha256 = projectId(target);
  const app = await timed(log, "decompile (jadx)", () => openJadx(target.path, sha256));
  return {
    id: sha256,
    path: target.path,
    origin: target.original,
    name: target.name,
    arch: target.arch,
    total: app.functions.length,
    functions: app.functions,
    strings: app.strings,
    imports: app.natives,
    segments: [],
    evidence: `${sha256.slice(0, 8)}… · jadx`,
    engine: "jadx",
    log: () => log,
    code: (addr, view) => timed(log, `${view === "pseudo" ? "java" : "bytecode"} ${addr}`, () => app.code(addr, view)),
    refs: (addr) => timed(log, `xrefs ${addr}`, () => app.refs(addr)),
    source: (file) => timed(log, `source ${file}`, () => app.source(file)),
    bareFiles: app.bare,
    resources: app.files,
    dossier: null,
    hex: async () => [],
    focusLine: () => -1,
    retype: null,
  };
}

/** Builds the workbench's view of a real target through REA, for Mach-O, ELF and PE alike. */
async function loadProgramRea(target: Target): Promise<Program> {
  const log: string[] = [];
  const sha256 = projectId(target);
  const opened: Opened = { path: target.path, sha256, format: "", architecture: target.arch };
  rea.replayOn(target.path, savedTypes(sha256));
  const procedures = await timed(log, "list_procedures", () => loadProcedures(target.path, sha256));
  const functions: readonly Fn[] = procedures
    .filter((p) => p.kind !== "External")
    .map((p) => ({ addr: p.address, name: p.name, kind: p.kind === "Thunk" ? "thunk" : "function" }));
  const [strings, segments, resources] = await Promise.all([
    timed(log, "list_strings", () => programStrings(target.path, sha256)),
    timed(log, "list_segments", () => programSegments(target.path, sha256)),
    timed(log, "app files", () => appFiles(target)),
  ]);
  const code = (addr: string, view: "pseudo" | "asm"): Promise<string> => {
    const name = functions.find((fn) => fn.addr === addr)?.name ?? addr;
    const op = `${view === "pseudo" ? "procedure_pseudo_code" : "procedure_assembly"} ${name}`;
    return timed(log, op, () => rea.code(opened, addr, view === "pseudo" ? "pseudocode" : "assembly"));
  };
  return {
    id: sha256,
    path: target.path,
    origin: target.original,
    name: target.name,
    arch: target.arch,
    total: functions.length,
    functions,
    strings,
    imports: procedures.filter((p) => p.kind === "External").map(importRow),
    segments,
    evidence: `${sha256.slice(0, 8)}…`,
    engine: "Ghidra",
    ...(resources ? { resources } : {}),
    log: () => log,
    code,
    refs: async (addr) => {
      const facts = await timed(log, `analyze_function ${addr}`, () => loadDossier(opened, addr));
      return { callers: facts.callers.map((site) => ({ addr: site.from, at: site.at })), callees: facts.callees };
    },
    dossier: (addr) => loadDossier(opened, addr),
    codeUsing: (addr) => timed(log, `xrefs ${addr}`, () => codeUsingString(target.path, addr, CODE_USING_LIMIT)),
    hex: (addr) => hexRows(target.path, addr),
    focusLine: () => -1,
    retype: async (addr, next) => {
      await timed(log, `set_code_type ${addr} ${next ?? "code"}`, () => rea.retype(target.path, addr, next));
      await Promise.all([forgetCode(sha256), forgetProcedures(sha256)]);
    },
  };
}

/** A way to read a target. The first reader that accepts it builds the workbench's view. */
type Reader = { readonly accepts: (target: Target) => boolean; readonly load: (target: Target) => Promise<Program> };

const READERS: readonly Reader[] = [
  { accepts: (target) => isAndroidCode(target.path), load: loadProgramJadx },
  { accepts: () => activeBackend() === "rizin", load: loadProgramRizin },
  { accepts: () => true, load: loadProgramRea },
];

export function loadProgram(target: Target): Promise<Program> {
  const reader = READERS.find((candidate) => candidate.accepts(target));
  if (!reader) throw new Error("Eleven has no way to read this file.");
  return reader.load(target);
}

/** The first view to show, and the full one that replaces it when the first is only a quick look. */
export type ProgramOpening = { readonly first: Promise<Program>; readonly full: Promise<Program> };

function previewFits(target: Target): boolean {
  return activeBackend() !== "rizin" && !isAndroidCode(target.path) && rizinInstalled();
}

async function settled(full: Promise<Program>, path: string): Promise<void> {
  try {
    await full;
    await rizinClose(path);
  } catch {
    return;
  }
}

/** Reads the file with Ghidra and, beside it, takes a quick rizin look so large binaries show their functions while Ghidra is still analyzing. */
export function openProgram(target: Target): ProgramOpening {
  const full = loadProgram(target);
  if (!previewFits(target)) return { first: full, full };
  const preview = loadProgramRizin(target, true);
  void settled(full, target.path);
  const first = Promise.race([full.catch(() => preview), preview.catch(() => full)]);
  return { first, full };
}
