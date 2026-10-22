import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { PlainId } from "../i18n";
import { supportPath } from "../lib/support";

/** A panel that can live in the right dock, the bottom dock, or an editor tab. */
export type Tool = "agent" | "inspector" | "refs" | "find" | "debug" | "terminal" | "patches";

export type Zone = "right" | "bottom";

/** Which tools sit in each dock, in tab order. A tool in neither opens as an editor tab. */
export type Docks = { readonly right: readonly Tool[]; readonly bottom: readonly Tool[] };

export const TOOLS: readonly Tool[] = ["agent", "inspector", "refs", "find", "debug", "patches", "terminal"];

export const TOOL_LABEL: Readonly<Record<Tool, PlainId>> = {
  agent: "workbench.tool.agent",
  inspector: "workbench.tool.inspector",
  refs: "workbench.tool.refs",
  find: "workbench.tool.find",
  debug: "workbench.tool.debug",
  patches: "workbench.tool.patches",
  terminal: "workbench.tool.terminal",
};

export const TOOL_ICON: Readonly<Record<Tool, string>> = {
  agent: "spark", inspector: "info", refs: "forward", find: "search", debug: "debug", patches: "hex", terminal: "slash",
};

export const DEFAULT_DOCKS: Docks = { right: ["agent", "inspector"], bottom: ["refs", "find", "debug", "patches", "terminal"] };

const FILE = supportPath("dock-layout.json");
const OLD_ORDER = supportPath("dock-order.json");

export function isTool(value: unknown): value is Tool {
  return TOOLS.some((tool) => tool === value);
}

function tools(value: unknown): readonly Tool[] {
  return Array.isArray(value) ? [...new Set(value.filter(isTool))] : [];
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The saved docks; before docks were saved, only the bottom dock's order was, so that is kept. */
export function loadDocks(): Docks {
  const saved = readJson(FILE);
  if (typeof saved === "object" && saved !== null && "right" in saved && "bottom" in saved) {
    const right = tools(saved.right);
    return { right, bottom: tools(saved.bottom).filter((tool) => !right.includes(tool)) };
  }
  const order = tools(readJson(OLD_ORDER)).filter((tool) => DEFAULT_DOCKS.bottom.includes(tool));
  return { right: DEFAULT_DOCKS.right, bottom: [...new Set([...order, ...DEFAULT_DOCKS.bottom])] };
}

export function saveDocks(docks: Docks): void {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, `${JSON.stringify(docks)}\n`);
  } catch {
    return;
  }
}

/** Moves `tab` to sit before `before`, or to the end when `before` is null. */
export function moveDockTab(order: readonly Tool[], tab: Tool, before: Tool | null): readonly Tool[] {
  const rest = order.filter((other) => other !== tab);
  const at = before === null ? rest.length : rest.indexOf(before);
  return at < 0 ? order : [...rest.slice(0, at), tab, ...rest.slice(at)];
}

export function zoneOf(docks: Docks, tool: Tool): Zone | null {
  if (docks.right.includes(tool)) return "right";
  return docks.bottom.includes(tool) ? "bottom" : null;
}

/** Takes `tool` out of whichever dock has it and, given a zone, puts it at the end of that one. */
export function placeTool(docks: Docks, tool: Tool, zone: Zone | null): Docks {
  const right = docks.right.filter((other) => other !== tool);
  const bottom = docks.bottom.filter((other) => other !== tool);
  if (zone === "right") return { right: [...right, tool], bottom };
  if (zone === "bottom") return { right, bottom: [...bottom, tool] };
  return { right, bottom };
}
