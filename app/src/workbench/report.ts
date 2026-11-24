import { authorName, type Edit, type EditField, unbacked } from "../engine/edits";
import type { Project } from "../engine/project";

/** The edit that set a value now standing, so the report can say who set it and on what evidence. */
function lastEdit(project: Project, field: EditField, key: string): Edit | undefined {
  return [...project.edits].reverse().find((edit) => edit.status === "applied" && edit.field === field && edit.key === key);
}

function basis(project: Project, field: EditField, key: string): string {
  const edit = lastEdit(project, field, key);
  if (!edit) return "";
  if (unbacked(edit)) return `${authorName(edit.by)}, no evidence`;
  return [authorName(edit.by), ...(edit.evidence ?? [])].join("; ");
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): readonly string[] {
  if (rows.length === 0) return [];
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)];
}

function section(title: string, lines: readonly string[]): readonly string[] {
  return lines.length === 0 ? [] : [`## ${title}`, "", ...lines, ""];
}

/** Everything found in a project as one Markdown document: names with who set them and why, notes, comments, bookmarks, patches and C types. */
export function projectReport(binary: string, project: Project, originalName: (addr: string) => string, when: Date = new Date()): string {
  const standing = [...[...project.names.keys()].map((key) => lastEdit(project, "names", key)), ...[...project.notes.keys()].map((key) => lastEdit(project, "notes", key)), ...[...project.comments.keys()].map((key) => lastEdit(project, "comments", key))];
  const guesses = standing.filter((edit) => edit !== undefined && unbacked(edit)).length;
  const names = [...project.names].map(([addr, name]) => [addr, originalName(addr), name, basis(project, "names", addr)]);
  const notes = [...project.notes].map(([addr, note]) => [addr, project.names.get(addr) ?? originalName(addr), note, basis(project, "notes", addr)]);
  const comments = [...project.comments].map(([addr, comment]) => [addr, comment, basis(project, "comments", addr)]);
  const marks = project.bookmarks.map((mark) => [mark.addr, mark.label]);
  const patches = project.patches.map((patch) => [patch.addr, patch.bytes]);
  const types = [...project.ctypes].map(([name, declaration]) => [`### ${name}`, "", "```c", declaration, "```", ""]).flat();
  const placed = [...project.ctypeAt].map(([addr, name]) => [addr, name]);
  return [
    `# ${binary}`,
    "",
    `Written by Eleven on ${when.toISOString().slice(0, 10)}. ${project.names.size} names, ${project.notes.size} notes, ${project.comments.size} comments${guesses > 0 ? `, ${guesses} still unchecked guesses` : ""}.`,
    "",
    ...section("Notebook", project.pages.get("notebook") ? [project.pages.get("notebook") ?? ""] : []),
    ...section("Names", table(["Address", "Was", "Named", "Set by and evidence"], names)),
    ...section("Notes", table(["Address", "Function", "Note", "Set by and evidence"], notes)),
    ...section("Comments", table(["Address", "Comment", "Set by and evidence"], comments)),
    ...section("Bookmarks", table(["Address", "Label"], marks)),
    ...section("Patches", table(["Address", "Bytes"], patches)),
    ...section("C types", [...types, ...table(["Address", "Read as"], placed)]),
  ].join("\n");
}
