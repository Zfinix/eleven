export type GoalControl = "pause" | "clear";

/** Codex takes these through `_session/goal`, so they reach it while a turn is still running. */
export function goalControl(agentId: string, text: string): GoalControl | null {
  if (agentId !== "codex-acp") return null;
  const action = /^\/goal\s+(pause|clear)$/i.exec(text.trim())?.[1]?.toLowerCase();
  return action === "pause" || action === "clear" ? action : null;
}
