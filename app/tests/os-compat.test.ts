import "./fixtures/isolate";

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { hidePaths } from "../src/bridge/privacy";
import { newestJdkFirst } from "../src/engine/toolchain";
import { dataRoot } from "../src/lib/platform";
import { loadSkills } from "../src/skills/load";

function jdk(root: string, folder: string, version: string): string {
  const home = join(root, folder);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "release"), `JAVA_VERSION="${version}"\n`);
  return home;
}

test("JDKs sort by their release file, not the numbers in the folder name", () => {
  const root = mkdtempSync(join(tmpdir(), "jdks-"));
  const distro = jdk(root, "java-17-openjdk-amd64", "17.0.12");
  const ours = jdk(root, "jdk-21.0.5+11", "21.0.5");
  expect([distro, ours].sort(newestJdkFirst)[0]).toBe(ours);
});

test("hiding folder paths also covers JSON, where Windows doubles backslashes", () => {
  const home = homedir();
  expect(hidePaths(JSON.stringify({ path: join(home, "app") }), true)).not.toContain(home);
  expect(hidePaths(`${home}/app`, true)).toBe("~/app");
});

test("playbooks saved with Windows line endings still read their name and description", () => {
  const dir = join(dataRoot(), "skills", "crlf-playbook");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\r\nname: crlf-playbook\r\ndescription: Saved on Windows\r\n---\r\nDo the thing.\r\n");
  const skill = loadSkills().find((candidate) => candidate.name === "crlf-playbook");
  expect(skill?.description).toBe("Saved on Windows");
  expect(skill?.body).toBe("Do the thing.");
});
