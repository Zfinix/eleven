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

/** Agents whose standalone install speaks ACP, by where their installer puts it under home. Other tools share these names. */
export const AGENT_ACP_CLI: Readonly<Record<string, { readonly home: readonly string[]; readonly args: readonly string[] }>> = {
  "grok-build": { home: [".grok", "bin", "grok"], args: ["agent", "stdio"] },
};
