import { lazyRows } from "./lazyRows";
import type { SourceNode } from "./model";

type ResourcePath = { readonly normalized: string; readonly full: string };

type ResourceGroup = { readonly node: SourceNode; readonly paths: ResourcePath[]; readonly childOffset: number };

export type ResourceEntry = { readonly node: SourceNode; readonly children: () => readonly ResourceEntry[] };

export type ResourceRow = { readonly node: SourceNode; readonly open: boolean };

/** Where the last directory every path shares starts, so the tree drops the build-machine prefix the way sourceTree does. */
function rootOffset(paths: readonly ResourcePath[]): number {
  const first = paths[0]?.normalized;
  if (!first) return 0;
  let shared = first.lastIndexOf("/") + 1;
  for (const path of paths) {
    while (shared > 0 && !path.normalized.startsWith(first.slice(0, shared))) shared = first.lastIndexOf("/", shared - 2) + 1;
  }
  return shared > 0 ? first.lastIndexOf("/", shared - 2) + 1 : 0;
}

function groupLevel(paths: readonly ResourcePath[], offset: number, parent: string, depth: number): readonly ResourceGroup[] {
  const groups = new Map<string, ResourceGroup>();
  for (const path of paths) {
    const cut = path.normalized.indexOf("/", offset);
    const folder = cut >= 0;
    const name = path.normalized.slice(offset, folder ? cut : undefined);
    let group = groups.get(name);
    if (!group) {
      const node: SourceNode = { path: parent ? `${parent}/${name}` : name, name, depth, folder, ext: folder ? "" : (name.split(".").pop() ?? "").toLowerCase(), full: folder ? "" : path.full };
      group = { node, paths: [], childOffset: cut + 1 };
      groups.set(name, group);
    }
    if (folder) group.paths.push(path);
  }
  return [...groups.values()].sort((a, b) => Number(b.node.folder) - Number(a.node.folder) || a.node.name.localeCompare(b.node.name));
}

function level(paths: readonly ResourcePath[], offset: number, parent: string, depth: number): readonly ResourceEntry[] {
  return groupLevel(paths, offset, parent, depth).map((group) => ({
    node: group.node,
    children: lazyRows(() => level(group.paths, group.childOffset, group.node.path, depth + 1)),
  }));
}

/** The top level of the resource tree; a folder's own rows are built the first time it opens. */
export function indexResources(paths: readonly string[]): readonly ResourceEntry[] {
  const normalized: ResourcePath[] = [];
  for (const full of paths) {
    const path = full.replace(/\/{2,}/g, "/").replace(/^\/|\/$/g, "");
    if (path) normalized.push({ normalized: path, full });
  }
  return level(normalized, rootOffset(normalized), "", 0);
}

/** The rows on screen: every entry down to the first closed folder. A folder alone at its level starts open. */
export function visibleResources(entries: readonly ResourceEntry[], isOpen: (key: string, byDefault: boolean) => boolean): readonly ResourceRow[] {
  const rows: ResourceRow[] = [];
  const append = (siblings: readonly ResourceEntry[]): void => {
    for (const entry of siblings) {
      const open = entry.node.folder && isOpen(`res:${entry.node.path}`, siblings.length === 1);
      rows.push({ node: entry.node, open });
      if (open) append(entry.children());
    }
  };
  append(entries);
  return rows;
}
