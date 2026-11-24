import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { basename, delimiter, dirname, join, relative } from "node:path";

import { cacheRoot, OS, zipExtract, zipListing } from "../lib/platform";
import { run, runSync } from "../lib/process";
import type { TableRow } from "../workbench/model";

/** Splits Play ships beside the base APK: per-ABI native code, per-density images, per-language strings. */
const SPLIT = /^(?:config|split_config|split)[._-].+\.apk$|\.config\.[^/]+\.apk$/i;
const NATIVE = /^lib\/[^/]+\/[^/]+\.so$/;

export function entries(zip: string): readonly string[] {
  try {
    const [lister, args] = zipListing(zip);
    return runSync(lister, args, { maxBuffer: 64 << 20 }).split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

/** The split APKs next to a base APK, so its native libraries and other parts come along. */
export function apkSplits(apk: string): readonly string[] {
  const dir = dirname(apk);
  try {
    return readdirSync(dir).filter((name) => SPLIT.test(name) && join(dir, name) !== apk).map((name) => join(dir, name));
  } catch {
    return [];
  }
}

function isZip(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const magic = Buffer.alloc(4);
    readSync(fd, magic, 0, 4, 0);
    return magic.toString("latin1") === "PK\u0003\u0004";
  } finally {
    closeSync(fd);
  }
}

/** For an .xapk, .apks or .zip of split APKs: the base APK, unpacked with its splits beside it; null for anything else. */
export function unpackBundle(path: string): string | null {
  if (!isZip(path)) return null;
  const listed = entries(path);
  if (listed.some((entry) => /^classes\d*\.dex$/.test(entry))) return null;
  const apks = listed.filter((entry) => entry.toLowerCase().endsWith(".apk"));
  if (apks.length === 0) return null;
  const { size, mtimeMs } = statSync(path);
  const dir = join(cacheRoot(), "bundles", createHash("sha256").update(`${path}:${size}:${mtimeMs}`).digest("hex").slice(0, 16));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    for (const entry of apks) {
      const [command, args] = zipExtract(path, entry, dir);
      runSync(command, args, { maxBuffer: 1 << 20 });
    }
  }
  const base = apks.filter((entry) => !SPLIT.test(basename(entry))).map((entry) => join(dir, entry));
  const biggest = base.sort((a, b) => statSync(b).size - statSync(a).size)[0];
  return biggest ?? null;
}

type Native = { readonly apk: string; readonly entry: string };

export type ApkFiles = {
  /** Every file in the app as a path inside it: AndroidManifest.xml, res/…, assets/…, lib/<abi>/….so. */
  readonly files: readonly string[];
  /** The file on disk, unpacked from the app the first time it's asked for. */
  readonly local: (file: string) => Promise<string>;
};

async function walk(root: string): Promise<readonly string[]> {
  if (!existsSync(root)) return [];
  const found = await readdir(root, { recursive: true, withFileTypes: true });
  return found.filter((entry) => entry.isFile()).map((entry) => relative(root, join(entry.parentPath, entry.name)).replaceAll("\\", "/"));
}

/** jadx's decoded resources plus the native libraries in the APK and its splits. */
export async function apkFiles(apk: string, jadxDir: string, unpackDir: string): Promise<ApkFiles> {
  const decoded = join(jadxDir, "resources");
  const natives = new Map<string, Native>();
  for (const zip of [apk, ...apkSplits(apk)]) {
    for (const entry of entries(zip)) if (NATIVE.test(entry) && !natives.has(entry)) natives.set(entry, { apk: zip, entry });
  }
  const files = [...(await walk(decoded)), ...natives.keys()].sort((a, b) => a.localeCompare(b));
  const local = async (file: string): Promise<string> => {
    const native = natives.get(file);
    if (!native) return join(decoded, file);
    const out = join(unpackDir, file);
    if (!existsSync(out)) {
      await mkdir(unpackDir, { recursive: true });
      const [command, args] = zipExtract(native.apk, native.entry, unpackDir);
      await run(command, args, { maxBuffer: 1 << 20 });
    }
    return out;
  };
  return { files, local };
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function unescape(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] ?? "")
    .replace(/\\n/g, "\n")
    .replace(/\\(['"@?])/g, "$1")
    .replace(/^"([\s\S]*)"$/, "$1");
}

/** The app's string resources (res/values/strings.xml) as name and text. */
export function resourceStrings(xml: string): readonly TableRow[] {
  return [...xml.matchAll(/<string\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g)].map((match) => ({ a: match[1] ?? "", b: unescape(match[2] ?? "") }));
}

export async function readResourceStrings(jadxDir: string): Promise<readonly TableRow[]> {
  try {
    return resourceStrings(await readFile(join(jadxDir, "resources", "res", "values", "strings.xml"), "utf8"));
  } catch {
    return [];
  }
}

const APKTOOL = OS === "windows" ? "apktool.bat" : "apktool";

/** apktool from ELEVEN_APKTOOL or the PATH, for smali. */
export function apktoolCommand(): string | null {
  const chosen = process.env.ELEVEN_APKTOOL;
  if (chosen && existsSync(chosen)) return chosen;
  const dirs = (process.env.PATH ?? "").split(delimiter).concat("/opt/homebrew/bin", "/usr/local/bin", "/opt/zerobrew/prefix/bin");
  return dirs.filter(Boolean).map((dir) => join(dir, APKTOOL)).find((bin) => existsSync(bin)) ?? null;
}

/** Every class as smali, decoded once by apktool into `dir`. */
async function decodeSmali(apktool: string, apk: string, dir: string): Promise<void> {
  const partial = `${dir}.partial`;
  await rm(partial, { recursive: true, force: true });
  await run(apktool, ["d", "-r", "--no-assets", "-f", "-o", partial, apk], { maxBuffer: 64 << 20, timeout: 600000 });
  await rm(dir, { recursive: true, force: true });
  await rename(partial, dir);
}

/** The smali folder for a dex: smali for classes.dex, smali_classesN for classesN.dex. */
export function smaliFile(dex: bigint, owner: string): string {
  return join(dex > 1n ? `smali_classes${dex}` : "smali", `${owner.replaceAll(".", "/")}.smali`);
}

/** One method out of a class's smali, from its `.method` line to `.end method`. */
export function smaliMethod(text: string, signature: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(".method ") && line.trimEnd().endsWith(` ${signature}`));
  if (start < 0) return "";
  const end = lines.findIndex((line, ix) => ix > start && line.startsWith(".end method"));
  return lines.slice(start, end < 0 ? undefined : end + 1).join("\n");
}

const decoding = new Map<string, Promise<void>>();

/** A class's smali, decoding the whole app with apktool the first time; null without apktool. */
export async function smaliClass(apk: string, dir: string, file: string): Promise<string | null> {
  const apktool = apktoolCommand();
  if (!apktool) return null;
  if (!existsSync(join(dir, "apktool.yml"))) {
    let pending = decoding.get(dir);
    if (!pending) {
      pending = decodeSmali(apktool, apk, dir);
      decoding.set(dir, pending);
      pending.catch(() => decoding.delete(dir));
    }
    await pending;
  }
  try {
    return readFileSync(join(dir, file), "utf8");
  } catch {
    return null;
  }
}

export type ResourceKind = "text" | "image" | "native" | "hermes" | "il2cpp" | "binary";

const IMAGE = /\.(?:png|jpe?g|gif|webp|bmp)$/i;
const HERMES_MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]);
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const MACHO_MAGIC = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xcafebabf]);

/** Java class files share the universal-binary magic, so they're told apart by name. */
function isMachO(file: string, head: Buffer): boolean {
  return head.length >= 4 && MACHO_MAGIC.has(head.readUInt32BE(0)) && !file.endsWith(".class");
}

/** What a file in the app is, from its name and first bytes. */
export function resourceKind(file: string, head: Buffer): ResourceKind {
  if (IMAGE.test(file)) return "image";
  if (head.subarray(0, 4).equals(ELF_MAGIC) || isMachO(file, head)) return "native";
  if (head.subarray(0, 8).equals(HERMES_MAGIC)) return "hermes";
  if (/(?:^|\/)global-metadata\.dat$/.test(file)) return "il2cpp";
  return head.includes(0) ? "binary" : "text";
}

const IL2CPP_SANITY = 0xfab11baf;

/** Unity IL2CPP metadata: its version when the header is Unity's own, or encrypted when a game hid it, which most do. */
export type Il2cppMetadata = { readonly kind: "plain"; readonly version: number } | { readonly kind: "encrypted" };

export function il2cppMetadata(head: Buffer): Il2cppMetadata {
  if (head.length >= 8 && head.readUInt32LE(0) === IL2CPP_SANITY) return { kind: "plain", version: head.readInt32LE(4) };
  return { kind: "encrypted" };
}

/** The Hermes bytecode version, right after the magic; decompilers each support only some versions. */
export function hermesVersion(head: Buffer): number | null {
  return head.length >= 12 && head.subarray(0, 8).equals(HERMES_MAGIC) ? head.readUInt32LE(8) : null;
}

const DART_SNAPSHOT_MAGIC = Buffer.from([0xf5, 0xf5, 0xdc, 0xdc]);

/** What built a Dart AOT snapshot: the SDK's snapshot hash (which names the Dart version) and the features it was built with. */
export type DartSnapshot = { readonly hash: string; readonly features: string };

/** Finds the first Dart snapshot header in a library: magic, 8-byte length, 8-byte kind, a 32-character hash, then the features as text. */
export function dartSnapshot(bytes: Buffer): DartSnapshot | null {
  for (let at = bytes.indexOf(DART_SNAPSHOT_MAGIC); at >= 0; at = bytes.indexOf(DART_SNAPSHOT_MAGIC, at + 1)) {
    const hash = bytes.subarray(at + 20, at + 52).toString("latin1");
    if (!/^[0-9a-f]{32}$/.test(hash)) continue;
    const end = bytes.indexOf(0, at + 52);
    return { hash, features: bytes.subarray(at + 52, end < 0 ? at + 52 : Math.min(end, at + 52 + 400)).toString("latin1").trim() };
  }
  return null;
}

/** A Flutter app's own Dart code, compiled ahead of time into this library beside the Flutter engine. */
export function isFlutterCode(file: string): boolean {
  return /(?:^|\/)(?:libapp\.so|App\.framework\/App)$/.test(file);
}

/** Offset, sixteen bytes and their printable text per line, like `xxd`. */
export function hexDump(bytes: Buffer): string {
  const lines: string[] = [];
  for (let at = 0; at < bytes.length; at += 16) {
    const row = bytes.subarray(at, at + 16);
    const hex = [...row].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
    const text = [...row].map((byte) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ".")).join("");
    lines.push(`${at.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${text}`);
  }
  return lines.join("\n");
}

export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1 << 20) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1 << 20)).toFixed(1)} MB`;
}
