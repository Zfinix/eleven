import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { readCachedText } from "../agents/launch";
import { isRecord, recordField, stringField } from "../lib/guards";
import { rea } from "./rea";
import { cacheRoot } from "../lib/platform";

export type ProcedureKind = "Function" | "Thunk" | "External";

export type Procedure = { readonly address: string; readonly name: string; readonly kind: ProcedureKind };

export const CACHE = cacheRoot();

const pendingLoads = new Map<string, Promise<readonly Procedure[]>>();

function kindOf(value: unknown): ProcedureKind | null {
  return value === "Function" || value === "Thunk" || value === "External" ? value : null;
}

function isCachedEntry(entry: unknown): entry is Procedure {
  const address = stringField(entry, "address");
  const name = stringField(entry, "name");
  const kind = isRecord(entry) ? kindOf(entry.kind) : null;
  return Boolean(address && name && kind);
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

/** The binary's procedures, from Eleven's shared cache or, on a first open, from REA. */
async function readProcedures(path: string, file: string): Promise<readonly Procedure[]> {
  const cached = await readCachedText(file);
  if (cached !== null) {
    const parsed: unknown = JSON.parse(cached);
    return Array.isArray(parsed) ? parsed.filter(isCachedEntry) : [];
  }
  const listed = await listFromRea(path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(listed));
  return listed;
}

/** Share concurrent workbench and chat loads, without retaining the inventory after delivery. */
export async function loadProcedures(path: string, sha256: string): Promise<readonly Procedure[]> {
  const file = join(CACHE, sha256, "ghidra", "procedures.json");
  const pending = pendingLoads.get(file);
  if (pending) return pending;

  const loading = readProcedures(path, file);
  pendingLoads.set(file, loading);
  try {
    return await loading;
  } finally {
    if (pendingLoads.get(file) === loading) pendingLoads.delete(file);
  }
}

/** Drops the cached function list, so the next open lists functions you added or undefined. */
export async function forgetProcedures(sha256: string): Promise<void> {
  await rm(join(CACHE, sha256, "ghidra", "procedures.json"), { force: true });
}

const ENTRY_NAMES = ["entry", "_main", "main", "start", "_start"] as const;

/** Where a reader should start: the program's entry point, or its first real function. */
export function entryProcedure(procedures: readonly Procedure[]): Procedure | null {
  const named = ENTRY_NAMES.flatMap((name) => procedures.filter((procedure) => procedure.name === name));
  return named[0] ?? procedures.find((procedure) => procedure.kind === "Function") ?? null;
}
