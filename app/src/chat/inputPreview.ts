import { isRecord, stringField } from "../lib/guards";

const PREVIEW_CHARS = 1200;
const MAX_ITEMS = 12;
const MAX_DEPTH = 4;

/** Visits only enough input to fill a small preview, even when a tool supplied a huge object. */
export function inputPreview(value: unknown): string {
  const command = stringField(value, "command");
  if (command !== undefined) return clipped(command);
  if (typeof value === "string") return clipped(value);
  if (value === undefined || value === null) return "";

  let remaining = PREVIEW_CHARS;
  const parts: string[] = [];
  const seen = new WeakSet<object>();
  const append = (text: string): void => {
    parts.push(text.slice(0, remaining));
    remaining = Math.max(0, remaining - text.length);
  };
  const visit = (item: unknown, depth: number): void => {
    if (remaining === 0) return;
    if (typeof item === "string") return append(JSON.stringify(item.slice(0, remaining)));
    if (typeof item !== "object" || item === null) return append(String(item));
    if (seen.has(item)) return append("[Circular]");
    if (depth >= MAX_DEPTH) return append("…");
    seen.add(item);

    if (Array.isArray(item)) {
      append("[");
      for (let index = 0; index < Math.min(item.length, MAX_ITEMS) && remaining > 0; index++) {
        if (index > 0) append(", ");
        visit(item[index], depth + 1);
      }
      if (item.length > MAX_ITEMS) append(", …");
      append("]");
    } else if (isRecord(item)) {
      append("{\n");
      let count = 0;
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        if (remaining === 0 || count === MAX_ITEMS) {
          append("…");
          break;
        }
        if (count > 0) append(",\n");
        append(`${JSON.stringify(key.slice(0, remaining))}: `);
        visit(item[key], depth + 1);
        count++;
      }
      append("\n}");
    }
    seen.delete(item);
  };

  visit(value, 0);
  return `${parts.join("")}${remaining === 0 ? "\n…" : ""}`;
}

function clipped(text: string): string {
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}\n…` : text;
}
