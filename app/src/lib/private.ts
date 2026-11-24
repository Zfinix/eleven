import { currentSettings } from "../settings/store";

/** Agents that can run on a model on this Mac, given one in their own settings: Aster, goose, opencode, or your own command. */
export const LOCAL_MODEL_AGENTS: ReadonlySet<string> = new Set(["aster", "goose", "opencode", "custom-agent"]);

/** Whether the person asked Eleven to keep everything on this Mac, so nothing of Eleven's own goes over the network. */
export function keepsToThisMac(): boolean {
  return currentSettings().keepOnThisMac;
}
