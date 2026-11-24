import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { cacheDir } from "../settings/actions";
import { currentSettings, pathSetting } from "../settings/store";

import { isRecord, recordField, stringField } from "../lib/guards";
import { rea } from "../engine/rea";
import type { Program } from "./model";
import { projectReport } from "./report";
import { loadProject } from "../engine/project";
import { openExternal, reveal } from "../lib/platform";

export type ObjcEntry = { readonly address: string; readonly name: string };

function exportDir(): string {
  return pathSetting("exportDir", "ELEVEN_EXPORT_DIR") ?? join(homedir(), "Downloads", "Eleven");
}

/** Opens this program's exports folder in the file manager, making it first if nothing was exported yet. */
export async function openExportsFolder(program: Program): Promise<void> {
  const dir = join(exportDir(), safe(program.name));
  await mkdir(dir, { recursive: true });
  openExternal(dir);
}

function safe(name: string): string {
  return name.replace(/[^\w.-]/g, "_").slice(0, 80);
}

/** Where a file another program writes for this one goes, in its exports folder. */
export async function exportPath(program: Program, file: string): Promise<string> {
  const dir = join(exportDir(), safe(program.name));
  await mkdir(dir, { recursive: true });
  return join(dir, file);
}

async function write(program: Pick<Program, "name">, file: string, body: string): Promise<string> {
  const dir = join(exportDir(), safe(program.name));
  await mkdir(dir, { recursive: true });
  const path = join(dir, file);
  await writeFile(path, body);
  if (currentSettings().revealExports && !pathSetting("exportDir", "ELEVEN_EXPORT_DIR")) reveal(path);
  return path;
}

/** Writes a function's control-flow graph as a PDF in Downloads/Eleven and reveals it. */
export function exportGraphPdf(program: Program, name: string, pdf: string): Promise<string> {
  return write(program, `${safe(name)}.graph.pdf`, pdf);
}

/** Writes one function's pseudocode or assembly to a file in Downloads/Eleven and reveals it. */
export async function exportFunction(program: Program, addr: string, view: "pseudo" | "asm", name: string): Promise<string> {
  const code = await program.code(addr, view);
  return write(program, `${safe(name)}.${view === "pseudo" ? "c" : "s"}`, code);
}

/** Writes a GPU kernel rewritten by the agent to a file in Downloads/Eleven and reveals it. */
export function exportKernel(program: Program, name: string, extension: string, code: string): Promise<string> {
  return write(program, `${safe(name)}.${extension}`, code);
}

function entries(reply: unknown, key: string): readonly ObjcEntry[] {
  const list = isRecord(reply) && Array.isArray(reply[key]) ? reply[key] : [];
  return list.flatMap((item) => {
    const address = stringField(item, "address");
    const name = stringField(item, "name");
    return address && name ? [{ address, name }] : [];
  });
}

/** A readable listing of a binary's Objective-C classes and protocols with their addresses. */
export function objcInventory(name: string, classes: readonly ObjcEntry[], protocols: readonly ObjcEntry[]): string {
  const section = (title: string, rows: readonly ObjcEntry[]): string => {
    if (rows.length === 0) return `${title}\n  none\n`;
    const body = rows.map((row) => `  ${row.address}  ${row.name}`).join("\n");
    return `${title}\n${body}\n`;
  };
  const header = `// Objective-C in ${name}: ${classes.length} classes, ${protocols.length} protocols\n`;
  return [header, section("Classes", classes), section("Protocols", protocols)].join("\n");
}

/** Writes the binary's Objective-C class and protocol inventory to a file, read in two REA calls. */
export async function exportObjcInventory(program: Program): Promise<string> {
  const [classReply, protoReply] = await Promise.all([
    rea.tool(program.path, "get_objc_classes", { pattern: "" }),
    rea.tool(program.path, "get_objc_protocols", {}),
  ]);
  const classes = entries(classReply, "classes");
  const protocols = entries(protoReply, "protocols");
  return write(program, `${safe(program.name)}-objc.txt`, objcInventory(program.name, classes, protocols));
}

/** Writes everything found in the project as a Markdown report beside the other exports. */
export function exportReport(program: Program): Promise<string> {
  const original = new Map(program.functions.map((fn) => [fn.addr, fn.name]));
  return writeReport(program.name, program.id, (addr) => original.get(addr) ?? addr);
}

/** The report for a project by name and id, for callers with no Program, like an agent's tool call. */
export function writeReport(name: string, id: string, originalName: (addr: string) => string): Promise<string> {
  return write({ name }, `${safe(name)}-report.md`, projectReport(name, loadProject(id), originalName));
}

/** Functions per REA call, so each call ends well inside its deadline and a stopped export keeps what it wrote. */
const DECOMPILE_BATCH = 500;

type Decompiled = { readonly address: string; readonly name: string; readonly file: string };

function remaining(manifest: unknown): number {
  const value = recordField(manifest, "counts")?.remaining;
  return typeof value === "number" ? value : 0;
}

/** Each function REA wrote, from its index, in the order the sidebar lists them. */
async function decompiledFunctions(program: Program, dir: string, indexPath: string): Promise<readonly Decompiled[]> {
  const parsed: unknown = JSON.parse(await readFile(indexPath, "utf8"));
  const functions = isRecord(parsed) && Array.isArray(parsed.functions) ? parsed.functions : [];
  const order = new Map(program.functions.map((fn, ix) => [fn.addr, ix]));
  return functions
    .flatMap((entry): Decompiled[] => {
      const address = stringField(entry, "address");
      const relative = stringField(entry, "relative_path");
      if (!address || !relative || stringField(entry, "status") !== "written") return [];
      return [{ address, name: stringField(entry, "name") ?? address, file: join(dir, relative) }];
    })
    .sort((a, b) => (order.get(a.address) ?? order.size) - (order.get(b.address) ?? order.size));
}

/** REA heads each file with comment lines about the function, then a blank line, then the pseudocode. */
function pseudocodeOf(text: string): string {
  const split = text.indexOf("\n\n");
  return (split < 0 ? text : text.slice(split + 2)).trim();
}

/** Writes every function's pseudocode to one file. REA decompiles them in batches into a cache folder, so a huge binary never has to fit one reply. */
export async function exportAllPseudocode(program: Program): Promise<string> {
  const dir = join(cacheDir(), program.id, "decompile-all");
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, ".."), { recursive: true });
  let indexPath: string | null = null;
  let resume = false;
  do {
    const manifest = await rea.tool(program.path, "decompile_all", { output_directory: dir, limit: DECOMPILE_BATCH, resume });
    indexPath = stringField(manifest, "index_path") ?? indexPath;
    resume = true;
    if (remaining(manifest) === 0) break;
  } while (true);
  if (!indexPath) throw new Error("REA didn't say where it wrote the pseudocode.");
  const files = await decompiledFunctions(program, dir, indexPath);
  const parts = await Promise.all(files.map(async (fn) => `// ${fn.name}\n${pseudocodeOf(await readFile(fn.file, "utf8"))}\n`));
  return write(program, `${safe(program.name)}-pseudocode.c`, parts.join("\n"));
}
