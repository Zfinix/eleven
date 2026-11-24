import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Author } from "../src/engine/edits";

process.env.ELEVEN_SUPPORT = mkdtempSync(join(tmpdir(), "eleven-edits-"));

const { diffProjects, evidenceAddress, parseEvidence, record, redoTarget, unbacked, undoTarget, YOU } = await import("../src/engine/edits");
const { accept, decline, dependents, pending, propose, redo, standingGuesses, undo, withdraw } = await import("../src/engine/history");
const { EMPTY_PROJECT, loadProject, updateProject } = await import("../src/engine/project");

const CLAUDE: Author = { kind: "agent", agent: "Claude", chat: "chat-1" };

function rename(id: string, addr: string, name: string, by: Author): void {
  updateProject(id, (project) => ({ ...project, names: new Map(project.names).set(addr, name) }), by);
}

test("edits: a diff covers maps and lists alike", () => {
  const after = { ...EMPTY_PROJECT, names: new Map([["0x10", "main"]]), bookmarks: [{ addr: "0x20", label: "start" }], patches: [{ addr: "0x30", bytes: "90" }] };
  expect(diffProjects(EMPTY_PROJECT, after)).toEqual([
    { field: "names", key: "0x10", before: null, after: "main" },
    { field: "bookmarks", key: "0x20", before: null, after: "start" },
    { field: "patches", key: "0x30", before: null, after: "90" },
  ]);
  expect(diffProjects(after, after)).toEqual([]);
});

test("edits: typing into one value folds into one entry, and typing it back removes it", () => {
  const one = record([], [{ field: "notes", key: "0x10", before: null, after: "p" }], YOU, 1000);
  const two = record(one, [{ field: "notes", key: "0x10", before: "p", after: "parses" }], YOU, 2000);
  expect(two).toHaveLength(1);
  expect(two[0]).toMatchObject({ before: null, after: "parses", changedAt: 2000 });
  expect(record(two, [{ field: "notes", key: "0x10", before: "parses", after: null }], YOU, 3000)).toEqual([]);
  expect(record(two, [{ field: "notes", key: "0x10", before: "parses", after: "x" }], CLAUDE, 3000)).toHaveLength(2);
  expect(record(two, [{ field: "notes", key: "0x10", before: "parses", after: "x" }], YOU, 90_000)).toHaveLength(2);
});

test("edits: every write is logged with its author, and a write that changes nothing is skipped", () => {
  const id = "log";
  rename(id, "0x10", "main", YOU);
  rename(id, "0x20", "parse_args", CLAUDE);
  const before = loadProject(id);
  rename(id, "0x20", "parse_args", CLAUDE);
  expect(loadProject(id).edits).toEqual(before.edits);
  expect(before.edits.map((edit) => [edit.by.kind, edit.key, edit.after])).toEqual([["you", "0x10", "main"], ["agent", "0x20", "parse_args"]]);
});

test("history: undo and redo take back the newest change and put it back", () => {
  const id = "undo";
  rename(id, "0x10", "main", YOU);
  rename(id, "0x20", "parse_args", CLAUDE);
  expect(undo(id)?.key).toBe("0x20");
  expect(loadProject(id).names.has("0x20")).toBe(false);
  expect(undo(id)?.key).toBe("0x10");
  expect(undo(id)).toBeNull();
  expect(redo(id)?.key).toBe("0x10");
  expect(loadProject(id).names.get("0x10")).toBe("main");
  rename(id, "0x30", "other", YOU);
  expect(redoTarget(loadProject(id).edits)).toBeNull();
  expect(undoTarget(loadProject(id).edits)?.key).toBe("0x30");
});

test("history: an older change can't be undone once the value moved on", () => {
  const id = "conflict";
  rename(id, "0x10", "first", CLAUDE);
  const first = loadProject(id).edits[0];
  rename(id, "0x10", "second", YOU);
  expect(() => undo(id, first?.id)).toThrow("changed again later");
  expect(loadProject(id).names.get("0x10")).toBe("second");
});

test("history: a suggestion changes nothing until accepted, and a declined one never lands", () => {
  const id = "review";
  const patch = propose(id, "patches", "0x100003f2c", "1f 20 03 d5", CLAUDE, "Skips the license check");
  const note = propose(id, "notes", "0x10", "checks the key", CLAUDE);
  expect(loadProject(id).patches).toEqual([]);
  expect(pending(loadProject(id)).map((edit) => edit.reason ?? null)).toEqual(["Skips the license check", null]);
  accept(id, [patch.id]);
  decline(id, [note.id]);
  const project = loadProject(id);
  expect(project.patches).toEqual([{ addr: "0x100003f2c", bytes: "1f 20 03 d5" }]);
  expect(project.notes.has("0x10")).toBe(false);
  expect(pending(project)).toEqual([]);
  expect(undo(id)?.id).toBe(patch.id);
  expect(loadProject(id).patches).toEqual([]);
});

test("edits: breakpoints are saved with the project and can be undone", () => {
  const id = "breakpoints";
  updateProject(id, (project) => ({ ...project, breakpoints: new Map([["0x100003e68", "on"]]) }), YOU);
  expect([...loadProject(id).breakpoints]).toEqual([["0x100003e68", "on"]]);
  undo(id);
  expect(loadProject(id).breakpoints.size).toBe(0);
});

test("evidence: items that name an address are kept, the rest dropped", () => {
  expect(parseEvidence('0x100004906 string "COLUMNS", 0x1000016d8 calls getenv\nit looked like a parser, 0x100004906 string "COLUMNS"')).toEqual(['0x100004906 string "COLUMNS"', "0x1000016d8 calls getenv"]);
  expect(parseEvidence("I just know")).toEqual([]);
  expect(evidenceAddress("0x1000016D8 calls getenv")).toBe("0x1000016d8");
});

test("evidence: an agent's rename keeps what it read, and one with nothing is a guess", () => {
  const id = "evidence";
  updateProject(id, (project) => ({ ...project, names: new Map(project.names).set("0x10", "read_columns") }), CLAUDE, ["0x100004906 string \"COLUMNS\""]);
  updateProject(id, (project) => ({ ...project, names: new Map(project.names).set("0x20", "do_thing") }), CLAUDE);
  rename(id, "0x30", "mine", YOU);
  const [backed, guess, yours] = loadProject(id).edits;
  expect(backed?.evidence).toEqual(['0x100004906 string "COLUMNS"']);
  expect(backed && unbacked(backed)).toBe(false);
  expect(guess && unbacked(guess)).toBe(true);
  expect(yours && unbacked(yours)).toBe(false);
  const suggested = propose(id, "notes", "0x10", "reads COLUMNS", CLAUDE, undefined, ["0x100004906 string"]);
  accept(id, [suggested.id]);
  expect(loadProject(id).edits.find((edit) => edit.id === suggested.id)?.evidence).toEqual(["0x100004906 string"]);
});

test("withdraw: taking back a rename takes back what was built on it, and nothing else", () => {
  const id = "withdraw";
  updateProject(id, (project) => ({ ...project, names: new Map(project.names).set("0x10", "parse_args") }), CLAUDE, ["0x10 reads argv"]);
  const [renamed] = loadProject(id).edits;
  updateProject(id, (project) => ({ ...project, notes: new Map(project.notes).set("0x20", "main hands argv to parse_args") }), CLAUDE, ["0x20 calls 0x10"]);
  updateProject(id, (project) => ({ ...project, comments: new Map(project.comments).set("0x24", "flag check") }), CLAUDE, ["0x10 compares the flag"]);
  updateProject(id, (project) => ({ ...project, notes: new Map(project.notes).set("0x30", "prints usage") }), CLAUDE, ["0x30 calls puts"]);
  if (!renamed) throw new Error("no rename was logged");
  expect(dependents(loadProject(id), renamed.id).map((edit) => edit.key)).toEqual(["0x20", "0x24"]);
  expect(withdraw(id, renamed.id)).toBe(3);
  const project = loadProject(id);
  expect(project.names.has("0x10")).toBe(false);
  expect(project.notes.has("0x20")).toBe(false);
  expect(project.comments.has("0x24")).toBe(false);
  expect(project.notes.get("0x30")).toBe("prints usage");
});

test("guesses: only an agent's unbacked marks that still stand are left to check", () => {
  const id = "guesses";
  updateProject(id, (project) => ({ ...project, names: new Map(project.names).set("0x10", "guess_one") }), CLAUDE);
  updateProject(id, (project) => ({ ...project, names: new Map(project.names).set("0x20", "backed") }), CLAUDE, ["0x20 calls getenv"]);
  updateProject(id, (project) => ({ ...project, notes: new Map(project.notes).set("0x30", "a hunch") }), CLAUDE);
  rename(id, "0x30", "mine", YOU);
  updateProject(id, (project) => ({ ...project, names: new Map(project.names).set("0x40", "overwritten") }), CLAUDE);
  rename(id, "0x40", "fixed_by_you", YOU);
  expect(standingGuesses(loadProject(id)).map((edit) => [edit.field, edit.key])).toEqual([["names", "0x10"], ["notes", "0x30"]]);
});
