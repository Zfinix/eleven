import { type ReactElement, type ReactNode, useMemo, useState } from "react";

import { type MenuEntry, menuOn } from "../components/ContextMenu";

import type { ThreadSummary } from "../chat/history";
import { ThreadName } from "../chat/ThreadName";
import type { ProjectEntry } from "../engine/project";
import type { CommandId } from "../keys/commands";
import { comboFor, comboKeys } from "../keys/keymaps";
import { FileIcon } from "../components/FileIcon";
import { type PlainId, t } from "../i18n";
import { useSettings } from "../settings/store";
import { type Appearance, onGlass, ThemeContext, useTheme } from "../theme";
import { appIcon, CommandKeys, Dot, Icon, MenuSurface, Popover, Row, usePopover } from "../components/ui";

const APPEARANCES: readonly Appearance[] = ["Dark", "Light", "System"];
const APPEARANCE_LABELS: Readonly<Record<Appearance, PlainId>> = { Dark: "home.appearance.dark", Light: "home.appearance.light", System: "home.appearance.system" };
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(at: number, now: number): string {
  const gap = Math.max(0, now - at);
  if (gap < MINUTE) return t("time.now");
  if (gap < HOUR) {
    const count = Math.floor(gap / MINUTE);
    return count === 1 ? t("time.minute") : t("time.minutes", { count });
  }
  if (gap < DAY) {
    const count = Math.floor(gap / HOUR);
    return count === 1 ? t("time.hour") : t("time.hours", { count });
  }
  if (gap < 2 * DAY) return t("time.yesterday");
  if (gap < 7 * DAY) return t("time.days", { count: Math.floor(gap / DAY) });
  if (gap < 14 * DAY) return t("time.lastWeek");
  return t("time.weeks", { count: Math.floor(gap / (7 * DAY)) });
}

function short(at: number, now: number): string {
  const gap = Math.max(0, now - at);
  if (gap < MINUTE) return t("time.now");
  if (gap < HOUR) return t("home.short.minutes", { count: Math.floor(gap / MINUTE) });
  if (gap < DAY) return t("home.short.hours", { count: Math.floor(gap / HOUR) });
  if (gap < 7 * DAY) return t("home.short.days", { count: Math.floor(gap / DAY) });
  return t("home.short.weeks", { count: Math.floor(gap / (7 * DAY)) });
}

function projectMeta(project: ProjectEntry, chats: readonly ThreadSummary[], now: number): string {
  const own = chats.filter((chat) => chat.project === project.id);
  const last = Math.max(project.openedAt, ...own.map((chat) => chat.updatedAt));
  const when = ago(last, now);
  if (own.length === 0) return when;
  return own.length === 1 ? t("home.project.oneChat", { when }) : t("home.project.chats", { count: own.length, when });
}

function rowStyle(on: boolean, fill: string): { readonly borderWidth: number; readonly borderColor: string; readonly backgroundColor: string } {
  return { borderWidth: 1, borderColor: "transparent", backgroundColor: on ? fill : "transparent" };
}

function ActionRow({ icon, label, command, onClick }: { readonly icon: string; readonly label: string; readonly command: CommandId; readonly onClick: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onClick} role="button" aria-label={label} style={{ display: "flex", alignItems: "center", gap: 10, height: 32, flexShrink: 0, paddingLeft: 8, paddingRight: 8, borderRadius: 8, cursor: "pointer", hover: { opacity: 0.72 } }}>
      <Icon name={icon} size={17} color={p.muted} />
      <div style={{ flexGrow: 1, color: p.text3 }}>{label}</div>
      <CommandKeys id={command} />
    </div>
  );
}

function SectionLabel({ text, first = false, children }: { readonly text: string; readonly first?: boolean; readonly children?: ReactNode }): ReactElement {
  const { p } = useTheme();
  return (
    <Row gap={6} style={{ height: 26, flexShrink: 0, marginTop: first ? 0 : 14, paddingLeft: 8, paddingRight: 8 }}>
      <div style={{ flexGrow: 1, fontSize: 12, fontWeight: 500, color: p.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{text}</div>
      {children}
    </Row>
  );
}

function ProjectTile({ path }: { readonly path: string }): ReactElement {
  const { p } = useTheme();
  return (
    <FileIcon path={path} px={34} radius={8} fallback={
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, flexShrink: 0, borderRadius: 8, backgroundColor: p.fill2, pointerEvents: "none" }}>
        <Icon name="binary" size={18} color={p.muted} />
      </div>
    } />
  );
}

function ProjectRow({ project, meta, on, onClick }: { readonly project: ProjectEntry; readonly meta: string; readonly on: boolean; readonly onClick: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onClick} role="button" aria-label={t("home.openProject", { name: project.name })} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, flexShrink: 0, paddingTop: 4, paddingBottom: 4, paddingLeft: 8, paddingRight: 8, borderRadius: 8, cursor: "pointer", hover: { opacity: 0.72 }, ...rowStyle(on, p.sel) }}>
      <ProjectTile path={project.original} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, lineHeight: 16 }}>
        <div style={{ color: p.text3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{project.name}</div>
        <div style={{ fontSize: 11.5, color: p.faint, opacity: 0.7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{meta}</div>
      </div>
    </div>
  );
}

function ChatRow({ title, when, busy, on, onClick, menu }: {
  readonly title: string;
  readonly when: string;
  readonly busy: boolean;
  readonly on: boolean;
  readonly onClick: () => void;
  readonly menu: () => readonly MenuEntry[];
}): ReactElement {
  const { p } = useTheme();
  const dot = busy ? p.data : on ? p.string : p.faint;
  return (
    <div {...menuOn(menu, onClick)} role="button" aria-label={title} style={{ display: "flex", alignItems: "center", gap: 10, height: 32, flexShrink: 0, paddingLeft: 8, paddingRight: 8, borderRadius: 8, cursor: "pointer", hover: { opacity: 0.72 }, ...rowStyle(on, p.sel) }}>
      <div style={{ display: "flex", justifyContent: "center", width: 17, flexShrink: 0, pointerEvents: "none" }}>
        <Dot color={dot} />
      </div>
      <div style={{ flexGrow: 1, minWidth: 0, color: p.text3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
      <div style={{ flexShrink: 0, fontSize: 12, color: busy ? p.data : p.faint, opacity: busy ? 1 : 0.7 }}>{busy ? t("home.working") : when}</div>
    </div>
  );
}

function ThemeSwitch(): ReactElement {
  const { p, appearance, setAppearance } = useTheme();
  return (
    <Row gap={2} style={{ paddingTop: 2, paddingBottom: 2, paddingLeft: 2, paddingRight: 2, borderRadius: 8, backgroundColor: p.fill }}>
      {APPEARANCES.map((choice) => {
        const on = appearance === choice;
        return (
          <div key={choice} onClick={() => setAppearance(choice)} role="radio" aria-label={t(APPEARANCE_LABELS[choice])} aria-checked={on} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 22, borderRadius: 6, cursor: "pointer", hover: { opacity: 0.72 }, backgroundColor: on ? p.sel2 : "transparent" }}>
            <Icon name={choice.toLowerCase()} size={14} color={on ? p.text : p.muted} />
          </div>
        );
      })}
    </Row>
  );
}

function MenuRow({ icon, label, hint, onClick }: { readonly icon: string; readonly label: string; readonly hint?: string; readonly onClick: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onClick} role="menuitem" aria-label={label} style={{ display: "flex", alignItems: "center", gap: 10, height: 32, flexShrink: 0, paddingLeft: 8, paddingRight: 8, borderRadius: 8, color: p.text3, cursor: "pointer", hover: { opacity: 0.72 } }}>
      <Icon name={icon} size={15} color={p.muted} />
      <div style={{ flexGrow: 1 }}>{label}</div>
      {hint && <div style={{ fontSize: 11.5, color: p.faint }}>{hint}</div>}
    </div>
  );
}

export type AppMenuActions = {
  readonly onSettings: () => void;
  readonly onSetup: () => void;
  readonly onWhatsNew: () => void;
};

function AppMenu({ actions }: { readonly actions: AppMenuActions }): ReactElement {
  const { p } = useTheme();
  const { settings } = useSettings();
  const menu = usePopover();
  const settingsKeys = comboKeys(comboFor("settings", settings.keymap ?? "eleven", settings.shortcuts)).join("");
  const pick = (run: () => void) => (): void => {
    menu.close();
    run();
  };
  return (
    <Row gap={2} style={{ marginTop: 8 }}>
      <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
      <div onMouseDown={menu.onTriggerDown} onClick={menu.onTriggerClick} role="button" aria-label="Eleven" aria-expanded={menu.open} style={{ display: "flex", alignItems: "center", gap: 9, flexGrow: 1, minWidth: 0, height: 34, paddingLeft: 8, paddingRight: 8, borderRadius: 8, cursor: "pointer", hover: { opacity: 0.72 }, ...rowStyle(menu.open, p.sel) }}>
        <img src={appIcon(p.icon)} style={{ width: 20, height: 20, borderRadius: 5 }} />
        <div style={{ flexGrow: 1, color: p.text3 }}>Eleven</div>
        <Icon name="chevron-up" size={11} color={p.muted} />
      </div>
        {menu.open && (
          <Popover side="top" align="start" gap={6} onDismiss={menu.dismiss}>
            <MenuSurface width={252}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <MenuRow icon="gear" label={t("home.menu.settings")} hint={settingsKeys} onClick={pick(actions.onSettings)} />
                <Row gap={10} style={{ height: 34, paddingLeft: 8, paddingRight: 4, color: p.text3 }}>
                  <Icon name="system" size={15} color={p.muted} />
                  <div style={{ flexGrow: 1 }}>{t("home.menu.appearance")}</div>
                  <ThemeSwitch />
                </Row>
                <MenuRow icon="retry" label={t("home.menu.setup")} onClick={pick(actions.onSetup)} />
                <MenuRow icon="star" label={t("home.menu.whatsNew")} onClick={pick(actions.onWhatsNew)} />
              </div>
            </MenuSurface>
          </Popover>
        )}
      </div>
      <div onClick={actions.onSettings} role="button" aria-label={t("home.menu.settings")} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, flexShrink: 0, borderRadius: 8, cursor: "pointer", hover: { opacity: 0.72 } }}>
        <Icon name="gear" size={16} color={p.muted} />
      </div>
    </Row>
  );
}

/** Shown while the chat list is hovered; asks once more before deleting. */
function ClearChats({ count, visible, onClear }: { readonly count: number; readonly visible: boolean; readonly onClear: () => void }): ReactElement | null {
  const { p } = useTheme();
  const [armed, setArmed] = useState(false);
  if (!visible || count === 0) {
    if (armed) setArmed(false);
    return null;
  }
  const label = !armed ? t("home.clearAll") : count === 1 ? t("home.clearOne") : t("home.clearMany", { count });
  const press = (): void => {
    if (!armed) return setArmed(true);
    setArmed(false);
    onClear();
  };
  return <div onClick={press} role="button" aria-label={label} style={{ fontSize: 12, color: armed ? p.error : p.faint, cursor: "pointer", hover: { opacity: 0.72 } }}>{label}</div>;
}

/** New chat and Open, your projects, the open project's chats, and the Eleven menu. */
const RECENT_CHATS = 12;

export function Sidebar({ projects, project, chats, threads, current, running, activity, onNewThread, onOpen, onOpenProject, onSeeAll, onOpenThread, onClearChats, menu, threadMenu }: {
  readonly projects: readonly ProjectEntry[];
  readonly project: string | null;
  readonly chats: readonly ThreadSummary[];
  readonly threads: readonly ThreadSummary[];
  readonly current: string;
  readonly running: ReadonlySet<string>;
  readonly activity: ReactNode;
  readonly onNewThread: () => void;
  readonly onOpen: () => void;
  readonly onOpenProject: (project: ProjectEntry) => void;
  /** Shows every project on the Projects page. */
  readonly onSeeAll: () => void;
  readonly onOpenThread: (id: string) => void;
  readonly onClearChats: (ids: readonly string[]) => void;
  readonly menu: AppMenuActions;
  readonly threadMenu: (thread: ThreadSummary, rename: () => void) => readonly MenuEntry[];
}): ReactElement {
  const theme = useTheme();
  const glass = useMemo(() => ({ ...theme, p: onGlass(theme.p) }), [theme]);
  const { p } = glass;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const now = Date.now();
  const open = projects.find((entry) => entry.id === project);
  const listed = open ? threads : chats;
  const shown = open ? threads : [...chats].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_CHATS);
  return (
    <ThemeContext.Provider value={glass}>
    <div style={{ display: "flex", flexDirection: "column", width: 272, flexShrink: 0, paddingLeft: 10, paddingRight: 10, paddingBottom: 10 }}>
      <div style={{ height: 46, flexShrink: 0 }} />
      <ActionRow icon="new-chat" label={t("home.newChat")} command="thread" onClick={onNewThread} />
      <ActionRow icon="folder" label={t("home.open")} command="open" onClick={onOpen} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", paddingTop: 14 }}>
        <SectionLabel text={t("home.projects")} first>
          {projects.length > 0 && (
            <div onClick={onSeeAll} role="button" aria-label={t("home.seeAllProjects")} style={{ fontSize: 12, color: p.faint, cursor: "pointer", hover: { opacity: 0.72 } }}>{t("home.seeAll")}</div>
          )}
        </SectionLabel>
        {projects.length === 0 && <div style={{ paddingTop: 4, paddingBottom: 4, paddingLeft: 8, paddingRight: 8, fontSize: 12.5, color: p.faint }}>{t("home.noProjects")}</div>}
        {projects.map((entry) => <ProjectRow key={entry.id} project={entry} meta={projectMeta(entry, chats, now)} on={entry.id === project} onClick={() => onOpenProject(entry)} />)}
        {activity}
        <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <SectionLabel text={open ? t("home.chatsIn", { name: open.name }) : t("home.recentChats")}>
            <ClearChats count={listed.length} visible={hovered} onClear={() => onClearChats(listed.map((thread) => thread.id))} />
          </SectionLabel>
          {shown.length === 0 && <div style={{ paddingTop: 4, paddingBottom: 4, paddingLeft: 8, paddingRight: 8, fontSize: 12.5, color: p.faint }}>{t("home.noChats")}</div>}
          {shown.map((thread) => (thread.id === renaming
            ? <ThreadName key={thread.id} id={thread.id} title={thread.title} height={32} onDone={() => setRenaming(null)} />
            : <ChatRow key={thread.id} title={thread.title} when={short(thread.updatedAt, now)} busy={running.has(thread.id)} on={thread.id === current} onClick={() => onOpenThread(thread.id)} menu={() => threadMenu(thread, () => setRenaming(thread.id))} />
          ))}
        </div>
      </div>
      <AppMenu actions={menu} />
    </div>
    </ThemeContext.Provider>
  );
}
