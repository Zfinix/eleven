import "./fixtures/isolate";

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { hidePaths } from "../src/bridge/privacy";
import { jdkVersion } from "../src/engine/toolchain";
import { dataRoot } from "../src/lib/platform";
import { launchLine, run } from "../src/lib/process";
import { newestFirst } from "../src/lib/version";
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
  expect([distro, ours].sort(newestFirst(jdkVersion))[0]).toBe(ours);
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

test("Windows batch launchers start through cmd.exe with every argument escaped", () => {
  const launch = launchLine("C:\\Program Files\\nodejs\\npx.cmd", ["-y", "a&b"], "win32");
  expect(launch).toEqual({ file: 'C:\\Program^ Files\\nodejs\\npx.cmd ^^^"-y^^^" ^^^"a^^^&b^^^"', args: [], shell: true });
  expect(launchLine("C:\\tools\\agent.exe", ["-y"], "win32")).toEqual({ file: "C:\\tools\\agent.exe", args: ["-y"], shell: false });
  expect(launchLine("/usr/bin/npx", ["-y"], "darwin").shell).toBe(false);
});

test("percent signs reach a batch launcher unexpanded", () => {
  expect(launchLine("C:\\x\\a.cmd", ["%USERNAME%"], "win32").file).toBe('C:\\x\\a.cmd ^^^"^^^%USERNAME^^^%^^^"');
});

test.skipIf(process.platform !== "win32")("a batch file in a folder with spaces gets its arguments as given", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "eleven ")), "with space");
  mkdirSync(dir);
  const bat = join(dir, "echo.cmd");
  writeFileSync(bat, "@echo off\r\necho %*\r\n");
  const { stdout } = await run(bat, ["%USERNAME%", "a&b", "c d"]);
  expect(stdout.trim()).toBe('"%USERNAME%" "a&b" "c d"');
});
