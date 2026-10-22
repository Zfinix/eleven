import { type PlainId, t } from "../../i18n";
import type { Fn } from "../model";
import type { FunctionModule, FunctionModules } from "./functionModules";

export type FnSort = "files" | "modules" | "address" | "name";

export type FnShow = "all" | "yours" | "renamed" | "imports";

/** A group is an origin heading like Your code or Libraries; a folder is a package or namespace; a file is a decompiled source file; a class is a C++ or Objective-C class. */
export type TreeKind = "group" | "folder" | "file" | "class";

export type FnRow =
  | { readonly kind: "node"; readonly path: string; readonly name: string; readonly tree: TreeKind; readonly ext: string; readonly depth: number; readonly count: number; readonly open: boolean }
  | { readonly kind: "fn"; readonly fn: Fn; readonly label: string; readonly depth: number; readonly where?: string; readonly module?: FunctionModule };

/** Where a function comes from: the program's own code, or something it was built with. */
export type Origin = "yours" | "libraries" | "imports" | "runtime";

const ORIGINS: readonly Origin[] = ["yours", "libraries", "imports", "runtime"];

export const ORIGIN_LABEL: Readonly<Record<Origin, PlainId>> = { yours: "workbench.side.origin.yours", libraries: "workbench.side.origin.libraries", imports: "workbench.side.origin.imports", runtime: "workbench.side.origin.runtime" };

/** Packages that ship inside apps rather than being written for them: Android, Kotlin, Google, Facebook, Square and the usual SDKs. */
const LIBRARY_PACKAGE = /^(?:android|androidx|kotlin|kotlinx|java|javax|dalvik|sun|j\$|_COROUTINE|com[./](?:google|facebook|squareup|android|fasterxml|bumptech|airbnb|swmansion|th3rdwave|reactnativecommunity)|okhttp3|okio|retrofit2|io[./](?:reactivex|sentry|ktor|grpc|opentelemetry)|rx|dagger|org[./](?:jetbrains|intellij|apache|json|xmlpull|chromium|reactivestreams)|bolts|coil|app[./]notifee|expo|host[./]exp)(?:[./$]|$)/;

/** Code the compiler or toolchain adds to every program: Swift and Objective-C runtime glue, C runtime startup, stack checks. */
const RUNTIME_NAME = /^(?:_?\$s|_?\$S|_+swift|swift_|_?objc_|outlined |type metadata|protocol witness|reabstraction thunk|thunk for|partial apply|merged |_+cxa_|_+gxx_|_+clang_|_+(?:scrt|acrt|vcrt|security_|report_gsfailure|GSHandler|chkstk|guard_|CRT|initterm|local_stdio|isa_available)|_?(?:start|_init|_fini|frame_dummy|register_tm_clones|deregister_tm_clones|__do_global_dtors_aux|__libc_csu_init|__libc_csu_fini|mainCRTStartup|wmainCRTStartup|WinMainCRTStartup|wWinMainCRTStartup|pre_c_init|pre_cpp_init|DllMainCRTStartup)$)/;

/** A function no symbol names, called by the address the decompiler gave it. */
const UNNAMED = /^(?:thunk_)?(?:FUN|sub|fcn|LAB)_[0-9a-fA-F]+$/;

export function originOf(fn: Fn, name: string): Origin {
  if (fn.file) return LIBRARY_PACKAGE.test(fn.file) ? "libraries" : "yours";
  if (fn.kind === "thunk") return "imports";
  return RUNTIME_NAME.test(name) ? "runtime" : "yours";
}

/** The source file a file row stands for: its tree path without the module or origin heading (`#yours/`) or the root's leading separator. */
export function rowFile(path: string): string {
  return path.replace(/^#module\/[^/]+\//, "").replace(/^#\w+\//, "").replace(/^\./, "");
}

/** A folder starts folded unless it's alone at its level; `flipped` holds the ones the user clicked away from that start. */
function openAt(path: string, flipped: ReadonlySet<string>, byDefault: boolean): boolean {
  return byDefault !== flipped.has(path);
}

export const SORT_LABEL: Readonly<Record<FnSort, string>> = { files: "By file", modules: "By module", address: "By address", name: "A–Z" };

export function nextSort(sort: FnSort): FnSort {
  switch (sort) {
    case "files":
      return "modules";
    case "modules":
      return "address";
    case "address":
      return "name";
    case "name":
      return "files";
    default: {
      const unhandled: never = sort;
      return unhandled;
    }
  }
}

/** The class or namespace a function belongs to, and its own name: `A::b`, `-[A b]` and `+[A b]` all split. */
export function splitOwner(name: string): { readonly owner: string; readonly member: string } | null {
  const objc = /^[-+]\[(\S+) (.+)\]$/.exec(name);
  if (objc?.[1] && objc[2]) return { owner: objc[1], member: objc[2] };
  const cut = name.lastIndexOf("::");
  if (cut <= 0 || cut + 2 >= name.length) return null;
  return { owner: name.slice(0, cut), member: name.slice(cut + 2) };
}

const byName = (nameOf: (addr: string) => string) => (a: Fn, b: Fn): number => nameOf(a.addr).localeCompare(nameOf(b.addr));

type Placed = { readonly segments: readonly string[]; readonly leaf: TreeKind; readonly sep: string; readonly member: string };

/** Where a function sits in the tree: under its source file when the engine knows it, else under its namespaces and class. */
function place(fn: Fn, name: string): Placed | null {
  if (fn.file) {
    const segments = fn.file.split("/").filter(Boolean);
    const prefix = fn.file.replace(/\.[^./]+$/, "").replaceAll("/", ".");
    const member = name.startsWith(prefix) && name.length > prefix.length ? name.slice(prefix.length).replace(/^[.$]/, "") : name;
    return { segments, leaf: "file", sep: ".", member };
  }
  if (fn.kind !== "function") return null;
  const split = splitOwner(name);
  if (!split) return null;
  return { segments: split.owner.split("::").filter(Boolean), leaf: "class", sep: "::", member: split.member };
}

type TreeNode = {
  readonly name: string;
  readonly path: string;
  readonly sep: string;
  tree: TreeKind;
  count: number;
  readonly children: Map<string, TreeNode>;
  readonly fns: { readonly fn: Fn; readonly member: string }[];
};

function child(parent: TreeNode, name: string, sep: string): TreeNode {
  const found = parent.children.get(name);
  if (found) return found;
  const made: TreeNode = { name, path: parent.path ? `${parent.path}/${name}` : `${sep}${name}`, sep, tree: "folder", count: 0, children: new Map(), fns: [] };
  parent.children.set(name, made);
  return made;
}

const FOLDERS_FIRST: Readonly<Record<TreeKind, number>> = { group: 0, folder: 0, class: 1, file: 1 };

/** A folder holding only one other folder shows as one row, `com.google.android`, the way editors compact them. */
function compact(node: TreeNode): { readonly node: TreeNode; readonly name: string } {
  let at = node;
  let name = node.name;
  for (;;) {
    const only = at.children.size === 1 ? [...at.children.values()][0] : undefined;
    if (at.tree !== "folder" || at.fns.length > 0 || !only || only.tree !== "folder") return { node: at, name };
    at = only;
    name = `${name}${at.sep}${at.name}`;
  }
}

function emit(node: TreeNode, depth: number, flipped: ReadonlySet<string>, out: FnRow[], alone: boolean): void {
  const { node: shown, name } = compact(node);
  const open = openAt(shown.path, flipped, alone);
  const ext = shown.tree === "file" ? (shown.name.split(".").pop() ?? "").toLowerCase() : "";
  out.push({ kind: "node", path: shown.path, name, tree: shown.tree, ext, depth, count: shown.count, open });
  if (!open) return;
  const kids = [...shown.children.values()].sort((a, b) => FOLDERS_FIRST[a.tree] - FOLDERS_FIRST[b.tree] || a.name.localeCompare(b.name));
  for (const kid of kids) emit(kid, depth + 1, flipped, out, kids.length === 1 && shown.fns.length === 0);
  for (const { fn, member } of [...shown.fns].sort((a, b) => a.member.localeCompare(b.member))) out.push({ kind: "fn", fn, label: member, depth: depth + 1 });
}

/** One origin's functions as a tree: packages and source files, or namespaces and classes, then the rest, with unnamed ones folded together. */
function treeRows(fns: readonly Fn[], nameOf: (addr: string) => string, flipped: ReadonlySet<string>, prefix: string, depth: number, bare: readonly string[] = []): readonly FnRow[] {
  const root: TreeNode = { name: "", path: prefix, sep: "", tree: "folder", count: 0, children: new Map(), fns: [] };
  for (const file of bare) {
    let at = root;
    const segments = file.split("/").filter(Boolean);
    segments.forEach((segment, ix) => {
      at = child(at, segment, ".");
      if (ix === segments.length - 1) at.tree = "file";
    });
  }
  const loose: Fn[] = [];
  const unnamed: Fn[] = [];
  for (const fn of fns) {
    const name = nameOf(fn.addr);
    const placed = place(fn, name);
    if (!placed) {
      (UNNAMED.test(name) ? unnamed : loose).push(fn);
      continue;
    }
    let at = root;
    placed.segments.forEach((segment, ix) => {
      at = child(at, segment, placed.sep);
      at.count++;
      if (ix === placed.segments.length - 1) at.tree = placed.leaf;
    });
    at.fns.push({ fn, member: placed.member });
  }
  const out: FnRow[] = [];
  const tops = [...root.children.values()].sort((a, b) => FOLDERS_FIRST[a.tree] - FOLDERS_FIRST[b.tree] || a.name.localeCompare(b.name));
  const alone = tops.length + loose.length + (unnamed.length > 0 ? 1 : 0) === 1;
  for (const top of tops) emit(top, depth, flipped, out, alone);
  const rank = (fn: Fn): number => (fn.kind === "thunk" ? 1 : 0);
  for (const fn of [...loose].sort((a, b) => rank(a) - rank(b) || byName(nameOf)(a, b))) out.push({ kind: "fn", fn, label: nameOf(fn.addr), depth });
  if (unnamed.length > 0) {
    const path = `${prefix}/#unnamed`;
    const open = openAt(path, flipped, alone);
    out.push({ kind: "node", path, name: t("workbench.side.unnamed"), tree: "folder", ext: "", depth, count: unnamed.length, open });
    if (open) for (const fn of [...unnamed].sort((a, b) => (BigInt(a.addr) < BigInt(b.addr) ? -1 : 1))) out.push({ kind: "fn", fn, label: nameOf(fn.addr), depth: depth + 1 });
  }
  return out;
}

/** Your code first, then libraries, imports and runtime code, each under its own folded heading; Your code starts open when it's the only way in. */
function fileRows(fns: readonly Fn[], nameOf: (addr: string) => string, flipped: ReadonlySet<string>, yoursOpen: boolean, bare: readonly string[]): readonly FnRow[] {
  const byOrigin = new Map<Origin, Fn[]>();
  for (const fn of fns) {
    const origin = originOf(fn, nameOf(fn.addr));
    const list = byOrigin.get(origin) ?? [];
    list.push(fn);
    byOrigin.set(origin, list);
  }
  const bareBy = new Map<Origin, string[]>();
  for (const file of bare) {
    const origin: Origin = LIBRARY_PACKAGE.test(file) ? "libraries" : "yours";
    bareBy.set(origin, [...(bareBy.get(origin) ?? []), file]);
  }
  const origins = ORIGINS.filter((origin) => byOrigin.has(origin) || bareBy.has(origin));
  if (origins.length <= 1) return treeRows(fns, nameOf, flipped, "", 0, bare);
  return origins.flatMap((origin): readonly FnRow[] => {
    const list = byOrigin.get(origin) ?? [];
    const path = `#${origin}`;
    const open = openAt(path, flipped, yoursOpen && origin === "yours");
    const head: FnRow = { kind: "node", path, name: t(ORIGIN_LABEL[origin]), tree: "group", ext: "", depth: 0, count: list.length, open };
    return open ? [head, ...treeRows(list, nameOf, flipped, path, 0, bareBy.get(origin) ?? [])] : [head];
  });
}

/** Where a search match lives, so a flat result list still says which package or class, and whether it's your code. */
function whereOf(fn: Fn, name: string): string {
  const origin = originOf(fn, name);
  const owner = fn.file ? fn.file.replace(/\/[^/]*$/, "").replaceAll("/", ".") : (splitOwner(name)?.owner ?? "");
  const label = t(ORIGIN_LABEL[origin]);
  return owner ? `${owner} · ${label.toLowerCase()}` : label;
}

const IMPORTS = "Imports";
const UNMAPPED = "Unmapped";

function moduleOf(fn: Fn, modules: FunctionModules): string {
  return modules.get(fn.addr)?.name ?? (fn.kind === "thunk" ? IMPORTS : UNMAPPED);
}

/** A module's heading as shown: the two catch-all groups read in the interface language, real module names as they are. */
function moduleLabel(name: string): string {
  if (name === IMPORTS) return t("workbench.side.module.imports");
  return name === UNMAPPED ? t("workbench.side.module.unmapped") : name;
}

/** Where a search match lives when grouped by module: the module, whether it's a guess, then its file or owner. */
function moduleWhere(fn: Fn, name: string, modules: FunctionModules): string {
  const guessed = modules.get(fn.addr)?.evidence === "layout" ? ` · ${t("workbench.side.guessed")}` : "";
  const owner = fn.file ?? splitOwner(name)?.owner;
  return `${moduleLabel(moduleOf(fn, modules))}${guessed}${owner ? ` · ${owner}` : ""}`;
}

/** One folded heading per module, A to Z with Imports and Unmapped last, each holding the usual file and class tree. */
function moduleRows(fns: readonly Fn[], nameOf: (addr: string) => string, flipped: ReadonlySet<string>, modules: FunctionModules): readonly FnRow[] {
  const groups = new Map<string, Fn[]>();
  for (const fn of fns) {
    const name = moduleOf(fn, modules);
    groups.set(name, [...(groups.get(name) ?? []), fn]);
  }
  const last = (name: string): number => (name === IMPORTS ? 1 : name === UNMAPPED ? 2 : 0);
  const ordered = [...groups.entries()].sort(([a], [b]) => last(a) - last(b) || a.localeCompare(b));
  return ordered.flatMap(([name, list]) => {
    const path = `#module/${name}`;
    const open = openAt(path, flipped, false);
    const head: FnRow = { kind: "node", path, name: moduleLabel(name), tree: "group", ext: "", depth: 0, count: list.length, open };
    if (!open) return [head];
    return [head, ...treeRows(list, nameOf, flipped, path, 0).map((row): FnRow => {
      const module = row.kind === "fn" ? modules.get(row.fn.addr) : undefined;
      return row.kind === "fn" && module ? { ...row, module } : row;
    })];
  });
}

/** The function list as the sidebar draws it: filtered, then as a file or module tree, or sorted flat. */
export function functionRows(fns: readonly Fn[], options: {
  readonly nameOf: (addr: string) => string;
  readonly renamed: ReadonlySet<string>;
  readonly query: string;
  readonly show: FnShow;
  readonly sort: FnSort;
  /** Which module each function belongs to, for grouping by module. */
  readonly modules?: FunctionModules;
  /** Groups and folders the user clicked away from how they start. */
  readonly flipped: ReadonlySet<string>;
  /** Your code starts open, for a binary with no source files to start from. */
  readonly yoursOpen?: boolean;
  /** Decompiled files with no functions of their own (Android R classes, interfaces, constants), listed under their package. */
  readonly bareFiles?: readonly string[];
}): readonly FnRow[] {
  const { nameOf, renamed, query, show, sort, flipped, yoursOpen = false, bareFiles = [] } = options;
  const modules = sort === "modules" ? (options.modules ?? new Map<string, FunctionModule>()) : undefined;
  const needle = query.trim().toLowerCase();
  const shown = fns.filter((fn) => {
    if (show === "renamed" && !renamed.has(fn.addr)) return false;
    if (show === "imports" && fn.kind !== "thunk") return false;
    if (show === "yours" && originOf(fn, nameOf(fn.addr)) !== "yours") return false;
    return !needle || nameOf(fn.addr).toLowerCase().includes(needle) || fn.addr.includes(needle) || (fn.file?.toLowerCase().includes(needle) ?? false) || (modules ? moduleOf(fn, modules).toLowerCase().includes(needle) : false);
  });
  const flat = (list: readonly Fn[]): readonly FnRow[] => list.map((fn) => ({ kind: "fn", fn, label: nameOf(fn.addr), depth: 0 }));
  if (sort === "address") return flat([...shown].sort((a, b) => (BigInt(a.addr) < BigInt(b.addr) ? -1 : 1)));
  if (sort === "name") return flat([...shown].sort(byName(nameOf)));
  if (needle && modules) {
    return [...shown].sort((a, b) => moduleOf(a, modules).localeCompare(moduleOf(b, modules)) || byName(nameOf)(a, b)).map((fn) => ({ kind: "fn", fn, label: nameOf(fn.addr), depth: 0, where: moduleWhere(fn, nameOf(fn.addr), modules) }));
  }
  if (needle) {
    const yoursFirst = (fn: Fn): number => (originOf(fn, nameOf(fn.addr)) === "yours" ? 0 : 1);
    return [...shown].sort((a, b) => yoursFirst(a) - yoursFirst(b) || byName(nameOf)(a, b)).map((fn) => ({ kind: "fn", fn, label: nameOf(fn.addr), depth: 0, where: whereOf(fn, nameOf(fn.addr)) }));
  }
  if (modules) return moduleRows(shown, nameOf, flipped, modules);
  const bare = show === "all" ? bareFiles : show === "yours" ? bareFiles.filter((file) => !LIBRARY_PACKAGE.test(file)) : [];
  return fileRows(shown, nameOf, flipped, yoursOpen, bare);
}

export type SourceNode = {
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly folder: boolean;
  readonly ext: string;
  /** The path as the binary spells it; empty for folders. */
  readonly full: string;
};

const SOURCE = /(?:^|[\s"'(])((?:\/|[A-Za-z]:\\|\.{0,2}\/)?(?:[\w.@+-]+\/)+[\w.@+-]+\.(?:swift|mm|m|c|cc|cpp|cxx|h|hh|hpp|metal|rs|go|kt|java))(?=$|[\s"':),])/;

/** Source file paths that compilers leave in a binary's strings (asserts, logging, #file), deduplicated. */
export function sourcePaths(strings: readonly string[]): readonly string[] {
  const found = new Set<string>();
  for (const text of strings) {
    const match = SOURCE.exec(text);
    if (match?.[1]) found.add(match[1].replace(/\\/g, "/"));
  }
  return [...found];
}

function commonDir(paths: readonly (readonly string[])[]): number {
  const first = paths[0];
  if (!first) return 0;
  let depth = 0;
  while (depth < first.length - 1 && paths.every((parts) => parts.length - 1 > depth && parts[depth] === first[depth])) depth++;
  return depth;
}

/** The paths as a tree, the shared build-machine prefix dropped, folders before files, open folders expanded. */
export function sourceTree(paths: readonly string[], closed: ReadonlySet<string>): readonly SourceNode[] {
  const split = paths.map((path) => path.split("/").filter(Boolean));
  const keep = Math.max(0, commonDir(split) - 1);
  const files = split.map((parts) => parts.slice(keep));
  const nodes = new Map<string, SourceNode>();
  files.forEach((parts, ix) => {
    parts.forEach((name, depth) => {
      const path = parts.slice(0, depth + 1).join("/");
      const folder = depth < parts.length - 1;
      if (!nodes.has(path)) nodes.set(path, { path, name, depth, folder, ext: folder ? "" : (name.split(".").pop() ?? "").toLowerCase(), full: folder ? "" : (paths[ix] ?? "") });
    });
  });
  const sorted = [...nodes.values()].sort((a, b) => {
    const pa = a.path.split("/");
    const pb = b.path.split("/");
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
      if (pa[i] === pb[i]) continue;
      const aFolder = i < pa.length - 1 || a.folder;
      const bFolder = i < pb.length - 1 || b.folder;
      if (aFolder !== bFolder) return aFolder ? -1 : 1;
      return (pa[i] ?? "").localeCompare(pb[i] ?? "");
    }
    return pa.length - pb.length;
  });
  return sorted.filter((node) => ![...closed].some((dir) => node.path.startsWith(`${dir}/`)));
}

const LOGOS: Readonly<Record<string, string>> = {
  swift: "lang-swift", m: "lang-objc", mm: "lang-objcpp", c: "lang-c", cc: "lang-cpp", cpp: "lang-cpp", cxx: "lang-cpp",
  h: "lang-h", hh: "lang-hpp", hpp: "lang-hpp", metal: "lang-metal", rs: "lang-rust", go: "lang-go", kt: "lang-kotlin", java: "lang-java", xml: "lang-xml", json: "lang-json",
};

export function logoFor(ext: string): string {
  return LOGOS[ext] ?? "lang-plist";
}
