export type StepStatus = "running" | "done" | "failed";

/** What a tool does, as the agent protocol classifies it. */
export type ToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "other";

export type PermissionChoice = { readonly id: string; readonly label: string; readonly allows: boolean };

export type PlanItem = { readonly content: string; readonly status: "pending" | "in_progress" | "completed" };

export type SlashCommand = { readonly name: string; readonly description: string; readonly hint: string | null };

export type OptionCategory = "model" | "mode" | "thought_level" | "other";

export type OptionChoice = { readonly value: string; readonly name: string; readonly description: string | null };

/** One of the agent's settings: its model, its mode, how hard it thinks, or anything else it exposes. */
export type SessionOption = {
  readonly id: string;
  readonly name: string;
  readonly category: OptionCategory;
  readonly current: string;
  readonly choices: readonly OptionChoice[];
  /** Older agents expose modes through session modes rather than config options. */
  readonly legacyMode: boolean;
};

export type Usage = { readonly used: number; readonly size: number; readonly cost: string | null };

export type AgentEvent =
  | { readonly kind: "connected"; readonly agent: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "thought"; readonly text: string }
  | {
      readonly kind: "step";
      readonly id: string;
      readonly tool: string;
      readonly toolKind: ToolKind | null;
      readonly status: StepStatus;
      readonly input: unknown;
      readonly output: string | null;
    }
  | { readonly kind: "permission"; readonly id: number; readonly tool: string; readonly input: unknown; readonly choices: readonly PermissionChoice[] }
  | { readonly kind: "plan"; readonly items: readonly PlanItem[] }
  | { readonly kind: "commands"; readonly commands: readonly SlashCommand[] }
  | { readonly kind: "options"; readonly options: readonly SessionOption[] }
  | { readonly kind: "usage"; readonly usage: Usage }
  | { readonly kind: "notice"; readonly text: string }
  | { readonly kind: "turnEnded"; readonly cancelled: boolean; readonly refused?: boolean }
  | { readonly kind: "failed"; readonly reason: string };
