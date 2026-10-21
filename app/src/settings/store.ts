import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { useSyncExternalStore } from "react";

import { z } from "zod";

import { LANGUAGE_SETTINGS, type LanguageSetting } from "../i18n";
import { COMMAND_IDS } from "../keys/commands";
import { KEYMAP_IDS, type KeymapId, type Overrides } from "../keys/keymaps";
import { errorMessage, isRecord } from "../lib/guards";
import { readOr } from "../lib/schema";
import { supportPath } from "../lib/support";
import type { Appearance } from "../theme";

export const SETTINGS_FILE = supportPath("settings.json");

export const CODE_FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 17, 18] as const;

export type CodeFontSize = (typeof CODE_FONT_SIZES)[number];

export const PERMISSION_TOOLS = ["read", "view", "rename", "notes", "patch", "gpu", "debug", "shell"] as const;

export type PermissionTool = (typeof PERMISSION_TOOLS)[number];

export const PERMISSION_LEVELS = ["Allow", "Ask", "Never"] as const;

export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export type PermissionTable = Readonly<Record<PermissionTool, PermissionLevel>>;

export const PERMISSION_PRESETS = {
  careful: { read: "Ask", view: "Allow", rename: "Ask", notes: "Ask", patch: "Ask", gpu: "Ask", debug: "Ask", shell: "Ask" },
  balanced: { read: "Allow", view: "Allow", rename: "Ask", notes: "Ask", patch: "Ask", gpu: "Ask", debug: "Ask", shell: "Ask" },
  free: { read: "Allow", view: "Allow", rename: "Allow", notes: "Allow", patch: "Ask", gpu: "Allow", debug: "Allow", shell: "Ask" },
} as const satisfies Readonly<Record<string, PermissionTable>>;

export const PATH_KEYS = ["exportDir", "lldbDap", "ghidraDir", "javaHome", "reaPath", "rizinPath", "cacheDir", "hopperPath", "idaPath", "skillsDir"] as const;

/** Languages the pseudocode view can rewrite a function into; Pseudocode is the engine's own output. */
export const CODE_LANGUAGES = ["Pseudocode", "C", "C++", "Rust", "Go", "Swift", "Python", "TypeScript", "Java", "C#", "Zig"] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

export const CODE_FONTS = ["JetBrains Mono", "SF Mono", "Menlo", "Cascadia Mono", "Consolas", "DejaVu Sans Mono", "Liberation Mono"] as const;

export type CodeFont = (typeof CODE_FONTS)[number];

export const GPU_SECONDS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60] as const;

export type PathKey = (typeof PATH_KEYS)[number];

export type Settings = {
  readonly defaultAgent: string | null;
  readonly language: LanguageSetting;
  readonly askBeforeChanges: boolean;
  readonly readWithoutAsking: boolean;
  /** Agent renames, notes, comments and bookmarks wait for review too, not just patches. */
  readonly reviewAgentEdits: boolean;
  readonly showThinking: boolean;
  readonly appearance: Appearance;
  readonly codeFontSize: CodeFontSize;
  readonly codeFont: CodeFont;
  readonly uiSize: "Small" | "Default" | "Large";
  readonly colorScheme: "Eleven" | "Classic" | "Quiet";
  readonly graphUsesCodeSize: boolean;
  readonly idaTools: boolean;
  readonly keymap: KeymapId | null;
  readonly shortcuts: Overrides;
  readonly permissions: PermissionTable;
  readonly rememberAnswers: boolean;
  readonly launch: "Home" | "The last project";
  readonly restoreLayout: boolean;
  readonly autoUpdate: boolean;
  readonly updateChannel: "Stable" | "Beta";
  readonly showWhatsNew: boolean;
  readonly showSuggestions: boolean;
  /** How much of the desktop shows through the window: 0 is solid, 100 is clearest. */
  readonly transparency: number;
  /** How strongly the desktop behind the window is blurred, from 0 to 100. */
  readonly frost: number;
  readonly lineSpacing: "Compact" | "Normal" | "Relaxed";
  readonly codeLanguage: CodeLanguage;
  readonly lineNumbers: boolean;
  readonly sendKey: "Return" | "Command Return";
  readonly notifyWhenDone: boolean;
  readonly notifyWhenAsked: boolean;
  readonly notifyWhenReady: boolean;
  readonly soundWhenAsked: boolean;
  readonly chatHistory: "Short" | "Normal" | "Long";
  readonly openWorkbench: "When the agent opens code" | "Always" | "Only when I ask";
  readonly keepAgentsRunning: boolean;
  readonly startAgentWithProject: boolean;
  readonly elevenTools: boolean;
  readonly reaTools: boolean;
  /** The model each agent answers "Ask about code" with, by agent id; missing means the chat's model. */
  readonly askModels: Readonly<Record<string, string>>;
  readonly askFast: boolean;
  readonly customAgent: string;
  readonly customToolServer: string;
  readonly hidePaths: boolean;
  readonly askBeforeWholeFile: boolean;
  readonly countInstall: boolean;
  readonly crashReports: boolean;
  readonly usageStats: boolean;
  readonly disabledSkills: readonly string[];
  readonly skillsInComposer: boolean;
  readonly ghidraPseudocode: boolean;
  readonly ghidraMemory: "Automatic" | "2 GB" | "4 GB" | "8 GB" | "16 GB" | "32 GB" | "64 GB";
  readonly ghidraTimeout: "30 minutes" | "2 hours" | "6 hours" | "12 hours";
  readonly findParameters: boolean;
  readonly rebuildSwitches: boolean;
  readonly hiddenCode: boolean;
  readonly swiftNames: boolean;
  readonly firstView: "Pseudocode" | "Assembly" | "Graph" | "Hex";
  readonly universalApps: "Ask each time" | "Open the one for this Mac";
  readonly addressPrefix: boolean;
  readonly addressUpper: boolean;
  readonly addressPad: boolean;
  readonly hexRow: "8" | "16" | "32";
  readonly listLimit: "400" | "1,000" | "5,000" | "All";
  readonly minimap: boolean;
  readonly blockLines: "4" | "8" | "16" | "All";
  readonly stopAtFunction: boolean;
  readonly stopAtEntry: boolean;
  readonly programArgs: string;
  readonly variableLimit: "50" | "200" | "1,000";
  readonly gpuTemplate: "Metal System Trace" | "Game Performance" | "Metal Application";
  readonly gpuSeconds: (typeof GPU_SECONDS)[number];
  readonly gpuSkipFrames: "0" | "3" | "10";
  readonly keepRecordings: "1" | "3" | "10" | "All";
  readonly revealExports: boolean;
  readonly autosave: boolean;
  readonly exportDir: string;
  readonly lldbDap: string;
  readonly ghidraDir: string;
  readonly javaHome: string;
  readonly reaPath: string;
  readonly rizinPath: string;
  readonly cacheDir: string;
  readonly hopperPath: string;
  readonly idaPath: string;
  readonly skillsDir: string;
};

export const DEFAULT_SETTINGS: Settings = {
  defaultAgent: null,
  language: "auto",
  askBeforeChanges: true,
  readWithoutAsking: true,
  reviewAgentEdits: false,
  showThinking: true,
  appearance: "System",
  codeFontSize: 10,
  codeFont: "JetBrains Mono",
  uiSize: "Default",
  colorScheme: "Eleven",
  graphUsesCodeSize: true,
  idaTools: false,
  keymap: null,
  shortcuts: {},
  permissions: PERMISSION_PRESETS.balanced,
  rememberAnswers: true,
  launch: "Home",
  restoreLayout: true,
  autoUpdate: true,
  updateChannel: "Stable",
  showWhatsNew: true,
  showSuggestions: true,
  transparency: process.platform === "linux" ? 0 : 30,
  frost: 60,
  lineSpacing: "Normal",
  codeLanguage: "Pseudocode",
  lineNumbers: true,
  sendKey: "Return",
  notifyWhenDone: true,
  notifyWhenAsked: true,
  notifyWhenReady: true,
  soundWhenAsked: false,
  chatHistory: "Normal",
  openWorkbench: "When the agent opens code",
  keepAgentsRunning: true,
  startAgentWithProject: false,
  elevenTools: true,
  reaTools: true,
  askModels: {},
  askFast: false,
  customAgent: "",
  customToolServer: "",
  hidePaths: true,
  askBeforeWholeFile: false,
  countInstall: true,
  crashReports: false,
  usageStats: false,
  disabledSkills: [],
  skillsInComposer: true,
  ghidraPseudocode: true,
  ghidraMemory: "Automatic",
  ghidraTimeout: "30 minutes",
  findParameters: false,
  rebuildSwitches: false,
  hiddenCode: false,
  swiftNames: true,
  firstView: "Pseudocode",
  universalApps: "Ask each time",
  addressPrefix: true,
  addressUpper: false,
  addressPad: false,
  hexRow: "16",
  listLimit: "1,000",
  minimap: true,
  blockLines: "8",
  stopAtFunction: true,
  stopAtEntry: false,
  programArgs: "",
  variableLimit: "200",
  gpuTemplate: "Metal System Trace",
  gpuSeconds: 20,
  gpuSkipFrames: "3",
  keepRecordings: "3",
  revealExports: true,
  autosave: true,
  exportDir: "",
  lldbDap: "",
  ghidraDir: "",
  javaHome: "",
  reaPath: "",
  rizinPath: "",
  cacheDir: "",
  hopperPath: "",
  idaPath: "",
  skillsDir: "",
};

const D = DEFAULT_SETTINGS;

const SHORTCUTS: z.ZodType<Overrides> = z.record(z.string(), z.unknown()).catch({}).transform((record) => Object.fromEntries(
  Object.entries(record).filter(([id, combo]) => COMMAND_IDS.some((known) => known === id) && typeof combo === "string"),
));

const PERMISSION_LEVEL: z.ZodType<PermissionLevel> = z.enum(PERMISSION_LEVELS);

const PERMISSIONS: z.ZodType<PermissionTable> = z.object({
  read: PERMISSION_LEVEL.catch(D.permissions.read),
  view: PERMISSION_LEVEL.catch(D.permissions.view),
  rename: PERMISSION_LEVEL.catch(D.permissions.rename),
  notes: PERMISSION_LEVEL.catch(D.permissions.notes),
  patch: PERMISSION_LEVEL.catch(D.permissions.patch),
  gpu: PERMISSION_LEVEL.catch(D.permissions.gpu),
  debug: PERMISSION_LEVEL.catch(D.permissions.debug),
  shell: PERMISSION_LEVEL.catch(D.permissions.shell),
}).catch(D.permissions);

/** Each setting falls back to its default on its own, so one bad value never resets the rest. */
const SETTINGS: z.ZodType<Settings> = z.object({
  defaultAgent: z.string().nullable().catch(D.defaultAgent),
  language: z.enum(LANGUAGE_SETTINGS).catch(D.language),
  askBeforeChanges: z.boolean().catch(D.askBeforeChanges),
  readWithoutAsking: z.boolean().catch(D.readWithoutAsking),
  reviewAgentEdits: z.boolean().catch(D.reviewAgentEdits),
  showThinking: z.boolean().catch(D.showThinking),
  appearance: z.enum(["Dark", "Light", "System"]).catch(D.appearance),
  codeFontSize: z.literal(CODE_FONT_SIZES).catch(D.codeFontSize),
  codeFont: z.enum(CODE_FONTS).catch(D.codeFont),
  uiSize: z.enum(["Small", "Default", "Large"]).catch(D.uiSize),
  colorScheme: z.enum(["Eleven", "Classic", "Quiet"]).catch(D.colorScheme),
  graphUsesCodeSize: z.boolean().catch(D.graphUsesCodeSize),
  idaTools: z.boolean().catch(D.idaTools),
  keymap: z.enum(KEYMAP_IDS).nullable().catch(D.keymap),
  shortcuts: SHORTCUTS,
  permissions: PERMISSIONS,
  rememberAnswers: z.boolean().catch(D.rememberAnswers),
  launch: z.enum(["Home", "The last project"]).catch(D.launch),
  restoreLayout: z.boolean().catch(D.restoreLayout),
  autoUpdate: z.boolean().catch(D.autoUpdate),
  updateChannel: z.enum(["Stable", "Beta"]).catch(D.updateChannel),
  showWhatsNew: z.boolean().catch(D.showWhatsNew),
  showSuggestions: z.boolean().catch(D.showSuggestions),
  transparency: z.number().int().min(0).max(100).catch(D.transparency),
  frost: z.number().int().min(0).max(100).catch(D.frost),
  lineSpacing: z.enum(["Compact", "Normal", "Relaxed"]).catch(D.lineSpacing),
  codeLanguage: z.enum(CODE_LANGUAGES).catch(D.codeLanguage),
  lineNumbers: z.boolean().catch(D.lineNumbers),
  sendKey: z.enum(["Return", "Command Return"]).catch(D.sendKey),
  notifyWhenDone: z.boolean().catch(D.notifyWhenDone),
  notifyWhenAsked: z.boolean().catch(D.notifyWhenAsked),
  notifyWhenReady: z.boolean().catch(D.notifyWhenReady),
  soundWhenAsked: z.boolean().catch(D.soundWhenAsked),
  chatHistory: z.enum(["Short", "Normal", "Long"]).catch(D.chatHistory),
  openWorkbench: z.enum(["When the agent opens code", "Always", "Only when I ask"]).catch(D.openWorkbench),
  keepAgentsRunning: z.boolean().catch(D.keepAgentsRunning),
  startAgentWithProject: z.boolean().catch(D.startAgentWithProject),
  elevenTools: z.boolean().catch(D.elevenTools),
  reaTools: z.boolean().catch(D.reaTools),
  askModels: z.record(z.string(), z.string()).catch(D.askModels),
  askFast: z.boolean().catch(D.askFast),
  customAgent: z.string().catch(D.customAgent),
  customToolServer: z.string().catch(D.customToolServer),
  hidePaths: z.boolean().catch(D.hidePaths),
  askBeforeWholeFile: z.boolean().catch(D.askBeforeWholeFile),
  countInstall: z.boolean().catch(D.countInstall),
  crashReports: z.boolean().catch(D.crashReports),
  usageStats: z.boolean().catch(D.usageStats),
  disabledSkills: z.array(z.string()).catch([]),
  skillsInComposer: z.boolean().catch(D.skillsInComposer),
  ghidraPseudocode: z.boolean().catch(D.ghidraPseudocode),
  ghidraMemory: z.enum(["Automatic", "2 GB", "4 GB", "8 GB", "16 GB", "32 GB", "64 GB"]).catch(D.ghidraMemory),
  ghidraTimeout: z.enum(["30 minutes", "2 hours", "6 hours", "12 hours"]).catch(D.ghidraTimeout),
  findParameters: z.boolean().catch(D.findParameters),
  rebuildSwitches: z.boolean().catch(D.rebuildSwitches),
  hiddenCode: z.boolean().catch(D.hiddenCode),
  swiftNames: z.boolean().catch(D.swiftNames),
  firstView: z.enum(["Pseudocode", "Assembly", "Graph", "Hex"]).catch(D.firstView),
  universalApps: z.enum(["Ask each time", "Open the one for this Mac"]).catch(D.universalApps),
  addressPrefix: z.boolean().catch(D.addressPrefix),
  addressUpper: z.boolean().catch(D.addressUpper),
  addressPad: z.boolean().catch(D.addressPad),
  hexRow: z.enum(["8", "16", "32"]).catch(D.hexRow),
  listLimit: z.enum(["400", "1,000", "5,000", "All"]).catch(D.listLimit),
  minimap: z.boolean().catch(D.minimap),
  blockLines: z.enum(["4", "8", "16", "All"]).catch(D.blockLines),
  stopAtFunction: z.boolean().catch(D.stopAtFunction),
  stopAtEntry: z.boolean().catch(D.stopAtEntry),
  programArgs: z.string().catch(D.programArgs),
  variableLimit: z.enum(["50", "200", "1,000"]).catch(D.variableLimit),
  gpuTemplate: z.enum(["Metal System Trace", "Game Performance", "Metal Application"]).catch(D.gpuTemplate),
  gpuSeconds: z.coerce.number().pipe(z.literal(GPU_SECONDS)).catch(D.gpuSeconds),
  gpuSkipFrames: z.enum(["0", "3", "10"]).catch(D.gpuSkipFrames),
  keepRecordings: z.enum(["1", "3", "10", "All"]).catch(D.keepRecordings),
  revealExports: z.boolean().catch(D.revealExports),
  autosave: z.boolean().catch(D.autosave),
  exportDir: z.string().catch(D.exportDir),
  lldbDap: z.string().catch(D.lldbDap),
  ghidraDir: z.string().catch(D.ghidraDir),
  javaHome: z.string().catch(D.javaHome),
  reaPath: z.string().catch(D.reaPath),
  rizinPath: z.string().catch(D.rizinPath),
  cacheDir: z.string().catch(D.cacheDir),
  hopperPath: z.string().catch(D.hopperPath),
  idaPath: z.string().catch(D.idaPath),
  skillsDir: z.string().catch(D.skillsDir),
});

function parseSettings(json: unknown): Settings {
  const settings = readOr(SETTINGS, json, DEFAULT_SETTINGS);
  return isRecord(json) && json.transparency === undefined && json.windowStyle === "Solid" ? { ...settings, transparency: 0 } : settings;
}

export function loadSettings(): Settings {
  try {
    return parseSettings(JSON.parse(readFileSync(SETTINGS_FILE, "utf8")));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current: Settings | null = null;
const listeners = new Set<() => void>();

function snapshot(): Settings {
  current ??= loadSettings();
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The settings as they are right now, for code outside React such as the window's key listener. */
export function currentSettings(): Settings {
  return snapshot();
}

/** A folder or program chosen in Settings, else the matching environment variable, else undefined. */
export function pathSetting(key: PathKey, env: string): string | undefined {
  return snapshot()[key] || process.env[env] || undefined;
}

export function saveSettings(next: Settings): void {
  current = next;
  for (const listener of listeners) listener();
  try {
    mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
    writeFileSync(SETTINGS_FILE, `${JSON.stringify(next, null, 2)}\n`);
  } catch (err) {
    console.warn(`eleven: couldn't save settings (${errorMessage(err)})`);
  }
}

export type SettingsHandle = {
  readonly settings: Settings;
  readonly update: (patch: Partial<Settings>) => void;
};

/** The saved settings, shared by every screen that reads them and written back on each change. */
export function useSettings(): SettingsHandle {
  const settings = useSyncExternalStore(subscribe, snapshot);
  return { settings, update: (patch) => saveSettings({ ...snapshot(), ...patch }) };
}
