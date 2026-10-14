import { closeSync, existsSync, openSync, readdirSync, readSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import { isRecord, stringField, type JsonRecord } from "../lib/guards";
import { cacheDir } from "../settings/actions";
import type { Caller, Fn, Refs, SourceText, TableRow } from "../workbench/model";
import { run, runSync } from "../lib/process";
import { OS, zipListing } from "../lib/platform";
import { apkFiles, type ApkFiles, readResourceStrings, smaliClass, smaliFile, smaliMethod } from "./apk";
import type { Procedure } from "./procedures";
import { newestFirst } from "../lib/version";


const ACC_NATIVE = 0x100;
const OPEN_FILES = 64;
const KEPT_CLASSES = 48;

type JadxMethod = {
  readonly addr: string;
  readonly name: string;
  /** The class file under sources/ that holds this method. */
  readonly file: string;
  /** The class as jadx names it inside that file (Outer.Inner). */
  readonly owner: string;
  readonly signature: string;
  /** The call graph's key for it (Outer$Inner.method(sig)). */
  readonly key: string;
};

type JadxIndex = {
  readonly methods: readonly JadxMethod[];
  readonly natives: readonly TableRow[];
  /** Each class file's top-level class, which jadx needs to re-read it as bytecode. */
  readonly tops: Readonly<Record<string, string>>;
  /** Class files with no code of their own (interfaces, constants, R), which the method list alone would hide. */
  readonly bare: readonly string[];
};

type Graph = { readonly callers: ReadonlyMap<string, readonly string[]>; readonly callees: ReadonlyMap<string, readonly string[]> };

export type JadxApp = {
  readonly functions: readonly Fn[];
  /** native methods: where the Java side calls into the app's own .so libraries. */
  readonly natives: readonly TableRow[];
  readonly bare: readonly string[];
  /** String resources by name. */
  readonly strings: readonly TableRow[];
  readonly files: ApkFiles;
  readonly code: (addr: string, view: "pseudo" | "asm") => Promise<string>;
  readonly refs: (addr: string) => Promise<Refs>;
  readonly source: (file: string) => Promise<SourceText>;
};

function records(value: unknown, key: string): readonly JsonRecord[] {
  const field = isRecord(value) ? value[key] : undefined;
  return Array.isArray(field) ? field.filter(isRecord) : [];
}

const JADX = OS === "windows" ? "jadx.bat" : "jadx";

/** The arch an opened Android app gets, which routes it to jadx instead of Ghidra. */
export const DALVIK = "dalvik";

/** jadx from ELEVEN_JADX, the PATH, or the newest copy unpacked in ~/.local/share. */
export function jadxCommand(): string | null {
  const chosen = process.env.ELEVEN_JADX;
  if (chosen && existsSync(chosen)) return chosen;
  const dirs = (process.env.PATH ?? "").split(delimiter).concat("/opt/homebrew/bin", "/usr/local/bin");
  const onPath = dirs.filter(Boolean).map((dir) => join(dir, JADX)).find((bin) => existsSync(bin));
  if (onPath) return onPath;
  const share = join(homedir(), ".local", "share");
  if (!existsSync(share)) return null;
  const copies = readdirSync(share).filter((name) => name.startsWith("jadx-")).sort(newestFirst((name) => name));
  return copies.map((name) => join(share, name, "bin", JADX)).find((bin) => existsSync(bin)) ?? null;
}

function head(path: string, size: number): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(size);
    return buf.toString("latin1", 0, readSync(fd, buf, 0, size, 0));
  } finally {
    closeSync(fd);
  }
}

/** True for a .dex file, or a zip (APK, AAR, a split's base) that carries classes.dex. */
export function isAndroidCode(path: string): boolean {
  try {
    const magic = head(path, 4);
    if (magic === "dex\n") return true;
    if (magic !== "PK\u0003\u0004") return false;
    const [lister, args] = zipListing(path);
    const listing = runSync(lister, args, { maxBuffer: 64 << 20 });
    return listing.split(/\r?\n/).some((entry) => /^classes\d*\.dex$/.test(entry));
  } catch {
    return false;
  }
}

function dexNumber(dex: string): bigint {
  const n = /^classes(\d*)\.dex$/.exec(dex)?.[1];
  return n ? BigInt(n) : 1n;
}

/** Dex offsets restart in every classesN.dex, so the dex number goes in the high bits. */
function address(dex: string, offset: string): string {
  return `0x${((dexNumber(dex) << 32n) + BigInt(offset)).toString(16)}`;
}

type Collected = { readonly methods: JadxMethod[]; readonly natives: TableRow[] };

function collect(node: JsonRecord, file: string, raw: ReadonlyMap<string, string>, inherited: string, into: Collected): void {
  const owner = stringField(node, "name") ?? "";
  const rawOwner = raw.get(owner) ?? owner;
  const dex = stringField(node, "dex") ?? inherited;
  for (const method of records(node, "methods")) {
    const signature = stringField(method, "signature");
    const name = stringField(method, "name");
    const offset = stringField(method, "offset");
    if (!signature || !name || !offset) continue;
    const flags = method["access-flags"];
    if (typeof flags === "number" && (flags & ACC_NATIVE) !== 0) into.natives.push({ a: rawOwner, b: name });
    else if (BigInt(offset) > 0n) into.methods.push({ addr: address(dex, offset), name: `${rawOwner}.${name}`, file, owner, signature, key: `${rawOwner}.${signature}` });
  }
  for (const inner of records(node, "inner-classes")) collect(inner, file, raw, dex, into);
}

/** A class file, or null for the synthetic classes jadx folds into others and never writes. */
async function readClass(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function buildIndex(dir: string): Promise<JadxIndex> {
  const mapping: unknown = JSON.parse(await readFile(join(dir, "sources", "mapping.json"), "utf8"));
  const raw = new Map<string, string>();
  const tops: Record<string, string> = {};
  for (const entry of records(mapping, "classes")) {
    const name = stringField(entry, "name");
    const file = stringField(entry, "json");
    if (!name || !file) continue;
    raw.set(name.replaceAll("$", "."), name);
    if (entry.inner !== true) tops[file] = name;
  }
  const into: Collected = { methods: [], natives: [] };
  const bare: string[] = [];
  const files = Object.keys(tops);
  for (let at = 0; at < files.length; at += OPEN_FILES) {
    const batch = files.slice(at, at + OPEN_FILES);
    const parsed = await Promise.all(batch.map((file) => readClass(join(dir, "sources", file))));
    parsed.forEach((node, ix) => {
      if (!isRecord(node)) return;
      const file = batch[ix] ?? "";
      const before = into.methods.length;
      collect(node, file, raw, "classes.dex", into);
      if (into.methods.length === before) bare.push(file.replace(/\.json$/, ".java"));
    });
  }
  return { methods: into.methods, natives: into.natives, tops, bare };
}

function isIndex(value: unknown): value is JadxIndex {
  return isRecord(value) && Array.isArray(value.methods) && Array.isArray(value.natives) && isRecord(value.tops) && Array.isArray(value.bare);
}

async function decompile(jadx: string, path: string, dir: string): Promise<void> {
  const partial = `${dir}.partial`;
  await rm(partial, { recursive: true, force: true });
  try {
    await run(jadx, ["--output-format", "json", "--call-graph", "json", "--log-level", "error", "-d", partial, path], { maxBuffer: 64 << 20 });
  } catch {
    // jadx exits non-zero when some methods don't decompile; the rest is still there
  }
  if (!existsSync(join(partial, "sources", "mapping.json"))) {
    await rm(partial, { recursive: true, force: true });
    throw new Error("Eleven couldn't read the Java code in this app. The file may be damaged or protected.");
  }
  await rm(dir, { recursive: true, force: true });
  await rename(partial, dir);
}

/** jadx's output and Eleven's index of it, decompiled once per file and cached by its SHA-256. */
async function loadIndex(path: string, sha256: string): Promise<{ readonly dir: string; readonly index: JadxIndex }> {
  const dir = join(cacheDir(), sha256, "jadx");
  const file = join(dir, "eleven-index.json");
  if (existsSync(file)) {
    const cached: unknown = JSON.parse(await readFile(file, "utf8"));
    if (isIndex(cached)) return { dir, index: cached };
  }
  if (!existsSync(join(dir, "sources", "mapping.json"))) {
    const jadx = jadxCommand();
    if (!jadx) throw new Error("Reading Android apps needs jadx. Install it with brew install jadx, then open the app again.");
    await mkdir(dirname(dir), { recursive: true });
    await decompile(jadx, path, dir);
  }
  const index = await buildIndex(dir);
  await writeFile(file, JSON.stringify(index));
  return { dir, index };
}

function append(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

async function loadGraph(dir: string): Promise<Graph> {
  const file = join(dir, "callgraph.json");
  const callers = new Map<string, string[]>();
  const callees = new Map<string, string[]>();
  if (!existsSync(file)) return { callers, callees };
  const graph: unknown = JSON.parse(await readFile(file, "utf8"));
  const names = new Map<number, string>();
  for (const node of records(graph, "nodes")) {
    const method = stringField(node, "method");
    if (typeof node.id === "number" && method) names.set(node.id, method);
  }
  for (const edge of records(graph, "edges")) {
    const from = typeof edge.from === "number" ? names.get(edge.from) : undefined;
    const to = typeof edge.to === "number" ? names.get(edge.to) : undefined;
    if (!from || !to) continue;
    append(callers, to, from);
    append(callees, from, to);
  }
  return { callers, callees };
}

function findClass(node: unknown, owner: string): JsonRecord | null {
  if (!isRecord(node)) return null;
  if (stringField(node, "name") === owner) return node;
  for (const inner of records(node, "inner-classes")) {
    const found = findClass(inner, owner);
    if (found) return found;
  }
  return null;
}

function methodText(method: JsonRecord, withOffsets: boolean): string {
  const declaration = (stringField(method, "declaration") ?? "").trim();
  const lines = records(method, "lines").map((line) => {
    const code = stringField(line, "code") ?? "";
    return withOffsets ? `${(stringField(line, "offset") ?? "").padEnd(10)}${code.trimStart()}` : `    ${code}`;
  });
  const first = lines.findIndex((line) => line.trim() !== "");
  return [`${declaration} {`, ...(first < 0 ? [] : lines.slice(first)), "}"].join("\n");
}

const INDENT = "    ";
/** Kotlin's @Metadata annotation is compiler data, not something anyone reads. */
const METADATA = /^@Metadata\(/;

function declarationLines(value: unknown): readonly string[] {
  return (stringField(value, "declaration") ?? "").trim().split("\n").filter((line) => !METADATA.test(line));
}

type Start = { readonly line: number; readonly owner: string; readonly signature: string };

/** One class as Java lines, noting the line each method's signature ends on. */
function classLines(node: JsonRecord, depth: number, starts: Start[], out: string[]): void {
  const pad = INDENT.repeat(depth);
  const owner = stringField(node, "name") ?? "";
  const head = declarationLines(node);
  head.forEach((line, ix) => out.push(`${pad}${ix === head.length - 1 ? `${line.trimEnd()} {` : line}`));
  for (const field of records(node, "fields")) for (const line of declarationLines(field)) out.push(`${pad}${INDENT}${line}`);
  for (const method of records(node, "methods")) {
    out.push("");
    const body = records(method, "lines").map((line) => stringField(line, "code") ?? "");
    const first = body.findIndex((line) => line.trim() !== "");
    const declaration = declarationLines(method);
    declaration.forEach((line, ix) => out.push(`${pad}${INDENT}${line}${ix === declaration.length - 1 ? (body.length > 0 ? " {" : ";") : ""}`));
    const signature = stringField(method, "signature");
    if (signature) starts.push({ line: out.length, owner, signature });
    if (body.length === 0) continue;
    for (const line of first < 0 ? [] : body.slice(first)) out.push(`${pad}${INDENT}${INDENT}${line}`);
    out.push(`${pad}${INDENT}}`);
  }
  for (const inner of records(node, "inner-classes")) {
    out.push("");
    classLines(inner, depth + 1, starts, out);
  }
  out.push(`${pad}}`);
}

/** A class file as the Java jadx would print: package, imports, then the class and its inner classes. */
function fileLines(node: JsonRecord, starts: Start[]): readonly string[] {
  const out: string[] = [];
  const pkg = stringField(node, "package");
  if (pkg) out.push(`package ${pkg};`, "");
  const imports = Array.isArray(node.imports) ? node.imports.filter((entry): entry is string => typeof entry === "string") : [];
  if (imports.length > 0) out.push(...imports.map((name) => `import ${name};`), "");
  classLines(node, 0, starts, out);
  return out;
}

/** One opened Android app: its index, class files read on demand, and the call graph once someone asks. */
class JadxSession {
  private readonly byAddr: ReadonlyMap<string, JadxMethod>;
  private readonly byKey: ReadonlyMap<string, string>;
  private readonly byOwner: ReadonlyMap<string, string>;
  private readonly classes = new Map<string, Promise<unknown>>();
  private graph: Promise<Graph> | null = null;

  constructor(private readonly path: string, private readonly dir: string, private readonly index: JadxIndex) {
    this.byAddr = new Map(index.methods.map((method) => [method.addr, method]));
    this.byKey = new Map(index.methods.map((method) => [method.key, method.addr]));
    this.byOwner = new Map(index.methods.map((method) => [`${method.owner}|${method.signature}`, method.addr]));
  }

  functions(): readonly Fn[] {
    return this.index.methods.map((method) => ({ addr: method.addr, name: method.name, kind: "function", file: method.file.replace(/\.json$/, ".java") }));
  }

  natives(): readonly TableRow[] {
    return this.index.natives;
  }

  bare(): readonly string[] {
    return this.index.bare;
  }

  private classFile(file: string, view: "pseudo" | "asm"): Promise<unknown> {
    const id = `${view}:${file}`;
    const known = this.classes.get(id);
    if (known) return known;
    if (this.classes.size >= KEPT_CLASSES) this.classes.delete(this.classes.keys().next().value ?? "");
    const pending = view === "pseudo" ? this.readJson(join(this.dir, "sources", file)) : this.bytecode(file);
    this.classes.set(id, pending);
    pending.catch(() => this.classes.delete(id));
    return pending;
  }

  private async readJson(file: string): Promise<unknown> {
    return JSON.parse(await readFile(file, "utf8"));
  }

  /** The class as raw Dalvik instructions, which jadx writes one class at a time. */
  private async bytecode(file: string): Promise<unknown> {
    const out = join(this.dir, "bytecode", file);
    if (!existsSync(out)) {
      const jadx = jadxCommand();
      const top = this.index.tops[file];
      if (!jadx || !top) throw new Error("Eleven can't show the bytecode for this class.");
      await mkdir(dirname(out), { recursive: true });
      try {
        await run(jadx, ["--single-class", top, "--decompilation-mode", "fallback", "--output-format", "json", "--single-class-output", out, "--log-level", "error", this.path], { maxBuffer: 64 << 20 });
      } catch {
        // as with the full run, a non-zero exit can still leave the class written
      }
      if (!existsSync(out)) throw new Error("Eleven couldn't read the bytecode for this class.");
    }
    return this.readJson(out);
  }

  /** The method as smali when apktool is installed and reads the app, else null for jadx's own bytecode. */
  private async smali(addr: string, method: JadxMethod): Promise<string | null> {
    const owner = method.key.slice(0, method.key.length - method.signature.length - 1);
    try {
      const text = await smaliClass(this.path, join(dirname(this.dir), "smali"), smaliFile(BigInt(addr) >> 32n, owner));
      return text === null ? null : smaliMethod(text, method.signature) || null;
    } catch {
      return null;
    }
  }

  async code(addr: string, view: "pseudo" | "asm"): Promise<string> {
    const method = this.byAddr.get(addr);
    if (!method) return "";
    if (view === "asm") {
      const smali = await this.smali(addr, method);
      if (smali) return smali;
    }
    const owner = findClass(await this.classFile(method.file, view), method.owner);
    const found = records(owner, "methods").find((entry) => stringField(entry, "signature") === method.signature);
    return found ? methodText(found, view === "asm") : "";
  }

  /** A whole class file (`com/foo/Bar.java`) as Java, with the line each known method starts on. */
  async source(file: string): Promise<SourceText> {
    const node = await this.classFile(file.replace(/\.java$/, ".json"), "pseudo");
    if (!isRecord(node)) throw new Error("Eleven couldn't read this file.");
    const starts: Start[] = [];
    const text = fileLines(node, starts).join("\n");
    return { text, starts: starts.flatMap((start) => {
      const addr = this.byOwner.get(`${start.owner}|${start.signature}`);
      return addr ? [{ line: start.line, addr }] : [];
    }) };
  }

  async refs(addr: string): Promise<Refs> {
    const method = this.byAddr.get(addr);
    if (!method) return { callers: [], callees: [] };
    this.graph ??= loadGraph(this.dir);
    const graph = await this.graph;
    const known = (keys: readonly string[] | undefined): readonly string[] => [...new Set((keys ?? []).flatMap((key) => this.byKey.get(key) ?? []))];
    const callers = known(graph.callers.get(method.key)).map((from): Caller => ({ addr: from, at: from }));
    return { callers, callees: known(graph.callees.get(method.key)) };
  }
}

declare global {
  var elevenJadxApps: Map<string, Promise<JadxSession>> | undefined;
}

const sessions = (globalThis.elevenJadxApps ??= new Map());

/** Opens an APK or .dex with jadx: Java and Kotlin as readable code, Dalvik bytecode, and the call graph. */
export async function openJadx(path: string, sha256: string): Promise<JadxApp> {
  let pending = sessions.get(sha256);
  if (!pending) {
    pending = (async () => {
      const { dir, index } = await loadIndex(path, sha256);
      return new JadxSession(path, dir, index);
    })();
    sessions.set(sha256, pending);
    pending.catch(() => sessions.delete(sha256));
  }
  const session = await pending;
  const dir = join(cacheDir(), sha256, "jadx");
  const [strings, files] = await Promise.all([readResourceStrings(dir), apkFiles(path, dir, join(cacheDir(), sha256, "apk"))]);
  return {
    functions: session.functions(),
    natives: session.natives(),
    bare: session.bare(),
    strings,
    files,
    code: (addr, view) => session.code(addr, view),
    refs: (addr) => session.refs(addr),
    source: (file) => session.source(file),
  };
}

/** An Android app's methods as procedures, so looking a function up by name never sends the app to Ghidra. */
export async function jadxProcedures(path: string, sha256: string): Promise<readonly Procedure[]> {
  return (await openJadx(path, sha256)).functions.map((fn) => ({ address: fn.addr, name: fn.name, kind: "Function" }));
}
