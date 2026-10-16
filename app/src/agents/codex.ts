import { isRecord, recordField } from "../lib/guards";
import type { AgentEvent, GoalStatus } from "./events";

/** The Codex adapter publishes goal snapshots through this metadata extension. */
export const CODEX_CLIENT_META = { jetbrains: { air: { version: 1 } } } as const;

export type GoalControl = "pause" | "clear";

/** These controls must reach Codex while its current turn is still running. */
export function goalControl(text: string): GoalControl | null {
  const command = /^\/goal\s+(pause|clear)$/i.exec(text.trim());
  const action = command?.[1]?.toLowerCase();
  return action === "pause" || action === "clear" ? action : null;
}

/** The Codex adapter accepts session instructions through its custom-instructions extension. */
export function codexSessionMeta(instructions: string): Record<string, unknown> {
  return { jetbrains: { air: { version: 1, customInstructions: instructions } } };
}

function isGoalStatus(value: unknown): value is GoalStatus {
  return (
    value === "active" ||
    value === "paused" ||
    value === "blocked" ||
    value === "complete" ||
    value === "limited"
  );
}

function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Missing or malformed metadata leaves the current goal alone; an explicit null clears it. */
export function codexGoalEvent(meta: unknown): AgentEvent | null {
  const air = recordField(recordField(meta, "jetbrains"), "air");
  const goal = air?.goal;
  if (goal === null) return { kind: "goal", goal: null };
  if (!isRecord(goal)) return null;

  const { objective, status, timeUsedSeconds, createdAt, updatedAt } = goal;
  if (typeof objective !== "string" || !objective.trim() || !isGoalStatus(status)) return null;
  if (
    !isNonnegativeNumber(timeUsedSeconds) ||
    !isNonnegativeNumber(createdAt) ||
    !isNonnegativeNumber(updatedAt)
  )
    return null;

  return {
    kind: "goal",
    goal: { objective: objective.trim(), status, timeUsedSeconds, createdAt, updatedAt },
  };
}
