import { expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "eleven-doc-"));
process.env.ELEVEN_SUPPORT = join(root, "support");
process.env.ELEVEN_CACHE = join(root, "cache");
process.env.ELEVEN_PROJECTS_DIR = join(root, "Projects");

const { saveDocument, openDocument, documentPath } = await import("../src/engine/document");
const { openElevenFile, pack, sha256, writeAtomic } = await import("../src/engine/elevenFile");
const { loadProject, projectJson, saveProject, EMPTY_PROJECT } = await import("../src/engine/project");
const { loadThread, saveThread } = await import("../src/chat/history");
const { prepareTarget } = await import("../src/engine/target");

const binary = join(root, "echo");
copyFileSync("/bin/echo", binary);
const id = sha256(new Uint8Array(readFileSync(binary)));
const target = { original: binary, path: binary, name: "echo", meta: "Mach-O · arm64e", arch: "arm64e", kind: "binary" as const };
const out = join(root, "echo.eleven");
const cached = join(process.env.ELEVEN_CACHE, id, "ghidra", "pseudocode", "entry.c");

test("a project packs into one .eleven file and comes back whole", async () => {
  saveProject(id, { ...EMPTY_PROJECT, names: new Map([["0x100000960", "main_echo"]]) });
  saveThread({ id: "t1", title: "What does it print?", target: binary, project: id, messages: [{ kind: "user", text: "What does it print?", at: 1 }], updatedAt: 1 });
  mkdirSync(join(cached, ".."), { recursive: true });
  writeFileSync(cached, "void entry(void) {\n  puts(argv[1]);\n}\n");
  await saveDocument(target, id, out);

  const file = openElevenFile(out);
  expect(file.manifest.name).toBe("echo");
  expect(file.manifest.binary).toBe(id);
  expect(file.manifest.entries.map((entry) => entry.name).sort()).toEqual(["binary", "cache.json", "chats.json", "project.json"]);
  const packed = file.manifest.entries.find((entry) => entry.name === "binary");
  expect(packed && packed.size < packed.raw).toBe(true);
  file.close();
  expect(documentPath(id)).toBe(out);

  rmSync(process.env.ELEVEN_SUPPORT ?? "", { recursive: true, force: true });
  rmSync(process.env.ELEVEN_CACHE ?? "", { recursive: true, force: true });
  const opened = openDocument(out);
  expect(sha256(new Uint8Array(readFileSync(opened.binary)))).toBe(id);
  expect(loadProject(id).names.get("0x100000960")).toBe("main_echo");
  expect(loadThread("t1")?.title).toBe("What does it print?");
  expect(readFileSync(cached, "utf8")).toContain("puts(argv[1])");
});

test("opening a .eleven file gives a target on the unpacked binary", () => {
  const opened = prepareTarget(out);
  expect(opened.original).toBe(out);
  expect(opened.name).toBe("echo");
  expect(opened.kind).toBe("binary");
  expect(statSync(opened.path).size).toBe(statSync("/bin/echo").size);
});

test("a damaged or foreign file is refused in plain words", () => {
  const bytes = new Uint8Array(readFileSync(out));
  bytes[bytes.length - 10] = (bytes[bytes.length - 10] ?? 0) ^ 0xff;
  const damaged = join(root, "damaged.eleven");
  writeFileSync(damaged, bytes);
  const file = openElevenFile(damaged);
  expect(() => file.entry("binary")).toThrow(/damaged/);
  file.close();
  const foreign = join(root, "notes.eleven");
  writeFileSync(foreign, "hello");
  expect(() => openElevenFile(foreign)).toThrow(/isn't an Eleven project file|cut short/);
});

const info = { name: "echo", kind: "binary", arch: "arm64e", meta: "Mach-O · arm64e", binary: id, savedAt: 1, app: "0.1.9" };

test("a file written the old way (every part compressed whole, binary at level 19) still opens", () => {
  saveProject(id, { ...EMPTY_PROJECT, names: new Map([["0x100000960", "old_main"]]) });
  const old = join(root, "old.eleven");
  const bytes = new Uint8Array(readFileSync(binary));
  writeAtomic(old, pack(info, [
    { name: "project.json", data: new TextEncoder().encode(projectJson(id)), level: 3 },
    { name: "chats.json", data: new TextEncoder().encode(JSON.stringify([{ id: "old1", title: "Old chat", target: binary, project: id, messages: [], updatedAt: 2 }])), level: 3 },
    { name: "cache.json", data: new TextEncoder().encode("{}"), level: 19 },
    { name: "binary", data: bytes, level: 19 },
  ]));
  rmSync(process.env.ELEVEN_SUPPORT ?? "", { recursive: true, force: true });
  const opened = openDocument(old);
  expect(sha256(new Uint8Array(readFileSync(opened.binary)))).toBe(id);
  expect(loadProject(id).names.get("0x100000960")).toBe("old_main");
  expect(loadThread("old1")?.title).toBe("Old chat");
});

test("a saved file is plain format 1: each entry decodes with stock zstd to its recorded size and hash", async () => {
  await saveDocument(target, id, out);
  const bytes = new Uint8Array(readFileSync(out));
  const length = new DataView(bytes.buffer).getUint32(8, true);
  const manifest: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + length)));
  const file = openElevenFile(out);
  expect(file.manifest.format).toBe(1);
  expect(manifest).toEqual(file.manifest);
  for (const entry of file.manifest.entries) {
    const start = 12 + length + entry.offset;
    const raw = Bun.zstdDecompressSync(bytes.subarray(start, start + entry.size));
    expect(raw.length).toBe(entry.raw);
    expect(sha256(raw)).toBe(entry.sha256);
  }
  expect(file.entry("binary")?.length).toBe(statSync(binary).size);
  file.close();
});

test("saves at the same time run one after another and leave one whole file", async () => {
  await Promise.all([saveDocument(target, id, out), saveDocument(target, id, out), saveDocument(target, id, out)]);
  const file = openElevenFile(out);
  expect(sha256(file.entry("binary") ?? new Uint8Array())).toBe(id);
  file.close();
  expect(existsSync(`${out}.saving`)).toBe(false);
});

test("a save that fails leaves the last good file as it was", async () => {
  const before = readFileSync(out);
  const missing = { ...target, path: join(root, "gone"), name: "gone" };
  await expect(saveDocument(missing, "gone-id", out, false)).rejects.toThrow();
  expect(readFileSync(out).equals(before)).toBe(true);

  const locked = join(root, "locked");
  mkdirSync(locked);
  const kept = join(locked, "echo.eleven");
  copyFileSync(out, kept);
  chmodSync(locked, 0o555);
  try {
    await expect(saveDocument(target, id, kept, false)).rejects.toThrow();
    expect(readFileSync(kept).equals(before)).toBe(true);
    expect(existsSync(`${kept}.saving`)).toBe(false);
  } finally {
    chmodSync(locked, 0o755);
  }
});
