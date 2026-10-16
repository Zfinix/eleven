import { useEffect, useRef } from "react";

import { listProjects, onProjectListChange } from "../engine/project";
import { useLanguage } from "../i18n";
import { isCommandBound, onCommandsChange } from "../lib/shortcuts";
import type { Desktop } from "../lib/native";
import { type Settings, useSettings } from "../settings/store";
import { comboFor } from "./keymaps";
import { hasMenuAction, onMenuActionsChange } from "./menuActions";
import { type MenuChoice, type MenuContext, menuBar, parseChoice } from "./menus";

const RECENT_LIMIT = 10;

/** Screens mount dozens of commands at once; one rebuild after they settle is enough. */
const SETTLE_MS = 40;

function contextFor(settings: Settings, withShortcuts: boolean): MenuContext {
  return {
    combo: (id) => (withShortcuts ? comboFor(id, settings.keymap ?? "eleven", settings.shortcuts) : ""),
    bound: isCommandBound,
    offered: hasMenuAction,
    recent: listProjects().slice(0, RECENT_LIMIT).map((entry) => ({ id: entry.id, name: entry.name })),
  };
}

/** A shortcut GPUI can't read would reject the whole bar, so that case falls back to a bar without shortcuts. */
function install(desktop: Desktop, settings: Settings): void {
  try {
    desktop.setMenus(menuBar(contextFor(settings, true)));
  } catch {
    desktop.setMenus(menuBar(contextFor(settings, false)));
  }
}

/** Keeps the macOS menu bar in step with the keymap and with what the screen in front can do. */
export function useMenuBar(desktop: Desktop | null, choose: (choice: MenuChoice) => void): void {
  const { settings } = useSettings();
  const language = useLanguage();
  const latest = useRef({ settings, choose });
  latest.current = { settings, choose };
  const { keymap, shortcuts } = settings;

  useEffect(() => {
    if (!desktop) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const rebuild = (): void => {
      timer = null;
      install(desktop, latest.current.settings);
    };
    const schedule = (): void => {
      timer ??= setTimeout(rebuild, SETTLE_MS);
    };
    rebuild();
    const stops = [onCommandsChange(schedule), onMenuActionsChange(schedule), onProjectListChange(schedule)];
    return () => {
      for (const stop of stops) stop();
      if (timer !== null) clearTimeout(timer);
    };
  }, [desktop, keymap, shortcuts, language]);

  useEffect(() => {
    if (!desktop) return;
    desktop.setMenuAction((id) => {
      const choice = parseChoice(id);
      if (choice) latest.current.choose(choice);
    });
    return () => desktop.setMenuAction(null);
  }, [desktop]);
}
