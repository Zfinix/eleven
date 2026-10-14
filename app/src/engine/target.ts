import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { isElevenFile, openDocument } from "./document";
import { unpackBundle } from "./apk";
import { DALVIK, isAndroidCode } from "./jadx";
import { cacheRoot, OS } from "../lib/platform";
import { binaryInfoOf, type Slice } from "./binaryInfo";
import { runSync } from "../lib/process";

export type TargetKind = "binary" | "app" | "gpu" | "model";

export type Target = {
  /** What the user picked: an app bundle or a file. */
  readonly original: string;
  /** The single-architecture binary REA analyzes. */
  readonly path: string;
  readonly name: string;
  readonly meta: string;
  readonly arch: string;
  readonly kind: TargetKind;
};

const KINDS: readonly TargetKind[] = ["binary", "app", "gpu", "model"];

function isKind(value: string): value is TargetKind {
  return KINDS.some((kind) => kind === value);
}

const HOST_SLICES = ["arm64e", "arm64"] as const;
const SLICE_DIR = join(cacheRoot(), "slices");

function tool(command: string, args: readonly string[]): string {
  try {
    return runSync(command, [...args]).trim();
  } catch {
    return "";
  }
}

function plistExecutable(app: string): string {
  try {
    const plist = readFileSync(join(app, "Contents", "Info.plist"), "utf8");
    const fromXml = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1];
    if (fromXml) return fromXml;
  } catch {
    return "";
  }
  return OS === "mac" ? tool("plutil", ["-extract", "CFBundleExecutable", "raw", join(app, "Contents", "Info.plist")]) : "";
}

function bundleExecutable(app: string): string {
  const name = plistExecutable(app) || basename(app, ".app");
  const exe = join(app, "Contents", "MacOS", name);
  return name && existsSync(exe) ? exe : app;
}

function kindOf(name: string, isApp: boolean): TargetKind {
  if (isApp) return "app";
  if (/\.(metallib|spv|air|ptx|cubin|fatbin|hipfb|hsaco|co)$/i.test(name)) return "gpu";
  if (/\.(mlmodelc|gguf|safetensors|onnx|pt|tflite)$/i.test(name)) return "model";
  return "binary";
}

/** Copies one architecture out of a universal binary, the way `lipo -thin` does, on any OS. */
function thinSlice(executable: string, slice: Slice): string {
  const digest = createHash("sha256").update(readFileSync(executable)).digest("hex").slice(0, 16);
  const dir = join(SLICE_DIR, digest);
  const thin = join(dir, `${basename(executable)}-${slice.arch}`);
  if (existsSync(thin)) return thin;
  mkdirSync(dir, { recursive: true });
  const bytes = Buffer.alloc(slice.size);
  const fd = openSync(executable, "r");
  try {
    readSync(fd, bytes, 0, slice.size, slice.offset);
  } finally {
    closeSync(fd);
  }
  writeFileSync(thin, bytes);
  return thin;
}

/** Resolves an app bundle to its executable, a universal Mach-O to its arm64 slice, and reads the arch of ELF and PE files. */
export function prepareTarget(original: string, pick: string | null = null): Target {
  if (isElevenFile(original)) {
    const { manifest, binary } = openDocument(original);
    return { original, path: binary, name: manifest.name, meta: manifest.meta, arch: manifest.arch, kind: isKind(manifest.kind) ? manifest.kind : "binary" };
  }
  const isApp = original.endsWith(".app") && statSync(original).isDirectory();
  const executable = isApp ? bundleExecutable(original) : original;
  const { format, slices } = binaryInfoOf(executable, statSync(executable).size);
  const base = { original, name: basename(original), kind: kindOf(basename(original), isApp) };
  if (!isApp && isAndroidCode(executable)) return { ...base, path: executable, arch: DALVIK, meta: "Android · Dalvik" };
  const splitApp = isApp ? null : unpackBundle(executable);
  if (splitApp) return { ...base, path: splitApp, arch: DALVIK, meta: "Android · Dalvik · split app" };
  const archs = slices.map((s) => s.arch);
  if (slices.length > 1) {
    const arch = pick !== null && archs.includes(pick) ? pick : HOST_SLICES.find((a) => archs.includes(a)) ?? archs[0] ?? "";
    const slice = slices.find((s) => s.arch === arch) ?? slices[0];
    if (slice) return { ...base, path: thinSlice(executable, slice), arch: slice.arch, meta: `${format} · universal · ${slices.length} slices` };
  }
  const arch = archs[0] ?? "";
  const shown = format === "File" ? "" : format;
  return { ...base, path: executable, arch, meta: [shown, arch].filter(Boolean).join(" · ") };
}
