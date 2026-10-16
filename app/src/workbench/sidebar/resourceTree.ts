import { lazyRows } from "./lazyRows";
import type { SourceNode } from "./model";

type ResourcePath = {
  readonly normalized: string;
  readonly full: string;
};

type ResourceEntry = {
  readonly node: SourceNode;
  readonly children: () => readonly ResourceEntry[];
};

type ResourceGroup = {
  readonly node: SourceNode;
  readonly paths: ResourcePath[];
  readonly childOffset: number;
};

export type ResourceRow = {
  readonly node: SourceNode;
  readonly open: boolean;
};

/** Keep the last shared directory, matching the source browser's project-root labels. */
function rootOffset(paths: readonly ResourcePath[]): number {
  const first = paths[0]?.normalized;
  if (!first) return 0;

  let sharedEnd = first.lastIndexOf("/") + 1;
  for (const path of paths) {
    while (sharedEnd > 0 && !path.normalized.startsWith(first.slice(0, sharedEnd))) {
      sharedEnd = first.lastIndexOf("/", sharedEnd - 2) + 1;
    }
  }

  return sharedEnd > 0 ? first.lastIndexOf("/", sharedEnd - 2) + 1 : 0;
}

function groupLevel(
  paths: readonly ResourcePath[],
  offset: number,
  parent: string,
  depth: number,
): readonly ResourceGroup[] {
  const groups = new Map<string, ResourceGroup>();

  for (const path of paths) {
    const separator = path.normalized.indexOf("/", offset);
    const folder = separator >= 0;
    const name = path.normalized.slice(offset, folder ? separator : undefined);
    let group = groups.get(name);

    if (!group) {
      group = {
        node: {
          path: parent ? `${parent}/${name}` : name,
          name,
          depth,
          folder,
          ext: folder ? "" : (name.split(".").pop() ?? "").toLowerCase(),
          full: folder ? "" : path.full,
        },
        paths: [],
        childOffset: separator + 1,
      };
      groups.set(name, group);
    }

    if (folder) group.paths.push(path);
  }

  return [...groups.values()].sort(
    (a, b) => Number(b.node.folder) - Number(a.node.folder) || a.node.name.localeCompare(b.node.name),
  );
}

function prepareLevel(
  paths: readonly ResourcePath[],
  offset: number,
  parent: string,
  depth: number,
): readonly ResourceEntry[] {
  return groupLevel(paths, offset, parent, depth).map((group) => ({
    node: group.node,
    children: lazyRows(() => prepareLevel(group.paths, group.childOffset, group.node.path, depth + 1)),
  }));
}

/** Index only the root level. Closed folders retain paths, without allocating their hidden nodes. */
export function indexResources(paths: readonly string[]): readonly ResourceEntry[] {
  const normalized: ResourcePath[] = [];
  for (const full of paths) {
    const path = full.replace(/\/{2,}/g, "/").replace(/^\/|\/$/g, "");
    if (path) normalized.push({ normalized: path, full });
  }

  return prepareLevel(normalized, rootOffset(normalized), "", 0);
}

/** Materialize a folder once, when expanded, and reuse its rows when reopened. */
export function visibleResources(
  entries: readonly ResourceEntry[],
  isOpen: (key: string, byDefault: boolean) => boolean,
): readonly ResourceRow[] {
  const rows: ResourceRow[] = [];

  const append = (siblings: readonly ResourceEntry[]): void => {
    for (const entry of siblings) {
      const { node } = entry;
      const open = node.folder && isOpen(`res:${node.path}`, siblings.length === 1);
      rows.push({ node, open });
      if (open) append(entry.children());
    }
  };

  append(entries);
  return rows;
}
