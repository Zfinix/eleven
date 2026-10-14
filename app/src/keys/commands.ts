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

export type Command = { readonly id: CommandId; readonly label: string; readonly group: CommandGroup };

export const COMMANDS: readonly Command[] = [
  { id: "goto", label: "Go to address or symbol", group: "Navigate" },
  { id: "palette", label: "Search everything", group: "Navigate" },
  { id: "open", label: "Open a file", group: "Navigate" },
  { id: "save", label: "Save project", group: "Navigate" },
  { id: "back", label: "Back", group: "Navigate" },
  { id: "forward", label: "Forward", group: "Navigate" },
  { id: "find", label: "Find in this view", group: "Navigate" },
  { id: "findNext", label: "Find next", group: "Navigate" },
  { id: "findPrevious", label: "Find previous", group: "Navigate" },
  { id: "rename", label: "Rename", group: "Annotate" },
  { id: "comment", label: "Comment", group: "Annotate" },
  { id: "xrefs", label: "Cross-references", group: "Annotate" },
  { id: "bookmark", label: "Bookmark", group: "Annotate" },
  { id: "undo", label: "Undo the last change", group: "Annotate" },
  { id: "redo", label: "Redo", group: "Annotate" },
  { id: "patch", label: "Patch bytes here", group: "Annotate" },
  { id: "markCode", label: "Mark as code", group: "Annotate" },
  { id: "markProcedure", label: "Mark as a function", group: "Annotate" },
  { id: "markData", label: "Mark as data", group: "Annotate" },
  { id: "markString", label: "Mark as a C string", group: "Annotate" },
  { id: "markUndefined", label: "Mark as undefined", group: "Annotate" },
  { id: "showHex", label: "Show number as hexadecimal", group: "Annotate" },
  { id: "showDecimal", label: "Show number as decimal", group: "Annotate" },
  { id: "showCharacter", label: "Show number as a character", group: "Annotate" },
  { id: "showOffset", label: "Show number as an offset", group: "Annotate" },
  { id: "showAddress", label: "Show number as an address", group: "Annotate" },
  { id: "graph", label: "Graph view", group: "View" },
  { id: "pseudo", label: "Pseudocode", group: "View" },
  { id: "strings", label: "Strings", group: "View" },
  { id: "split", label: "Split right", group: "View" },
  { id: "splitDown", label: "Split down", group: "View" },
  { id: "terminal", label: "Terminal", group: "View" },
  { id: "details", label: "Show or hide details", group: "View" },
  { id: "agent", label: "Agent panel", group: "Agent" },
  { id: "thread", label: "New chat", group: "Agent" },
  { id: "stop", label: "Stop the agent", group: "Agent" },
  { id: "settings", label: "Settings", group: "Agent" },
  { id: "debug", label: "Debug this program", group: "Debugger" },
  { id: "continue", label: "Continue", group: "Debugger" },
  { id: "stepOver", label: "Step over", group: "Debugger" },
  { id: "stepIn", label: "Step into", group: "Debugger" },
  { id: "stepOut", label: "Step out", group: "Debugger" },
  { id: "selectAll", label: "Select all code", group: "View" },
  { id: "copy", label: "Copy selected code", group: "View" },
  { id: "confirm", label: "Confirm", group: "Navigate" },
  { id: "dismiss", label: "Dismiss", group: "Navigate" },
];

export const GROUPS: readonly CommandGroup[] = ["Navigate", "Annotate", "View", "Agent", "Debugger"];

/** Commands a text field handles itself while you type in it. */
export const TEXT_COMMANDS: ReadonlySet<CommandId> = new Set<CommandId>(["undo", "redo", "selectAll", "copy"]);

export function isCommandId(value: string): value is CommandId {
  return COMMAND_IDS.some((id) => id === value);
}

export function commandLabel(id: CommandId): string {
  return COMMANDS.find((command) => command.id === id)?.label ?? id;
}
