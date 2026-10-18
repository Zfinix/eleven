import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { readCachedText } from "../agents/launch";
import { isRecord, recordField, stringField } from "../lib/guards";
import { rea } from "./rea";
import { cacheRoot } from "../lib/platform";

export type ProcedureKind = "Function" | "Thunk" | "External";

export type Procedure = { readonly address: string; readonly name: string; readonly kind: ProcedureKind };

export const CACHE = cacheRoot();

const loading = new Map<string, Promise<readonly Procedure[]>>();

function kindOf(value: unknown): ProcedureKind | null {
  return value === "Function" || value === "Thunk" || value === "External" ? value : null;
}

function cachedEntry(entry: unknown): readonly Procedure[] {
  const address = stringField(entry, "address");
  const name = stringField(entry, "name");
  const kind = isRecord(entry) ? kindOf(entry.kind) : null;
  return address && name && kind ? [{ address, name, kind }] : [];
}

function listedEntry(entry: unknown): readonly Procedure[] {
  const address = stringField(entry, "address");
  const name = stringField(entry, "value");
  const facts = recordField(entry, "procedure");
  if (!address || !name) return [];
  const kind: ProcedureKind = facts?.external === true ? "External" : facts?.thunk === true ? "Thunk" : "Function";
  return [{ address, name, kind }];
}

async function listFromRea(path: string): Promise<readonly Procedure[]> {
  return (await rea.listProcedures(path)).flatMap(listedEntry);
}

async function readProcedures(path: string, file: string): Promise<readonly Procedure[]> {
  const cached = await readCachedText(file);
  if (cached !== null) {
    const parsed: unknown = JSON.parse(cached);
    return Array.isArray(parsed) ? parsed.flatMap(cachedEntry) : [];
  }
  const listed = await listFromRea(path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(listed));
  return listed;
}

/** The binary's procedures, from Eleven's shared cache or, on a first open, from REA. Loads at the same time share one read. */
export async function loadProcedures(path: string, sha256: string): Promise<readonly Procedure[]> {
  const pending = loading.get(sha256);
  if (pending) return pending;
  const load = readProcedures(path, join(CACHE, sha256, "ghidra", "procedures.json"));
  loading.set(sha256, load);
  try {
    return await load;
  } finally {
    if (loading.get(sha256) === load) loading.delete(sha256);
  }
}

/** Drops the cached function list, so the next open lists functions you added or undefined. */
export async function forgetProcedures(sha256: string): Promise<void> {
  loading.delete(sha256);
  await rm(join(CACHE, sha256, "ghidra", "procedures.json"), { force: true });
}

const ENTRY_NAMES = ["entry", "_main", "main", "start", "_start"] as const;

/** Where a reader should start: the program's entry point, or its first real function. */
export function entryProcedure(procedures: readonly Procedure[]): Procedure | null {
  const named = ENTRY_NAMES.flatMap((name) => procedures.filter((procedure) => procedure.name === name));
  return named[0] ?? procedures.find((procedure) => procedure.kind === "Function") ?? null;
}
