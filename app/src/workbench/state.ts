import { useState } from "react";

import { DEFAULT_DOCKS, type Docks, placeTool, type Tool, type Zone, zoneOf } from "./dockOrder";

import type { BlockGroup, Bookmark, Project } from "../engine/project";
import type { CodeMode, Pane, Program, Tab, TabTarget } from "./model";
import { currentSettings, type Settings } from "../settings/store";
import { type Edge, loadSizes, type Sizes } from "./sizes";
import { equalize, type PaneTree, removePane, renumber, resizeAt, rowOf, type Side, splitBeside, type TreePath } from "./paneTree";
import type { Subject } from "./subject";
import type { ThreadTabs } from "./threadTabs";

export type UiState = {
  readonly panes: readonly Pane[];
  /** How `panes` are arranged in rows and columns. */
  readonly tree: PaneTree;
  readonly focus: number;
  readonly seq: number;
  readonly filter: string;
  readonly names: ReadonlyMap<string, string>;
  readonly bookmarks: readonly Bookmark[];
  readonly notes: ReadonlyMap<string, string>;
  /** Functions visited in order, for back and forward. */
  readonly trail: readonly string[];
  /** When each entry in `trail` was visited, in step with it. */
  readonly trailTimes: readonly number[];
  readonly at: number;
  readonly sidebarOpen: boolean;
  /** Which tools each dock holds; the rest open as editor tabs. */
  readonly docks: Docks;
  readonly rightOpen: boolean;
  readonly bottomOpen: boolean;
  /** The tool showing in each dock. */
  readonly right: Tool;
  readonly bottom: Tool;
  /** Listing lines show their raw bytes. */
  readonly showBytes: boolean;
  /** A listing and its pseudocode sit side by side, and selecting a line in one highlights the match in the other. */
  readonly linked: boolean;
  /** Instruction addresses the debugger stops at. */
  readonly breakpoints: ReadonlyMap<string, string>;
  /** The instruction the debugger is paused at. */
  readonly debugPc: string | null;
  readonly navClosed: readonly NavSection[];
  readonly sizes: Sizes;
  readonly resizing: { readonly edge: Edge; readonly start: number; readonly from: number } | null;
  readonly paneDrag: PaneDrag | null;
  readonly renaming: string | null;
  readonly renameDraft: string;
  readonly patching: string | null;
  readonly patchDraft: string;
  readonly pickerOpen: boolean;
  readonly paletteOpen: boolean;
  readonly paletteQuery: string;
  /** Set while the palette picks where a call path from this function should end. */
  readonly pathFrom: string | null;
  /** Set while the palette picks a library from macOS's dyld shared cache to open. */
  readonly systemPick: boolean;
  readonly comments: ReadonlyMap<string, string>;
  readonly colors: ReadonlyMap<string, string>;
  /** What bytes were marked as, and how numbers show, from the project. */
  readonly types: ReadonlyMap<string, string>;
  readonly formats: ReadonlyMap<string, string>;
  /** Goes up whenever the engine re-reads the code after a type change, so open views reload. */
  readonly revision: number;
  /** The line, word, block or bytes last clicked; keyboard actions act on it. */
  readonly selected: Subject | null;
  readonly commenting: string | null;
  readonly commentDraft: string;
  /** An address whose references the References tab lists instead of the open function's callers. */
  readonly refsOf: string | null;
  readonly toast: UndoToast | null;
  readonly groups: readonly BlockGroup[];
  /** Graph blocks picked with Shift-click, to group them. */
  readonly blockPicks: readonly string[];
  readonly labelling: { readonly fn: string; readonly start: string } | null;
  readonly labelDraft: string;
  /** Lines picked with Select all or Shift-click, inclusive and 1-based; Copy takes them. */
  readonly lineRange: LineRange | null;
  /** The lines whose ask thread is open under them, and the question it opened with. */
  readonly asking: Asking | null;
  readonly finding: boolean;
  readonly findQuery: string;
  readonly findMode: FindMode;
  /** Which match is current; wraps around the matches in the view. */
  readonly findAt: number;
};

/** In a "text" view (a rewrite, a source file) `fn` names the view, not a function. */
export type LineRange = { readonly fn: string; readonly view: "pseudo" | "asm" | "text"; readonly from: number; readonly to: number };

export type Asking = { readonly range: LineRange; readonly start: string | null };

const EMPTY_PANE: Pane = { tabs: [], active: 0 };

/** A divider being dragged: the split it sits in, the children either side, and how much weight one pixel is worth. */
export type PaneDrag = { readonly path: TreePath; readonly index: number; readonly vertical: boolean; readonly start: number; readonly from: readonly [number, number]; readonly perPx: number };

export type FindMode = "text" | "regex" | "hex" | "number";

export type UndoToast = { readonly text: string; readonly undo: (() => void) | null; readonly seq: number };

const NAV_SECTIONS = ["threads", "work", "data", "source", "resources", "functions", "gpu", "model", "blocks"] as const;

export type NavSection = (typeof NAV_SECTIONS)[number];

export function isNavSection(value: string): value is NavSection {
  return NAV_SECTIONS.some((section) => section === value);
}

function modeFor(view: Settings["firstView"]): CodeMode {
  switch (view) {
    case "Pseudocode":
      return "pseudo";
    case "Assembly":
      return "asm";
    case "Graph":
      return "graph";
    case "Hex":
      return "hex";
    default: {
      const unhandled: never = view;
      return unhandled;
    }
  }
}

/** The view a newly opened function shows first, from Code views settings. */
export function firstMode(): CodeMode {
  return modeFor(currentSettings().firstView);
}

export function initialPanes(program: Program): readonly Pane[] {
  const main = program.functions.find((fn) => fn.name === "entry" || fn.name === "_main") ?? program.functions[0];
  const tabs: Tab[] = main ? [{ kind: "fn", id: "a", addr: main.addr, view: firstMode(), preview: false }] : [];
  return [{ tabs, active: 0 }];
}

export function initialState(panes: readonly Pane[], tree: PaneTree = rowOf(panes.length), docks: Docks = DEFAULT_DOCKS): UiState {
  const start = panes[0]?.tabs.find((tab) => tab.kind === "fn");
  const trail = start?.kind === "fn" ? [start.addr] : [];
  const trailTimes = trail.map(() => Date.now());
  return {
    panes, tree, focus: 0, seq: 10, filter: "", names: new Map(), bookmarks: [], notes: new Map(), trail, trailTimes, at: trail.length - 1,
    sidebarOpen: true, docks, rightOpen: docks.right.length > 0, bottomOpen: false, right: docks.right[0] ?? "agent", bottom: docks.bottom[0] ?? "refs", showBytes: false, linked: false, breakpoints: new Map(), debugPc: null, navClosed: ["functions"], sizes: loadSizes(), resizing: null, paneDrag: null,
    renaming: null, pathFrom: null, systemPick: false, renameDraft: "", patching: null, patchDraft: "", pickerOpen: false,
    paletteOpen: false, paletteQuery: "",
    comments: new Map(), colors: new Map(), types: new Map(), formats: new Map(), revision: 0, selected: null, commenting: null, commentDraft: "", refsOf: null, toast: null,
    lineRange: null, asking: null, finding: false, findQuery: "", findMode: "text", findAt: 0, groups: [], blockPicks: [], labelling: null, labelDraft: "",
  };
}

function sameTarget(tab: Tab, target: TabTarget): boolean {
  switch (target.kind) {
    case "fn":
      return tab.kind === "fn" && tab.addr === target.addr;
    case "thread":
      return tab.kind === "thread" && tab.thread === target.thread;
    case "list":
      return tab.kind === "list" && tab.list === target.list;
    case "shader":
      return tab.kind === "shader" && tab.library === target.library && tab.name === target.name;
    case "model":
      return tab.kind === "model" && tab.name === target.name;
    case "profile":
      return tab.kind === "profile" && tab.title === target.title;
    case "diff":
      return tab.kind === "diff";
    case "debug":
      return tab.kind === "debug";
    case "path":
      return tab.kind === "path" && tab.from === target.from && tab.to === target.to;
    case "second":
      return tab.kind === "second" && tab.addr === target.addr;
    case "ctypes":
      return tab.kind === "ctypes";
    case "crash":
      return tab.kind === "crash" && tab.file === target.file;
    case "notebook":
      return tab.kind === "notebook";
    case "guesses":
      return tab.kind === "guesses";
    case "listing":
      return tab.kind === "listing";
    case "source":
      return tab.kind === "source" && tab.file === target.file;
    case "resource":
      return tab.kind === "resource" && tab.file === target.file;
    case "text":
      return tab.kind === "text" && tab.title === target.title;
    case "tool":
      return tab.kind === "tool" && tab.tool === target.tool;
    default: {
      const unhandled: never = target;
      return unhandled;
    }
  }
}

function freshTab(target: TabTarget, id: string, preview: boolean, view: CodeMode): Tab {
  switch (target.kind) {
    case "fn":
      return { kind: "fn", id, addr: target.addr, view, preview };
    case "thread":
      return { kind: "thread", id, thread: target.thread, preview };
    case "list":
      return { kind: "list", id, list: target.list, preview };
    case "shader":
      return { kind: "shader", id, library: target.library, name: target.name, preview };
    case "model":
      return { kind: "model", id, name: target.name, page: target.page ?? "overview", tensor: target.tensor ?? null, preview };
    case "profile":
      return { kind: "profile", id, title: target.title, preview };
    case "diff":
      return { kind: "diff", id, preview };
    case "debug":
      return { kind: "debug", id, preview };
    case "path":
      return { kind: "path", id, from: target.from, to: target.to, preview };
    case "second":
      return { kind: "second", id, addr: target.addr, preview };
    case "ctypes":
      return { kind: "ctypes", id, at: target.at, preview };
    case "crash":
      return { kind: "crash", id, file: target.file, preview };
    case "notebook":
      return { kind: "notebook", id, preview };
    case "guesses":
      return { kind: "guesses", id, preview };
    case "listing":
      return { kind: "listing", id, preview };
    case "source":
      return { kind: "source", id, file: target.file, preview };
    case "resource":
      return { kind: "resource", id, file: target.file, preview };
    case "text":
      return { kind: "text", id, title: target.title, text: target.text, preview };
    case "tool":
      return { kind: "tool", id, tool: target.tool, preview };
    default: {
      const unhandled: never = target;
      return unhandled;
    }
  }
}

/** The focused tab's view, so a function opened from graph view opens in graph view too. */
function viewHere(s: UiState): CodeMode {
  const pane = s.panes[s.focus];
  const tab = pane?.tabs[pane.active];
  return tab?.kind === "fn" ? tab.view : firstMode();
}

function openIn(s: UiState, target: TabTarget, preview: boolean, view: CodeMode = viewHere(s)): UiState {
  const focus = Math.min(s.focus, s.panes.length - 1);
  const panes = s.panes.length > 0 ? [...s.panes] : [EMPTY_PANE];
  const pane = panes[Math.max(focus, 0)] ?? EMPTY_PANE;
  const tabs = [...pane.tabs];
  const same = tabs.findIndex((t) => sameTarget(t, target));
  const at = Math.max(focus, 0);
  if (same >= 0) {
    const found = tabs[same];
    if (found && !preview) tabs[same] = { ...found, preview: false };
    const current = tabs[same];
    if (current?.kind === "model" && target.kind === "model") tabs[same] = { ...current, page: target.page ?? current.page, tensor: target.tensor === undefined ? current.tensor : target.tensor };
    panes[at] = { ...pane, tabs, active: same };
    return { ...s, panes, focus: at, paletteOpen: false };
  }
  const seq = s.seq + 1;
  const fresh = freshTab(target, `t${seq}`, preview, view);
  const previous = preview ? tabs.findIndex((t) => t.preview) : -1;
  if (previous >= 0) tabs[previous] = fresh;
  else tabs.push(fresh);
  panes[at] = { ...pane, tabs, active: previous >= 0 ? previous : tabs.length - 1 };
  return { ...s, panes, focus: at, seq, paletteOpen: false };
}

function visit(s: UiState, addr: string): UiState {
  if (s.trail[s.at] === addr) return s;
  const trail = [...s.trail.slice(0, s.at + 1), addr];
  const trailTimes = [...s.trailTimes.slice(0, s.at + 1), Date.now()];
  return { ...s, trail, trailTimes, at: trail.length - 1 };
}

function step(s: UiState, by: number): UiState {
  const at = s.at + by;
  const addr = s.trail[at];
  if (addr === undefined) return s;
  return { ...openIn(s, { kind: "fn", addr }, false), at };
}

function withPane(s: UiState, pi: number, change: (pane: Pane) => Pane): UiState {
  const pane = s.panes[pi];
  if (!pane) return s;
  return { ...s, panes: s.panes.map((p, ix) => (ix === pi ? change(pane) : p)), focus: pi, paletteOpen: false };
}

function selectTab(s: UiState, pi: number, ti: number): UiState {
  return withPane(s, pi, (pane) => {
    const tab = pane.tabs[ti];
    const keep = tab && pane.active === ti && tab.preview;
    return { ...pane, tabs: keep ? pane.tabs.map((t, ix) => (ix === ti ? { ...t, preview: false } : t)) : pane.tabs, active: ti };
  });
}

function closeTab(s: UiState, pi: number, ti: number): UiState {
  const next = withPane(s, pi, (pane) => {
    const tabs = pane.tabs.filter((_, ix) => ix !== ti);
    return { ...pane, tabs, active: Math.min(pane.active, Math.max(0, tabs.length - 1)) };
  });
  return next.panes[pi]?.tabs.length === 0 ? closePane(next, pi) : next;
}

/** Removes a pane; its neighbour takes over its space. */
export function closePane(s: UiState, pi: number): UiState {
  if (!s.panes[pi] || s.panes.length < 2) return s;
  const panes = s.panes.filter((_, ix) => ix !== pi);
  return { ...s, panes, tree: removePane(s.tree, pi), focus: Math.max(0, Math.min(pi > 0 ? pi - 1 : 0, panes.length - 1)), paletteOpen: false };
}

/** Halves a pane and puts `tabs` in a new pane on the given side of it. */
function insertPane(s: UiState, pi: number, tabs: readonly Tab[], side: Side = "right"): UiState {
  if (!s.panes[pi]) return s;
  const panes = [...s.panes.slice(0, pi + 1), { tabs, active: 0 }, ...s.panes.slice(pi + 1)];
  const tree = splitBeside(renumber(s.tree, pi + 1, 1), pi, pi + 1, side);
  return { ...s, panes, tree, focus: pi + 1, paletteOpen: false };
}

export function split(s: UiState, pi: number, side: Side = "right"): UiState {
  const pane = s.panes[pi];
  const current = pane?.tabs[pane.active];
  return insertPane(s, pi, current ? [{ ...current, id: `${current.id}s`, preview: false }] : [], side);
}

/** Moves a tab one pane over, making a new pane on the right when there is none. */
export function moveTab(s: UiState, pi: number, ti: number, by: 1 | -1): UiState {
  const tab = s.panes[pi]?.tabs[ti];
  const to = pi + by;
  if (!tab || to < 0) return s;
  const lone = s.panes[pi]?.tabs.length === 1;
  if (to >= s.panes.length) return lone ? s : { ...closeTab(insertPane(s, pi, [{ ...tab, preview: false }]), pi, ti), focus: to };
  const target = s.panes[to];
  if (!target) return s;
  const found = target.tabs.findIndex((t) => sameTarget(t, tab));
  const tabs = found >= 0 ? target.tabs : [...target.tabs, { ...tab, preview: false }];
  const moved = { ...s, panes: s.panes.map((p, ix) => (ix === to ? { ...target, tabs, active: found >= 0 ? found : tabs.length - 1 } : p)) };
  const closed = closeTab(moved, pi, ti);
  const landed = lone && to > pi ? to - 1 : to;
  return { ...closed, focus: landed };
}

export function resizePanes(s: UiState, path: TreePath, index: number, weights: readonly [number, number]): UiState {
  return { ...s, tree: resizeAt(s.tree, path, index, weights) };
}

function setView(s: UiState, pi: number, view: CodeMode): UiState {
  return withPane(s, pi, (pane) => ({
    ...pane,
    tabs: pane.tabs.map((t, ix) => (ix === pane.active && t.kind === "fn" ? { ...t, view, preview: false } : t)),
  }));
}

function keepTabs(s: UiState, pi: number, keep: (ix: number) => boolean): UiState {
  return withPane(s, pi, (pane) => {
    const tabs = pane.tabs.filter((_, ix) => keep(ix));
    const active = tabs.findIndex((tab) => tab.id === pane.tabs[pane.active]?.id);
    return { ...pane, tabs, active: Math.max(0, active) };
  });
}

/** Opens a target in the pane next to the focused one, splitting the editor first when there is only one. */
/** Puts the function's pseudocode in the pane beside it and links their selections. */
export function besidePseudo(s: UiState, addr: string): UiState {
  if (s.linked) return { ...s, linked: false };
  const opened = openSplit(s, { kind: "fn", addr });
  return { ...setView(opened, opened.focus, "pseudo"), focus: s.focus, linked: true };
}

export function openSplit(s: UiState, target: TabTarget): UiState {
  const view = viewHere(s);
  if (s.panes.length > 1) return openIn({ ...s, focus: s.focus + 1 < s.panes.length ? s.focus + 1 : s.focus - 1 }, target, false, view);
  return openIn(insertPane(s, s.focus, []), target, false, view);
}

function isToolTab(tab: Tab, tool: Tool): boolean {
  return tab.kind === "tool" && tab.tool === tool;
}

/** Closes every editor tab showing `tool`. */
function closeToolTabs(s: UiState, tool: Tool): UiState {
  let next = s;
  for (let pi = next.panes.length - 1; pi >= 0; pi -= 1) {
    const at = next.panes[pi]?.tabs.findIndex((tab) => isToolTab(tab, tool)) ?? -1;
    if (at >= 0) next = closeTab(next, pi, at);
  }
  return next;
}

/** True when `tool` is on screen: the active tool of an open dock, or the active tab of a pane. */
export function showing(s: UiState, tool: Tool): boolean {
  const zone = zoneOf(s.docks, tool);
  if (zone === "right") return s.rightOpen && s.right === tool;
  if (zone === "bottom") return s.bottomOpen && s.bottom === tool;
  return s.panes.some((pane) => { const tab = pane.tabs[pane.active]; return tab !== undefined && isToolTab(tab, tool); });
}

/** Shows `tool` wherever it lives: opens its dock on it, or opens or focuses its editor tab. */
export function reveal(s: UiState, tool: Tool): UiState {
  const zone = zoneOf(s.docks, tool);
  if (zone === "right") return { ...s, rightOpen: true, right: tool };
  if (zone === "bottom") return { ...s, bottomOpen: true, bottom: tool };
  return openIn(s, { kind: "tool", tool }, false);
}

/** Hides `tool` when it is showing, and reveals it otherwise. An editor tab closes. */
export function toggleTool(s: UiState, tool: Tool): UiState {
  if (!showing(s, tool)) return reveal(s, tool);
  const zone = zoneOf(s.docks, tool);
  if (zone === "right") return { ...s, rightOpen: false };
  if (zone === "bottom") return { ...s, bottomOpen: false };
  return closeToolTabs(s, tool);
}

/** Moves `tool` to the end of a dock, or out of the docks into an editor tab when `zone` is null, and shows it there. */
export function moveTool(s: UiState, tool: Tool, zone: Zone | null): UiState {
  const docks = placeTool(s.docks, tool, zone);
  const right = docks.right.includes(s.right) ? s.right : (docks.right[0] ?? s.right);
  const bottom = docks.bottom.includes(s.bottom) ? s.bottom : (docks.bottom[0] ?? s.bottom);
  const moved: UiState = {
    ...(zone === null ? s : closeToolTabs(s, tool)),
    docks, right, bottom,
    rightOpen: s.rightOpen && docks.right.length > 0,
    bottomOpen: s.bottomOpen && docks.bottom.length > 0,
  };
  return reveal(moved, tool);
}

function editMap(map: ReadonlyMap<string, string>, key: string, value: string): ReadonlyMap<string, string> {
  const next = new Map(map);
  if (value.trim()) next.set(key, value);
  else next.delete(key);
  return next;
}

export type Workbench = {
  readonly s: UiState;
  readonly patch: (change: Partial<UiState>) => void;
  readonly reset: (panes: readonly Pane[]) => void;
  readonly open: (target: TabTarget, preview: boolean) => void;
  readonly back: () => void;
  readonly forward: () => void;
  readonly selectTab: (pi: number, ti: number) => void;
  readonly closeTab: (pi: number, ti: number) => void;
  readonly split: (pi: number, side?: Side) => void;
  readonly closePane: (pi: number) => void;
  readonly moveTab: (pi: number, ti: number, by: 1 | -1) => void;
  readonly resizePanes: (path: TreePath, index: number, weights: readonly [number, number]) => void;
  readonly equalizePanes: () => void;
  readonly besidePseudo: (addr: string) => void;
  readonly toggleBreakpoint: (addr: string) => void;
  /** Stops at a breakpoint only when this lldb expression holds; empty stops every time. */
  readonly setBreakpointCondition: (addr: string, condition: string) => void;
  readonly setView: (pi: number, view: CodeMode) => void;
  readonly rename: (addr: string, name: string) => void;
  readonly toggleBookmark: (mark: Bookmark) => void;
  readonly setNote: (addr: string, text: string) => void;
  readonly restore: (project: Project) => void;
  readonly showTabs: (saved: ThreadTabs) => void;
  readonly select: (subject: Subject | null) => void;
  readonly show: (addr: string, view: CodeMode) => void;
  readonly openSplit: (target: TabTarget) => void;
  readonly closeOthers: (pi: number, ti: number) => void;
  readonly closeRight: (pi: number, ti: number) => void;
  readonly setComment: (addr: string, text: string) => void;
  readonly setColor: (addr: string, color: string) => void;
  readonly reread: () => void;
  /** A short confirmation at the bottom of the editor, with Undo when the change can be reversed. */
  readonly notify: (text: string, undo: (() => void) | null) => void;
  readonly reveal: (tool: Tool) => void;
  readonly toggleTool: (tool: Tool) => void;
  readonly moveTool: (tool: Tool, zone: Zone | null) => void;
  readonly orderDock: (zone: Zone, order: readonly Tool[]) => void;
};

const synced = new WeakSet<object>();

/** True for a value the window took from the project as is; the autosave never writes those back over newer changes. */
export function fromProject(value: object): boolean {
  return synced.has(value);
}

export function useWorkbenchState(panes: readonly Pane[], docks: Docks): Workbench {
  const [s, setS] = useState<UiState>(() => initialState(panes, undefined, docks));
  const patch = (change: Partial<UiState>): void => setS((prev) => ({ ...prev, ...change }));
  return {
    s,
    patch,
    reset: (next: readonly Pane[]) => setS((prev) => ({ ...initialState(next, undefined, prev.docks), paletteOpen: prev.paletteOpen, paletteQuery: prev.paletteQuery, navClosed: prev.navClosed })),
    open: (target: TabTarget, preview: boolean) => setS((prev) => {
      const opened = openIn(prev, target, preview);
      return target.kind === "fn" ? visit(opened, target.addr) : opened;
    }),
    back: () => setS((prev) => step(prev, -1)),
    forward: () => setS((prev) => step(prev, 1)),
    selectTab: (pi: number, ti: number) => setS((prev) => selectTab(prev, pi, ti)),
    closeTab: (pi: number, ti: number) => setS((prev) => closeTab(prev, pi, ti)),
    split: (pi: number, side?: Side) => setS((prev) => split(prev, pi, side)),
    closePane: (pi: number) => setS((prev) => closePane(prev, pi)),
    moveTab: (pi: number, ti: number, by: 1 | -1) => setS((prev) => moveTab(prev, pi, ti, by)),
    resizePanes: (path: TreePath, index: number, weights: readonly [number, number]) => setS((prev) => resizePanes(prev, path, index, weights)),
    toggleBreakpoint: (addr: string) => setS((prev) => ({ ...prev, breakpoints: editMap(prev.breakpoints, addr, prev.breakpoints.has(addr) ? "" : "on") })),
    setBreakpointCondition: (addr: string, condition: string) => setS((prev) => (prev.breakpoints.has(addr) ? { ...prev, breakpoints: editMap(prev.breakpoints, addr, condition.trim() || "on") } : prev)),
    besidePseudo: (addr: string) => setS((prev) => besidePseudo(prev, addr)),
    equalizePanes: () => setS((prev) => ({ ...prev, tree: equalize(prev.tree) })),
    setView: (pi: number, view: CodeMode) => setS((prev) => setView(prev, pi, view)),
    rename: (addr: string, name: string) => setS((prev) => ({ ...prev, names: editMap(prev.names, addr, name) })),
    toggleBookmark: (mark: Bookmark) => setS((prev) => ({
      ...prev,
      bookmarks: prev.bookmarks.some((b) => b.addr === mark.addr) ? prev.bookmarks.filter((b) => b.addr !== mark.addr) : [...prev.bookmarks, mark],
    })),
    setNote: (addr: string, text: string) => setS((prev) => {
      const notes = new Map(prev.notes);
      if (text.trim()) notes.set(addr, text);
      else notes.delete(addr);
      return { ...prev, notes };
    }),
    restore: (project: Project) => {
      for (const value of [project.names, project.bookmarks, project.notes, project.comments, project.colors, project.groups, project.breakpoints]) synced.add(value);
      setS((prev) => ({ ...prev, names: project.names, bookmarks: project.bookmarks, notes: project.notes, comments: project.comments, colors: project.colors, groups: project.groups, types: project.types, formats: project.formats, breakpoints: project.breakpoints }));
    },
    showTabs: (saved: ThreadTabs) => setS((prev) => {
      let seq = prev.seq;
      const panes = saved.panes.map((pane) => ({ ...pane, tabs: pane.tabs.map((tab) => ({ ...tab, id: `t${++seq}` })) }));
      return { ...prev, panes, tree: saved.tree, focus: saved.focus, seq, paletteOpen: false };
    }),
    select: (subject: Subject | null) => setS((prev) => ({ ...prev, selected: subject })),
    show: (addr: string, view: CodeMode) => setS((prev) => {
      const opened = visit(openIn(prev, { kind: "fn", addr }, false), addr);
      return setView(opened, opened.focus, view);
    }),
    openSplit: (target: TabTarget) => setS((prev) => openSplit(prev, target)),
    closeOthers: (pi: number, ti: number) => setS((prev) => keepTabs(prev, pi, (ix) => ix === ti)),
    closeRight: (pi: number, ti: number) => setS((prev) => keepTabs(prev, pi, (ix) => ix <= ti)),
    setComment: (addr: string, text: string) => setS((prev) => ({ ...prev, comments: editMap(prev.comments, addr, text) })),
    setColor: (addr: string, color: string) => setS((prev) => ({ ...prev, colors: editMap(prev.colors, addr, color) })),
    reread: () => setS((prev) => ({ ...prev, revision: prev.revision + 1 })),
    notify: (text: string, undo: (() => void) | null) => setS((prev) => ({ ...prev, toast: { text, undo, seq: (prev.toast?.seq ?? 0) + 1 } })),
    reveal: (tool: Tool) => setS((prev) => reveal(prev, tool)),
    toggleTool: (tool: Tool) => setS((prev) => toggleTool(prev, tool)),
    moveTool: (tool: Tool, zone: Zone | null) => setS((prev) => moveTool(prev, tool, zone)),
    orderDock: (zone: Zone, order: readonly Tool[]) => setS((prev) => ({ ...prev, docks: { ...prev.docks, [zone]: order } })),
  };
}
