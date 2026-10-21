import { t } from "../i18n";

export const COMMAND_IDS = [
  "goto", "palette", "open", "save", "back", "forward", "find", "findNext", "findPrevious",
  "rename", "comment", "xrefs", "bookmark", "undo", "redo",
  "graph", "pseudo", "strings", "split", "splitDown", "terminal", "details",
  "agent", "thread", "stop", "settings",
  "patch", "debug", "continue", "stepOver", "stepIn", "stepOut",
  "confirm", "dismiss", "selectAll", "copy",
  "markCode", "markProcedure", "markData", "markString", "markUndefined",
  "showHex", "showDecimal", "showCharacter", "showOffset", "showAddress",
] as const;

export type CommandId = (typeof COMMAND_IDS)[number];

export type CommandGroup = "Navigate" | "Annotate" | "View" | "Agent" | "Debugger";

export type Command = { readonly id: CommandId; readonly group: CommandGroup };

export const COMMANDS: readonly Command[] = [
  { id: "goto", group: "Navigate" },
  { id: "palette", group: "Navigate" },
  { id: "open", group: "Navigate" },
  { id: "save", group: "Navigate" },
  { id: "back", group: "Navigate" },
  { id: "forward", group: "Navigate" },
  { id: "find", group: "Navigate" },
  { id: "findNext", group: "Navigate" },
  { id: "findPrevious", group: "Navigate" },
  { id: "rename", group: "Annotate" },
  { id: "comment", group: "Annotate" },
  { id: "xrefs", group: "Annotate" },
  { id: "bookmark", group: "Annotate" },
  { id: "undo", group: "Annotate" },
  { id: "redo", group: "Annotate" },
  { id: "patch", group: "Annotate" },
  { id: "markCode", group: "Annotate" },
  { id: "markProcedure", group: "Annotate" },
  { id: "markData", group: "Annotate" },
  { id: "markString", group: "Annotate" },
  { id: "markUndefined", group: "Annotate" },
  { id: "showHex", group: "Annotate" },
  { id: "showDecimal", group: "Annotate" },
  { id: "showCharacter", group: "Annotate" },
  { id: "showOffset", group: "Annotate" },
  { id: "showAddress", group: "Annotate" },
  { id: "graph", group: "View" },
  { id: "pseudo", group: "View" },
  { id: "strings", group: "View" },
  { id: "split", group: "View" },
  { id: "splitDown", group: "View" },
  { id: "terminal", group: "View" },
  { id: "details", group: "View" },
  { id: "agent", group: "Agent" },
  { id: "thread", group: "Agent" },
  { id: "stop", group: "Agent" },
  { id: "settings", group: "Agent" },
  { id: "debug", group: "Debugger" },
  { id: "continue", group: "Debugger" },
  { id: "stepOver", group: "Debugger" },
  { id: "stepIn", group: "Debugger" },
  { id: "stepOut", group: "Debugger" },
  { id: "selectAll", group: "View" },
  { id: "copy", group: "View" },
  { id: "confirm", group: "Navigate" },
  { id: "dismiss", group: "Navigate" },
];

export const GROUPS: readonly CommandGroup[] = ["Navigate", "Annotate", "View", "Agent", "Debugger"];

/** Commands a text field handles itself while you type in it. */
export const TEXT_COMMANDS: ReadonlySet<CommandId> = new Set<CommandId>(["undo", "redo", "selectAll", "copy"]);

export function isCommandId(value: string): value is CommandId {
  return COMMAND_IDS.some((id) => id === value);
}

export function commandLabel(id: CommandId): string {
  return t(`command.${id}`);
}
