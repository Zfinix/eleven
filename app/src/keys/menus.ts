import type { MenuItemSpec, MenuSpec } from "@gpuix/native";

import { type PlainId, t } from "../i18n";
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
export const APP_ITEMS = ["about", "updates", "shortcuts", "whatsNew", "support", "report"] as const;

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
function command(ctx: MenuContext, id: CommandId, label: PlainId): MenuItemSpec {
  const combo = ctx.combo(id);
  const item: MenuItemSpec = { id: choiceId({ kind: "command", id }), label: t(label), enabled: ctx.bound(id) };
  return combo && !isBareCombo(combo) ? { ...item, keys: combo } : item;
}

function action(ctx: MenuContext, id: MenuActionId, label: PlainId): MenuItemSpec {
  return { id: choiceId({ kind: "action", id }), label: t(label), enabled: ctx.offered(id) };
}

function app(id: AppItem, label: PlainId): MenuItemSpec {
  return { id: choiceId({ kind: "app", id }), label: t(label) };
}

/** Text fields handle these themselves, so they press the standard keys and are always on. */
function edit(label: PlainId, keys: string): MenuItemSpec {
  return { label: t(label), keys };
}

function recentMenu(ctx: MenuContext): MenuItemSpec {
  if (ctx.recent.length === 0) return { label: t("menu.openRecent"), enabled: false, items: [] };
  return { label: t("menu.openRecent"), items: ctx.recent.map((project) => ({ id: choiceId({ kind: "recent", id: project.id }), label: project.name })) };
}

export function menuBar(ctx: MenuContext): MenuSpec[] {
  return [
    { label: "Eleven", items: [
      app("about", "menu.about"),
      app("updates", "menu.checkUpdates"),
      SEPARATOR,
      command(ctx, "settings", "menu.settings"),
      SEPARATOR,
      { role: "services", label: t("menu.services") },
      SEPARATOR,
      { role: "hide", label: t("menu.hide") },
      { role: "hideOthers", label: t("menu.hideOthers") },
      { role: "showAll", label: t("menu.showAll") },
      SEPARATOR,
      { role: "quit", label: t("menu.quit") },
    ] },
    { label: t("menu.file"), items: [
      command(ctx, "thread", "menu.newChat"),
      command(ctx, "open", "menu.open"),
      recentMenu(ctx),
      SEPARATOR,
      command(ctx, "save", "menu.save"),
      SEPARATOR,
      { label: t("menu.export"), items: [
        action(ctx, "exportPseudocode", "menu.exportPseudocode"),
        action(ctx, "exportAssembly", "menu.exportAssembly"),
        SEPARATOR,
        action(ctx, "exportAllPseudocode", "menu.exportAllPseudocode"),
        action(ctx, "exportObjc", "menu.exportObjc"),
      ] },
      action(ctx, "compare", "menu.compare"),
      action(ctx, "writePatched", "menu.writePatched"),
      SEPARATOR,
      { role: "close", label: t("menu.close") },
    ] },
    { label: t("menu.edit"), items: [
      edit("menu.undo", "cmd-z"),
      edit("menu.redo", "shift-cmd-z"),
      SEPARATOR,
      edit("menu.cut", "cmd-x"),
      edit("menu.copy", "cmd-c"),
      edit("menu.paste", "cmd-v"),
      edit("menu.selectAll", "cmd-a"),
      SEPARATOR,
      command(ctx, "find", "menu.find"),
      command(ctx, "findNext", "menu.findNext"),
      command(ctx, "findPrevious", "menu.findPrevious"),
    ] },
    { label: t("menu.navigate"), items: [
      command(ctx, "goto", "menu.goto"),
      command(ctx, "palette", "menu.palette"),
      SEPARATOR,
      command(ctx, "back", "menu.back"),
      command(ctx, "forward", "menu.forward"),
      SEPARATOR,
      command(ctx, "xrefs", "menu.xrefs"),
    ] },
    { label: t("menu.modify"), items: [
      command(ctx, "rename", "menu.rename"),
      command(ctx, "comment", "menu.comment"),
      command(ctx, "bookmark", "menu.bookmark"),
      command(ctx, "patch", "menu.patch"),
      SEPARATOR,
      { label: t("menu.markAs"), items: [
        command(ctx, "markCode", "menu.markCode"),
        command(ctx, "markProcedure", "menu.markProcedure"),
        command(ctx, "markData", "menu.markData"),
        command(ctx, "markString", "menu.markString"),
        command(ctx, "markUndefined", "menu.markUndefined"),
      ] },
      { label: t("menu.showAs"), items: [
        command(ctx, "showHex", "menu.showHex"),
        command(ctx, "showDecimal", "menu.showDecimal"),
        command(ctx, "showCharacter", "menu.showCharacter"),
        command(ctx, "showOffset", "menu.showOffset"),
        command(ctx, "showAddress", "menu.showAddress"),
      ] },
    ] },
    { label: t("menu.view"), items: [
      command(ctx, "pseudo", "menu.pseudo"),
      command(ctx, "graph", "menu.graph"),
      command(ctx, "strings", "menu.strings"),
      SEPARATOR,
      command(ctx, "split", "menu.split"),
      command(ctx, "splitDown", "menu.splitDown"),
      SEPARATOR,
      action(ctx, "sidebar", "menu.sidebar"),
      command(ctx, "details", "menu.details"),
      command(ctx, "terminal", "menu.terminal"),
    ] },
    { label: t("menu.agent"), items: [
      command(ctx, "agent", "menu.agentPanel"),
      command(ctx, "stop", "menu.stop"),
    ] },
    { label: t("menu.debug"), items: [
      command(ctx, "debug", "menu.debugProgram"),
      SEPARATOR,
      command(ctx, "continue", "menu.continue"),
      command(ctx, "stepOver", "menu.stepOver"),
      command(ctx, "stepIn", "menu.stepIn"),
      command(ctx, "stepOut", "menu.stepOut"),
    ] },
    { label: t("menu.window"), items: [
      { role: "minimize", label: t("menu.minimize") },
      { role: "zoom", label: t("menu.zoom") },
    ] },
    { label: t("menu.help"), items: [
      app("shortcuts", "menu.shortcuts"),
      app("whatsNew", "menu.whatsNew"),
      app("support", "menu.support"),
      SEPARATOR,
      app("report", "menu.report"),
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
