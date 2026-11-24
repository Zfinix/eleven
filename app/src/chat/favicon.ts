import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { cacheRoot } from "../lib/platform";
import { keepsToThisMac } from "../lib/private";

const DIR = join(cacheRoot(), "favicons");
const pending = new Map<string, Promise<string | null>>();

function fileFor(domain: string): string {
  return join(DIR, `${domain.replace(/[^\w.-]/g, "_")}.png`);
}

async function download(domain: string, file: string): Promise<string | null> {
  if (keepsToThisMac()) return null;
  try {
    const response = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`);
    if (!response.ok) return null;
    await mkdir(DIR, { recursive: true });
    await writeFile(file, new Uint8Array(await response.arrayBuffer()));
    return file;
  } catch {
    return null;
  }
}

/** A site's icon as a local PNG, fetched once and kept in the cache; null when the site has none. */
export function favicon(domain: string): Promise<string | null> {
  const file = fileFor(domain);
  if (existsSync(file)) return Promise.resolve(file);
  const known = pending.get(domain);
  if (known) return known;
  const loading = download(domain, file);
  pending.set(domain, loading);
  return loading;
}
