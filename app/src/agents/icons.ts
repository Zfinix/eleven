import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ASSETS } from "../lib/assets";
import { readCachedText } from "./launch";
import type { AgentEntry } from "./registry";
import { cacheRoot } from "../lib/platform";
import { keepsToThisMac } from "../lib/private";

const ICON_DIR = join(cacheRoot(), "agents", "icons");

async function download(url: string, file: string): Promise<string | null> {
  if (keepsToThisMac()) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const svg = await response.text();
    await mkdir(ICON_DIR, { recursive: true });
    await writeFile(file, svg);
    return svg;
  } catch {
    return null;
  }
}

/** A full-color logo file Eleven ships (with a dark-mode file for black or white marks), or the registry's one-color glyph. */
export type AgentIcon =
  | { readonly kind: "color"; readonly light: string; readonly dark: string }
  | { readonly kind: "mono"; readonly svg: string };

function shippedIcon(id: string): AgentIcon | null {
  const light = join(ASSETS, "agents", `${id}.svg`);
  if (!existsSync(light)) return null;
  const dark = join(ASSETS, "agents", `${id}-dark.svg`);
  return { kind: "color", light, dark: existsSync(dark) ? dark : light };
}

export async function loadIcon(agent: AgentEntry): Promise<AgentIcon | null> {
  const shipped = shippedIcon(agent.id);
  if (shipped || !agent.iconUrl) return shipped;
  const file = join(ICON_DIR, `${agent.id}.svg`);
  const svg = (await readCachedText(file)) ?? (await download(agent.iconUrl, file));
  return svg ? { kind: "mono", svg } : null;
}

export async function loadIcons(agents: readonly AgentEntry[]): Promise<ReadonlyMap<string, AgentIcon>> {
  const pairs = await Promise.all(agents.map(async (agent) => [agent.id, await loadIcon(agent)] as const));
  return new Map(pairs.filter((pair): pair is readonly [string, AgentIcon] => pair[1] !== null));
}
