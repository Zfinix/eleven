import { t, thisDevice } from "../i18n";

export const PAGES = ["general", "appearance", "keyboard", "chat", "agents", "permissions", "privacy", "skills", "engines", "code", "debugging", "gpu", "storage", "about"] as const;

export type Page = (typeof PAGES)[number];

export const NAV_GROUPS: readonly (readonly Page[])[] = [
  ["general", "appearance", "keyboard"],
  ["chat", "agents", "permissions", "privacy", "skills"],
  ["engines", "code", "debugging", "gpu"],
  ["storage", "about"],
];

const PATHS: Readonly<Record<Page, string>> = {
  general: "M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
  appearance: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 3v18M12 7a5 5 0 010 10",
  keyboard: "M3 6.5h18v11H3zM7 10h.01M10 10h.01M13 10h.01M16 10h.01M7.5 14h9",
  chat: "M5 5h14a1 1 0 011 1v9a1 1 0 01-1 1H10l-4 3v-3H5a1 1 0 01-1-1V6a1 1 0 011-1z",
  agents: "M6 10l3-3v13M12 10l3-3v13",
  permissions: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-4.5",
  privacy: "M6 10.5h12v9.5H6zM8.5 10.5V8a3.5 3.5 0 017 0v2.5M12 14.5v2",
  skills: "M5 4h10l4 4v12H5zM14 4v5h5M8.5 13h7M8.5 16.5h5",
  engines: "M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4",
  code: "M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14",
  debugging: "M9 9a3 3 0 016 0v6a3 3 0 01-6 0zM12 9v9M4 12h5M15 12h5M5 6l4 3M19 6l-4 3M5 19l4-3M19 19l-4-3",
  gpu: "M2.5 6.5h19v11h-19zM8 12a2.5 2.5 0 100 .01M16 12a2.5 2.5 0 100 .01M6 17.5v3M10 17.5v3",
  storage: "M3.5 7a1.5 1.5 0 011.5-1.5h4.5l2 2H19a1.5 1.5 0 011.5 1.5v9A1.5 1.5 0 0119 19.5H5A1.5 1.5 0 013.5 18z",
  about: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M12 7.5h.01",
};

const SPARK = "M19.5 1.2c.4 2 1.4 3 3.4 3.4-2 .4-3 1.4-3.4 3.4-.4-2-1.4-3-3.4-3.4 2-.4 3-1.4 3.4-3.4z";

export function pageTitle(page: Page): string {
  return t(`settings.page.${page}`);
}

export function pageIntro(page: Page): string {
  return page === "agents" || page === "privacy" ? t(`settings.intro.${page}`, { device: thisDevice() }) : t(`settings.intro.${page}`);
}

/** The page's icon from the design board, as SVG drawn in currentColor. */
export function pageIcon(page: Page): string {
  const fill = page === "agents" ? `<path d="${SPARK}" fill="currentColor" stroke-width="1"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${PATHS[page]}"/>${fill}</svg>`;
}

export const KEYBOARD_WORDS = "keyboard shortcuts keys keymap hotkey";
