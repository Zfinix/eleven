import { afterAll, expect, spyOn, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "eleven-doc-"));
process.env.ELEVEN_SUPPORT = join(root, "support");
process.env.ELEVEN_CACHE = join(root, "cache");
process.env.ELEVEN_PROJECTS_DIR = join(root, "Projects");

const { saveDocument, openDocument, documentPath } = await import("../src/engine/document");
const { documentChats } = await import("../src/engine/documentChats");
const { compressPart } = await import("../src/engine/compressedPart");
const { openElevenFile, sha256 } = await import("../src/engine/elevenFile");
const { loadProject, saveProject, projectId, EMPTY_PROJECT } = await import("../src/engine/project");
const { loadThread, saveThread } = await import("../src/chat/history");
const { prepareTarget } = await import("../src/engine/target");

const binary = join(root, "echo");
copyFileSync("/bin/echo", binary);
const id = sha256(new Uint8Array(readFileSync(binary)));
const target = { original: binary, path: binary, name: "echo", meta: "Mach-O · arm64e", arch: "arm64e", kind: "binary" as const };
const out = join(root, "echo.eleven");
const cached = join(process.env.ELEVEN_CACHE, id, "ghidra", "pseudocode", "entry.c");

afterAll(() => rmSync(root, { recursive: true, force: true }));

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

test("overlapping saves keep compression memory bounded and produce complete projects", async () => {
  const compress = Bun.zstdCompress;
  let active = 0;
  let peak = 0;
  const compression = spyOn(Bun, "zstdCompress").mockImplementation(async (data, options) => {
    active++;
    peak = Math.max(peak, active);
    try {
      await Bun.sleep(5);
      return await compress(data, options);
    } finally {
      active--;
    }
  });
  const destination = join(root, "overlapping.eleven");

  try {
    await Promise.all([
      saveDocument(target, id, destination, false),
      saveDocument(target, id, destination, false),
    ]);
    expect(peak).toBe(1);

    const file = openElevenFile(destination);
    try {
      expect(file.entry("binary")).toEqual(new Uint8Array(readFileSync(binary)));
      expect(file.entry("project.json")).not.toBeNull();
      expect(file.entry("chats.json")).not.toBeNull();
      expect(file.entry("cache.json")).not.toBeNull();
    } finally {
      file.close();
    }
  } finally {
    compression.mockRestore();
  }
});

test("chat archives preserve large Unicode messages across stream boundaries", async () => {
  const thread = {
    id: "large-chat",
    title: "Unicode history",
    target: binary,
    project: id,
    messages: [{ kind: "user" as const, text: "日本語 🐘\n".repeat(24000), at: 2 }],
    updatedAt: 2,
  };
  saveThread(thread);
  const destination = join(root, "large-chat.eleven");
  await saveDocument(target, id, destination, false);

  const file = openElevenFile(destination);
  try {
    const bytes = file.entry("chats.json");
    if (!bytes) throw new Error("The saved project is missing its chats.");
    const chats: unknown = JSON.parse(new TextDecoder().decode(bytes));
    expect(chats).toEqual(expect.arrayContaining([thread]));
  } finally {
    file.close();
  }
});

test("a truncated chat preserves the previous project and a repaired chat can be saved", async () => {
  const destination = join(root, "chat-recovery.eleven");
  await saveDocument(target, id, destination, false);
  const previous = readFileSync(destination);
  const chat = join(root, "support", "threads", "large-chat.json");
  const original = readFileSync(chat);

  try {
    writeFileSync(chat, original.subarray(0, original.length - 12));
    await expect(saveDocument(target, id, destination, false)).rejects.toThrow();
    expect(readFileSync(destination)).toEqual(previous);
  } finally {
    writeFileSync(chat, original);
  }

  await saveDocument(target, id, destination, false);
  const file = openElevenFile(destination);
  try {
    expect(file.entry("chats.json")).not.toBeNull();
  } finally {
    file.close();
  }
});

test("a removed chat is omitted without damaging the archive", async () => {
  rmSync(join(root, "support", "threads", "large-chat.json"));
  const destination = join(root, "missing-chat.eleven");
  await saveDocument(target, id, destination, false);

  const file = openElevenFile(destination);
  try {
    const bytes = file.entry("chats.json");
    if (!bytes) throw new Error("The saved project is missing its chats.");
    const chats: unknown = JSON.parse(new TextDecoder().decode(bytes));
    expect(chats).toEqual([loadThread("t1")]);
  } finally {
    file.close();
  }
});

test("streamed archives select their project and retain chats saved before project ids", async () => {
  const legacy = {
    id: "legacy-chat", title: "Old history", target: binary,
    messages: [{ kind: "user" as const, text: "Earlier conversation", at: 1 }], updatedAt: 1,
  };
  const legacyPath = join(root, "support", "threads", `${legacy.id}.json`);
  const otherPath = join(root, "support", "threads", "other-project.json");
  const other = { ...legacy, id: "other-project", project: "unrelated" };
  writeFileSync(legacyPath, JSON.stringify(legacy));
  writeFileSync(otherPath, JSON.stringify(other));

  const readChats = async (project: string): Promise<unknown> => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of documentChats(project)) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };

  try {
    const chats = await readChats(projectId(prepareTarget(binary)));
    expect(chats).toEqual(expect.arrayContaining([legacy]));
    expect(chats).not.toEqual(expect.arrayContaining([other]));
    expect(await readChats("unrelated")).toEqual([other]);
  } finally {
    rmSync(legacyPath);
    rmSync(otherPath);
  }
});

test("editing a chat in place during streaming rejects the incomplete snapshot", async () => {
  const path = join(root, "support", "threads", "t1.json");
  const original = readFileSync(path);
  const archive = documentChats(id);

  try {
    await archive.next();
    await archive.next();
    writeFileSync(path, Buffer.concat([original, Buffer.from("\n")]));

    const finish = async (): Promise<void> => {
      for await (const chunk of archive) expect(chunk).toBeInstanceOf(Uint8Array);
    };
    await expect(finish()).rejects.toThrow("A chat changed while saving");
  } finally {
    await archive.return(undefined);
    writeFileSync(path, original);
  }
});

test("replacing a chat atomically keeps the already opened archive snapshot", async () => {
  const path = join(root, "support", "threads", "t1.json");
  const original = readFileSync(path);
  const archive = documentChats(id);

  try {
    await archive.next();
    await archive.next();
    const replacement = `${path}.replacement`;
    writeFileSync(replacement, "{}");
    renameSync(replacement, path);

    const chunks: Uint8Array[] = [Buffer.from("[")];
    for await (const chunk of archive) chunks.push(chunk);
    const chats: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(chats).toEqual([JSON.parse(original.toString("utf8"))]);
  } finally {
    await archive.return(undefined);
    writeFileSync(path, original);
  }
});

test("a failed compression preserves the saved project and subsequent saves recover", async () => {
  const destination = join(root, "recovery.eleven");
  await saveDocument(target, id, destination, false);
  const previous = readFileSync(destination);
  const compress = Bun.zstdCompress;
  let calls = 0;
  const compression = spyOn(Bun, "zstdCompress").mockImplementation(async (data, options) => {
    if (++calls === 2) throw new Error("compression interrupted");
    return compress(data, options);
  });

  try {
    await expect(saveDocument(target, id, destination, false)).rejects.toThrow("compression interrupted");
    expect(readFileSync(destination)).toEqual(previous);
  } finally {
    compression.mockRestore();
  }

  await saveDocument(target, id, destination, false);
  const file = openElevenFile(destination);
  try {
    expect(file.entry("binary")).toEqual(new Uint8Array(readFileSync(binary)));
  } finally {
    file.close();
  }
});

test("multiple large chats make progress when metadata follows their messages", async () => {
  const paths: string[] = [];
  let raw = 2;

  try {
    for (let index = 0; index < 3; index++) {
      const path = join(root, "support", "threads", `streaming-${index}.json`);
      const bytes = Buffer.from(JSON.stringify({
        messages: [{ kind: "user", text: "x".repeat(8 * 1024 * 1024), at: 1 }],
        id: `streaming-${index}`, title: "Large history", project: "streaming-project", updatedAt: 1,
      }));
      paths.push(path);
      writeFileSync(path, bytes);
      raw += bytes.length + (index > 0 ? 1 : 0);
    }

    const part = await compressPart("chats.json", documentChats("streaming-project"));
    expect(part.raw).toBe(raw);
    expect(Bun.zstdDecompressSync(part.packed).length).toBe(raw);
  } finally {
    for (const path of paths) rmSync(path);
  }
}, 10_000);
