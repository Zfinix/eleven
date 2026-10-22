import { join } from "node:path";

import { type ReactElement, type ReactNode, useMemo } from "react";

import { activeEngine, chooseEngine, type EngineId, ENGINES, isEnabled } from "../../analysis/engines";
import { AgentLogo, appIcon, Icon, Popover } from "../../components/ui";
import { type PlainId, t } from "../../i18n";
import { comboFor } from "../../keys/keymaps";
import { ASSETS } from "../../lib/assets";
import { runCommand } from "../../lib/shortcuts";
import { loadProject } from "../../engine/project";
import { enabledSkills, playbookTitle, skillPrompt } from "../../skills/load";
import { openSettings } from "../../settings/open";
import { CODE_FONT_SIZES, useSettings } from "../../settings/store";
import { appVersion, openLink } from "../../settings/system";
import { type Appearance, useTheme } from "../../theme";
import { ask } from "../actions";
import { exportAllPseudocode, exportFunction, exportObjcInventory, openExportsFolder } from "../export";
import { patchBytes } from "../patch";
import { ELLIPSIS, HOVER, IconButton, useBench } from "../parts";
import { INSET, SideRow } from "./parts";

export type FooterSub = "agents" | "playbooks" | "exports" | "engine" | "appearance";

export type FooterMenu = { readonly open: boolean; readonly sub: FooterSub | null };

const MENU_WIDTH = 260;
const SUB_WIDTH = 290;

let pressedOutsideSub = false;

function Card({ width, children }: { readonly width: number; readonly children: ReactNode }): ReactElement {
  const { p } = useTheme();
  const shadow = { offsetX: 0, offsetY: 16, blurRadius: 40, spreadRadius: 0, color: "rgba(0,0,0,0.45)" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width, padding: 6, borderWidth: 1, borderColor: p.line3, borderRadius: 12, backgroundColor: p.raised2, boxShadow: shadow }}>
      {children}
    </div>
  );
}

function Group({ title = "", children }: { readonly title?: string; readonly children: ReactNode }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {title && <div style={{ paddingTop: 4, paddingBottom: 4, paddingLeft: INSET, fontSize: 12, color: p.faint }}>{title}</div>}
      {children}
    </div>
  );
}

function Check(): ReactElement {
  const { p } = useTheme();
  return <Icon name="check" size={15} color={p.text3} />;
}

function agentStatus(kind: "ready" | "working" | "starting" | "idle"): string {
  switch (kind) {
    case "ready":
      return t("workbench.side.agent.connected");
    case "working":
      return t("workbench.side.agent.working");
    case "starting":
      return t("workbench.side.agent.starting");
    case "idle":
      return t("workbench.side.agent.idle");
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

function AgentsSub({ onDone }: { readonly onDone: () => void }): ReactElement {
  const { p } = useTheme();
  const { chat } = useBench();
  const { agents } = chat;
  const installed = [agents.selected, ...agents.list.filter((agent) => agent.id !== agents.selected.id && agents.installed.has(agent.id))];
  const status = agentStatus(chat.thread.state.agent.kind);
  return (
    <>
      <Group title={t("workbench.side.agents")}>
        {installed.map((agent) => {
          const on = agent.id === agents.selected.id;
          return <SideRow key={agent.id} lead={{ kind: "node", node: <AgentLogo icon={agents.icons.get(agent.id) ?? null} size={17} /> }} label={agent.name} note={on ? status : t("workbench.side.ready")} noteColor={on ? p.string : null} on={on} trailing={on ? <Check /> : null} onClick={() => { onDone(); chat.pickAgent(agent.id); }} />;
        })}
      </Group>
      <Group>
        <SideRow lead={{ kind: "icon", name: "external" }} label={t("workbench.side.agents.registry")} onClick={() => { onDone(); openLink("https://agentclientprotocol.com"); }} />
        <SideRow lead={{ kind: "icon", name: "gear" }} label={t("workbench.side.agents.settings")} onClick={() => { onDone(); openSettings("agents"); }} />
      </Group>
    </>
  );
}

function PlaybooksSub({ onDone }: { readonly onDone: () => void }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { program, nameOf, focusAddr } = bench;
  const skills = useMemo(enabledSkills, []);
  return (
    <Group title={t("workbench.side.playbooks.runOn", { name: program.name })}>
      {skills.map((skill) => (
        <SideRow key={skill.name} lead={{ kind: "node", node: <Icon name="bolt" size={15} color={p.data} /> }} label={playbookTitle(skill.name)} note={skill.description} onClick={() => { onDone(); ask(bench, skillPrompt(skill, `${nameOf(focusAddr)} at ${focusAddr}`)); }} />
      ))}
    </Group>
  );
}

function ExportsSub({ onDone }: { readonly onDone: () => void }): ReactElement {
  const { program, focusAddr, nameOf, chat } = useBench();
  const patches = loadProject(program.id).patches.length;
  const exported = (work: Promise<string>): void => {
    onDone();
    void (async (): Promise<void> => {
      try {
        chat.thread.note(t("workbench.side.exports.savedTo", { path: await work }));
      } catch (err) {
        chat.thread.note(t("workbench.side.exports.failed", { error: err instanceof Error ? err.message : String(err) }));
      }
    })();
  };
  return (
    <>
      <Group title={t("workbench.side.exports.thisFunction")}>
        <SideRow lead={{ kind: "icon", name: "export-pseudo" }} label={t("workbench.side.exports.pseudocode")} onClick={() => exported(exportFunction(program, focusAddr, "pseudo", nameOf(focusAddr)))} />
        <SideRow lead={{ kind: "icon", name: "export-asm" }} label={t("workbench.side.exports.assembly")} onClick={() => exported(exportFunction(program, focusAddr, "asm", nameOf(focusAddr)))} />
      </Group>
      <Group title={t("workbench.side.exports.wholeFile")}>
        <SideRow lead={{ kind: "icon", name: "export-all" }} label={t("workbench.side.exports.allPseudocode")} side={t("workbench.side.exports.functions", { count: program.total.toLocaleString() })} onClick={() => exported(exportAllPseudocode(program))} />
        <SideRow lead={{ kind: "icon", name: "export-objc" }} label={t("workbench.side.exports.objc")} onClick={() => exported(exportObjcInventory(program))} />
        {patches > 0 && <SideRow lead={{ kind: "icon", name: "export-patch" }} label={t("workbench.side.exports.patched")} side={patches === 1 ? t("workbench.side.exports.onePatch") : t("workbench.side.exports.patches", { count: patches })} onClick={() => exported(patchBytes(program, []))} />}
      </Group>
      <Group>
        <SideRow lead={{ kind: "icon", name: "export-folder" }} label={t("workbench.side.exports.folder")} note="Downloads/Eleven" onClick={() => { onDone(); void openExportsFolder(program); }} />
      </Group>
    </>
  );
}

const ENGINE_LOGOS: Readonly<Partial<Record<EngineId, string>>> = { ghidra: "ghidra.png", rizin: "rizin.svg", hopper: "hopper.png", ida: "ida.png" };

function EngineLogo({ id, dim }: { readonly id: EngineId; readonly dim: boolean }): ReactElement | null {
  const file = ENGINE_LOGOS[id];
  if (!file) return null;
  return <img src={join(ASSETS, "engines", file)} objectFit="contain" style={{ width: 16, height: 16, borderRadius: 4, opacity: dim ? 0.45 : 1, pointerEvents: "none" }} />;
}

function EngineSub({ onDone }: { readonly onDone: () => void }): ReactElement {
  const { p } = useTheme();
  const active = activeEngine();
  const engines = ENGINES.filter((engine) => engine.status === "ready");
  return (
    <>
      <Group title={t("workbench.side.engine.reads")}>
        {engines.map((engine) => {
          const installed = engine.installed();
          const inUse = engine.id === active?.id;
          const note = !installed ? t("workbench.side.engine.notInstalled") : inUse ? t("workbench.side.engine.inUse") : isEnabled(engine.id) ? t("workbench.side.ready") : t("workbench.side.engine.off");
          const pick = (): void => {
            onDone();
            if (!installed) openLink(engine.repo);
            else if (!inUse) chooseEngine(engine.id);
          };
          return <SideRow key={engine.id} lead={{ kind: "node", node: <EngineLogo id={engine.id} dim={!installed} /> }} label={engine.name} note={note} noteColor={inUse ? p.string : null} on={inUse} trailing={inUse ? <Check /> : installed ? null : <Icon name="external" size={13} color={p.faint} />} onClick={pick} />;
        })}
      </Group>
      <Group>
        <SideRow lead={{ kind: "icon", name: "gear" }} label={t("workbench.side.engine.settings")} onClick={() => { onDone(); openSettings("engines"); }} />
      </Group>
    </>
  );
}

const THEMES: readonly { readonly id: Appearance; readonly label: PlainId; readonly icon: string }[] = [
  { id: "Dark", label: "home.appearance.dark", icon: "dark" },
  { id: "Light", label: "home.appearance.light", icon: "light" },
  { id: "System", label: "workbench.side.theme.system", icon: "system" },
];

const APPEARANCE_LABELS: Readonly<Record<Appearance, PlainId>> = { Dark: "home.appearance.dark", Light: "home.appearance.light", System: "home.appearance.system" };

function Stepper({ value, onDown, onUp }: { readonly value: string; readonly onDown: (() => void) | null; readonly onUp: (() => void) | null }): ReactElement {
  const { p } = useTheme();
  const button = (icon: string, label: string, run: (() => void) | null): ReactElement => (
    <div onClick={() => run?.()} role="button" aria-label={label} aria-disabled={!run} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, cursor: run ? "pointer" : "default", opacity: run ? 1 : 0.35, ...(run ? { hover: HOVER } : {}) }}>
      <Icon name={icon} size={13} color={p.text3} />
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, padding: 2, borderRadius: 8, backgroundColor: p.fill2 }}>
      {button("zoom-out", t("workbench.side.smaller"), onDown)}
      <div style={{ minWidth: 36, textAlign: "center", fontSize: 12, color: p.text3 }}>{value}</div>
      {button("zoom-in", t("workbench.side.larger"), onUp)}
    </div>
  );
}

function AppearanceSub(): ReactElement {
  const { appearance, setAppearance } = useTheme();
  const { settings, update } = useSettings();
  const at = CODE_FONT_SIZES.findIndex((size) => size === settings.codeFontSize);
  const smaller = CODE_FONT_SIZES[at - 1];
  const larger = CODE_FONT_SIZES[at + 1];
  return (
    <>
      <Group title={t("workbench.side.theme")}>
        {THEMES.map((theme) => <SideRow key={theme.id} lead={{ kind: "icon", name: theme.icon }} label={t(theme.label)} on={appearance === theme.id} trailing={appearance === theme.id ? <Check /> : null} onClick={() => setAppearance(theme.id)} />)}
      </Group>
      <Group title={t("workbench.side.code")}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, height: 34, paddingLeft: INSET, paddingRight: INSET - 2 }}>
          <Icon name="text" size={17} />
          <div style={{ flexGrow: 1 }}>{t("workbench.side.fontSize")}</div>
          <Stepper value={`${settings.codeFontSize} pt`} onDown={smaller ? () => update({ codeFontSize: smaller }) : null} onUp={larger ? () => update({ codeFontSize: larger }) : null} />
        </div>
      </Group>
    </>
  );
}

function SubBody({ sub, onDone }: { readonly sub: FooterSub; readonly onDone: () => void }): ReactElement {
  switch (sub) {
    case "agents":
      return <AgentsSub onDone={onDone} />;
    case "playbooks":
      return <PlaybooksSub onDone={onDone} />;
    case "exports":
      return <ExportsSub onDone={onDone} />;
    case "engine":
      return <EngineSub onDone={onDone} />;
    case "appearance":
      return <AppearanceSub />;
    default: {
      const unhandled: never = sub;
      return unhandled;
    }
  }
}

function SubRow({ id, icon, lead = null, label, side, menu, onMenu }: {
  readonly id: FooterSub;
  readonly icon: string;
  readonly lead?: ReactNode;
  readonly label: string;
  readonly side: string;
  readonly menu: FooterMenu;
  readonly onMenu: (menu: FooterMenu) => void;
}): ReactElement {
  const { p } = useTheme();
  const on = menu.sub === id;
  return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative" }}>
      <SideRow lead={lead ? { kind: "node", node: lead } : { kind: "icon", name: icon }} label={label} side={side} on={on} trailing={<Icon name="forward" size={11} color={p.faint} />} onClick={() => onMenu({ open: true, sub: on ? null : id })} />
      {on && (
        <anchored deferred occlude priority={3} side="right" align="end" gap={12} fit="switch" style={{ borderRadius: 12 }}>
          <div onMouseDownOutside={() => (pressedOutsideSub = true)} style={{ display: "flex" }}>
            <Card width={SUB_WIDTH}><SubBody sub={id} onDone={() => onMenu({ open: false, sub: null })} /></Card>
          </div>
        </anchored>
      )}
    </div>
  );
}

/** Eleven's menu: the app itself, then agents, playbooks, exports, engine, appearance and history, then settings. */
function ElevenMenu({ menu, onMenu }: { readonly menu: FooterMenu; readonly onMenu: (menu: FooterMenu) => void }): ReactElement {
  const { p, appearance } = useTheme();
  const { chat } = useBench();
  const { settings } = useSettings();
  const keymap = settings.keymap ?? "eleven";
  const close = (): void => onMenu({ open: false, sub: null });
  return (
    <Card width={MENU_WIDTH}>
      <Group title="Eleven">
        <div style={{ display: "flex", alignItems: "center", gap: 10, height: 36, paddingLeft: INSET, paddingRight: INSET }}>
          <img src={appIcon(p.icon)} style={{ width: 20, height: 20, borderRadius: 5 }} />
          <div style={{ flexGrow: 1, minWidth: 0, color: p.text3, ...ELLIPSIS }}>{`Eleven ${appVersion()}`}</div>
          <IconButton icon="more" label={t("menu.about")} size={24} iconSize={15} onClick={() => { close(); openSettings("about"); }} />
        </div>
      </Group>
      <Group>
        <SubRow id="agents" icon="agent" lead={<AgentLogo icon={chat.agents.icons.get(chat.agents.selected.id) ?? null} size={17} />} label={t("workbench.side.agents")} side={chat.agents.selected.name} menu={menu} onMenu={onMenu} />
        <SubRow id="playbooks" icon="plan" label={t("workbench.side.playbooks")} side="" menu={menu} onMenu={onMenu} />
        <SubRow id="exports" icon="download" label={t("workbench.side.exports")} side="" menu={menu} onMenu={onMenu} />
        <SubRow id="engine" icon="engine" label={t("workbench.side.engine")} side={activeEngine()?.name ?? t("workbench.side.noEngine")} menu={menu} onMenu={onMenu} />
        <SubRow id="appearance" icon="dark" label={t("workbench.side.appearance")} side={t(APPEARANCE_LABELS[appearance])} menu={menu} onMenu={onMenu} />
        <SideRow lead={{ kind: "icon", name: "gear" }} label={t("command.settings")} combo={comboFor("settings", keymap, settings.shortcuts)} onClick={() => { close(); runCommand("settings"); }} />
      </Group>
      <Group>
        <SideRow lead={{ kind: "icon", name: "folder" }} label={t("command.open")} combo={comboFor("open", keymap, settings.shortcuts)} onClick={() => { close(); runCommand("open"); }} />
        <SideRow lead={{ kind: "icon", name: "download" }} label={t("command.save")} combo={comboFor("save", keymap, settings.shortcuts)} onClick={() => { close(); runCommand("save"); }} />
      </Group>
    </Card>
  );
}

/** The submenu floats outside the menu's box, so a press in it also reads as outside the menu; close only when it missed both. */
function dismissUnlessInSub(subOpen: boolean, close: () => void): void {
  setTimeout(() => {
    if (!subOpen || pressedOutsideSub) close();
    pressedOutsideSub = false;
  }, 0);
}

/** The footer: Eleven and what it is connected to, opening its menu, then search and settings. */
export function Footer({ menu, onMenu }: { readonly menu: FooterMenu; readonly onMenu: (menu: FooterMenu) => void }): ReactElement {
  const { p } = useTheme();
  const { wb } = useBench();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, paddingTop: 8, flexShrink: 0, position: "relative" }}>
      <div style={{ display: "flex", flexGrow: 1, minWidth: 0, position: "relative" }}>
        <div onClick={() => onMenu({ open: !menu.open, sub: null })} role="button" aria-expanded={menu.open} aria-label={t("workbench.side.menu")} style={{ display: "flex", alignItems: "center", gap: 10, flexGrow: 1, minWidth: 0, height: 36, paddingLeft: INSET, paddingRight: INSET, borderRadius: 8, cursor: "pointer", hover: HOVER, ...(menu.open ? { backgroundColor: p.sel } : {}) }}>
          <img src={appIcon(p.icon)} style={{ width: 22, height: 22, borderRadius: 6, pointerEvents: "none" }} />
          <div style={{ flexGrow: 1, minWidth: 0, color: p.text3, pointerEvents: "none" }}>Eleven</div>
          <Icon name="disclosure" size={12} color={p.faint} />
        </div>
        {menu.open && (
          <Popover side="top" align="start" gap={8} onDismiss={() => dismissUnlessInSub(menu.sub !== null, () => onMenu({ open: false, sub: null }))}>
            <ElevenMenu menu={menu} onMenu={onMenu} />
          </Popover>
        )}
      </div>
      <IconButton icon="search" label={t("command.palette")} tip={false} size={32} iconSize={17} onClick={() => wb.patch({ paletteOpen: true, paletteQuery: "" })} />
      <IconButton icon="gear" tip={false} size={32} iconSize={17} onClick={() => runCommand("settings")} />
    </div>
  );
}
