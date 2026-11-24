import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { listOf, readOr } from "../lib/schema";
import { supportPath } from "../lib/support";
import { MODEL_PAGES, type Pane, type Tab } from "./model";
import { fits, type PaneTree, rowOf } from "./paneTree";

const THREAD_TABS = supportPath("thread-tabs");

/** The editor tabs that were open while a thread was the current one. */
export type ThreadTabs = { readonly panes: readonly Pane[]; readonly tree: PaneTree; readonly focus: number };

function file(threadId: string): string {
  return join(THREAD_TABS, `${threadId}.json`);
}

const ID = { id: z.string(), preview: z.literal(false).catch(false) };

const TAB: z.ZodType<Tab> = z.discriminatedUnion("kind", [
  z.object({ ...ID, kind: z.literal("fn"), addr: z.string(), view: z.enum(["pseudo", "asm", "graph", "hex"]) }),
  z.object({ ...ID, kind: z.literal("list"), list: z.enum(["strings", "imports", "segments"]) }),
  z.object({ ...ID, kind: z.literal("shader"), library: z.string(), name: z.string() }),
  z.object({ ...ID, kind: z.literal("model"), name: z.string(), page: z.enum(MODEL_PAGES).catch("overview"), tensor: z.string().nullable().catch(null) }),
  z.object({ ...ID, kind: z.literal("profile"), title: z.string() }),
  z.object({ ...ID, kind: z.literal("path"), from: z.string(), to: z.string() }),
  z.object({ ...ID, kind: z.literal("notebook") }),
]);

function clamp(index: number, count: number): number {
  return Math.min(Math.max(0, index), count - 1);
}

const PANE: z.ZodType<Pane> = z.object({
  tabs: listOf(TAB).refine((tabs) => tabs.length > 0),
  active: z.number().catch(0),
}).transform((pane) => ({ ...pane, active: clamp(pane.active, pane.tabs.length) }));

const TREE: z.ZodType<PaneTree> = z.lazy(() => z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pane"), pane: z.number().int() }),
  z.object({ kind: z.literal("split"), dir: z.enum(["row", "column"]), children: z.array(TREE).min(2), weights: z.array(z.number().positive()) }),
]));

const THREAD_TABS_FILE: z.ZodType<ThreadTabs> = z.object({
  panes: listOf(PANE).refine((panes) => panes.length > 0),
  tree: TREE.nullable().catch(null),
  focus: z.number().catch(0),
}).transform((saved) => ({
  panes: saved.panes,
  tree: saved.tree && fits(saved.tree, saved.panes.length) ? saved.tree : rowOf(saved.panes.length),
  focus: clamp(saved.focus, saved.panes.length),
}));

export function loadThreadTabs(threadId: string): ThreadTabs | null {
  try {
    return readOr(THREAD_TABS_FILE, JSON.parse(readFileSync(file(threadId), "utf8")), null);
  } catch {
    return null;
  }
}

/** Chat tabs are left out: the chat itself already belongs to the thread. */
export function saveThreadTabs(threadId: string, panes: readonly Pane[], tree: PaneTree, focus: number): void {
  const kept = panes.map((pane) => {
    const active = pane.tabs[pane.active];
    const tabs = pane.tabs.filter((tab) => tab.kind !== "thread");
    return { tabs, active: Math.max(0, tabs.findIndex((tab) => tab === active)) };
  });
  mkdirSync(THREAD_TABS, { recursive: true });
  writeFileSync(file(threadId), `${JSON.stringify({ panes: kept, tree, focus }, null, 2)}\n`);
}

export function clearThreadTabs(): void {
  try {
    rmSync(THREAD_TABS, { recursive: true, force: true });
  } catch {
    return;
  }
}
