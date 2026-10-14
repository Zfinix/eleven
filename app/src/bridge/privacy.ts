import { homedir } from "node:os";

import { currentSettings } from "../settings/store";

/** With "Hide my folder paths" on, the home folder reads as ~ in anything Eleven hands an agent, also inside JSON where Windows backslashes are doubled. */
export function hidePaths(text: string, hide: boolean = currentSettings().hidePaths): string {
  const home = homedir();
  if (!hide || home.length <= 1) return text;
  const escaped = JSON.stringify(home).slice(1, -1);
  return text.split(home).join("~").split(escaped).join("~");
}
