import type { ChildProcess } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { useEffect, useState } from "react";

import { isRecord } from "../lib/guards";
import type { Look } from "./highlightServer";
import { FROM_SOURCE } from "../lib/platform";
import { startWith } from "../lib/process";

export type { Look } from "./highlightServer";

/** One run of text in one color, as VS Code's C++ grammar and theme paint it. */
export type Span = { readonly start: number; readonly end: number; readonly color: string };

type Lines = readonly (readonly Span[])[];
type Pending = { readonly resolve: (spans: Lines) => void; readonly reject: (err: Error) => void };

const CACHED = 24;

let helper: ChildProcess | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();
const cache = new Map<string, Lines>();

function toSpan(value: unknown): readonly Span[] {
  if (!Array.isArray(value)) return [];
  const [start, end, color] = value;
  return typeof start === "number" && typeof end === "number" && typeof color === "string" ? [{ start, end, color }] : [];
}

function settle(line: string): void {
  const reply: unknown = JSON.parse(line);
  if (!isRecord(reply) || typeof reply.id !== "number" || !Array.isArray(reply.spans)) return;
  const waiting = pending.get(reply.id);
  pending.delete(reply.id);
  waiting?.resolve(reply.spans.map((spans) => (Array.isArray(spans) ? spans.flatMap(toSpan) : [])));
}

async function readReplies(child: ChildProcess): Promise<void> {
  if (!child.stdout) return;
  for await (const line of createInterface({ input: child.stdout })) settle(line);
}

/** The same Eleven executable started with --eleven-highlight, so WebAssembly never runs in the window's process. */
function started(): ChildProcess {
  if (helper) return helper;
  const args = FROM_SOURCE ? [join(import.meta.dir, "..", "main.tsx"), "--eleven-highlight"] : ["--eleven-highlight"];
  const child = startWith(process.execPath, args, { stdio: ["pipe", "pipe", "ignore"] });
  child.on("exit", () => {
    if (helper === child) helper = null;
    for (const waiting of pending.values()) waiting.reject(new Error("The highlighter stopped."));
    pending.clear();
  });
  void readReplies(child);
  child.unref();
  helper = child;
  return child;
}

/** Colors for C-like code as VS Code would show them, cached per function. */
export async function highlightLines(lines: readonly string[], look: Look): Promise<Lines> {
  const key = `${look}\u0000${lines.join("\n")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const id = nextId++;
  const spans = await new Promise<Lines>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    started().stdin?.write(`${JSON.stringify({ id, look, lines })}\n`);
  });
  if (cache.size >= CACHED) cache.delete(cache.keys().next().value ?? "");
  cache.set(key, spans);
  return spans;
}

/** The same, as a hook: null until the colors arrive, so callers keep a fallback. */
export function useSpans(lines: readonly string[], look: Look): Lines | null {
  const key = `${look}\u0000${lines.join("\n")}`;
  const [shown, setShown] = useState<{ readonly key: string; readonly spans: Lines } | null>(null);
  useEffect(() => {
    let live = true;
    const run = async (): Promise<void> => {
      try {
        const spans = await highlightLines(lines, look);
        if (live) setShown({ key, spans });
      } catch {
        return;
      }
    };
    void run();
    return () => {
      live = false;
    };
  }, [key]);
  return shown?.key === key ? shown.spans : null;
}
