import { isRecord, stringField } from "../lib/guards";

export type CrashFrame = { readonly image: string; readonly offset: number; readonly symbol: string | null };

export type Crash = { readonly app: string; readonly exception: string; readonly thread: readonly CrashFrame[] };

function numberField(value: unknown, key: string): number | null {
  if (!isRecord(value)) return null;
  const found = value[key];
  return typeof found === "number" ? found : null;
}

/** A macOS .ips crash report: a one-line JSON header, then the JSON body with threads, images and the exception. */
export function parseCrash(text: string): Crash {
  const newline = text.indexOf("\n");
  let body: unknown;
  try {
    body = JSON.parse(newline < 0 ? text : text.slice(newline + 1));
  } catch {
    throw new Error("That isn't a macOS crash report (.ips).");
  }
  if (!isRecord(body) || !Array.isArray(body.threads)) throw new Error("That crash report has no threads in it.");
  const images = Array.isArray(body.usedImages) ? body.usedImages.map((image) => stringField(image, "name") ?? "?") : [];
  const faulting = numberField(body, "faultingThread") ?? body.threads.findIndex((thread) => isRecord(thread) && thread.triggered === true);
  const thread: unknown = body.threads[Math.max(0, faulting)];
  const frames = isRecord(thread) && Array.isArray(thread.frames) ? thread.frames : [];
  const exception = isRecord(body.exception) ? [stringField(body.exception, "type"), stringField(body.exception, "signal"), stringField(body.exception, "subtype")].filter(Boolean).join(" ") : "";
  return {
    app: stringField(body, "procName") ?? "?",
    exception: exception || "a crash",
    thread: frames.flatMap((frame): CrashFrame[] => {
      const offset = numberField(frame, "imageOffset");
      const index = numberField(frame, "imageIndex");
      if (offset === null || index === null) return [];
      return [{ image: images[index] ?? "?", offset, symbol: stringField(frame, "symbol") ?? null }];
    }),
  };
}

/** The function each frame in `image` lands in: the nearest function start at or below `base + offset`. */
export function placeFrames(frames: readonly CrashFrame[], image: string, base: bigint, starts: readonly string[]): readonly (CrashFrame & { readonly addr: string | null; readonly fn: string | null })[] {
  const sorted = starts.map((start) => BigInt(start)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return frames.map((frame) => {
    if (frame.image !== image) return { ...frame, addr: null, fn: null };
    const at = base + BigInt(frame.offset);
    let fn: bigint | null = null;
    for (const start of sorted) {
      if (start > at) break;
      fn = start;
    }
    return { ...frame, addr: `0x${at.toString(16)}`, fn: fn === null ? null : `0x${fn.toString(16)}` };
  });
}
