import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { errorMessage, isRecord, recordField, stringField } from "../lib/guards";
import { cacheRoot } from "../lib/platform";

const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const CACHE_DIR = join(cacheRoot(), "agents");
const REGISTRY_FILE = join(CACHE_DIR, "registry.json");
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type Env = Readonly<Record<string, string>>;

export type PackageRun = { readonly package: string; readonly args: readonly string[]; readonly env: Env };

export type BinaryBuild = {
  readonly archive: string;
  readonly cmd: string;
  readonly args: readonly string[];
  readonly sha256: string | null;
  readonly env: Env;
};

export type Distribution =
  | { readonly kind: "npx"; readonly run: PackageRun }
  | { readonly kind: "uvx"; readonly run: PackageRun }
  | { readonly kind: "binary"; readonly build: BinaryBuild }
  | { readonly kind: "command"; readonly command: string; readonly args: readonly string[] };

export type AgentEntry = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly iconUrl: string | null;
  readonly distribution: Distribution;
};

export const CUSTOM_AGENT_ID = "custom-agent";

/** The ACP agent command typed in Settings, such as `my-agent --acp`, as "Your agent". */
export function customAgentEntry(command: string): AgentEntry | null {
  const [program, ...args] = command.trim().split(/\s+/).filter(Boolean);
  if (!program) return null;
  return { id: CUSTOM_AGENT_ID, name: "Your agent", description: command.trim(), version: "local", iconUrl: null, distribution: { kind: "command", command: program, args } };
}

/** Agents Eleven knows about that aren't in the public registry. */
const LOCAL_AGENTS: readonly AgentEntry[] = [
  {
    id: "aster",
    name: "Aster",
    description: "Your local Aster agent",
    version: "local",
    iconUrl: null,
    distribution: { kind: "command", command: "aster", args: ["acp"] },
  },
];

export const DEFAULT_AGENT_ID = "claude-acp";

/** The order agents appear in the picker; everything else follows alphabetically. */
const FEATURED = ["claude-acp", "codex-acp", "grok-build", "antigravity-acp", "gemini", "github-copilot-cli", "cursor", "goose", "opencode", "aster"] as const;

export function platformKey(): string {
  const os = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
  const cpu = process.arch === "arm64" ? "aarch64" : "x86_64";
  return `${os}-${cpu}`;
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function env(value: unknown): Env {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function packageRun(value: unknown): PackageRun | null {
  const pkg = stringField(value, "package");
  if (!pkg || !isRecord(value)) return null;
  return { package: pkg, args: strings(value.args), env: env(value.env) };
}

function binaryBuild(value: unknown): BinaryBuild | null {
  const build = recordField(value, platformKey());
  const archive = stringField(build, "archive");
  const cmd = stringField(build, "cmd");
  if (!build || !archive || !cmd) return null;
  return { archive, cmd, args: strings(build.args), sha256: stringField(build, "sha256") ?? null, env: env(build.env) };
}

function distribution(value: unknown): Distribution | null {
  const npx = packageRun(recordField(value, "npx"));
  if (npx) return { kind: "npx", run: npx };
  const uvx = packageRun(recordField(value, "uvx"));
  if (uvx) return { kind: "uvx", run: uvx };
  const build = binaryBuild(recordField(value, "binary"));
  return build ? { kind: "binary", build } : null;
}

function parseEntry(value: unknown): AgentEntry | null {
  const id = stringField(value, "id");
  const name = stringField(value, "name");
  const dist = distribution(recordField(value, "distribution"));
  if (!id || !name || !dist) return null;
  return {
    id,
    name: shortName(name),
    description: stringField(value, "description") ?? "",
    version: stringField(value, "version") ?? "",
    iconUrl: stringField(value, "icon") ?? null,
    distribution: dist,
  };
}

/** Drops the protocol suffixes registry names carry, so "Claude Agent" reads as "Claude". */
export function shortName(name: string): string {
  return name.replace(/\s+(Agent|ACP|CLI)$/i, "").trim() || name;
}

export function parseRegistry(json: unknown): readonly AgentEntry[] {
  const agents = isRecord(json) && Array.isArray(json.agents) ? json.agents : [];
  return agents.map(parseEntry).filter((entry): entry is AgentEntry => entry !== null);
}

function rank(entry: AgentEntry): number {
  const index = FEATURED.findIndex((id) => id === entry.id);
  return index === -1 ? FEATURED.length : index;
}

export function sortAgents(entries: readonly AgentEntry[]): readonly AgentEntry[] {
  return [...entries].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

async function isFresh(file: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(file)).mtimeMs < MAX_AGE_MS;
  } catch {
    return false;
  }
}

async function download(): Promise<unknown> {
  const response = await fetch(REGISTRY_URL);
  if (!response.ok) throw new Error(`The agent registry answered ${response.status}`);
  const text = await response.text();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(REGISTRY_FILE, text);
  return JSON.parse(text);
}

async function cached(): Promise<unknown> {
  try {
    return JSON.parse(await readFile(REGISTRY_FILE, "utf8"));
  } catch {
    return null;
  }
}

/** The ACP registry Zed uses, cached for a day and usable offline. */
export async function loadAgents(): Promise<readonly AgentEntry[]> {
  let json: unknown = null;
  try {
    json = (await isFresh(REGISTRY_FILE)) ? await cached() : await download();
  } catch (err) {
    console.warn(`eleven: using the cached agent list (${errorMessage(err)})`);
    json = await cached();
  }
  return sortAgents([...parseRegistry(json), ...LOCAL_AGENTS]);
}

export function fallbackAgents(): readonly AgentEntry[] {
  const claude: AgentEntry = {
    id: DEFAULT_AGENT_ID,
    name: "Claude",
    description: "Claude Code over ACP",
    version: "latest",
    iconUrl: "https://cdn.agentclientprotocol.com/registry/v1/latest/claude-acp.svg",
    distribution: { kind: "npx", run: { package: "@agentclientprotocol/claude-agent-acp@latest", args: [], env: {} } },
  };
  return [claude, ...LOCAL_AGENTS];
}
