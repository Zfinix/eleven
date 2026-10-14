import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { readCachedText } from "../agents/launch";
import { isRecord, stringField } from "../lib/guards";
import { rea } from "../engine/rea";
import { cacheDir } from "../settings/actions";
import type { HexRow, TableRow } from "./model";

const MAX_STRINGS = 400;
const MAX_SEGMENTS = 200;
const HEX_BYTES = 9 * 16;

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function tableRow(value: unknown): readonly TableRow[] {
  const a = stringField(value, "a");
  const b = stringField(value, "b");
  return a !== undefined && b !== undefined ? [{ a, b }] : [];
}

/** A table read once per binary and kept with its function list, so reopening a project never asks REA (and Ghidra) again. */
async function cachedRows(sha256: string, name: string, load: () => Promise<readonly TableRow[]>): Promise<readonly TableRow[]> {
  const file = join(cacheDir(), sha256, "ghidra", `${name}.json`);
  const cached = await readCachedText(file);
  if (cached !== null) return list(JSON.parse(cached)).flatMap(tableRow);
  const rows = await load();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(rows));
  return rows;
}

export function programStrings(path: string, sha256: string): Promise<readonly TableRow[]> {
  return cachedRows(sha256, "strings", () => stringsFromRea(path));
}

export function programSegments(path: string, sha256: string): Promise<readonly TableRow[]> {
  return cachedRows(sha256, "segments", () => segmentsFromRea(path));
}

/** Defined strings in the binary, from REA, for any format. */
async function stringsFromRea(path: string): Promise<readonly TableRow[]> {
  return list(await rea.tool(path, "list_strings", {}))
    .flatMap((entry) => {
      const address = stringField(entry, "address");
      const value = stringField(entry, "value");
      return address && value ? [{ a: address, b: value }] : [];
    })
    .slice(0, MAX_STRINGS);
}

/** The binary's segments and sections, from REA, for any format. */
async function segmentsFromRea(path: string): Promise<readonly TableRow[]> {
  return list(await rea.tool(path, "list_segments", {}))
    .flatMap((entry) => {
      const name = stringField(entry, "name");
      const start = stringField(entry, "start");
      const end = stringField(entry, "end");
      return name && start && end ? [{ a: name, b: `${start} to ${end}` }] : [];
    })
    .slice(0, MAX_SEGMENTS);
}

function printable(byte: number): string {
  return byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ".";
}

/** A screenful of bytes at an address, read through REA, for any format. */
export async function hexRows(path: string, addr: string): Promise<readonly HexRow[]> {
  const reply = await rea.tool(path, "read_bytes", { address: addr, length: HEX_BYTES });
  const hex = isRecord(reply) ? stringField(reply, "bytes_hex") : null;
  if (!hex) return [];
  const bytes = hex.match(/.{2}/g)?.map((pair) => parseInt(pair, 16)) ?? [];
  const at = BigInt(addr);
  return Array.from({ length: Math.floor(bytes.length / 16) }, (_, row) => {
    const slice = bytes.slice(row * 16, row * 16 + 16);
    return {
      addr: `0x${(at + BigInt(row * 16)).toString(16)}`,
      bytes: slice.map((b) => b.toString(16).padStart(2, "0")).join(" "),
      ascii: slice.map(printable).join(""),
    };
  });
}

const CFSTRING_TEXT_OFFSET = 0x10n;

function refAddresses(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.startsWith("0x")) : [];
}

export type XRef = { readonly from: string; readonly fn: string | null };

/** Every place that refers to an address, and the function each one sits in. */
export async function referencesTo(path: string, address: string): Promise<readonly XRef[]> {
  const sites = refAddresses(await rea.tool(path, "xrefs", { address }));
  return Promise.all(sites.map(async (from) => ({ from, fn: await containingFunction(path, from) })));
}

/** The function an address sits in, or null when it is data or a thunk. */
export async function containingFunction(path: string, address: string): Promise<string | null> {
  const result = await rea.tool(path, "resolve_containing_procedure", { address });
  if (!isRecord(result) || result.found !== true) return null;
  const thunk = isRecord(result.procedure) && isRecord(result.procedure.classification) && result.procedure.classification.thunk === true;
  return thunk ? null : stringField(result.procedure, "address") ?? null;
}

/**
 * The functions that reference a string, via REA, up to `limit`. Plain strings are referenced from code directly;
 * Objective-C string literals go through a CFString record, so a data referrer is stepped back to it.
 */
export async function codeUsingString(path: string, address: string, limit: number): Promise<readonly string[]> {
  const found = new Set<string>();
  for (const ref of refAddresses(await rea.tool(path, "xrefs", { address }))) {
    const direct = await containingFunction(path, ref);
    if (direct) found.add(direct);
    else {
      const record = `0x${(BigInt(ref) - CFSTRING_TEXT_OFFSET).toString(16)}`;
      for (const site of refAddresses(await rea.tool(path, "xrefs", { address: record }))) {
        const loader = await containingFunction(path, site);
        if (loader) found.add(loader);
        if (found.size >= limit) break;
      }
    }
    if (found.size >= limit) break;
  }
  return [...found];
}

/** The first function that references a string. */
export async function codeForString(path: string, address: string): Promise<string | null> {
  return (await codeUsingString(path, address, 1))[0] ?? null;
}
