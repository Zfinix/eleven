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
import { LANGUAGE_NAMES, LANGUAGE_SETTINGS, type LanguageSetting, type PlainId, t, thisDevice } from "../i18n";
import { loadSkills } from "../skills/load";
import { resetWorkbenchLayout } from "../workbench/sizes";
import { clearFolder, clearRecordings, cacheDir, deleteAllChats, moveToTrash, PROJECTS_DIR, THREADS_DIR } from "./actions";
import { type Info, measured, reaStatus, updateLine, updateShort } from "./info";
import type { Action, Confirm, Control, GroupModel, Lead, Option, SettingRowModel } from "./model";
import type { Page } from "./pages";
import { DEFAULT_SETTINGS, type PathKey, PERMISSION_TOOLS, type PermissionLevel, type PermissionTool, saveSettings, type Settings, SETTINGS_FILE } from "./store";
import { openLink, pickPath, RELEASE_NOTES, showInFinder, SPONSOR, tildePath } from "./system";
import { ASSETS } from "../lib/assets";
import { dataRoot, FILE_MANAGER, OS } from "../lib/platform";
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

function btn(label: string, act: () => void, style: Action["style"] = "plain"): Action {
  return { label, act, style };
}

function info(title: string, desc: string, extra: Partial<SettingRowModel> = {}): SettingRowModel {
  return { title, desc, control: { kind: "none" }, ...extra };
}

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

type ChoiceKey = { [K in keyof Settings]: string extends Settings[K] ? never : Settings[K] extends string ? K : never }[keyof Settings];

type Labels = Readonly<Record<string, string>>;

function patchOf<K extends keyof Settings>(key: K, value: Settings[K]): Partial<Settings> {
  const patch: Partial<Settings> = {};
  patch[key] = value;
  return patch;
}

function pickControl<K extends ChoiceKey>(c: Ctx, kind: "seg" | "select", key: K, options: readonly Settings[K][], labels: Labels = {}, notes: Labels = {}): Control {
  const pick = (value: string): void => {
    const next = options.find((option) => option === value);
    if (next !== undefined) c.update(patchOf(key, next));
  };
  return { kind, value: c.settings[key], pick, options: options.map((value): Option => { const note = notes[value]; return note ? { value, label: labels[value] ?? value, note } : { value, label: labels[value] ?? value }; }) };
}

function makeHelpers(c: Ctx): {
  readonly tg: (key: BoolKey, title: string, desc: string, extra?: Partial<SettingRowModel>) => SettingRowModel;
  readonly seg: <K extends ChoiceKey>(key: K, title: string, desc: string, options: readonly Settings[K][], labels?: Labels) => SettingRowModel;
  readonly sel: <K extends ChoiceKey>(key: K, title: string, desc: string, options: readonly Settings[K][], labels?: Labels, notes?: Labels) => SettingRowModel;
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
    sel: (key, title, desc, options, labels = {}, notes = {}) => ({ title, desc, control: pickControl(c, "select", key, options, labels, notes) }),
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
        buttons: [btn(t("settings.choose"), () => void choose()), btn(t("settings.showIn", { app: FILE_MANAGER }), () => showInFinder(shown)), ...(chosen ? [btn(t("settings.reset"), () => save(""))] : [])],
        ...extra,
      };
    },
    danger: (title, desc, button, confirm, extra = []) => info(title, desc, { buttons: [...extra, btn(button, () => c.ask(confirm.id), "danger")], confirm }),
    confirmed,
  };
}

const SKILL_TEXT: Readonly<Record<string, readonly [PlainId, PlainId]>> = {
  "first-look": ["skill.firstLook", "skill.firstLook.desc"],
  "explain-function": ["skill.explainFunction", "skill.explainFunction.desc"],
  "name-functions": ["skill.nameFunctions", "skill.nameFunctions.desc"],
  find: ["skill.find", "skill.find.desc"],
  "trace-feature": ["skill.traceFeature", "skill.traceFeature.desc"],
  "network-map": ["skill.networkMap", "skill.networkMap.desc"],
  decompile: ["skill.decompile", "skill.decompile.desc"],
  "shader-check": ["skill.shaderCheck", "skill.shaderCheck.desc"],
};

type PermissionGroup = "reading" | "changing" | "running";

const PERMISSION_TEXT: Readonly<Record<PermissionTool, readonly [PlainId, PlainId, PermissionGroup]>> = {
  read: ["permission.read", "permission.read.desc", "reading"],
  view: ["permission.view", "permission.view.desc", "reading"],
  rename: ["permission.rename", "permission.rename.desc", "changing"],
  notes: ["permission.notes", "permission.notes.desc", "changing"],
  patch: ["permission.patch", "permission.patch.desc", "changing"],
  gpu: ["permission.gpu", "permission.gpu.desc", "running"],
  debug: ["permission.debug", "permission.debug.desc", "running"],
  shell: ["permission.shell", "permission.shell.desc", "running"],
};

const LEVEL_LABELS: Readonly<Record<PermissionLevel, PlainId>> = { Allow: "permission.allow", Ask: "permission.ask", Never: "permission.never" };

function permissionRows(c: Ctx, group: PermissionGroup): readonly SettingRowModel[] {
  const levels: readonly PermissionLevel[] = ["Allow", "Ask", "Never"];
  return PERMISSION_TOOLS.filter((tool) => PERMISSION_TEXT[tool][2] === group).map((tool) => ({
    title: t(PERMISSION_TEXT[tool][0]),
    desc: t(PERMISSION_TEXT[tool][1]),
    keywords: "allow ask never agent",
    control: {
      kind: "seg",
      options: levels.map((level): Option => ({ value: level, label: t(LEVEL_LABELS[level]) })),
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
    if (login === false) return info(agent.name, t("settings.agent.signInOnce"), { lead: lead(agent.id), ...(isDefault ? { tag: t("settings.agent.default") } : {}), status: { text: t("settings.agent.notSignedIn"), tone: "warn" }, buttons: [btn(t("settings.agent.signIn"), () => { signIn(agent); c.toast(t("settings.agent.finishSignIn", { name: agent.name })); }, "primary")] });
    const out = canSignOut(agent) ? [btn(t("settings.agent.signOut"), () => { signOut(agent); c.toast(t("settings.agent.signingOut", { name: agent.name })); })] : [];
    return info(agent.name, t("settings.agent.versionAt", { version: agent.version, path: tildePath(path) }), {
      lead: lead(agent.id), ...(isDefault ? { tag: t("settings.agent.default") } : {}), status: { text: login ? t("settings.agent.signedIn") : t("settings.installed"), tone: "good" },
      buttons: [...(isDefault ? [] : [btn(t("settings.agent.makeDefault"), () => c.update({ defaultAgent: agent.id }))]), ...out],
    });
  });
  const others = c.agents.list.filter((agent) => !c.installed.has(agent.id));
  const more = (c.browsing ? others : others.slice(0, 2)).map((agent) => info(agent.name, t("settings.agent.notHere", { device: thisDevice() }), {
    lead: lead(agent.id), buttons: [btn(t("settings.agent.makeDefault"), () => c.update({ defaultAgent: agent.id })), btn(t("settings.install"), () => c.install(agent.id))],
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
    { value: "", label: t("settings.askModel.sameAsChat") },
    ...models.map((model): Option => (model.description ? { value: model.value, label: model.name, note: model.description } : { value: model.value, label: model.name })),
  ];
  const desc = models.length > 0 ? t("settings.askModel.desc", { name: agent.name }) : t("settings.askModel.notStarted", { name: agent.name });
  return { title: t("settings.askModel"), desc, keywords: "ask explain quick answer selection", control: { kind: "select", value: c.settings.askModels[agent.id] ?? "", pick, options } };
}

function input(c: Ctx, key: "customAgent" | "customToolServer", title: string, desc: string, placeholder: string, done: string): SettingRowModel {
  const draft = c.drafts[key] ?? c.settings[key];
  return {
    title, desc, control: { kind: "input", value: draft, placeholder, set: (value) => c.setDraft(key, value) },
    buttons: [btn(t("settings.add"), () => {
      c.update(patchOf(key, draft.trim()));
      c.toast(draft.trim() ? done : t("settings.removedIt"));
    })],
  };
}

type EngineRowId = "rizin" | "ghidra" | "hopper" | "ida";

function engineRows(c: Ctx, h: ReturnType<typeof makeHelpers>): readonly SettingRowModel[] {
  const active = activeEngine()?.id ?? null;
  const e = c.info.engines;
  const row = (id: EngineRowId, name: string, desc: string, found: string | null, key: PathKey, folder: boolean): SettingRowModel => {
    const locate = async (): Promise<void> => {
      const picked = await pickPath(folder ? "folder" : "file", t("settings.engine.locateTitle", { name }));
      if (picked === null) return;
      c.update(patchOf(key, picked));
      adoptToolchain();
      c.refresh();
      c.toast(t("settings.engine.using", { name, path: tildePath(picked) }));
    };
    if (found === null) return info(name, desc, { lead: { kind: "img", src: ENGINE_LOGO[id] }, status: { text: t("settings.notFound"), tone: "quiet" }, buttons: [btn(t("settings.engine.locate"), () => void locate())] });
    const engineId: EngineId = id;
    const remove = h.confirmed(`remove-${id}`, t("settings.engine.removeConfirm", { name }), t("settings.remove"), () => {
      void moveToTrash(found);
      c.update(patchOf(key, ""));
      adoptToolchain();
    }, t("settings.engine.trashed", { name }));
    const update = id === "rizin" || id === "ghidra" ? [btn(t("settings.engine.checkUpdate"), () => c.checkEngine(id))] : [];
    return info(name, desc, {
      lead: { kind: "img", src: ENGINE_LOGO[id] },
      pick: { on: active === engineId, act: () => { chooseEngine(engineId); c.refresh(); } },
      ...(active === engineId ? { tag: t("settings.engine.opensFiles") } : {}),
      status: { text: t("settings.installed"), tone: "good" },
      buttons: [...update, btn(t("settings.remove"), () => c.ask(remove.id))],
      confirm: remove,
    });
  };
  return [
    row("rizin", "Rizin", e.rizin.version ? t("settings.engine.rizinVersion", { version: e.rizin.version }) : t("settings.engine.rizin"), e.rizin.path, "rizinPath", false),
    row("ghidra", "Ghidra", e.ghidra.version ? t("settings.engine.ghidraVersion", { version: e.ghidra.version }) : t("settings.engine.ghidra"), e.ghidra.path, "ghidraDir", true),
    row("hopper", "Hopper", t("settings.engine.hopper"), e.hopper, "hopperPath", false),
    row("ida", "IDA Pro", t("settings.engine.ida"), e.ida, "idaPath", false),
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
  c.toast(t("settings.skills.created"));
}

function languageLabel(setting: LanguageSetting): string {
  return setting === "auto" ? t("settings.language.auto") : LANGUAGE_NAMES[setting];
}

/** Every settings page as groups of rows, built from the saved settings and what Eleven found on this Mac. */
export function buildPages(c: Ctx): Readonly<Record<Page, readonly GroupModel[]>> {
  const s = c.settings;
  const h = makeHelpers(c);
  const { tg, seg, sel, path, danger, confirmed } = h;
  const agentName = c.agents.list.find((agent) => agent.id === (s.defaultAgent ?? DEFAULT_AGENT_ID))?.name ?? t("settings.privacy.noAgent");
  const { here, more } = agentRows(c);
  const sizes = c.info.sizes;
  const app = c.info.app;
  const showIn = t("settings.showIn", { app: FILE_MANAGER });
  const opened = (): void => c.toast(t("settings.openedInBrowser"));
  const skillsFolder = s.skillsDir || join(dataRoot(), "skills");
  const builtIn = loadSkills();
  const flipSkill = (name: string): void => {
    const off = s.disabledSkills.includes(name);
    c.update({ disabledSkills: off ? s.disabledSkills.filter((entry) => entry !== name) : [...s.disabledSkills, name] });
  };
  const skillRow = (name: string, description: string): SettingRowModel => {
    const text = SKILL_TEXT[name];
    return { title: text ? t(text[0]) : name, desc: text ? t(text[1]) : description, control: { kind: "toggle", on: !s.disabledSkills.includes(name), flip: () => flipSkill(name) } };
  };
  const recordings = confirmed("clear-rec", t("settings.recordings.deleteConfirm"), t("settings.delete"), clearRecordings, t("settings.recordings.deleted"));
  const recordings2 = { ...recordings, id: "clear-rec2" };
  const exportDir = s.exportDir || join(homedir(), "Downloads", "Eleven");
  const all = t("settings.all");
  return {
    general: [
      { label: null, rows: [
        { ...sel("language", t("settings.language"), t("settings.language.desc"), LANGUAGE_SETTINGS, Object.fromEntries(LANGUAGE_SETTINGS.map((setting) => [setting, languageLabel(setting)]))), keywords: `language locale translation ${Object.values(LANGUAGE_NAMES).join(" ")}` },
      ] },
      { label: t("settings.group.startup"), rows: [
        sel("launch", t("settings.launch"), t("settings.launch.desc"), ["Home", "The last project"], { Home: t("settings.launch.home"), "The last project": t("settings.launch.lastProject") }),
        tg("restoreLayout", t("settings.restoreLayout"), t("settings.restoreLayout.desc")),
      ] },
      { label: t("settings.group.updates"), rows: [
        ...(OS === "mac" ? [tg("autoUpdate", t("settings.autoUpdate"), t("settings.autoUpdate.desc"))] : []),
        seg("updateChannel", t("settings.updateChannel"), t("settings.updateChannel.desc"), ["Stable", "Beta"], { Stable: t("settings.updateChannel.stable"), Beta: t("settings.updateChannel.beta") }),
        info(t("settings.elevenVersion", { version: app.version }), updateLine(app), { buttons: app.download ? [btn(t("settings.download"), () => openLink(app.download ?? ""), "primary")] : [btn(t("settings.checkNow"), c.checkApp)] }),
      ] },
      { label: t("settings.group.home"), rows: [
        tg("showWhatsNew", t("settings.showWhatsNew"), t("settings.showWhatsNew.desc")),
        tg("showSuggestions", t("settings.showSuggestions"), t("settings.showSuggestions.desc")),
      ] },
      { label: t("settings.group.reset"), rows: [
        danger(t("settings.resetAll"), t("settings.resetAll.desc"), t("settings.resetAll.button"), confirmed("reset-all", t("settings.resetAll.confirm"), t("settings.resetAll.confirmButton"), () => {
          saveSettings({ ...DEFAULT_SETTINGS, keymap: s.keymap, shortcuts: s.shortcuts });
          adoptToolchain();
        }, t("settings.resetAll.done"))),
      ] },
    ],
    appearance: [
      { label: t("settings.group.window"), preview: "window", rows: [
        seg("uiSize", t("settings.uiSize"), t("settings.uiSize.desc"), ["Small", "Default", "Large"], { Small: t("settings.uiSize.small"), Default: t("settings.uiSize.default"), Large: t("settings.uiSize.large") }),
        { title: t("settings.transparency"), desc: t("settings.transparency.desc"), keywords: "glass see-through opacity solid window background", control: { kind: "range", min: 0, max: 100, step: 5, value: s.transparency, unit: "%", set: (transparency) => c.update({ transparency }) } },
        { title: t("settings.frost"), desc: t("settings.frost.desc"), keywords: "glass blur frosted window background", dim: s.transparency === 0, control: { kind: "range", min: 0, max: 100, step: 5, value: s.frost, unit: "%", set: (frost) => c.update({ frost }) } },
      ] },
      { label: t("settings.group.code"), preview: "code", rows: [
        sel("codeFont", t("settings.codeFont"), t("settings.codeFont.desc"), codeFontsHere()),
        { title: t("settings.codeSize"), desc: t("settings.codeSize.desc"), control: { kind: "range", min: 10, max: 18, step: 1, value: s.codeFontSize, unit: " pt", set: (value) => {
          const size = ([10, 11, 12, 13, 14, 15, 16, 17, 18] as const).find((candidate) => candidate === value);
          if (size) c.update({ codeFontSize: size });
        } } },
        seg("lineSpacing", t("settings.lineSpacing"), "", ["Compact", "Normal", "Relaxed"], { Compact: t("settings.lineSpacing.compact"), Normal: t("settings.lineSpacing.normal"), Relaxed: t("settings.lineSpacing.relaxed") }),
        sel("colorScheme", t("settings.colorScheme"), t("settings.colorScheme.desc"), ["Eleven", "Classic", "Quiet"], { Classic: t("settings.colorScheme.classic"), Quiet: t("settings.colorScheme.quiet") }),
        tg("lineNumbers", t("settings.lineNumbers"), t("settings.lineNumbers.desc")),
        tg("graphUsesCodeSize", t("settings.graphUsesCodeSize"), t("settings.graphUsesCodeSize.desc")),
      ] },
    ],
    keyboard: [],
    chat: [
      { label: t("settings.group.replies"), rows: [
        tg("showThinking", t("settings.showThinking"), t("settings.showThinking.desc")),
        sel("chatHistory", t("settings.chatHistory"), t("settings.chatHistory.desc"), ["Short", "Normal", "Long"], { Short: t("settings.chatHistory.short"), Normal: t("settings.chatHistory.normal"), Long: t("settings.chatHistory.long") }, { Short: t("settings.chatHistory.shortNote"), Normal: t("settings.chatHistory.normalNote"), Long: t("settings.chatHistory.longNote") }),
        sel("openWorkbench", t("settings.openWorkbench"), t("settings.openWorkbench.desc"), ["When the agent opens code", "Always", "Only when I ask"], { "When the agent opens code": t("settings.openWorkbench.whenCode"), Always: t("settings.openWorkbench.always"), "Only when I ask": t("settings.openWorkbench.whenAsked") }),
      ] },
      { label: t("settings.group.composer"), rows: [seg("sendKey", t("settings.sendKey"), t("settings.sendKey.desc"), ["Return", "Command Return"], { "Command Return": `${MOD.replace("+", "")} Return` })] },
      { label: t("settings.group.notifications"), rows: [
        tg("notifyWhenDone", t("settings.notifyWhenDone"), t("settings.notifyWhenDone.desc")),
        tg("notifyWhenAsked", t("settings.notifyWhenAsked"), t("settings.notifyWhenAsked.desc")),
        tg("notifyWhenReady", t("settings.notifyWhenReady"), t("settings.notifyWhenReady.desc")),
        tg("soundWhenAsked", t("settings.soundWhenAsked"), t("settings.soundWhenAsked.desc")),
      ] },
    ],
    agents: [
      { label: t("settings.group.onDevice", { device: thisDevice() }), foot: t("settings.agents.foot"), rows: [
        ...here,
        info(t("settings.rescan"), t("settings.rescan.desc"), { buttons: [btn(t("settings.rescan.button"), c.rescan)] }),
      ] },
      { label: t("settings.group.moreAgents"), rows: [
        ...more,
        info(t("settings.browseAgents", { count: c.agents.list.length }), t("settings.browseAgents.desc"), { buttons: [btn(c.browsing ? t("settings.browseAgents.fewer") : t("settings.browseAgents.button"), () => c.setBrowsing(!c.browsing))] }),
        input(c, "customAgent", t("settings.customAgent"), t("settings.customAgent.desc"), "my-agent --acp", t("settings.customAgent.done")),
      ] },
      { label: t("settings.group.tools"), foot: t("settings.tools.foot"), rows: [
        tg("elevenTools", "Eleven", t("settings.elevenTools.desc"), { lead: { kind: "img", src: appIcon(c.icon) }, keywords: "mcp tool server" }),
        tg("reaTools", t("settings.reaTools"), t("settings.reaTools.desc"), { lead: { kind: "img", src: join(ENGINES_DIR, "rea.svg") }, keywords: "mcp tool server" }),
        tg("idaTools", "IDA Pro", t("settings.idaTools.desc"), { lead: { kind: "img", src: ENGINE_LOGO.ida }, keywords: "mcp tool server" }),
        input(c, "customToolServer", t("settings.customToolServer"), t("settings.customToolServer.desc"), "npx my-mcp-server", t("settings.customToolServer.done")),
      ] },
      { label: t("settings.group.askAboutCode"), foot: t("settings.askAboutCode.foot"), rows: [
        askModelRow(c),
        tg("askFast", t("settings.askFast"), t("settings.askFast.desc"), { keywords: "ask explain quick answer speed" }),
      ] },
      { label: t("settings.group.runningAgents"), rows: [
        tg("keepAgentsRunning", t("settings.keepAgentsRunning"), t("settings.keepAgentsRunning.desc")),
        tg("startAgentWithProject", t("settings.startAgentWithProject"), t("settings.startAgentWithProject.desc")),
      ] },
    ],
    permissions: [
      { label: t("settings.group.reading"), rows: permissionRows(c, "reading") },
      { label: t("settings.group.changing"), rows: permissionRows(c, "changing") },
      { label: t("settings.group.running"), rows: permissionRows(c, "running") },
      { label: t("settings.group.answers"), rows: [
        tg("rememberAnswers", t("settings.rememberAnswers"), t("settings.rememberAnswers.desc")),
        info(t("settings.forgetAnswers"), c.info.remembered === 0 ? t("settings.forgetAnswers.none") : c.info.remembered === 1 ? t("settings.forgetAnswers.one") : t("settings.forgetAnswers.many", { count: c.info.remembered }), { buttons: [btn(t("settings.forgetAnswers.button"), () => {
          const count = forgetAnswers();
          c.refresh();
          c.toast(count === 0 ? t("settings.forgetAnswers.noneSaved") : count === 1 ? t("settings.forgetAnswers.forgotOne") : t("settings.forgetAnswers.forgotMany", { count }));
        })] }),
      ] },
    ],
    privacy: [
      { label: t("settings.group.leaves"), foot: t("settings.leaves.foot", { device: thisDevice() }), rows: [
        info(t("settings.privacy.agent"), t("settings.privacy.agent.desc"), { status: { text: agentName, tone: "quiet" } }),
        tg("hidePaths", t("settings.hidePaths"), t("settings.hidePaths.desc")),
        tg("askBeforeWholeFile", t("settings.askBeforeWholeFile"), t("settings.askBeforeWholeFile.desc")),
      ] },
      { label: t("settings.group.improve"), rows: [
        tg("countInstall", t("settings.countInstall"), t("settings.countInstall.desc")),
        tg("crashReports", t("settings.crashReports"), t("settings.crashReports.desc")),
        tg("usageStats", t("settings.usageStats"), t("settings.usageStats.desc")),
      ] },
    ],
    skills: [
      { label: t("settings.group.builtIn"), rows: builtIn.filter((skill) => SKILL_TEXT[skill.name]).map((skill) => skillRow(skill.name, skill.description)) },
      { label: t("settings.group.yours"), rows: [
        ...builtIn.filter((skill) => !SKILL_TEXT[skill.name]).map((skill) => skillRow(skill.name, skill.description)),
        path("skillsDir", t("settings.skillsDir"), skillsFolder, true),
        info(t("settings.newSkill"), t("settings.newSkill.desc"), { buttons: [btn(t("settings.newSkill.button"), () => newSkill(c, skillsFolder), "primary")] }),
        tg("skillsInComposer", t("settings.skillsInComposer"), t("settings.skillsInComposer.desc")),
      ] },
    ],
    engines: [
      { label: t("settings.group.openWith"), foot: t("settings.openWith.foot"), rows: engineRows(c, h) },
      { label: t("settings.group.together"), rows: [tg("ghidraPseudocode", t("settings.ghidraPseudocode"), t("settings.ghidraPseudocode.desc"), { dim: activeEngine()?.id === "ghidra" })] },
      { label: "Ghidra", rows: [
        sel("ghidraMemory", t("settings.ghidraMemory"), t("settings.ghidraMemory.desc", { device: thisDevice() }), ["Automatic", "2 GB", "4 GB", "8 GB", "16 GB", "32 GB", "64 GB"], { Automatic: t("settings.ghidraMemory.automatic") }),
        sel("ghidraTimeout", t("settings.ghidraTimeout"), t("settings.ghidraTimeout.desc"), ["30 minutes", "2 hours", "6 hours", "12 hours"], { "30 minutes": t("settings.ghidraTimeout.minutes", { count: 30 }), "2 hours": t("settings.ghidraTimeout.hours", { count: 2 }), "6 hours": t("settings.ghidraTimeout.hours", { count: 6 }), "12 hours": t("settings.ghidraTimeout.hours", { count: 12 }) }),
        tg("findParameters", t("settings.findParameters"), t("settings.findParameters.desc")),
        tg("rebuildSwitches", t("settings.rebuildSwitches"), t("settings.rebuildSwitches.desc")),
        tg("hiddenCode", t("settings.hiddenCode"), t("settings.hiddenCode.desc")),
        tg("swiftNames", t("settings.swiftNames"), t("settings.swiftNames.desc")),
        path("javaHome", "Java", c.info.java.path ?? t("settings.notFound"), true, { status: c.info.java.version ? { text: `Java ${c.info.java.version}`, tone: "good" } : { text: t("settings.notFound"), tone: "warn" } }),
      ] },
      { label: t("settings.group.analysisTools"), rows: [
        info(`REA ${c.info.rea.version ?? ""}`.trim(), t("settings.rea.desc"), { status: reaStatus(c.info.rea.state) }),
      ] },
    ],
    code: [
      { label: t("settings.group.opening"), rows: [
        seg("firstView", t("settings.firstView"), t("settings.firstView.desc"), ["Pseudocode", "Assembly", "Graph", "Hex"], { Pseudocode: t("settings.firstView.pseudocode"), Assembly: t("settings.firstView.assembly"), Graph: t("settings.firstView.graph"), Hex: t("settings.firstView.hex") }),
        sel("universalApps", t("settings.universalApps"), t("settings.universalApps.desc"), ["Ask each time", "Open the one for this Mac"], { "Ask each time": t("settings.universalApps.ask"), "Open the one for this Mac": t("settings.universalApps.native") }),
      ] },
      { label: t("settings.group.addresses"), preview: "address", rows: [
        tg("addressPrefix", t("settings.addressPrefix"), ""),
        tg("addressUpper", t("settings.addressUpper"), t("settings.addressUpper.desc")),
        tg("addressPad", t("settings.addressPad"), t("settings.addressPad.desc")),
      ] },
      { label: t("settings.group.hexAndLists"), rows: [
        seg("hexRow", t("settings.hexRow"), t("settings.hexRow.desc"), ["8", "16", "32"]),
        sel("listLimit", t("settings.listLimit"), t("settings.listLimit.desc"), ["400", "1,000", "5,000", "All"], { All: all }),
      ] },
      { label: t("settings.group.graph"), rows: [
        tg("minimap", t("settings.minimap"), t("settings.minimap.desc")),
        seg("blockLines", t("settings.blockLines"), "", ["4", "8", "16", "All"], { All: all }),
      ] },
    ],
    debugging: [
      { label: t("settings.group.debugger"), rows: [path("lldbDap", t("settings.lldbDap"), c.info.lldb ?? t("settings.notFound"), false, { status: c.info.lldb ? { text: t("settings.found"), tone: "good" } : { text: t("settings.notFound"), tone: "warn" } })] },
      { label: t("settings.group.starting"), rows: [
        tg("stopAtFunction", t("settings.stopAtFunction"), t("settings.stopAtFunction.desc")),
        tg("stopAtEntry", t("settings.stopAtEntry"), t("settings.stopAtEntry.desc")),
        { title: t("settings.programArgs"), desc: t("settings.programArgs.desc"), control: { kind: "input", value: s.programArgs, placeholder: "--verbose", set: (programArgs) => c.update({ programArgs }) } },
      ] },
      { label: t("settings.group.values"), rows: [sel("variableLimit", t("settings.variableLimit"), t("settings.variableLimit.desc"), ["50", "200", "1,000"])] },
    ],
    gpu: [
      { label: t("settings.group.recording"), rows: [
        sel("gpuTemplate", t("settings.gpuTemplate"), t("settings.gpuTemplate.desc"), ["Metal System Trace", "Game Performance", "Metal Application"]),
        { title: t("settings.gpuSeconds"), desc: t("settings.gpuSeconds.desc"), control: { kind: "range", min: 5, max: 60, step: 5, value: s.gpuSeconds, unit: " s", set: (value) => {
          const seconds = ([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60] as const).find((candidate) => candidate === value);
          if (seconds) c.update({ gpuSeconds: seconds });
        } } },
        seg("gpuSkipFrames", t("settings.gpuSkipFrames"), t("settings.gpuSkipFrames.desc"), ["0", "3", "10"]),
      ] },
      { label: t("settings.group.keepingRecordings"), rows: [
        sel("keepRecordings", t("settings.keepRecordings"), t("settings.keepRecordings.desc"), ["1", "3", "10", "All"], { All: all }),
        danger(t("settings.recordings"), t("settings.recordings.where", { size: measured(sizes.recordings), path: tildePath(RECORDINGS_DIR) }), t("settings.deleteAll"), recordings, [btn(showIn, () => showInFinder(RECORDINGS_DIR))]),
      ].map((row, ix) => (ix === 1 ? { ...row, mono: true } : row)) },
    ],
    storage: [
      { label: t("settings.group.exports"), rows: [
        path("exportDir", t("settings.exportDir"), exportDir, true),
        tg("revealExports", t("settings.revealExports", { app: FILE_MANAGER }), t("settings.revealExports.desc")),
      ] },
      { label: t("settings.group.yourWork"), rows: [
        info(t("settings.projects"), sizes.apps === 1 ? t("settings.projects.one", { size: measured(sizes.projects) }) : t("settings.projects.many", { size: measured(sizes.projects), count: sizes.apps }), { buttons: [btn(showIn, () => showInFinder(PROJECTS_DIR))] }),
        danger(t("settings.chats"), t("settings.chats.desc", { size: measured(sizes.chats) }), t("settings.deleteAll"), confirmed("clear-chats", t("settings.chats.confirm"), t("settings.chats.confirmButton"), deleteAllChats, t("settings.chats.done")), [btn(showIn, () => showInFinder(THREADS_DIR))]),
        tg("autosave", t("settings.autosave"), t("settings.autosave.desc")),
      ] },
      { label: t("settings.group.freeUp"), rows: [
        danger(t("settings.cache"), t("settings.cache.desc", { size: measured(sizes.cache) }), t("settings.clear"), confirmed("clear-cache", t("settings.cache.confirm"), t("settings.cache.confirmButton"), () => clearFolder(cacheDir()), t("settings.cache.done"))),
        danger(t("settings.recordings"), t("settings.recordings.size", { size: measured(sizes.recordings) }), t("settings.clear"), recordings2),
      ] },
      { label: t("settings.group.window"), rows: [
        info(t("settings.resetLayout"), t("settings.resetLayout.desc"), { buttons: [btn(t("settings.reset"), () => { resetWorkbenchLayout(); c.toast(t("settings.resetLayout.done")); })] }),
      ] },
    ],
    about: [
      { label: null, rows: [
        info("Eleven", t("settings.about.version", { version: app.version, chip: process.arch === "arm64" ? t("settings.about.appleSilicon") : "Intel", update: updateShort(app) }), { lead: { kind: "img", src: appIcon(c.icon) }, buttons: app.download ? [btn(t("settings.download"), () => openLink(app.download ?? ""), "primary")] : [btn(t("settings.about.checkUpdates"), c.checkApp)] }),
        info(t("settings.about.whatsNew"), t("settings.about.whatsNew.desc"), { buttons: [btn(t("settings.open"), () => { openLink(RELEASE_NOTES); c.toast(t("settings.about.whatsNew.opened")); })] }),
        info(t("settings.about.support"), t("settings.about.support.desc"), { keywords: "donate sponsor fund", buttons: [btn(t("settings.about.sponsor"), () => { openLink(SPONSOR); opened(); })] }),
      ] },
      { label: t("settings.group.help"), rows: [
        info(t("settings.about.setup"), t("settings.about.setup.desc"), { buttons: [btn(t("settings.about.setup.button"), c.setup)] }),
        info(t("settings.about.report"), t("settings.about.report.desc"), { buttons: [btn(t("settings.about.report.button"), c.copyDetails)] }),
        info(t("settings.about.settingsFile"), tildePath(SETTINGS_FILE), { mono: true, buttons: [btn(showIn, () => showInFinder(SETTINGS_FILE))] }),
      ] },
      { label: t("settings.group.madeWith"), rows: [
        info("REA", t("settings.about.rea"), { lead: { kind: "img", src: join(ENGINES_DIR, "rea.svg") }, buttons: [btn(t("settings.website"), () => { openLink("https://github.com/morluto/rea"); opened(); })] }),
        info("Rizin", t("settings.about.rizin"), { lead: { kind: "img", src: ENGINE_LOGO.rizin }, buttons: [btn(t("settings.website"), () => { openLink("https://rizin.re"); opened(); })] }),
        info("Ghidra", t("settings.about.ghidra"), { lead: { kind: "img", src: ENGINE_LOGO.ghidra }, buttons: [btn(t("settings.website"), () => { openLink("https://ghidra-sre.org"); opened(); })] }),
        info("Agent Client Protocol", t("settings.about.acp"), { lead: { kind: "img", src: join(ENGINES_DIR, "acp-light.png"), darkSrc: join(ENGINES_DIR, "acp-dark.png") }, buttons: [btn(t("settings.website"), () => { openLink("https://agentclientprotocol.com"); opened(); })] }),
      ] },
    ],
  };
}

export function rowMatches(row: SettingRowModel, group: GroupModel, pageName: string, query: string): boolean {
  return `${row.title} ${row.desc} ${row.keywords ?? ""} ${group.label ?? ""} ${pageName}`.toLowerCase().includes(query);
}
