export type DebugAction = "continue" | "pause" | "step_over" | "step_into" | "step_out" | "step_instruction";

export const DEBUG_ACTIONS: readonly DebugAction[] = ["continue", "pause", "step_over", "step_into", "step_out", "step_instruction"];

export function isDebugAction(value: string): value is DebugAction {
  return DEBUG_ACTIONS.some((action) => action === value);
}

/** What the open debug session lets an agent do. Every answer is plain text for the agent to read. */
export type DebugControl = {
  readonly describe: () => Promise<string>;
  readonly act: (action: DebugAction) => Promise<string>;
  readonly evaluate: (expression: string) => Promise<string>;
  readonly memory: (where: string) => Promise<string>;
};

let control: DebugControl | null = null;

/** The debug view claims this while a session is open in it. */
export function claimDebug(next: DebugControl | null): void {
  control = next;
}

export function debugControl(): DebugControl | null {
  return control;
}

/** Starts the open file under the debugger, or attaches to `pid`, and reports where it first stops. */
export type DebugStarter = (pid: number | null) => Promise<string>;

let starter: DebugStarter | null = null;
let opener: (() => void) | null = null;
let workbench: (() => boolean) | null = null;

/** The debug view claims this while it is open, since it knows the program and its breakpoints. */
export function claimDebugStart(next: DebugStarter | null): void {
  starter = next;
}

/** The workbench claims this so an agent can bring up the debug view. */
export function claimDebugOpen(next: (() => void) | null): void {
  opener = next;
}

/** The app claims this so an agent can bring up the workbench for the open file. It returns false when no file is open. */
export function claimWorkbenchOpen(next: (() => boolean) | null): void {
  workbench = next;
}

const OPEN_WAIT_MS = 10_000;

async function until(ready: () => boolean): Promise<void> {
  const end = Date.now() + OPEN_WAIT_MS;
  while (!ready() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 50));
}

/** Opens the debug view when it is closed, then starts a session from it. */
export async function startDebugging(pid: number | null): Promise<string> {
  if (!starter && !opener) {
    if (!workbench?.()) throw new Error("No file is open in Eleven. Ask the user to open one.");
    await until(() => opener !== null);
  }
  if (!starter) {
    if (!opener) throw new Error("The workbench didn't open. Ask the user to press Debug.");
    opener();
    await until(() => starter !== null);
  }
  if (!starter) throw new Error("The debug view didn't open. Ask the user to press Debug.");
  return starter(pid);
}
