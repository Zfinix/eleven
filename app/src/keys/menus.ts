import type { MenuItemSpec, MenuSpec } from "@gpuix/native";

import { tr } from "../i18n";
import { type CommandId, isCommandId } from "./commands";
import { type Combo, isBareCombo } from "./keymaps";
import { isMenuActionId, type MenuActionId } from "./menuActions";

export type RecentProject = { readonly id: string; readonly name: string };

/** What the menu bar is built from: the current shortcuts and what the screen can do right now. */
export type MenuContext = {
  readonly combo: (id: CommandId) => Combo;
  readonly bound: (id: CommandId) => boolean;
  readonly offered: (id: MenuActionId) => boolean;
  readonly recent: readonly RecentProject[];
};

/** Items that are neither commands nor menu actions. */
export const APP_ITEMS = ["about", "updates", "shortcuts", "whatsNew", "report"] as const;

export type AppItem = (typeof APP_ITEMS)[number];

/** What a menu item id asks for, so the click handler can switch on it. */
export type MenuChoice =
  | { readonly kind: "command"; readonly id: CommandId }
  | { readonly kind: "action"; readonly id: MenuActionId }
  | { readonly kind: "recent"; readonly id: string }
  | { readonly kind: "app"; readonly id: AppItem };

export function choiceId(choice: MenuChoice): string {
  return `${choice.kind}:${choice.id}`;
}

const SEPARATOR: MenuItemSpec = { role: "separator" };

/**
 * A command with ⌘ or ⌃ shows its shortcut and presses it when chosen, so it acts exactly like the keyboard.
 * A one-key shortcut would let the menu take that key from text fields, so those call back by id instead.
 */
function command(ctx: MenuContext, id: CommandId, label: string): MenuItemSpec {
  const combo = ctx.combo(id);
  const item: MenuItemSpec = { id: choiceId({ kind: "command", id }), label: tr(label), enabled: ctx.bound(id) };
  return combo && !isBareCombo(combo) ? { ...item, keys: combo } : item;
}

function action(ctx: MenuContext, id: MenuActionId, label: string): MenuItemSpec {
  return { id: choiceId({ kind: "action", id }), label: tr(label), enabled: ctx.offered(id) };
}

function app(id: AppItem, label: string): MenuItemSpec {
  return { id: choiceId({ kind: "app", id }), label: tr(label) };
}

/** Text fields handle these themselves, so they press the standard keys and are always on. */
function edit(label: string, keys: string): MenuItemSpec {
  return { label: tr(label), keys };
}

function recentMenu(ctx: MenuContext): MenuItemSpec {
  if (ctx.recent.length === 0) return { label: tr("Open Recent"), enabled: false, items: [] };
  return { label: tr("Open Recent"), items: ctx.recent.map((project) => ({ id: choiceId({ kind: "recent", id: project.id }), label: project.name })) };
}

export function menuBar(ctx: MenuContext): MenuSpec[] {
  return [
    { label: "Eleven", items: [
      app("about", "About Eleven"),
      app("updates", "Check for Updates…"),
      SEPARATOR,
      command(ctx, "settings", "Settings…"),
      SEPARATOR,
      { role: "services" },
      SEPARATOR,
      { role: "hide", label: tr("Hide Eleven") },
      { role: "hideOthers" },
      { role: "showAll" },
      SEPARATOR,
      { role: "quit", label: tr("Quit Eleven") },
    ] },
    { label: tr("File"), items: [
      command(ctx, "thread", "New Chat"),
      command(ctx, "open", "Open…"),
      recentMenu(ctx),
      SEPARATOR,
      command(ctx, "save", "Save Project"),
      SEPARATOR,
      { label: tr("Export"), items: [
        action(ctx, "exportPseudocode", "Pseudocode of This Function"),
        action(ctx, "exportAssembly", "Assembly of This Function"),
        SEPARATOR,
        action(ctx, "exportAllPseudocode", "All Pseudocode"),
        action(ctx, "exportObjc", "Objective-C Classes"),
      ] },
      action(ctx, "compare", "Compare with Another Binary…"),
      action(ctx, "writePatched", "Write Patched Copy"),
      SEPARATOR,
      { role: "close" },
    ] },
    { label: tr("Edit"), items: [
      edit("Undo", "cmd-z"),
      edit("Redo", "shift-cmd-z"),
      SEPARATOR,
      edit("Cut", "cmd-x"),
      edit("Copy", "cmd-c"),
      edit("Paste", "cmd-v"),
      edit("Select All", "cmd-a"),
      SEPARATOR,
      command(ctx, "find", "Find…"),
      command(ctx, "findNext", "Find Next"),
      command(ctx, "findPrevious", "Find Previous"),
    ] },
    { label: tr("Navigate"), items: [
      command(ctx, "goto", "Go to Address or Symbol…"),
      command(ctx, "palette", "Search Everything…"),
      SEPARATOR,
      command(ctx, "back", "Back"),
      command(ctx, "forward", "Forward"),
      SEPARATOR,
      command(ctx, "xrefs", "Cross-References"),
    ] },
    { label: tr("Modify"), items: [
      command(ctx, "rename", "Rename…"),
      command(ctx, "comment", "Comment…"),
      command(ctx, "bookmark", "Bookmark"),
      command(ctx, "patch", "Patch Bytes Here…"),
      SEPARATOR,
      { label: tr("Mark As"), items: [
        command(ctx, "markCode", "Code"),
        command(ctx, "markProcedure", "Function"),
        command(ctx, "markData", "Data"),
        command(ctx, "markString", "C String"),
        command(ctx, "markUndefined", "Undefined"),
      ] },
      { label: tr("Show Number As"), items: [
        command(ctx, "showHex", "Hexadecimal"),
        command(ctx, "showDecimal", "Decimal"),
        command(ctx, "showCharacter", "Character"),
        command(ctx, "showOffset", "Offset"),
        command(ctx, "showAddress", "Address"),
      ] },
    ] },
    { label: tr("View"), items: [
      command(ctx, "pseudo", "Pseudocode"),
      command(ctx, "graph", "Graph"),
      command(ctx, "strings", "Strings"),
      SEPARATOR,
      command(ctx, "split", "Split Right"),
      command(ctx, "splitDown", "Split Down"),
      SEPARATOR,
      action(ctx, "sidebar", "Sidebar"),
      command(ctx, "details", "Details"),
      command(ctx, "terminal", "Terminal"),
    ] },
    { label: tr("Agent"), items: [
      command(ctx, "agent", "Agent Panel"),
      command(ctx, "stop", "Stop the Agent"),
    ] },
    { label: tr("Debug"), items: [
      command(ctx, "debug", "Debug This Program"),
      SEPARATOR,
      command(ctx, "continue", "Continue"),
      command(ctx, "stepOver", "Step Over"),
      command(ctx, "stepIn", "Step Into"),
      command(ctx, "stepOut", "Step Out"),
    ] },
    { label: tr("Window"), items: [
      { role: "minimize" },
      { role: "zoom" },
    ] },
    { label: tr("Help"), items: [
      app("shortcuts", "Keyboard Shortcuts"),
      app("whatsNew", "What’s New in Eleven"),
      SEPARATOR,
      app("report", "Report a Problem…"),
    ] },
  ];
}

/** Reads an item id back into what it asks for, or null for one this build doesn't know. */
export function parseChoice(id: string): MenuChoice | null {
  const colon = id.indexOf(":");
  if (colon < 0) return null;
  const kind = id.slice(0, colon);
  const rest = id.slice(colon + 1);
  switch (kind) {
    case "command":
      return isCommandId(rest) ? { kind, id: rest } : null;
    case "action":
      return isMenuActionId(rest) ? { kind, id: rest } : null;
    case "recent":
      return { kind, id: rest };
    case "app": {
      const item = APP_ITEMS.find((known) => known === rest);
      return item ? { kind, id: item } : null;
    }
    default:
      return null;
  }
}
