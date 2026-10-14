import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Presence } from "../agents/detect";
import { DEFAULT_AGENT_ID } from "../agents/registry";
import { canSignOut, signedIn, signIn, signOut } from "../welcome/agentSetup";
import { knownModels } from "../agents/models";
import { forgetAnswers } from "../agents/remembered";
import { activeEngine, chooseEngine, type EngineId } from "../analysis/engines";
import type { Agents } from "../chat/useAgents";
import { appIcon } from "../components/ui";
import { adoptToolchain } from "../engine/toolchain";
import { RECORDINGS_DIR } from "../gpu/trace";
import { loadSkills } from "../skills/load";
import { resetWorkbenchLayout } from "../workbench/sizes";
import { clearFolder, clearRecordings, cacheDir, deleteAllChats, moveToTrash, PROJECTS_DIR, THREADS_DIR } from "./actions";
import type { Info } from "./info";
import type { Action, Confirm, Control, GroupModel, Lead, Option, SettingRowModel } from "./model";
import type { Page } from "./pages";
import { DEFAULT_SETTINGS, type PathKey, PERMISSION_TOOLS, type PermissionLevel, type PermissionTool, saveSettings, type Settings, SETTINGS_FILE } from "./store";
import { openLink, pickPath, showInFinder, tildePath } from "./system";
import { ASSETS } from "../lib/assets";
import { dataRoot, FILE_MANAGER, OS, THIS_DEVICE } from "../lib/platform";
import { MOD } from "../lib/platform";
import { codeFontsHere } from "./look";

export type Ctx = {
  readonly settings: Settings;
  readonly update: (patch: Partial<Settings>) => void;
  readonly agents: Agents;
  readonly installed: ReadonlyMap<string, Presence>;
  readonly info: Info;
  readonly icon: string;
  readonly browsing: boolean;
  readonly drafts: Readonly<Record<string, string>>;
  readonly setDraft: (key: string, value: string) => void;
  readonly setBrowsing: (on: boolean) => void;
  readonly toast: (text: string) => void;
  readonly ask: (id: string) => void;
  readonly refresh: () => void;
  readonly rescan: () => void;
  readonly install: (id: string) => void;
  readonly checkApp: () => void;
  readonly checkEngine: (id: "rizin" | "ghidra") => void;
  readonly copyDetails: () => void;
  readonly setup: () => void;
};

const ENGINES_DIR = join(ASSETS, "engines");
export const ENGINE_LOGO = {
  rizin: join(ENGINES_DIR, "rizin.svg"),
  ghidra: join(ENGINES_DIR, "ghidra.png"),
  hopper: join(ENGINES_DIR, "hopper.png"),
  ida: join(ENGINES_DIR, "ida.png"),
} as const;

const opts = (values: readonly string[]): readonly Option[] => values.map((value) => ({ value, label: value }));

function btn(label: string, act: () => void, style: Action["style"] = "plain"): Action {
  return { label, act, style };
}

function info(title: string, desc: string, extra: Partial<SettingRowModel> = {}): SettingRowModel {
  return { title, desc, control: { kind: "none" }, ...extra };
}

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

type ChoiceKey = { [K in keyof Settings]: string extends Settings[K] ? never : Settings[K] extends string ? K : never }[keyof Settings];

function patchOf<K extends keyof Settings>(key: K, value: Settings[K]): Partial<Settings> {
  const patch: Partial<Settings> = {};
  patch[key] = value;
  return patch;
}

function pickControl<K extends ChoiceKey>(c: Ctx, kind: "seg" | "select", key: K, options: readonly Settings[K][], labels: Readonly<Record<string, string>> = {}, notes: Readonly<Record<string, string>> = {}): Control {
  const pick = (value: string): void => {
    const next = options.find((option) => option === value);
    if (next !== undefined) c.update(patchOf(key, next));
  };
  return { kind, value: c.settings[key], pick, options: options.map((value): Option => { const note = notes[value]; return note ? { value, label: labels[value] ?? value, note } : { value, label: labels[value] ?? value }; }) };
}

function makeHelpers(c: Ctx): {
  readonly tg: (key: BoolKey, title: string, desc: string, extra?: Partial<SettingRowModel>) => SettingRowModel;
  readonly seg: <K extends ChoiceKey>(key: K, title: string, desc: string, options: readonly Settings[K][], labels?: Readonly<Record<string, string>>) => SettingRowModel;
  readonly sel: <K extends ChoiceKey>(key: K, title: string, desc: string, options: readonly Settings[K][], notes?: Readonly<Record<string, string>>) => SettingRowModel;
  readonly path: (key: PathKey, title: string, shown: string, folder: boolean, extra?: Partial<SettingRowModel>) => SettingRowModel;
  readonly danger: (title: string, desc: string, button: string, confirm: Confirm, extra?: readonly Action[]) => SettingRowModel;
  readonly confirmed: (id: string, text: string, label: string, act: () => void, done: string) => Confirm;
} {
  const confirmed = (id: string, text: string, label: string, act: () => void, done: string): Confirm => ({
    id, text, label,
    act: () => {
      act();
      c.refresh();
      c.toast(done);
    },
  });
  return {
    tg: (key, title, desc, extra = {}) => ({ title, desc, control: { kind: "toggle", on: c.settings[key], flip: () => c.update(patchOf(key, !c.settings[key])) }, ...extra }),
    seg: (key, title, desc, options, labels = {}) => ({ title, desc, control: pickControl(c, "seg", key, options, labels) }),
    sel: (key, title, desc, options, notes = {}) => ({ title, desc, control: pickControl(c, "select", key, options, {}, notes) }),
    path: (key, title, shown, folder, extra = {}) => {
      const save = (value: string): void => {
        c.update(patchOf(key, value));
        adoptToolchain();
        c.refresh();
      };
      const choose = async (): Promise<void> => {
        const picked = await pickPath(folder ? "folder" : "file", title);
        if (picked !== null) save(picked);
      };
      const chosen = c.settings[key] !== "";
      return {
        title, desc: tildePath(shown), mono: true, keywords: "folder location path choose", control: { kind: "none" },
        buttons: [btn("Choose…", () => void choose()), btn(`Show in ${FILE_MANAGER}`, () => showInFinder(shown)), ...(chosen ? [btn("Reset", () => save(""))] : [])],
        ...extra,
      };
    },
    danger: (title, desc, button, confirm, extra = []) => info(title, desc, { buttons: [...extra, btn(button, () => c.ask(confirm.id), "danger")], confirm }),
    confirmed,
  };
}

const SKILL_TEXT: Readonly<Record<string, readonly [string, string]>> = {
  "first-look": ["First look", "Tour a new app: what it is, how it starts, what stands out."],
  "explain-function": ["Explain a function", "Walk through the function you have open, step by step."],
  "name-functions": ["Name functions", "Suggest clear names for unnamed functions and apply the ones you approve."],
  find: ["Find", "Hunt for a string, behaviour or API across the whole app."],
  "trace-feature": ["Trace a feature", "Follow a feature from the button you press to the code that does the work."],
  "network-map": ["Map the network code", "List what the app talks to and the code that does it."],
  decompile: ["Clean up pseudocode", "Rewrite a function into readable C with types and names."],
  "shader-check": ["Check a shader", "Read a Metal shader and point out what makes it slow."],
};

const PERMISSION_TEXT: Readonly<Record<PermissionTool, readonly [string, string, string]>> = {
  read: ["Read the open file", "Functions, strings, code and bytes in the app you have open.", "Reading"],
  view: ["Move around the window", "Open functions, switch views and jump to addresses for you.", "Reading"],
  rename: ["Rename functions and variables", "Saved in the project. You can undo any rename.", "Changing your project"],
  notes: ["Add notes, comments and bookmarks", "Saved in the project next to the code.", "Changing your project"],
  patch: ["Patch bytes", "Writes a patched copy. The original file is never touched.", "Changing your project"],
  gpu: ["Run the app to record a GPU trace", "Starts the program under Instruments for a few seconds.", "Running things"],
  debug: ["Run the app in the debugger", "Starts the program and stops at breakpoints.", "Running things"],
  shell: [`Run commands on your computer`, "The agent’s own terminal tools, outside Eleven.", "Running things"],
};

function permissionRows(c: Ctx, group: string): readonly SettingRowModel[] {
  const levels: readonly PermissionLevel[] = ["Allow", "Ask", "Never"];
  return PERMISSION_TOOLS.filter((tool) => PERMISSION_TEXT[tool][2] === group).map((tool) => ({
    title: PERMISSION_TEXT[tool][0],
    desc: PERMISSION_TEXT[tool][1],
    keywords: "allow ask never agent",
    control: {
      kind: "seg",
      options: opts(levels),
      value: c.settings.permissions[tool],
      pick: (value: string) => {
        const level = levels.find((candidate) => candidate === value);
        if (level) c.update({ permissions: { ...c.settings.permissions, [tool]: level } });
      },
    },
  }));
}

function agentRows(c: Ctx): { readonly here: readonly SettingRowModel[]; readonly more: readonly SettingRowModel[] } {
  const defaultId = c.settings.defaultAgent ?? DEFAULT_AGENT_ID;
  const lead = (id: string): Lead => ({ kind: "agent", icon: c.agents.icons.get(id) ?? null });
  const here = c.agents.list.filter((agent) => c.installed.has(agent.id)).map((agent): SettingRowModel => {
    const isDefault = agent.id === defaultId;
    const found = c.installed.get(agent.id);
    const path = found?.command?.path ?? found?.cli ?? "";
    const login = signedIn(agent);
    if (login === false) return info(agent.name, "Installed. Sign in once and Eleven remembers it.", { lead: lead(agent.id), ...(isDefault ? { tag: "Default" } : {}), status: { text: "Not signed in", tone: "warn" }, buttons: [btn("Sign in", () => { signIn(agent); c.toast(`Finish signing in to ${agent.name} in Terminal`); }, "primary")] });
    const out = canSignOut(agent) ? [btn("Sign out", () => { signOut(agent); c.toast(`Signing out of ${agent.name} in Terminal`); })] : [];
    return info(agent.name, `Version ${agent.version}, ${tildePath(path)}`, {
      lead: lead(agent.id), ...(isDefault ? { tag: "Default" } : {}), status: { text: login ? "Signed in" : "Installed", tone: "good" },
      buttons: [...(isDefault ? [] : [btn("Make default", () => c.update({ defaultAgent: agent.id }))]), ...out],
    });
  });
  const others = c.agents.list.filter((agent) => !c.installed.has(agent.id));
  const more = (c.browsing ? others : others.slice(0, 2)).map((agent) => info(agent.name, `Not on ${THIS_DEVICE}. Eleven downloads it and keeps it up to date.`, {
    lead: lead(agent.id), buttons: [btn("Make default", () => c.update({ defaultAgent: agent.id })), btn("Install", () => c.install(agent.id))],
  }));
  return { here, more };
}

/** The model the chosen agent answers "Ask about code" with; the list is what it offered the last time it started. */
function askModelRow(c: Ctx): SettingRowModel {
  const agent = c.agents.selected;
  const models = knownModels(agent.id);
  const others = Object.fromEntries(Object.entries(c.settings.askModels).filter(([id]) => id !== agent.id));
  const pick = (value: string): void => c.update({ askModels: value ? { ...others, [agent.id]: value } : others });
  const options: readonly Option[] = [
    { value: "", label: "Same as the chat" },
    ...models.map((model): Option => (model.description ? { value: model.value, label: model.name, note: model.description } : { value: model.value, label: model.name })),
  ];
  const desc = models.length > 0 ? `For ${agent.name}. A smaller model answers sooner but explains less.` : `${agent.name}’s models show here once it has started.`;
  return { title: "Model", desc, keywords: "ask explain quick answer selection", control: { kind: "select", value: c.settings.askModels[agent.id] ?? "", pick, options } };
}

function input(c: Ctx, key: "customAgent" | "customToolServer", title: string, desc: string, placeholder: string, done: string): SettingRowModel {
  const draft = c.drafts[key] ?? c.settings[key];
  return {
    title, desc, control: { kind: "input", value: draft, placeholder, set: (value) => c.setDraft(key, value) },
    buttons: [btn("Add", () => {
      c.update(patchOf(key, draft.trim()));
      c.toast(draft.trim() ? done : "Removed it");
    })],
  };
}

type EngineRowId = "rizin" | "ghidra" | "hopper" | "ida";

function engineRows(c: Ctx, h: ReturnType<typeof makeHelpers>): readonly SettingRowModel[] {
  const active = activeEngine()?.id ?? null;
  const e = c.info.engines;
  const row = (id: EngineRowId, name: string, desc: string, found: string | null, key: PathKey, folder: boolean): SettingRowModel => {
    const locate = async (): Promise<void> => {
      const picked = await pickPath(folder ? "folder" : "file", `Locate ${name}`);
      if (picked === null) return;
      c.update(patchOf(key, picked));
      adoptToolchain();
      c.refresh();
      c.toast(`Using ${name} at ${tildePath(picked)}`);
    };
    if (found === null) return info(name, desc, { lead: { kind: "img", src: ENGINE_LOGO[id] }, status: { text: "Not found", tone: "quiet" }, buttons: [btn("Locate…", () => void locate())] });
    const engineId: EngineId = id;
    const remove = h.confirmed(`remove-${id}`, `Remove ${name}? Projects keep their work, and you can install it again any time.`, "Remove", () => {
      void moveToTrash(found);
      c.update(patchOf(key, ""));
      adoptToolchain();
    }, `Moved ${name} to the Trash`);
    const update = id === "rizin" || id === "ghidra" ? [btn("Check for update", () => c.checkEngine(id))] : [];
    return info(name, desc, {
      lead: { kind: "img", src: ENGINE_LOGO[id] },
      pick: { on: active === engineId, act: () => { chooseEngine(engineId); c.refresh(); } },
      ...(active === engineId ? { tag: "Opens your files" } : {}),
      status: { text: "Installed", tone: "good" },
      buttons: [...update, btn("Remove", () => c.ask(remove.id))],
      confirm: remove,
    });
  };
  return [
    row("rizin", "Rizin", `${e.rizin.version ? `Version ${e.rizin.version}. ` : ""}Fast, opens most apps in seconds.`, e.rizin.path, "rizinPath", false),
    row("ghidra", "Ghidra", `${e.ghidra.version ? `Version ${e.ghidra.version}. ` : ""}Slower, with the clearest readable code.`, e.ghidra.path, "ghidraDir", true),
    row("hopper", "Hopper", "Uses your Hopper license through its own tools.", e.hopper, "hopperPath", false),
    row("ida", "IDA Pro", "Uses your IDA license. Needs IDA 9 with its MCP plugin.", e.ida, "idaPath", false),
  ];
}

function newSkill(c: Ctx, folder: string): void {
  let name = "new-skill";
  for (let n = 2; loadSkills().some((skill) => skill.name === name); n += 1) name = `new-skill-${n}`;
  const dir = join(folder, name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  writeFileSync(file, `---\nname: ${name}\ndescription: One line on what this skill does.\n---\n\n1. The first step the agent takes.\n2. The next step.\n`);
  showInFinder(file);
  c.refresh();
  c.toast("Created a new skill in your skills folder");
}

/** Every settings page as groups of rows, built from the saved settings and what Eleven found on this Mac. */
export function buildPages(c: Ctx): Readonly<Record<Page, readonly GroupModel[]>> {
  const s = c.settings;
  const h = makeHelpers(c);
  const { tg, seg, sel, path, danger, confirmed } = h;
  const agentName = c.agents.list.find((agent) => agent.id === (s.defaultAgent ?? DEFAULT_AGENT_ID))?.name ?? "None";
  const { here, more } = agentRows(c);
  const sizes = c.info.sizes;
  const app = c.info.app;
  const skillsFolder = s.skillsDir || join(dataRoot(), "skills");
  const builtIn = loadSkills();
  const flipSkill = (name: string): void => {
    const off = s.disabledSkills.includes(name);
    c.update({ disabledSkills: off ? s.disabledSkills.filter((entry) => entry !== name) : [...s.disabledSkills, name] });
  };
  const skillRow = (name: string, description: string): SettingRowModel => {
    const text = SKILL_TEXT[name];
    return { title: text?.[0] ?? name, desc: text?.[1] ?? description, control: { kind: "toggle", on: !s.disabledSkills.includes(name), flip: () => flipSkill(name) } };
  };
  const recordings = confirmed("clear-rec", "Delete all GPU recordings? Profiles in your chats keep their numbers but can’t be opened again.", "Delete", clearRecordings, "Deleted GPU recordings");
  const recordings2 = { ...recordings, id: "clear-rec2" };
  const exportDir = s.exportDir || join(homedir(), "Downloads", "Eleven");
  return {
    general: [
      { label: "Startup", rows: [
        sel("launch", "When Eleven opens", "Start on Home, or go straight back to what you had open.", ["Home", "The last project"]),
        tg("restoreLayout", "Reopen tabs and splits", "Bring back the workbench layout of each project when you open it."),
      ] },
      { label: "Updates", rows: [
        ...(OS === "mac" ? [tg("autoUpdate", "Update automatically", "Download updates in the background and install them when you quit Eleven.")] : []),
        seg("updateChannel", "Update channel", "Beta gets new features a few weeks early.", ["Stable", "Beta"]),
        info(`Eleven ${app.version}`, app.line, { buttons: app.download ? [btn("Download", () => openLink(app.download ?? ""), "primary")] : [btn("Check now", c.checkApp)] }),
      ] },
      { label: "Home", rows: [
        tg("showWhatsNew", "Show what’s new on Home", "A short note on Home after each update. Dismiss it and it stays gone."),
        tg("showSuggestions", "Show suggested questions", "The starter questions under the composer on Home."),
      ] },
      { label: "Reset", rows: [
        danger("Reset all settings", "Puts every setting back the way it was on day one. Your projects and chats stay.", "Reset…", confirmed("reset-all", "Reset every setting to its default? Your projects, chats and shortcuts you changed are kept.", "Reset settings", () => {
          saveSettings({ ...DEFAULT_SETTINGS, keymap: s.keymap, shortcuts: s.shortcuts });
          adoptToolchain();
        }, "Settings reset")),
      ] },
    ],
    appearance: [
      { label: "Window", preview: "window", rows: [
        seg("uiSize", "Interface size", "Text and controls outside the code.", ["Small", "Default", "Large"]),
        { title: "Transparency", desc: "How much of your desktop shows through around the edges. All the way down is solid.", keywords: "glass see-through opacity solid window background", control: { kind: "range", min: 0, max: 100, step: 5, value: s.transparency, unit: "%", set: (transparency) => c.update({ transparency }) } },
        { title: "Frost", desc: "How much the desktop behind the window is blurred.", keywords: "glass blur frosted window background", dim: s.transparency === 0, control: { kind: "range", min: 0, max: 100, step: 5, value: s.frost, unit: "%", set: (frost) => c.update({ frost }) } },
      ] },
      { label: "Code", preview: "code", rows: [
        sel("codeFont", "Code font", "Used for pseudocode, assembly, hex and code in replies.", codeFontsHere()),
        { title: "Code size", desc: "Applies to every code view, the graph and replies.", control: { kind: "range", min: 10, max: 18, step: 1, value: s.codeFontSize, unit: " pt", set: (value) => {
          const size = ([10, 11, 12, 13, 14, 15, 16, 17, 18] as const).find((candidate) => candidate === value);
          if (size) c.update({ codeFontSize: size });
        } } },
        seg("lineSpacing", "Line spacing", "", ["Compact", "Normal", "Relaxed"]),
        sel("colorScheme", "Colours", "How keywords, names, strings and numbers are coloured.", ["Eleven", "Classic", "Quiet"]),
        tg("lineNumbers", "Line numbers", "In pseudocode and shader views."),
        tg("graphUsesCodeSize", "Use the code size in graphs", "Off keeps graph blocks small so more fits on screen."),
      ] },
    ],
    keyboard: [],
    chat: [
      { label: "Replies", rows: [
        tg("showThinking", "Show the agent’s thinking", "Folded under each reply. Open it to see how the agent got there."),
        sel("chatHistory", "How much of the chat the agent sees", "More context gives better answers on long chats but is slower.", ["Short", "Normal", "Long"], { Short: "Last 10 messages", Normal: "Last 20 messages", Long: "Last 50 messages" }),
        sel("openWorkbench", "Open the workbench", "The full workbench next to the chat.", ["When the agent opens code", "Always", "Only when I ask"]),
      ] },
      { label: "Composer", rows: [seg("sendKey", "Send with", "The other one adds a new line.", ["Return", "Command Return"], { "Command Return": `${MOD.replace("+", "")} Return` })] },
      { label: "Notifications", rows: [
        tg("notifyWhenDone", "Notify me when the agent finishes", "Only when Eleven isn’t the window in front."),
        tg("soundWhenAsked", "Play a sound when the agent needs you", "For questions and permission requests."),
      ] },
    ],
    agents: [
      { label: `On ${THIS_DEVICE}`, foot: "Every agent gets the same tools: Eleven’s analysis engine and control of this window.", rows: [
        ...here,
        info("Look for agents again", "After installing one from the terminal.", { buttons: [btn("Rescan", c.rescan)] }),
      ] },
      { label: "More agents", rows: [
        ...more,
        info(`Browse all ${c.agents.list.length} agents`, "From the open agent registry, the same one Zed uses.", { buttons: [btn(c.browsing ? "Show fewer" : "Browse…", () => c.setBrowsing(!c.browsing))] }),
        input(c, "customAgent", "Add your own agent", "Any command that speaks the Agent Client Protocol.", "my-agent --acp", "Added your agent"),
      ] },
      { label: "Tools agents get", foot: "Tool servers use the Model Context Protocol. Every agent gets the ones that are on.", rows: [
        tg("elevenTools", "Eleven", "Open functions, switch views, rename, take notes and record GPU traces in this window.", { lead: { kind: "img", src: appIcon(c.icon) }, keywords: "mcp tool server" }),
        tg("reaTools", "Analysis tools (REA)", "Read functions, strings, cross-references and bytes from the open app.", { lead: { kind: "img", src: join(ENGINES_DIR, "rea.svg") }, keywords: "mcp tool server" }),
        tg("idaTools", "IDA Pro", "Uses your IDA license through its MCP plugin.", { lead: { kind: "img", src: ENGINE_LOGO.ida }, keywords: "mcp tool server" }),
        input(c, "customToolServer", "Add a tool server", "Any MCP server. Every agent gets its tools.", "npx my-mcp-server", "Added the tool server"),
      ] },
      { label: "Ask about code", foot: "Select lines in any code view, then Ask or Explain. These only change those quick answers, not the chat.", rows: [
        askModelRow(c),
        tg("askFast", "Fast mode", "Quicker answers from agents that offer it, like Claude. It can cost more.", { keywords: "ask explain quick answer speed" }),
      ] },
      { label: "Running agents", rows: [
        tg("keepAgentsRunning", "Keep agents running between chats", "Replies start faster. Uses a little more memory."),
        tg("startAgentWithProject", "Start the agent when a project opens", "So it’s ready before you ask."),
      ] },
    ],
    permissions: [
      { label: "Reading", rows: permissionRows(c, "Reading") },
      { label: "Changing your project", rows: permissionRows(c, "Changing your project") },
      { label: "Running things", rows: permissionRows(c, "Running things") },
      { label: "Your answers", rows: [
        tg("rememberAnswers", "Remember “Always allow” for each project", "When you pick Always allow in a chat, it sticks for that project only."),
        info("Forget remembered answers", c.info.remembered === 0 ? "No projects have answers saved." : `${c.info.remembered} ${c.info.remembered === 1 ? "project has" : "projects have"} answers saved.`, { buttons: [btn("Forget all", () => {
          const count = forgetAnswers();
          c.refresh();
          c.toast(count === 0 ? "No answers were saved" : `Forgot the answers saved in ${count} ${count === 1 ? "project" : "projects"}`);
        })] }),
      ] },
    ],
    privacy: [
      { label: "What leaves your computer", foot: `Projects, chats and caches never leave ${THIS_DEVICE} unless you export them.`, rows: [
        info("The agent you use", "Code and questions you send go to that agent’s provider, under its own privacy terms. Local agents keep everything here.", { status: { text: agentName, tone: "quiet" } }),
        tg("hidePaths", "Hide your name in paths", "Agents see ~/Downloads instead of /Users/yourname/Downloads."),
        tg("askBeforeWholeFile", "Ask before sending a whole file", "Agents normally send only the functions they read. Ask before they upload the entire app."),
      ] },
      { label: "Help improve Eleven", rows: [
        tg("countInstall", "Count this install", "Sends a random ID, the version and your system when Eleven opens, so we know how many people use it."),
        tg("crashReports", "Send crash reports", "Where Eleven crashed, its version and your system. Never your files or chats."),
        tg("usageStats", "Share how features are used", "Counts like how often the graph is opened. Off by default."),
      ] },
    ],
    skills: [
      { label: "Built in", rows: builtIn.filter((skill) => SKILL_TEXT[skill.name]).map((skill) => skillRow(skill.name, skill.description)) },
      { label: "Yours", rows: [
        ...builtIn.filter((skill) => !SKILL_TEXT[skill.name]).map((skill) => skillRow(skill.name, skill.description)),
        path("skillsDir", "Skills folder", skillsFolder, true),
        info("New skill", "A Markdown file with a name, a one line description and the steps.", { buttons: [btn("New skill…", () => newSkill(c, skillsFolder), "primary")] }),
        tg("skillsInComposer", "Show skills in the composer", "Type / in the composer to pick one."),
      ] },
    ],
    engines: [
      { label: "Open files with", foot: "The engine you pick opens files. Eleven still uses the others when you ask for something only they can do.", rows: engineRows(c, h) },
      { label: "Together", rows: [tg("ghidraPseudocode", "Use Ghidra for readable code", "Open files fast with Rizin, then show Ghidra’s clearer pseudocode when it’s ready.", { dim: activeEngine()?.id === "ghidra" })] },
      { label: "Ghidra", rows: [
        sel("ghidraMemory", "Memory", `Big apps open faster with more. Automatic picks 2 to 4 GB from what ${THIS_DEVICE} has.`, ["Automatic", "4 GB", "8 GB", "16 GB"]),
        tg("findParameters", "Work out function parameters", "Better pseudocode for big apps. Makes the first open slower."),
        tg("rebuildSwitches", "Rebuild switch statements", "Turns jump tables back into switch blocks."),
        tg("hiddenCode", "Look for code no one calls", "Finds more functions in stripped apps. The slowest option."),
        path("javaHome", "Java", c.info.java.path ?? "Not found", true, { status: c.info.java.version ? { text: `Java ${c.info.java.version}`, tone: "good" } : { text: "Not found", tone: "warn" } }),
      ] },
      { label: "Analysis tools", rows: [
        info(`REA ${c.info.rea.version ?? ""}`.trim(), "Comes with Eleven. Gives agents the tools to read apps.", { status: c.info.rea.status }),
      ] },
    ],
    code: [
      { label: "Opening a function", rows: [
        seg("firstView", "Show first", "What you see when you open a function. Switch any time in the view.", ["Pseudocode", "Assembly", "Graph", "Hex"]),
        sel("universalApps", "Universal apps", "Apps with Apple silicon and Intel code inside.", ["Ask each time", "Open the one for this Mac"]),
      ] },
      { label: "Addresses", preview: "address", rows: [
        tg("addressPrefix", "Start with 0x", ""),
        tg("addressUpper", "Capital letters", "For hex digits A to F."),
        tg("addressPad", "Pad to full width", "Every address the same length, so columns line up."),
      ] },
      { label: "Hex and lists", rows: [
        seg("hexRow", "Bytes per row", "In the hex view.", ["8", "16", "32"]),
        sel("listLimit", "Strings and symbols to show", "Search always looks through all of them.", ["400", "1,000", "5,000", "All"]),
      ] },
      { label: "Graph", rows: [
        tg("minimap", "Show the minimap", "The small overview in the corner of big graphs."),
        seg("blockLines", "Lines per block before folding", "", ["4", "8", "16", "All"]),
      ] },
    ],
    debugging: [
      { label: "Debugger", rows: [path("lldbDap", "Debugger", c.info.lldb ?? "Not found", false, { status: c.info.lldb ? { text: "Found", tone: "good" } : { text: "Not found", tone: "warn" } })] },
      { label: "Starting", rows: [
        tg("stopAtFunction", "Stop at the function you’re looking at", "Puts a breakpoint there before the program starts."),
        tg("stopAtEntry", "Stop at the first instruction", "Pause before any of the program’s code runs."),
        { title: "Arguments", desc: "Passed to the program each time it starts.", control: { kind: "input", value: s.programArgs, placeholder: "--verbose", set: (programArgs) => c.update({ programArgs }) } },
      ] },
      { label: "Showing values", rows: [sel("variableLimit", "Variables to show", "Per scope. Big structs fold after this many.", ["50", "200", "1,000"])] },
    ],
    gpu: [
      { label: "Recording", rows: [
        sel("gpuTemplate", "Instruments template", "What gets recorded while the app runs.", ["Metal System Trace", "Game Performance", "Metal Application"]),
        { title: "Record for", desc: "Stops sooner if the app quits.", control: { kind: "range", min: 5, max: 60, step: 5, value: s.gpuSeconds, unit: " s", set: (value) => {
          const seconds = ([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60] as const).find((candidate) => candidate === value);
          if (seconds) c.update({ gpuSeconds: seconds });
        } } },
        seg("gpuSkipFrames", "Frames to skip at the start", "The first frames are often slow while the app loads.", ["0", "3", "10"]),
      ] },
      { label: "Keeping recordings", rows: [
        sel("keepRecordings", "Recordings to keep", "Older ones are deleted. Each can be a few hundred MB.", ["1", "3", "10", "All"]),
        danger("GPU recordings", `${sizes.recordings} in ${tildePath(RECORDINGS_DIR)}`, "Delete all…", recordings, [btn(`Show in ${FILE_MANAGER}`, () => showInFinder(RECORDINGS_DIR))]),
      ].map((row, ix) => (ix === 1 ? { ...row, mono: true } : row)) },
    ],
    storage: [
      { label: "Exports and patches", rows: [
        path("exportDir", "Save to", exportDir, true),
        tg("revealExports", `Show in ${FILE_MANAGER} after saving`, "For exported code, Objective-C lists and patched copies."),
      ] },
      { label: "Your work", rows: [
        info("Projects", `${sizes.projects}. Renames, notes, bookmarks and patches for ${sizes.apps} ${sizes.apps === 1 ? "app" : "apps"}.`, { buttons: [btn(`Show in ${FILE_MANAGER}`, () => showInFinder(PROJECTS_DIR))] }),
        danger("Chats", `${sizes.chats}. Every conversation, in its project.`, "Delete all…", confirmed("clear-chats", "Delete every chat in every project? Renames, notes and patches stay. This can’t be undone.", "Delete chats", deleteAllChats, "Deleted all chats"), [btn(`Show in ${FILE_MANAGER}`, () => showInFinder(THREADS_DIR))]),
        tg("autosave", "Save changes as you go", "Renames and notes save a moment after you make them."),
      ] },
      { label: "Space Eleven can free up", rows: [
        danger("Analysis cache", `${sizes.cache}. Apps you opened before open instantly.`, "Clear…", confirmed("clear-cache", "Clear the analysis cache? Nothing is lost, but each app takes longer the next time you open it.", "Clear cache", () => clearFolder(cacheDir()), "Cleared the analysis cache")),
        danger("GPU recordings", `${sizes.recordings}.`, "Clear…", recordings2),
      ] },
      { label: "Window", rows: [
        info("Reset the workbench layout", "Puts panels, splits and sizes back to how they started.", { buttons: [btn("Reset", () => { resetWorkbenchLayout(); c.toast("Layout reset"); })] }),
      ] },
    ],
    about: [
      { label: null, rows: [
        info("Eleven", `Version ${app.version} (${process.arch === "arm64" ? "Apple silicon" : "Intel"}). ${app.short}`, { lead: { kind: "img", src: appIcon(c.icon) }, buttons: app.download ? [btn("Download", () => openLink(app.download ?? ""), "primary")] : [btn("Check for updates", c.checkApp)] }),
        info("What’s new", "Notes for every release.", { buttons: [btn("Open", () => { openLink("https://github.com/Zfinix/eleven/releases"); c.toast("Opened the release notes"); })] }),
      ] },
      { label: "Help", rows: [
        info("Run setup again", "Install engines and agents, and pick shortcuts.", { buttons: [btn("Start", c.setup)] }),
        info("Report a problem", "Copies Eleven’s version, engines and recent errors so you can paste them in a bug report. No file contents.", { buttons: [btn("Copy details", c.copyDetails)] }),
        info("Settings file", tildePath(SETTINGS_FILE), { mono: true, buttons: [btn(`Show in ${FILE_MANAGER}`, () => showInFinder(SETTINGS_FILE))] }),
      ] },
      { label: "Made with", rows: [
        info("Rizin", "Fast reverse engineering framework.", { lead: { kind: "img", src: ENGINE_LOGO.rizin }, buttons: [btn("Website", () => { openLink("https://rizin.re"); c.toast("Opened in your browser"); })] }),
        info("Ghidra", "Decompiler from the NSA.", { lead: { kind: "img", src: ENGINE_LOGO.ghidra }, buttons: [btn("Website", () => { openLink("https://ghidra-sre.org"); c.toast("Opened in your browser"); })] }),
        info("Agent Client Protocol", "How Eleven talks to every agent.", { lead: { kind: "img", src: join(ENGINES_DIR, "acp-light.png"), darkSrc: join(ENGINES_DIR, "acp-dark.png") }, buttons: [btn("Website", () => { openLink("https://agentclientprotocol.com"); c.toast("Opened in your browser"); })] }),
      ] },
    ],
  };
}

export function rowMatches(row: SettingRowModel, group: GroupModel, pageName: string, query: string): boolean {
  return `${row.title} ${row.desc} ${row.keywords ?? ""} ${group.label ?? ""} ${pageName}`.toLowerCase().includes(query);
}
