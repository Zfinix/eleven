import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { findOnPath, type NativeCommand } from "../agents/detect";
import { binaryInstalled, readyToRun, resolveLaunch } from "../agents/launch";
import type { AgentEntry } from "../agents/registry";
import { t, thisDevice } from "../i18n";
import { runInTerminal as openTerminal } from "../lib/platform";

const HOME = homedir();

type Login = {
  readonly signedIn: () => boolean;
  readonly cli: string;
  readonly args: readonly string[];
  readonly npx: string | null;
  readonly logout?: readonly string[];
};

function hasFile(...parts: readonly string[]): boolean {
  return existsSync(join(HOME, ...parts));
}

function fileHas(text: string, ...parts: readonly string[]): boolean {
  try {
    return readFileSync(join(HOME, ...parts), "utf8").includes(text);
  } catch {
    return false;
  }
}

const LOGINS: Readonly<Record<string, Login>> = {
  "claude-acp": { signedIn: () => Boolean(process.env.ANTHROPIC_API_KEY) || fileHas("oauthAccount", ".claude.json"), cli: "claude", args: ["/login"], logout: ["/logout"], npx: "@anthropic-ai/claude-code" },
  "codex-acp": { signedIn: () => Boolean(process.env.OPENAI_API_KEY) || hasFile(".codex", "auth.json"), cli: "codex", args: ["login"], logout: ["logout"], npx: "@openai/codex" },
  gemini: { signedIn: () => Boolean(process.env.GEMINI_API_KEY) || hasFile(".gemini", "oauth_creds.json"), cli: "gemini", args: [], npx: "@google/gemini-cli" },
  opencode: { signedIn: () => hasFile(".local", "share", "opencode", "auth.json"), cli: "opencode", args: ["auth", "login"], logout: ["auth", "logout"], npx: "opencode-ai" },
  goose: { signedIn: () => hasFile(".config", "goose", "config.yaml"), cli: "goose", args: ["configure"], npx: null },
};

export type AgentStatus =
  | { readonly kind: "ready"; readonly detail: string }
  | { readonly kind: "install" }
  | { readonly kind: "installing" }
  | { readonly kind: "failed" }
  | { readonly kind: "signin" }
  | { readonly kind: "unavailable"; readonly detail: string };

function loginCommand(login: Login): string | null {
  if (findOnPath(login.cli)) return [login.cli, ...login.args].join(" ");
  if (login.npx && findOnPath("npx")) return ["npx", "-y", login.npx, ...login.args].join(" ");
  return null;
}

function missingDetail(agent: AgentEntry): string {
  switch (agent.distribution.kind) {
    case "npx":
      return t("setup.agent.needsNode", { device: thisDevice() });
    case "uvx":
      return t("setup.agent.needsUv", { device: thisDevice() });
    case "binary":
    case "command":
      return t("setup.agent.notFound", { device: thisDevice() });
    default: {
      const unhandled: never = agent.distribution;
      return unhandled;
    }
  }
}

export type AgentFacts = { readonly native: NativeCommand | null; readonly downloaded: boolean; readonly installing: boolean; readonly failed: boolean };

export function agentStatus(agent: AgentEntry, facts: AgentFacts): AgentStatus {
  if (facts.installing) return { kind: "installing" };
  if (agent.distribution.kind === "binary" && !facts.native && !facts.downloaded) return facts.failed ? { kind: "failed" } : { kind: "install" };
  if (!readyToRun(agent, facts.native)) return { kind: "unavailable", detail: missingDetail(agent) };
  const login = LOGINS[agent.id];
  const here = facts.native !== null;
  const ready = here ? t("setup.agent.status.here", { device: thisDevice() }) : t("setup.ready");
  if (!login) return { kind: "ready", detail: ready };
  if (login.signedIn()) return { kind: "ready", detail: here ? t("setup.agent.status.hereSignedIn", { device: thisDevice() }) : t("setup.agent.status.signedIn") };
  return loginCommand(login) ? { kind: "signin" } : { kind: "ready", detail: ready };
}

export function agentDetail(status: AgentStatus): string {
  switch (status.kind) {
    case "ready":
    case "unavailable":
      return status.detail;
    case "install":
      return t("setup.agent.status.missing");
    case "installing":
      return t("setup.agent.status.installing");
    case "failed":
      return t("setup.engine.stopped");
    case "signin":
      return t("setup.agent.status.signIn");
  }
}

export async function downloaded(agent: AgentEntry): Promise<boolean> {
  return binaryInstalled(agent);
}

export async function installAgent(agent: AgentEntry): Promise<void> {
  await resolveLaunch(agent, null);
}

/** Whether the agent is signed in, or null when Eleven doesn't know how to tell. */
export function signedIn(agent: AgentEntry): boolean | null {
  return LOGINS[agent.id]?.signedIn() ?? null;
}

export function canSignOut(agent: AgentEntry): boolean {
  return LOGINS[agent.id]?.logout !== undefined;
}

/** Opens Terminal on the agent's own login command; it signs in there and comes back. */
export function signIn(agent: AgentEntry): void {
  const login = LOGINS[agent.id];
  runInTerminal(login ? loginCommand(login) : null);
}

export function signOut(agent: AgentEntry): void {
  const login = LOGINS[agent.id];
  runInTerminal(login?.logout ? loginCommand({ ...login, args: login.logout }) : null);
}

function runInTerminal(command: string | null): void {
  if (command) openTerminal(command);
}
