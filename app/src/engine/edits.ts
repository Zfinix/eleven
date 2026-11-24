import { randomUUID } from "node:crypto";

import { z } from "zod";

import { describeType } from "./codeTypes";
import { describeFormat } from "./operands";
import type { BlockGroup, Project } from "./project";

export const EDIT_FIELDS = ["names", "notes", "comments", "colors", "bookmarks", "patches", "groups", "types", "formats", "breakpoints", "ctypes", "ctypeAt", "pages"] as const;

export type EditField = (typeof EDIT_FIELDS)[number];

export type Author = { readonly kind: "you" } | { readonly kind: "agent"; readonly agent: string; readonly chat: string | null };

export const YOU: Author = { kind: "you" };

export type EditStatus = "applied" | "proposed" | "rejected" | "undone";

/** One change to a project value, by you or an agent. `null` means the value isn't set. */
export type Edit = {
  readonly id: string;
  readonly at: number;
  readonly changedAt: number;
  readonly by: Author;
  readonly field: EditField;
  readonly key: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly status: EditStatus;
  /** Why an agent suggested it, in its own words. */
  readonly reason?: string;
  /** What an agent read that backs it: addresses in the binary, each with what it saw there. */
  readonly evidence?: readonly string[];
};

/** Kinds of edit that state a claim about the code, so an agent making one should say what it is based on. */
const CLAIMS: ReadonlySet<EditField> = new Set(["names", "notes", "comments", "bookmarks", "pages"]);

export function isClaim(field: EditField): boolean {
  return CLAIMS.has(field);
}

/** An agent's claim with nothing behind it: shown as a guess until checked. */
export function unbacked(edit: Edit): boolean {
  return edit.by.kind === "agent" && isClaim(edit.field) && edit.after !== null && (edit.evidence?.length ?? 0) === 0;
}

const MAX_EVIDENCE = 8;
const MAX_EVIDENCE_CHARS = 120;

/** An agent's evidence, one item per comma or line, kept only where it names an address in the binary. */
export function parseEvidence(text: string): readonly string[] {
  return [...new Set(text.split(/[,\n;]+/).map((item) => item.trim().slice(0, MAX_EVIDENCE_CHARS)).filter((item) => /\b0x[0-9a-f]+\b/i.test(item)))].slice(0, MAX_EVIDENCE);
}

/** The address an evidence item points at, for a link to it. */
export function evidenceAddress(item: string): string | null {
  return /\b0x[0-9a-f]+\b/i.exec(item)?.[0].toLowerCase() ?? null;
}

export type Change = { readonly field: EditField; readonly key: string; readonly before: string | null; readonly after: string | null };

const MAX_EDITS = 2000;
const MERGE_MS = 60_000;

let lastStamp = 0;

/** The time now, always later than the previous stamp, so the log's order never ties. */
export function stamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

function groupKey(group: BlockGroup): string {
  return `${group.fn}|${group.blocks.join(",")}`;
}

/** Any project field as a map from key to value, so every kind of change is handled the same way. */
export function fieldMap(project: Project, field: EditField): ReadonlyMap<string, string> {
  switch (field) {
    case "names":
    case "notes":
    case "comments":
    case "colors":
    case "types":
    case "formats":
    case "breakpoints":
    case "ctypes":
    case "ctypeAt":
    case "pages":
      return project[field];
    case "bookmarks":
      return new Map(project.bookmarks.map((mark) => [mark.addr, mark.label]));
    case "patches":
      return new Map(project.patches.map((patch) => [patch.addr, patch.bytes]));
    case "groups":
      return new Map(project.groups.map((group) => [groupKey(group), group.label]));
    default: {
      const unhandled: never = field;
      return unhandled;
    }
  }
}

function withField(project: Project, field: EditField, map: ReadonlyMap<string, string>): Project {
  const entries = [...map];
  switch (field) {
    case "names":
    case "notes":
    case "comments":
    case "colors":
    case "types":
    case "formats":
    case "breakpoints":
    case "ctypes":
    case "ctypeAt":
    case "pages":
      return { ...project, [field]: map };
    case "bookmarks":
      return { ...project, bookmarks: entries.map(([addr, label]) => ({ addr, label })) };
    case "patches":
      return { ...project, patches: entries.map(([addr, bytes]) => ({ addr, bytes })) };
    case "groups":
      return {
        ...project,
        groups: entries.map(([key, label]) => {
          const [fn = "", blocks = ""] = key.split("|");
          return { fn, blocks: blocks.split(","), label };
        }),
      };
    default: {
      const unhandled: never = field;
      return unhandled;
    }
  }
}

export function valueOf(project: Project, field: EditField, key: string): string | null {
  return fieldMap(project, field).get(key) ?? null;
}

export function setValue(project: Project, field: EditField, key: string, value: string | null): Project {
  const map = new Map(fieldMap(project, field));
  if (value === null) map.delete(key);
  else map.set(key, value);
  return withField(project, field, map);
}

/** Every value that differs between two versions of a project. */
export function diffProjects(before: Project, after: Project): readonly Change[] {
  return EDIT_FIELDS.flatMap((field) => {
    const a = fieldMap(before, field);
    const b = fieldMap(after, field);
    const keys = new Set([...a.keys(), ...b.keys()]);
    return [...keys].flatMap((key) => {
      const was = a.get(key) ?? null;
      const now = b.get(key) ?? null;
      return was === now ? [] : [{ field, key, before: was, after: now }];
    });
  });
}

export function sameAuthor(a: Author, b: Author): boolean {
  if (a.kind === "you" || b.kind === "you") return a.kind === b.kind;
  return a.agent === b.agent && a.chat === b.chat;
}

function trim(log: readonly Edit[]): readonly Edit[] {
  const extra = log.length - MAX_EDITS;
  if (extra <= 0) return log;
  let dropped = 0;
  return log.filter((edit) => {
    if (dropped >= extra || edit.status === "proposed") return true;
    dropped++;
    return false;
  });
}

export function newEdit(change: Change, by: Author, status: EditStatus, now: number, reason?: string, evidence?: readonly string[]): Edit {
  const edit: Edit = { id: randomUUID(), at: now, changedAt: now, by, status, ...change, ...(reason ? { reason } : {}) };
  return evidence && evidence.length > 0 ? { ...edit, evidence } : edit;
}

function folds(last: Edit, change: Change, by: Author, now: number): boolean {
  return last.status === "applied" && last.field === change.field && last.key === change.key && sameAuthor(last.by, by) && now - last.changedAt < MERGE_MS;
}

/** Appends applied changes; one that repeats the newest entry within a minute folds into it, so typing a note is one entry. */
export function record(log: readonly Edit[], changes: readonly Change[], by: Author, now: number = stamp(), evidence?: readonly string[]): readonly Edit[] {
  if (changes.length === 0) return log;
  let next = [...log];
  for (const change of changes) {
    const last = next.at(-1);
    if (!last || !folds(last, change, by, now)) {
      next.push(newEdit(change, by, "applied", now, undefined, evidence));
      continue;
    }
    next = next.slice(0, -1);
    if (last.before !== change.after) next.push({ ...last, after: change.after, changedAt: now, ...(evidence && evidence.length > 0 ? { evidence } : {}) });
  }
  return trim(next);
}

/** The newest applied edit, which ⌘Z takes back. */
export function undoTarget(log: readonly Edit[]): Edit | null {
  return [...log].reverse().find((edit) => edit.status === "applied") ?? null;
}

/** The most recently undone edit, as long as nothing was changed after the undo. */
export function redoTarget(log: readonly Edit[]): Edit | null {
  const undone = log.filter((edit) => edit.status === "undone").sort((a, b) => b.changedAt - a.changedAt)[0];
  if (!undone) return null;
  const later = log.some((edit) => edit.status === "applied" && edit.changedAt > undone.changedAt);
  return later ? null : undone;
}

/** An edit can be undone only while its value is still what it set. */
export function canUndo(project: Project, edit: Edit): boolean {
  return edit.status === "applied" && valueOf(project, edit.field, edit.key) === edit.after;
}

/** A plain sentence for an edit, like "Renamed FUN_1000 to parse_args"; `originalOf` gives a function's name before any rename. */
export function describeEdit(edit: Edit, nameOf: (addr: string) => string, originalOf: (addr: string) => string = nameOf): string {
  const { field, key, before, after } = edit;
  switch (field) {
    case "names":
      if (after === null) return `Removed the name ${before ?? ""} from ${key}`;
      return `Renamed ${before ?? originalOf(key)} to ${after}`;
    case "notes":
      return after === null ? `Removed the note on ${nameOf(key)}` : `Noted ${nameOf(key)}: ${after}`;
    case "comments":
      return after === null ? `Removed the comment at ${key}` : `Commented ${key}: ${after}`;
    case "colors":
      return after === null ? `Cleared the color of the block at ${key}` : `Colored the block at ${key} ${after}`;
    case "bookmarks":
      return after === null ? `Removed the bookmark on ${before ?? key}` : `Bookmarked ${after} (${key})`;
    case "patches":
      return after === null ? `Removed the patch at ${key}` : `Patch ${key} to ${after}`;
    case "groups":
      return after === null ? `Ungrouped ${before ?? "blocks"}` : `Grouped blocks as ${after}`;
    case "types":
      return after === null ? `Put ${key} back to how it was read` : `Marked ${key} as ${describeType(after)}`;
    case "formats":
      return after === null ? `Showed the number at ${key} as it was` : `Showed the number at ${key} as ${describeFormat(after)}`;
    case "breakpoints":
      return after === null ? `Removed the breakpoint at ${key}` : `Added a breakpoint at ${key}`;
    case "ctypes":
      return after === null ? `Removed the C type ${key}` : before === null ? `Wrote the C type ${key}` : `Changed the C type ${key}`;
    case "ctypeAt":
      return after === null ? `Took the C type off ${key}` : `Read ${key} as ${after}`;
    case "pages":
      return after === null ? `Cleared the ${key}` : `Wrote in the ${key}`;
    default: {
      const unhandled: never = field;
      return unhandled;
    }
  }
}

export function authorName(by: Author): string {
  return by.kind === "you" ? "You" : by.agent;
}

const AUTHOR: z.ZodType<Author> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("you") }),
  z.object({ kind: z.literal("agent"), agent: z.string(), chat: z.string().nullable().catch(null) }),
]);

/** One saved log entry; entries that don't fit are dropped when the project loads. */
export const EDIT: z.ZodType<Edit> = z.object({
  id: z.string(),
  at: z.number(),
  changedAt: z.number(),
  by: AUTHOR,
  field: z.enum(EDIT_FIELDS),
  key: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  status: z.enum(["applied", "proposed", "rejected", "undone"]),
  reason: z.string().exactOptional(),
  evidence: z.array(z.string()).exactOptional(),
});
