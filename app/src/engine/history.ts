import { type Author, canUndo, type Edit, type EditField, evidenceAddress, unbacked, newEdit, redoTarget, setValue, stamp, undoTarget, valueOf } from "./edits";
import { loadProject, type Project, updateProject } from "./project";

function replace(project: Project, id: string, change: (edit: Edit) => Edit): Project {
  return { ...project, edits: project.edits.map((edit) => (edit.id === id ? change(edit) : edit)) };
}

function find(project: Project, editId: string): Edit {
  const edit = project.edits.find((entry) => entry.id === editId);
  if (!edit) throw new Error("That change is no longer in the history.");
  return edit;
}

/** Records an agent's change as a suggestion; nothing changes until it is accepted. */
export function propose(id: string, field: EditField, key: string, after: string | null, by: Author, reason?: string, evidence?: readonly string[]): Edit {
  const project = loadProject(id);
  const edit = newEdit({ field, key, before: valueOf(project, field, key), after }, by, "proposed", stamp(), reason, evidence);
  updateProject(id, (current) => ({ ...current, edits: [...current.edits.filter((old) => !(old.status === "proposed" && old.field === field && old.key === key)), edit] }), null);
  return edit;
}

export function pending(project: Project): readonly Edit[] {
  return project.edits.filter((edit) => edit.status === "proposed");
}

export function accept(id: string, editIds: readonly string[]): void {
  const now = stamp();
  updateProject(id, (project) => editIds.reduce((next, editId) => {
    const edit = find(next, editId);
    if (edit.status !== "proposed") return next;
    const before = valueOf(next, edit.field, edit.key);
    return replace(setValue(next, edit.field, edit.key, edit.after), editId, (old) => ({ ...old, before, status: "applied", changedAt: now }));
  }, project), null);
}

export function decline(id: string, editIds: readonly string[]): void {
  const now = stamp();
  updateProject(id, (project) => editIds.reduce((next, editId) => replace(next, editId, (old) => (old.status === "proposed" ? { ...old, status: "rejected", changedAt: now } : old)), project), null);
}

/** Takes back one edit, or the newest one. Returns what was undone, or null when there is nothing to undo. */
export function undo(id: string, editId?: string): Edit | null {
  const project = loadProject(id);
  const edit = editId ? find(project, editId) : undoTarget(project.edits);
  if (!edit) return null;
  if (!canUndo(project, edit)) throw new Error("That value was changed again later. Undo the later change first.");
  updateProject(id, (current) => replace(setValue(current, edit.field, edit.key, edit.before), edit.id, (old) => ({ ...old, status: "undone", changedAt: stamp() })), null);
  return edit;
}

/** Puts back an undone edit, or the most recently undone one. */
export function redo(id: string, editId?: string): Edit | null {
  const project = loadProject(id);
  const edit = editId ? find(project, editId) : redoTarget(project.edits);
  if (!edit || edit.status !== "undone") return null;
  if (valueOf(project, edit.field, edit.key) !== edit.before) throw new Error("That value was changed again since. It can't be put back.");
  updateProject(id, (current) => replace(setValue(current, edit.field, edit.key, edit.after), edit.id, (old) => ({ ...old, status: "applied", changedAt: stamp() })), null);
  return edit;
}

function mentions(text: string | null, word: string): boolean {
  if (!text || word.length < 3) return false;
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
}

/**
 * Later edits still standing that lean on this one: they cite its address as
 * evidence, or use the name or label it gave. Taking back a claim means
 * looking at these too.
 */
export function dependents(project: Project, editId: string): readonly Edit[] {
  const base = project.edits.find((entry) => entry.id === editId);
  if (!base) return [];
  const word = base.field === "names" || base.field === "bookmarks" ? base.after : null;
  return project.edits.filter((later) =>
    later.id !== base.id &&
    later.at > base.at &&
    (later.status === "applied" || later.status === "proposed") &&
    ((later.evidence ?? []).some((item) => evidenceAddress(item) === base.key) || (word !== null && mentions(later.after, word))),
  );
}

/** Takes back an edit and every edit still standing that depends on it, newest first. Returns how many were taken back. */
export function withdraw(id: string, editId: string): number {
  const chain = [...dependents(loadProject(id), editId)].sort((a, b) => b.at - a.at);
  let count = 0;
  for (const edit of chain) {
    const current = loadProject(id).edits.find((entry) => entry.id === edit.id);
    if (current?.status === "proposed") {
      decline(id, [edit.id]);
      count++;
    } else if (current && canUndo(loadProject(id), current)) {
      undo(id, edit.id);
      count++;
    }
  }
  const base = loadProject(id).edits.find((entry) => entry.id === editId);
  if (base?.status === "proposed") decline(id, [editId]);
  else if (base?.status === "applied") undo(id, editId);
  return count + 1;
}

/** Marks still standing whose latest edit is an agent's claim with no evidence: the list to check. */
export function standingGuesses(project: Project): readonly Edit[] {
  const latest = new Map<string, Edit>();
  for (const edit of project.edits) if (edit.status === "applied") latest.set(`${edit.field}|${edit.key}`, edit);
  return [...latest.values()].filter((edit) => unbacked(edit) && valueOf(project, edit.field, edit.key) === edit.after);
}
