import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { currentSettings } from "../settings/store";
import { dataRoot } from "../lib/platform";

/** One of Eleven's reverse-engineering playbooks: a name, a one-line description, and the instructions sent to the agent. */
export type Skill = { readonly name: string; readonly description: string; readonly body: string };

const MAX_BODY = 8000;

function skillDirs(): readonly string[] {
  const bundled = join(dirname(process.execPath), "..", "Resources", "skills");
  const dev = join(import.meta.dir, "..", "..", "skills");
  const user = currentSettings().skillsDir || join(dataRoot(), "skills");
  return [existsSync(bundled) ? bundled : dev, user].filter(existsSync);
}

function frontmatter(raw: string): { readonly meta: ReadonlyMap<string, string>; readonly body: string } {
  const text = raw.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match?.[1]) return { meta: new Map(), body: text.trim() };
  const meta = new Map(match[1].split("\n").flatMap((line) => {
    const at = line.indexOf(":");
    return at > 0 ? [[line.slice(0, at).trim(), line.slice(at + 1).trim()] as const] : [];
  }));
  return { meta, body: (match[2] ?? "").trim() };
}

function read(dir: string): readonly Skill[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry): Skill[] => {
    const file = join(dir, entry.name, "SKILL.md");
    if (!entry.isDirectory() || !existsSync(file)) return [];
    const { meta, body } = frontmatter(readFileSync(file, "utf8"));
    const name = meta.get("name") ?? entry.name;
    return [{ name, description: meta.get("description") ?? "", body: body.slice(0, MAX_BODY) }];
  });
}

/** Eleven's built-in skills, plus any the user added, by name. A user skill overrides a built-in of the same name. */
export function loadSkills(): readonly Skill[] {
  const byName = new Map<string, Skill>();
  for (const dir of skillDirs()) for (const skill of read(dir)) byName.set(skill.name, skill);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The skills not turned off in Settings → Skills, for lists the user picks from. */
export function enabledSkills(): readonly Skill[] {
  const off = currentSettings().disabledSkills;
  return loadSkills().filter((skill) => !off.includes(skill.name));
}

/** The prompt Eleven sends when the user runs a skill: the playbook, then whatever they added after it. */
const PLAYBOOK = /^Follow this Eleven playbook, "([^"]+)"\.\n[\s\S]*?(?:\n\nThe user added: ([\s\S]*))?$/;

export function playbookTitle(name: string): string {
  const words = name.replace(/[-_]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What a sent message reads as in the chat: a playbook shows its name and what you added, not its whole prompt. */
export function shownText(text: string): string {
  const match = PLAYBOOK.exec(text);
  if (!match?.[1]) return text;
  return match[2] ? `${playbookTitle(match[1])}: ${match[2].trim()}` : playbookTitle(match[1]);
}

export function skillPrompt(skill: Skill, rest: string): string {
  const extra = rest.trim();
  return [`Follow this Eleven playbook, "${skill.name}".`, "", skill.body, ...(extra ? ["", `The user added: ${extra}`] : [])].join("\n");
}
