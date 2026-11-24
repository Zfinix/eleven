import type { Project, ProjectEntry } from "./project";

/** One mark in another project that matches a search: where it is and what it says. */
export type ProjectHit = { readonly project: ProjectEntry; readonly addr: string; readonly kind: "name" | "note" | "comment" | "bookmark"; readonly text: string };

const MAX_HITS = 8;

/** Names, notes, comments and bookmarks in other projects that contain `query`, case blind, newest project first. */
export function searchProjects(query: string, projects: readonly ProjectEntry[], load: (id: string) => Project, skip: string | null, limit = MAX_HITS): readonly ProjectHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 3) return [];
  const hits: ProjectHit[] = [];
  for (const project of projects) {
    if (project.id === skip) continue;
    const marks = load(project.id);
    const found = [
      ...[...marks.names].map(([addr, text]) => ({ addr, kind: "name" as const, text })),
      ...marks.bookmarks.map((mark) => ({ addr: mark.addr, kind: "bookmark" as const, text: mark.label })),
      ...[...marks.notes].map(([addr, text]) => ({ addr, kind: "note" as const, text })),
      ...[...marks.comments].map(([addr, text]) => ({ addr, kind: "comment" as const, text })),
    ].filter((mark) => mark.text.toLowerCase().includes(needle));
    for (const mark of found) {
      hits.push({ project, ...mark });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}
