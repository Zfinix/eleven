import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { currentSettings } from "../settings/store";
import { appVersion } from "../settings/system";
import { isRecord } from "./guards";
import { cacheRoot, OS, unzip } from "./platform";
import { isNewer } from "./version";
import { run, startWith } from "./process";

const RELEASES = "https://api.github.com/repos/Zfinix/eleven/releases";
const MIRROR = "https://dl.chizi.app";
const STAGE = join(cacheRoot(), "update");
const STAGED_APP = join(STAGE, "next", "Eleven.app");
const STAGED_VERSION = join(STAGE, "version");
const ARCH = process.arch === "arm64" ? "arm64" : "x86_64";

type Release = { readonly version: string; readonly url: string };

function runningApp(): string | null {
  const app = dirname(dirname(dirname(process.execPath)));
  return OS === "mac" && app.endsWith(".app") ? app : null;
}

/** Cloudflare's copy of the latest stable release, which downloads much faster than GitHub's. */
async function mirroredRelease(): Promise<Release | null> {
  try {
    const response = await fetch(`${MIRROR}/latest.json`);
    if (!response.ok) return null;
    const json: unknown = await response.json();
    if (!isRecord(json) || typeof json.version !== "string") return null;
    const url = `${MIRROR}/v${json.version}/Eleven-${json.version}-${ARCH}.zip`;
    const head = await fetch(url, { method: "HEAD" });
    return head.ok ? { version: json.version, url } : null;
  } catch {
    return null;
  }
}

async function latestRelease(): Promise<Release | null> {
  const beta = currentSettings().updateChannel === "Beta";
  const mirrored = beta ? null : await mirroredRelease();
  if (mirrored) return mirrored;
  const response = await fetch(beta ? `${RELEASES}?per_page=1` : `${RELEASES}/latest`, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) return null;
  const json: unknown = await response.json();
  const release: unknown = Array.isArray(json) ? json[0] : json;
  if (!isRecord(release) || typeof release.tag_name !== "string" || !Array.isArray(release.assets)) return null;
  const version = release.tag_name.replace(/^v/, "");
  const name = `Eleven-${version}-${ARCH}.zip`;
  for (const asset of release.assets) {
    if (isRecord(asset) && asset.name === name && typeof asset.browser_download_url === "string") return { version, url: asset.browser_download_url };
  }
  return null;
}

async function stage(release: Release): Promise<boolean> {
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(join(STAGE, "next"), { recursive: true });
  const response = await fetch(release.url);
  if (!response.ok) return false;
  const zip = join(STAGE, "update.zip");
  await Bun.write(zip, response);
  await unzip(zip, join(STAGE, "next"));
  rmSync(zip, { force: true });
  await run("codesign", ["--verify", "--deep", "--strict", STAGED_APP]);
  writeFileSync(STAGED_VERSION, release.version);
  return true;
}

function stagedVersion(): string | null {
  try {
    return existsSync(STAGED_APP) ? readFileSync(STAGED_VERSION, "utf8").trim() : null;
  } catch {
    return null;
  }
}

/** Swaps the staged app in once this process exits, however it exits. */
function installOnQuit(app: string): void {
  const script = 'while kill -0 "$1" 2>/dev/null; do sleep 0.5; done; rm -rf "$3.old"; mv "$3" "$3.old" && { mv "$2" "$3" || mv "$3.old" "$3"; }; rm -rf "$3.old" "$4"';
  startWith("/bin/sh", ["-c", script, "sh", String(process.pid), STAGED_APP, app, STAGE], { detached: true, stdio: "ignore" }).unref();
}

async function checkForUpdate(app: string): Promise<void> {
  const current = appVersion();
  const staged = stagedVersion();
  if (staged !== null && isNewer(staged, current)) return installOnQuit(app);
  const release = await latestRelease();
  if (release === null || !isNewer(release.version, current)) return rmSync(STAGE, { recursive: true, force: true });
  if (await stage(release)) installOnQuit(app);
}

export function startUpdates(): void {
  const app = runningApp();
  if (app === null || !currentSettings().autoUpdate) return;
  void (async (): Promise<void> => {
    try {
      await checkForUpdate(app);
    } catch {
      rmSync(STAGE, { recursive: true, force: true });
    }
  })();
}
