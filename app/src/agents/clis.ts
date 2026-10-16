/** The agent's own command-line tool, for the agents that ship one. Eleven runs these through their ACP adapter. */
export const AGENT_CLI: Readonly<Record<string, string>> = {
  "claude-acp": "claude",
  "codex-acp": "codex",
  "grok-build": "grok",
  "antigravity-acp": "agy",
  gemini: "gemini",
  opencode: "opencode",
  goose: "goose",
  cursor: "cursor-agent",
  "crow-cli": "crow-cli",
  cline: "cline",
};

/** Agents whose own CLI speaks ACP, so a standalone install works without the registry's npm package. */
export const AGENT_ACP_CLI: Readonly<Record<string, { readonly command: string; readonly args: readonly string[] }>> = {
  "grok-build": { command: "grok", args: ["agent", "stdio"] },
};
