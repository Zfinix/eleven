import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { askQuietly, type QuietAsk, type RewriteProgress } from "../engine/rewrite";
import type { SwiftType } from "../engine/swiftTypes";
import { errorMessage, isRecord, stringField } from "../lib/guards";
import { cacheRoot } from "../lib/platform";
import { t } from "../i18n";
import type { Fn, TableRow } from "./model";
import { originOf } from "./sidebar/model";
import { type SourceFiles, stemOf, traceStatic } from "./sources";

/** How a file got its place: its path is in the binary, it sits next to files that are, or the agent grouped it. */
export type Placement = "exact" | "neighbour" | "guess";

const PLACEMENTS: readonly Placement[] = ["exact", "neighbour", "guess"];

export type ArrangedFile = {
  /** The key the source tab opens it by: the path as the binary spells it, `<Type>.swift`, or the agent's name. */
  readonly key: string;
  /** Where it shows in the tree, relative to the project folder. */
  readonly path: string;
  readonly placement: Placement;
  readonly reason: readonly Why[];
  readonly fns: readonly string[];
};

/** One part of why a file sits where it does, kept as data so it reads in the language picked when shown. */
export type Why =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "type"; readonly type: string }
  | { readonly kind: "neighbours"; readonly count: number }
  | { readonly kind: "beside"; readonly file: string }
  | { readonly kind: "grouped" }
  | { readonly kind: "folder"; readonly folder: string; readonly said: string }
  | { readonly kind: "said"; readonly text: string };

const WHY_KINDS: readonly Why["kind"][] = ["path", "type", "neighbours", "beside", "grouped", "folder", "said"];

export type Arrangement = { readonly files: readonly ArrangedFile[]; readonly unplaced: readonly string[] };

export type ArrangeStep = { readonly label: string; readonly done: boolean };

/** Why the agent couldn't finish, as far as its error says: it needs a sign-in, hit a usage limit, can't be reached, or just stopped. */
export type FailReason = "signin" | "limit" | "stopped" | "offline";

const SIGN_IN = /auth|sign.?in|log.?in|credential|api key/i;
const LIMIT = /limit|quota|usage|too many|429|overloaded/i;
const OFFLINE = /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|offline|fetch failed|getaddrinfo/i;

export function failureReason(message: string): FailReason {
  if (SIGN_IN.test(message)) return "signin";
  if (LIMIT.test(message)) return "limit";
  if (OFFLINE.test(message)) return "offline";
  return "stopped";
}

/** What happened and what to do, in one or two plain sentences, for the card under Source files. */
export function failureText(reason: FailReason, agent: string, left: number): string {
  const rest = left === 1 ? t("workbench.arrange.otherOne") : t("workbench.arrange.others", { count: left.toLocaleString() });
  switch (reason) {
    case "signin":
      return t("workbench.arrange.signin", { agent, rest });
    case "limit":
      return t("workbench.arrange.limit", { agent, rest });
    case "stopped":
      return t("workbench.arrange.stopped", { agent, rest });
    case "offline":
      return t("workbench.arrange.offline", { agent, rest });
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}

function whyText(why: Why): string {
  switch (why.kind) {
    case "path":
      return t("workbench.arrange.why.path", { path: why.path });
    case "type":
      return t("workbench.arrange.why.type", { type: why.type });
    case "neighbours":
      return why.count === 1 ? t("workbench.arrange.why.neighbour") : t("workbench.arrange.why.neighbours", { count: why.count.toLocaleString() });
    case "beside":
      return t("workbench.arrange.why.beside", { file: why.file });
    case "grouped":
      return t("workbench.arrange.why.grouped");
    case "folder":
      return why.said ? t("workbench.arrange.why.folderBecause", { folder: why.folder, reason: why.said }) : t("workbench.arrange.why.folder", { folder: why.folder });
    case "said":
      return why.text;
    default: {
      const unhandled: never = why;
      return unhandled;
    }
  }
}

/** Why a file sits where it does, in the current language; the agent's own words stay as it wrote them. */
export function reasonText(reason: readonly Why[]): string {
  return reason.map(whyText).reduce((first, next) => (first ? t("workbench.arrange.why.then", { first, next }) : next), "");
}

/** An arrangement, and why the agent couldn't finish it when it couldn't; such a run isn't saved, so the next one tries again. */
export type ArrangeResult = Arrangement & { readonly agentFailed: string | null };

const MAX_FOR_AGENT = 400;
const MIN_FNS_FOR_AGENT = 5;
const MIN_FILES_TO_SORT = 8;
const MAX_LISTED_FILES = 80;

function sortedByAddress(fns: readonly Fn[]): readonly Fn[] {
  return [...fns].sort((a, b) => (BigInt(a.addr) < BigInt(b.addr) ? -1 : BigInt(a.addr) > BigInt(b.addr) ? 1 : 0));
}

/** The folder the binary's paths share, dropped so the tree starts at the project, not at the build machine's home. */
function commonPrefix(paths: readonly string[]): string {
  const split = paths.map((path) => path.split("/").slice(0, -1));
  const first = split[0] ?? [];
  let n = 0;
  while (n < first.length && split.every((parts) => parts[n] === first[n])) n++;
  return first.slice(0, Math.max(0, n - 1)).join("/");
}

function relative(path: string, prefix: string): string {
  return prefix && path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : path.replace(/^\/+/, "");
}

/** Step one and two: files from paths and types, then each run of unplaced functions between two functions of one file joins it. */
export function arrangeFromEvidence(functions: readonly Fn[], strings: readonly TableRow[], types: readonly SwiftType[], sources: SourceFiles): Arrangement {
  const yours = functions.filter((fn) => originOf(fn, fn.name) === "yours");
  const owner = new Map<string, string>();
  const files = new Map<string, { key: string; path: string; placement: Placement; reason: readonly Why[] }>();
  const prefix = commonPrefix(sources.paths);
  for (const path of sources.paths) {
    const trace = traceStatic(path, false, types, yours, strings);
    files.set(path, { key: path, path: relative(path, prefix), placement: "exact", reason: [{ kind: "path", path }] });
    for (const fn of trace.fns) if (!owner.has(fn.addr)) owner.set(fn.addr, path);
  }
  for (const guess of sources.guessed) {
    const trace = traceStatic(guess.file, true, types, yours, strings);
    if (trace.fns.length === 0) continue;
    files.set(guess.file, { key: guess.file, path: guess.file, placement: "neighbour", reason: [{ kind: "type", type: guess.type }] });
    for (const fn of trace.fns) if (!owner.has(fn.addr)) owner.set(fn.addr, guess.file);
  }
  const order = sortedByAddress(yours);
  const filled = fillBetween(order, owner);
  for (const [key, count] of filled) {
    const file = files.get(key);
    if (!file || count === 0) continue;
    file.reason = [...file.reason, { kind: "neighbours", count }];
  }
  placeGuessedFolders(files, order, owner);
  const byFile = new Map<string, string[]>();
  for (const [addr, file] of owner) byFile.set(file, [...(byFile.get(file) ?? []), addr]);
  const arranged = [...files.values()].flatMap((file): ArrangedFile[] => {
    const fns = byFile.get(file.key) ?? [];
    return fns.length > 0 ? [{ ...file, fns }] : [];
  });
  return { files: arranged.sort((a, b) => a.path.localeCompare(b.path)), unplaced: order.filter((fn) => !owner.has(fn.addr)).map((fn) => fn.addr) };
}

/**
 * Compilers lay each source file's code out in one block, so unplaced functions between two placed ones join them:
 * the whole run when both sides are the same file, else split at the midpoint. Returns how many each file gained.
 */
function fillBetween(order: readonly Fn[], owner: Map<string, string>): ReadonlyMap<string, number> {
  const gained = new Map<string, number>();
  const give = (addr: string, file: string): void => {
    owner.set(addr, file);
    gained.set(file, (gained.get(file) ?? 0) + 1);
  };
  let last: string | null = null;
  let run: string[] = [];
  for (const fn of order) {
    const file = owner.get(fn.addr);
    if (!file) {
      run.push(fn.addr);
      continue;
    }
    if (last !== null) {
      const before = last;
      const half = last === file ? run.length : Math.ceil(run.length / 2);
      run.forEach((addr, ix) => give(addr, ix < half ? before : file));
    }
    run = [];
    last = file;
  }
  return gained;
}

/** A file named after its type has no folder of its own; it goes in the folder of the file its code sits beside. */
function placeGuessedFolders(files: Map<string, { key: string; path: string; placement: Placement; reason: readonly Why[] }>, order: readonly Fn[], owner: ReadonlyMap<string, string>): void {
  for (const file of files.values()) {
    if (file.placement !== "neighbour") continue;
    const at = order.findIndex((fn) => owner.get(fn.addr) === file.key);
    if (at < 0) continue;
    const near = [...order.slice(0, at)].reverse().concat(order.slice(at + 1)).map((fn) => owner.get(fn.addr)).find((key) => key && files.get(key)?.placement === "exact");
    const folder = near ? dirname(files.get(near)?.path ?? "") : ".";
    if (folder !== ".") {
      file.path = `${folder}/${file.path}`;
      file.reason = [...file.reason, { kind: "beside", file: near?.split("/").pop() ?? "" }];
    }
  }
}

/** Files whose folder nothing in the binary gives: the ones the agent may sort into folders. */
function loose(files: readonly ArrangedFile[]): readonly ArrangedFile[] {
  return files.filter((file) => file.placement !== "exact");
}

export function arrangePrompt(binaryName: string, files: readonly ArrangedFile[], left: readonly Fn[]): string {
  const movable = loose(files);
  return [
    `Eleven is rebuilding the source folders of ${binaryName}. These files are placed (path, then how many functions):`,
    ...files.slice(0, MAX_LISTED_FILES).map((file) => `- ${file.path} (${file.fns.length})`),
    "",
    ...(movable.length >= MIN_FILES_TO_SORT
      ? ["Sort the files whose folder isn't known yet into the folders the project most likely had, judging by their names (views, models, history, settings and so on). Keep each file's name. Only list files from the list above."]
      : []),
    ...(left.length >= MIN_FNS_FOR_AGENT
      ? ["Group the functions listed at the end into the files they most likely came from. Reuse a placed file when a function clearly belongs there, otherwise name a new file. Leave out any you can't place with reason."]
      : []),
    "Reply with one ```json block holding {\"folders\": [{\"folder\": \"App/History\", \"reason\": \"one plain sentence\", \"files\": [\"HistoryStore.swift\"]}], \"groups\": [{\"file\": \"App/Support/Helpers.swift\", \"reason\": \"one plain sentence\", \"functions\": [\"0xaddress\"]}]} and nothing else.",
    "",
    ...left.slice(0, MAX_FOR_AGENT).map((fn) => `${fn.addr} ${fn.name}`),
  ].join("\n");
}

export type AgentAnswer = { readonly groups: readonly ArrangedFile[]; readonly folders: ReadonlyMap<string, { readonly folder: string; readonly reason: string }> };

/** The agent's answer, keeping only functions it was asked about and files that exist. */
export function agentAnswer(reply: string, asked: ReadonlySet<string>, files: ReadonlySet<string>): AgentAnswer {
  const json = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(reply)?.[1] ?? reply;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { groups: [], folders: new Map() };
  }
  const groupsRaw = isRecord(parsed) && Array.isArray(parsed.groups) ? parsed.groups : Array.isArray(parsed) ? parsed : [];
  const groups = groupsRaw.flatMap((item): ArrangedFile[] => {
    if (!isRecord(item)) return [];
    const file = stringField(item, "file")?.replace(/^\/+/, "");
    const said = stringField(item, "reason");
    const reason: readonly Why[] = said ? [{ kind: "said", text: said }] : [{ kind: "grouped" }];
    const fns = Array.isArray(item.functions) ? item.functions.filter((addr): addr is string => typeof addr === "string" && asked.has(addr)) : [];
    return file && fns.length > 0 ? [{ key: file, path: file, placement: "guess", reason, fns }] : [];
  });
  const folders = new Map<string, { readonly folder: string; readonly reason: string }>();
  for (const item of isRecord(parsed) && Array.isArray(parsed.folders) ? parsed.folders : []) {
    if (!isRecord(item)) continue;
    const folder = stringField(item, "folder")?.replace(/^\/+|\/+$/g, "");
    const reason = stringField(item, "reason") ?? "";
    if (!folder || !Array.isArray(item.files)) continue;
    for (const name of item.files) if (typeof name === "string" && files.has(name)) folders.set(name, { folder, reason });
  }
  return { groups, folders };
}

/** Moves files nothing in the binary gave a folder into the folders the agent suggested, saying so in their reason. */
function refolder(files: readonly ArrangedFile[], folders: AgentAnswer["folders"]): readonly ArrangedFile[] {
  return files.map((file) => {
    const name = file.path.split("/").pop() ?? file.path;
    const moved = file.placement !== "exact" ? folders.get(name) : undefined;
    return moved ? { ...file, path: `${moved.folder}/${name}`, reason: [...file.reason, { kind: "folder", folder: moved.folder, said: moved.reason }] } : file;
  });
}

/** Merges the agent's groups in: into an existing file at the same path, else as a new guessed file. */
function merge(base: Arrangement, groups: readonly ArrangedFile[]): Arrangement {
  const byPath = new Map(base.files.map((file) => [file.path, file]));
  const placed = new Set<string>();
  for (const group of groups) {
    const fresh = group.fns.filter((addr) => !placed.has(addr));
    fresh.forEach((addr) => placed.add(addr));
    const same = byPath.get(group.path) ?? [...byPath.values()].find((file) => stemOf(file.path) === stemOf(group.path) && dirname(file.path) === dirname(group.path));
    byPath.set(same?.path ?? group.path, same ? { ...same, fns: [...same.fns, ...fresh] } : { ...group, fns: fresh });
  }
  return { files: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)), unplaced: base.unplaced.filter((addr) => !placed.has(addr)) };
}

function savedFile(projectId: string): string {
  return join(cacheRoot(), "arrange", `${projectId}.json`);
}

function isSavedFile(value: unknown): boolean {
  return isRecord(value) && typeof value.key === "string" && typeof value.path === "string" && PLACEMENTS.some((placement) => placement === value.placement) && Array.isArray(value.fns) && value.fns.every((fn) => typeof fn === "string");
}

function isArrangement(value: unknown): value is Arrangement {
  return isRecord(value) && Array.isArray(value.files) && value.files.every(isSavedFile) && Array.isArray(value.unplaced) && value.unplaced.every((fn) => typeof fn === "string");
}

function isWhy(value: unknown): value is Why {
  if (!isRecord(value) || !WHY_KINDS.some((kind) => kind === value.kind)) return false;
  switch (value.kind) {
    case "path":
      return typeof value.path === "string";
    case "type":
      return typeof value.type === "string";
    case "neighbours":
      return typeof value.count === "number";
    case "beside":
      return typeof value.file === "string";
    case "grouped":
      return true;
    case "folder":
      return typeof value.folder === "string" && typeof value.said === "string";
    case "said":
      return typeof value.text === "string";
    default:
      return false;
  }
}

/** Older saves hold the reason as one English sentence, shown as written. */
function savedReason(raw: unknown): readonly Why[] {
  if (typeof raw === "string") return raw ? [{ kind: "said", text: raw }] : [];
  return Array.isArray(raw) ? raw.filter(isWhy) : [];
}

export async function savedArrangement(projectId: string): Promise<Arrangement | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(savedFile(projectId), "utf8"));
    return isArrangement(parsed) ? { ...parsed, files: parsed.files.map((file) => ({ ...file, reason: savedReason(file.reason) })) } : null;
  } catch {
    return null;
  }
}

export async function forgetArrangement(projectId: string): Promise<void> {
  await rm(savedFile(projectId), { force: true });
}

/** The whole arrangement: evidence first, the agent only for what's left, then saved for this binary. */
export async function arrange(input: {
  readonly ask: QuietAsk;
  readonly binaryName: string;
  readonly functions: readonly Fn[];
  readonly strings: readonly TableRow[];
  readonly types: readonly SwiftType[];
  readonly sources: SourceFiles;
  readonly onStep: (steps: readonly ArrangeStep[]) => void;
  /** The evidence-only arrangement, as soon as it's known and before the agent starts. */
  readonly onEvidence?: (arrangement: Arrangement) => void;
  readonly onProgress?: (progress: RewriteProgress) => void;
}): Promise<ArrangeResult> {
  const { ask, functions, sources, onStep } = input;
  const paths = sources.paths.length;
  const found = t(paths === 1 ? "workbench.arrange.foundOne" : "workbench.arrange.found", { paths: paths.toLocaleString(), types: input.types.length.toLocaleString() });
  onStep([{ label: found, done: true }, { label: t("workbench.arrange.placing"), done: false }]);
  const base = arrangeFromEvidence(functions, input.strings, input.types, sources);
  input.onEvidence?.(base);
  const placedCount = base.files.reduce((sum, file) => sum + file.fns.length, 0);
  const evidenceSteps: readonly ArrangeStep[] = [
    { label: found, done: true },
    { label: t("workbench.arrange.placed", { count: placedCount.toLocaleString() }), done: true },
  ];
  const leftFns = base.unplaced.flatMap((addr) => functions.find((fn) => fn.addr === addr) ?? []).filter((fn) => !/^(?:thunk_)?(?:FUN|sub|fcn)_/.test(fn.name));
  const askFns = leftFns.length >= MIN_FNS_FOR_AGENT ? leftFns.slice(0, MAX_FOR_AGENT) : [];
  const askFolders = loose(base.files).length >= MIN_FILES_TO_SORT;
  let result = base;
  let agentFailed: string | null = null;
  if (askFns.length > 0 || askFolders) {
    onStep([...evidenceSteps, { label: askFns.length > 0 ? t("workbench.arrange.grouping", { agent: ask.agent.name, count: askFns.length.toLocaleString() }) : t("workbench.arrange.sorting", { agent: ask.agent.name }), done: false }]);
    try {
      const reply = await askQuietly(ask, arrangePrompt(input.binaryName, base.files, askFns), input.onProgress ?? (() => {}));
      const answer = agentAnswer(reply, new Set(askFns.map((fn) => fn.addr)), new Set(base.files.map((file) => file.path.split("/").pop() ?? file.path)));
      const merged = merge(base, answer.groups);
      result = { ...merged, files: refolder(merged.files, answer.folders).slice().sort((x, y) => x.path.localeCompare(y.path)) };
      onStep([...evidenceSteps, { label: t("workbench.arrange.sorted", { agent: ask.agent.name }), done: true }]);
    } catch (err) {
      agentFailed = errorMessage(err);
    }
  }
  if (agentFailed === null) {
    await mkdir(dirname(savedFile(ask.projectId)), { recursive: true });
    await writeFile(savedFile(ask.projectId), JSON.stringify(result));
  }
  return { ...result, agentFailed };
}
