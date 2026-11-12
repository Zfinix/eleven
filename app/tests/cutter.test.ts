import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { changedIn, cutterRizin, openCutterSessions, projectScript, readCutterProject, rizinName, rizinQuoted, rizinUnescaped, writeCutterProject } from "../src/engine/cutter";
import { rizinInstalled } from "../src/analysis/engines";

function elf(): string {
  const dir = join(process.env.GHIDRA_INSTALL_DIR ?? join(process.env.HOME ?? "", ".local/share/ghidra_12.1.4_PUBLIC"), "GPL", "DemanglerGnu", "os", "linux_x86_64");
  const file = existsSync(dir) ? readdirSync(dir).find((name) => !name.includes(".")) : undefined;
  if (!file) throw new Error(`no binary found in ${dir} to test with`);
  return join(dir, file);
}

test("cutter: text keeps its semicolons, at signs, quotes, backslashes and lines inside one rizin argument", () => {
  expect(rizinQuoted("plain")).toBe("'plain'");
  expect(rizinQuoted("a; b @ c")).toBe("'a; b @ c'");
  expect(rizinQuoted(`it's "x"`)).toBe(`'it'"'"'s "x"'`);
  expect(rizinQuoted("a\\b")).toBe("'a\\\\b'");
  expect(rizinQuoted("one\ntwo")).toBe("'one\\ntwo'");
});

test("cutter: comments rizin lists come back as the text that was written", () => {
  expect(rizinUnescaped("a\\\\b\\nc")).toBe("a\\b\nc");
  expect(rizinUnescaped("plain")).toBe("plain");
});

test("cutter: names lose the characters rizin would read as syntax", () => {
  expect(rizinName("parse header")).toBe("parse_header");
  expect(rizinName("ns::Type.method$1")).toBe("ns::Type.method$1");
  expect(rizinName("a;b@c")).toBe("a_b_c");
});

test("cutter: the project script analyzes, renames, comments, then saves", () => {
  const script = projectScript({ names: new Map([[0x1000, "start here"]]), comments: new Map([[0x1004, "why; it's"]]) }, "/tmp/p.rzdb");
  expect(script.split("\n")).toEqual(["aaa", "afn start_here @ 0x1000", "CC- @ 0x1004", `CC 'why; it'"'"'s' @ 0x1004`, "Ps '/tmp/p.rzdb'", ""]);
});

test("cutter: only names and comments set in Cutter come back, not rizin's own", () => {
  const fresh = { names: new Map([[1, "fcn.1"], [2, "main"]]), comments: new Map([[3, "auto"]]) };
  const saved = { names: new Map([[1, "decode_packet"], [2, "main"]]), comments: new Map([[3, "auto"], [4, "checked by hand"]]) };
  const changed = changedIn(saved, fresh);
  expect([...changed.names]).toEqual([[1, "decode_packet"]]);
  expect([...changed.comments]).toEqual([[4, "checked by hand"]]);
});

const live = rizinInstalled() || cutterRizin() !== null ? test : test.skip;

live("cutter: a project written with Eleven's names and comments reads back the same", async () => {
  const binary = elf();
  const out = join(mkdtempSync(join(tmpdir(), "eleven-cutter-")), "project.rzdb");
  const comment = `checked; "twice" @ 0x10 \\ and it's\nfine`;
  const fresh = await readCutterProject(await writeCutterProject(binary, { names: new Map(), comments: new Map() }, out), binary);
  expect(fresh.names.size).toBe(0);
  const main = 0x413cce;
  await writeCutterProject(binary, { names: new Map([[main, "entry for tests"]]), comments: new Map([[main, comment]]) }, out);
  const back = await readCutterProject(out, binary);
  expect(back.names.get(main)).toBe("entry_for_tests");
  expect(back.comments.get(main)).toBe(comment);
}, 300_000);

test("cutter: only a running Cutter counts as connected, not a session file left behind", () => {
  const dir = mkdtempSync(join(tmpdir(), "eleven-bridge-"));
  process.env.REA_CUTTER_BRIDGE_DIR = dir;
  try {
    expect(openCutterSessions()).toBe(0);
    writeFileSync(join(dir, `cutter-${process.pid}-live.json`), "{}");
    writeFileSync(join(dir, "cutter-999999999-gone.json"), "{}");
    writeFileSync(join(dir, "notes.txt"), "");
    expect(openCutterSessions()).toBe(1);
  } finally {
    delete process.env.REA_CUTTER_BRIDGE_DIR;
  }
});
