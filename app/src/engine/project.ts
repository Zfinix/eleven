import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { type Author, diffProjects, EDIT, type Edit, record } from "./edits";
import { listOf, readOr, textMap } from "../lib/schema";
import { supportPath } from "../lib/support";
import { currentSettings } from "../settings/store";
import type { Target, TargetKind } from "./target";

const PROJECTS = supportPath("projects");
const INDEX = join(PROJECTS, "index.json");

/** One app or binary you have opened: the top level that its chats, renames and notes belong to. */
export type ProjectEntry = {
  readonly id: string;
  readonly name: string;
  readonly original: string;
  readonly arch: string;
  readonly kind: TargetKind;
  readonly openedAt: number;
};

const ids = new Map<string, string>();

/** A project is keyed by the SHA-256 of the binary REA reads, hashed once per file version. */
export function projectId(target: Target): string {
  const { size, mtimeMs } = statSync(target.path);
  const key = `${target.path}:${size}:${mtimeMs}`;
  const known = ids.get(key);
  if (known) return known;
  const id = createHash("sha256").update(readFileSync(target.path)).digest("hex");
  ids.set(key, id);
  return id;
}

const KIND: z.ZodType<TargetKind> = z.enum(["binary", "app", "gpu", "model"]);

const INDEX_ENTRIES = listOf(z.object({ id: z.string(), name: z.string(), original: z.string(), arch: z.string(), kind: KIND, openedAt: z.number() }));

/** Projects you have opened, most recent first. */
export function listProjects(): readonly ProjectEntry[] {
  try {
    return [...readOr(INDEX_ENTRIES, JSON.parse(readFileSync(INDEX, "utf8")), [])].sort((a, b) => b.openedAt - a.openedAt);
  } catch {
    return [];
  }
}

/** Adds the target to the project list, or marks it opened at `at`, and returns its project id. */
const listWatchers = new Set<() => void>();

/** Runs whenever a project is added to, renamed in or taken off the list. */
export function onProjectListChange(watcher: () => void): () => void {
  listWatchers.add(watcher);
  return () => {
    listWatchers.delete(watcher);
  };
}

function listChanged(): void {
  for (const watcher of listWatchers) watcher();
}

export function rememberProject(target: Target, at: number = Date.now()): string {
  const id = projectId(target);
  const known = listProjects();
  const openedAt = Math.max(at, known.find((project) => project.id === id)?.openedAt ?? 0);
  const next: ProjectEntry = { id, name: target.name, original: target.original, arch: target.arch, kind: target.kind, openedAt };
  mkdirSync(PROJECTS, { recursive: true });
  writeFileSync(INDEX, `${JSON.stringify([next, ...known.filter((project) => project.id !== id)], null, 2)}\n`);
  listChanged();
  return id;
}

export type Bookmark = { readonly addr: string; readonly label: string };

export type Patch = { readonly addr: string; readonly bytes: string };

/** Graph blocks folded into one node: the function, the blocks' start addresses, and its label. */
export type BlockGroup = { readonly fn: string; readonly blocks: readonly string[]; readonly label: string };

/** Everything you changed about one binary: renames, bookmarks, notes and byte patches, keyed by its SHA-256. */
function writeIndex(entries: readonly ProjectEntry[]): void {
  mkdirSync(PROJECTS, { recursive: true });
  writeFileSync(INDEX, `${JSON.stringify(entries, null, 2)}\n`);
  listChanged();
}

/** Takes a project off the list; its file and saved work stay where they are. */
export function forgetProject(id: string): void {
  writeIndex(listProjects().filter((project) => project.id !== id));
}

/** Takes a project off the list and deletes its saved work. The app or binary it was made from is never touched. */
export function deleteProject(id: string): void {
  unsaved.delete(id);
  rmSync(file(id), { force: true });
  forgetProject(id);
}

export function renameProject(id: string, name: string): void {
  writeIndex(listProjects().map((project) => (project.id === id ? { ...project, name } : project)));
}

export type Project = {
  readonly names: ReadonlyMap<string, string>;
  readonly bookmarks: readonly Bookmark[];
  readonly notes: ReadonlyMap<string, string>;
  readonly patches: readonly Patch[];
  /** Comments on single instructions, keyed by address. */
  readonly comments: ReadonlyMap<string, string>;
  /** Highlight colors for graph blocks, keyed by the block's start address. */
  readonly colors: ReadonlyMap<string, string>;
  readonly groups: readonly BlockGroup[];
  /** What you marked bytes as (code, a function, data, a string, undefined), keyed by address. */
  readonly types: ReadonlyMap<string, string>;
  /** How the number in an instruction is shown, keyed by the instruction's address. */
  readonly formats: ReadonlyMap<string, string>;
  /** Where the debugger stops, keyed by instruction address. */
  readonly breakpoints: ReadonlyMap<string, string>;
  /** C types written for this binary, keyed by type name, each its whole declaration. */
  readonly ctypes: ReadonlyMap<string, string>;
  /** Which C type the bytes at an address are, keyed by address. */
  readonly ctypeAt: ReadonlyMap<string, string>;
  /** Free-form pages of findings, keyed by page name; the workbench shows the one called "notebook". */
  readonly pages: ReadonlyMap<string, string>;
  /** Every change made to the values above, oldest first, including agent suggestions waiting for review. */
  readonly edits: readonly Edit[];
};

export const EMPTY_PROJECT: Project = { names: new Map(), bookmarks: [], notes: new Map(), patches: [], comments: new Map(), colors: new Map(), groups: [], types: new Map(), formats: new Map(), breakpoints: new Map(), ctypes: new Map(), ctypeAt: new Map(), pages: new Map(), edits: [] };

function file(id: string): string {
  return join(PROJECTS, `${id}.json`);
}

const PROJECT: z.ZodType<Project> = z.object({
  names: textMap,
  bookmarks: listOf(z.object({ addr: z.string(), label: z.string() })),
  notes: textMap,
  patches: listOf(z.object({ addr: z.string(), bytes: z.string() })),
  comments: textMap,
  colors: textMap,
  groups: listOf(z.object({ fn: z.string(), blocks: listOf(z.string()), label: z.string() }).refine((group) => group.blocks.length > 1)),
  types: textMap,
  formats: textMap,
  breakpoints: textMap,
  ctypes: textMap,
  ctypeAt: textMap,
  pages: textMap,
  edits: listOf(EDIT),
});

/** Changes held in memory while autosave is off, written by `saveProjects` or when Eleven quits. */
const unsaved = new Map<string, Project>();

export function loadProject(id: string): Project {
  const held = unsaved.get(id);
  if (held) return held;
  try {
    return readOr(PROJECT, JSON.parse(readFileSync(file(id), "utf8")), EMPTY_PROJECT);
  } catch {
    return EMPTY_PROJECT;
  }
}

export function saveProject(id: string, project: Project): void {
  unsaved.delete(id);
  mkdirSync(PROJECTS, { recursive: true });
  const json = { names: Object.fromEntries(project.names), bookmarks: project.bookmarks, notes: Object.fromEntries(project.notes), patches: project.patches, comments: Object.fromEntries(project.comments), colors: Object.fromEntries(project.colors), groups: project.groups, types: Object.fromEntries(project.types), formats: Object.fromEntries(project.formats), breakpoints: Object.fromEntries(project.breakpoints), ctypes: Object.fromEntries(project.ctypes), ctypeAt: Object.fromEntries(project.ctypeAt), pages: Object.fromEntries(project.pages), edits: project.edits };
  writeFileSync(file(id), `${JSON.stringify(json, null, 2)}\n`);
}

/** The project's saved JSON as written to disk, for packing into a `.eleven` file. */
export function projectJson(id: string): string {
  saveProjects();
  try {
    return readFileSync(file(id), "utf8");
  } catch {
    return "{}\n";
  }
}

/** Replaces a project's saved work with JSON unpacked from a `.eleven` file, and tells open views. */
export function restoreProjectJson(id: string, json: string): void {
  unsaved.delete(id);
  mkdirSync(PROJECTS, { recursive: true });
  writeFileSync(file(id), json);
  for (const listener of listeners) listener(id);
}

type Listener = (id: string) => void;

const listeners = new Set<Listener>();

/** Applies a change, logs it as made `by` (null when the change edits the log itself), and announces it. */
export function updateProject(id: string, change: (project: Project) => Project, by: Author | null, evidence?: readonly string[]): Project {
  const before = loadProject(id);
  const changed = change(before);
  const next = by ? { ...changed, edits: record(changed.edits, diffProjects(before, changed), by, undefined, evidence) } : changed;
  if (next.edits === before.edits && diffProjects(before, next).length === 0) return before;
  if (currentSettings().autosave) saveProject(id, next);
  else holdUnsaved(id, next);
  for (const listener of listeners) listener(id);
  return next;
}

function holdUnsaved(id: string, project: Project): void {
  if (unsaved.size === 0) process.once("exit", saveProjects);
  unsaved.set(id, project);
}

/** Whether a project has changes not yet written to disk. */
export function hasUnsaved(id: string): boolean {
  return unsaved.has(id);
}

/** Writes every held change to disk: the explicit save when autosave is off. */
export function saveProjects(): void {
  for (const [id, project] of [...unsaved]) saveProject(id, project);
}

export function onProjectChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
