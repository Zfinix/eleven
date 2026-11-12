import { type Annotations, openInCutter, readCutterProject, writeCutterProject } from "../engine/cutter";
import { YOU } from "../engine/edits";
import { loadProject, type Project, updateProject } from "../engine/project";
import { exportPath } from "./export";
import type { Program } from "./model";

function numeric(addr: string): number | null {
  const value = Number.parseInt(addr.replace(/^0x/i, ""), 16);
  return Number.isNaN(value) ? null : value;
}

function byAddress(map: ReadonlyMap<string, string>): ReadonlyMap<number, string> {
  return new Map([...map].flatMap(([addr, value]) => {
    const at = numeric(addr);
    return at === null ? [] : [[at, value] as const];
  }));
}

/** Eleven's names and comments for this program, keyed by address, to carry into Cutter. */
export function annotationsOf(project: Project): Annotations {
  return { names: byAddress(project.names), comments: byAddress(project.comments) };
}

/** An address written the way this engine writes them, padded like its function addresses, so imported values land on the right lines. */
export function addressLike(sample: string | undefined, value: number): string {
  const digits = value.toString(16);
  const padded = sample?.match(/^0x(0+)[0-9a-f]+$/i) ? digits.padStart(sample.length - 2, "0") : digits;
  return `0x${padded}`;
}

/** Writes this binary with Eleven's names and comments as a Cutter project in the exports folder. */
export async function exportCutterProject(program: Program): Promise<string> {
  return writeCutterProject(program.path, annotationsOf(loadProject(program.id)), await exportPath(program, `${program.name}.rzdb`));
}

/** Writes the Cutter project, then opens it in Cutter. */
export async function openCutter(program: Program): Promise<string> {
  const project = await exportCutterProject(program);
  openInCutter(project);
  return project;
}

/** Brings the names and comments set in a Cutter project into this project, logged so they can be undone. */
export async function importCutterProject(program: Program, file: string): Promise<{ readonly names: number; readonly comments: number }> {
  const found = await readCutterProject(file, program.path);
  const functions = new Map(program.functions.map((fn) => [numeric(fn.addr), fn.addr]));
  const sample = program.functions[0]?.addr;
  const key = (at: number): string => functions.get(at) ?? addressLike(sample, at);
  updateProject(program.id, (project) => ({
    ...project,
    names: new Map([...project.names, ...[...found.names].map(([at, name]) => [key(at), name] as const)]),
    comments: new Map([...project.comments, ...[...found.comments].map(([at, text]) => [key(at), text] as const)]),
  }), YOU);
  return { names: found.names.size, comments: found.comments.size };
}
