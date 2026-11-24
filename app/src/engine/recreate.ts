import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";

import { engineHint } from "../analysis/hint";
import { cacheRoot } from "../lib/platform";
import type { SourceText } from "../workbench/model";
import { askQuietly, codeSoFar, type QuietAsk, type RewriteProgress } from "./rewrite";

export type SourceLanguage = { readonly label: string; readonly fence: string };

const LANGUAGES: Readonly<Record<string, SourceLanguage>> = {
  swift: { label: "Swift", fence: "swift" },
  m: { label: "Objective-C", fence: "objc" },
  mm: { label: "Objective-C++", fence: "objcpp" },
  c: { label: "C", fence: "c" },
  h: { label: "C", fence: "c" },
  cc: { label: "C++", fence: "cpp" },
  cpp: { label: "C++", fence: "cpp" },
  cxx: { label: "C++", fence: "cpp" },
  hh: { label: "C++", fence: "cpp" },
  hpp: { label: "C++", fence: "cpp" },
  metal: { label: "Metal", fence: "metal" },
  rs: { label: "Rust", fence: "rust" },
  go: { label: "Go", fence: "go" },
  kt: { label: "Kotlin", fence: "kotlin" },
  java: { label: "Java", fence: "java" },
};

export function languageOf(file: string): SourceLanguage {
  return LANGUAGES[(file.split(".").pop() ?? "").toLowerCase()] ?? { label: "its original language", fence: "" };
}

export type RecreateFn = { readonly name: string; readonly addr: string; readonly why: string };

/** Everything Eleven traced to one source file, for the agent to write the file back from. */
export type RecreateRequest = QuietAsk & {
  readonly binary: { readonly path: string; readonly name: string; readonly arch: string };
  readonly file: string;
  readonly types: readonly string[];
  readonly fns: readonly RecreateFn[];
  readonly strings: readonly string[];
  /** Pseudocode for the first few functions; the agent reads the rest itself. */
  readonly pseudocode: readonly { readonly name: string; readonly addr: string; readonly code: string }[];
};

/** The parts of a request a saved recreation is keyed by. */
export type RecreateKey = Pick<RecreateRequest, "projectId" | "agent" | "file" | "types" | "fns">;

const MAX_LISTED = 60;
const MARKER = /^[ \t]*\/\/[ \t]*@(0[xX][0-9a-fA-F]+)[ \t]*$/;

export function recreatePrompt(req: RecreateRequest): string {
  const language = languageOf(req.file);
  const listed = req.fns.slice(0, MAX_LISTED);
  return [
    `Recreate the source file ${req.file} that ${req.binary.name} (${req.binary.arch}) was built from, as ${language.label}. The binary is at ${req.binary.path}.`,
    engineHint(req.binary.path, req.binary.arch),
    "Eleven traced the parts below to this file. Read them, and whatever else helps: the functions they call, their callers, the strings and data they touch. Only read; don't rename, comment or patch anything.",
    "",
    ...(req.types.length ? ["Types:", ...req.types.map((type) => `- ${type}`), ""] : []),
    ...(listed.length
      ? ["Functions:", ...listed.map((fn) => `- ${fn.name} at ${fn.addr}: ${fn.why}`), ...(req.fns.length > listed.length ? [`- and ${req.fns.length - listed.length} more`] : []), ""]
      : ["Nothing in the binary points to the file directly. Find its code yourself from the types and strings here.", ""]),
    ...(req.strings.length ? ["Strings that mention it:", ...req.strings.map((text) => `- ${JSON.stringify(text)}`), ""] : []),
    "Write the whole file the way its author likely wrote it: imports, type declarations, stored properties, then methods. Keep the behavior exactly. Name things from what the code makes clear, and keep unknown calls by their current names.",
    "Where the binary doesn't show something and you filled it in (a field, a type, a parameter name, a default value, a missing branch), end that line with `// guessed`, so the reader knows what you inferred rather than read. Never fill a gap silently.",
    "Right above each declaration that comes from one of the functions above, put a line with only `// @` and its address, for example `// @0x1000a3184`. Eleven turns those into links and removes them.",
    `Reply with one \`\`\`${language.fence} code block holding the whole file, and nothing else.`,
    ...req.pseudocode.flatMap((fn) => ["", `Pseudocode of ${fn.name} (${fn.addr}):`, "```c", fn.code, "```"]),
  ].join("\n");
}

/** The file without its address markers, each marker becoming a link on the line under it. */
export function recreatedSource(code: string): SourceText {
  const lines: string[] = [];
  const starts: { line: number; addr: string }[] = [];
  let pending: string | null = null;
  for (const line of code.split("\n")) {
    const marker = MARKER.exec(line);
    if (marker?.[1]) {
      pending = marker[1].toLowerCase();
      continue;
    }
    lines.push(line);
    if (pending && line.trim()) {
      starts.push({ line: lines.length, addr: pending });
      pending = null;
    }
  }
  return { text: lines.join("\n").replace(/\s+$/, ""), starts };
}

function withoutMarkers(code: string): string {
  return code.split("\n").filter((line) => !MARKER.test(line)).join("\n");
}

function fileDir(projectId: string, file: string): string {
  return join(cacheRoot(), "recreated", projectId, encodeURIComponent(file));
}

function savedDir(key: RecreateKey): string {
  const hash = createHash("sha256").update(JSON.stringify([key.types, key.fns.map((fn) => fn.addr)])).digest("hex").slice(0, 16);
  return join(fileDir(key.projectId, key.file), hash, key.agent.id);
}

/** Where the recreated file is saved, under its own name so an agent can open it. */
export function savedPath(key: RecreateKey): string {
  return join(savedDir(key), key.file.split("/").pop() ?? key.file);
}

export async function savedRecreation(key: RecreateKey): Promise<SourceText | null> {
  try {
    return recreatedSource(await readFile(join(savedDir(key), "reply.txt"), "utf8"));
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

/** Calls `listener` whenever a file is recreated or forgotten; returns the unsubscribe. */
export function watchRecreated(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The files in a project that have a saved recreation by any agent. */
export async function recreatedFiles(projectId: string): Promise<ReadonlySet<string>> {
  try {
    const entries = await readdir(join(cacheRoot(), "recreated", projectId), { recursive: true });
    return new Set(entries.filter((entry) => entry.endsWith("reply.txt")).map((entry) => decodeURIComponent(entry.split(sep)[0] ?? "")));
  } catch {
    return new Set();
  }
}

const running = new Map<string, Promise<SourceText>>();

async function recreateFresh(req: RecreateRequest, onProgress: (progress: RewriteProgress) => void): Promise<SourceText> {
  const reply = await askQuietly(req, recreatePrompt(req), (progress) => onProgress({ ...progress, code: progress.code === null ? null : withoutMarkers(progress.code) }));
  const code = codeSoFar(reply) ?? reply;
  const source = recreatedSource(code);
  await mkdir(savedDir(req), { recursive: true });
  await writeFile(join(savedDir(req), "reply.txt"), code);
  await writeFile(savedPath(req), source.text);
  for (const listener of listeners) listener();
  return source;
}

/** Has the agent write the whole file back; saved, so reopening it is instant. Progress streams the code with markers hidden. */
export async function recreate(req: RecreateRequest, onProgress: (progress: RewriteProgress) => void = () => {}): Promise<SourceText> {
  const saved = await savedRecreation(req);
  if (saved) return saved;
  const dir = savedDir(req);
  const pending = running.get(dir) ?? recreateFresh(req, onProgress);
  running.set(dir, pending);
  try {
    return await pending;
  } finally {
    running.delete(dir);
  }
}

export async function forgetRecreation(key: RecreateKey): Promise<void> {
  await rm(savedDir(key), { recursive: true, force: true });
  for (const listener of listeners) listener();
}
