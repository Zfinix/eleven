import { copyFileSync, existsSync, statSync } from "node:fs";

import { type ReactElement, useState } from "react";

import { listThreads } from "../chat/history";
import type { Chat } from "../chat/useChat";
import { FileIcon } from "../components/FileIcon";
import { Icon, Popover, usePopover } from "../components/ui";
import { askSavePath, deleteDocument, documentPath, renameDocument } from "../engine/document";
import { deleteProject, forgetProject, listProjects, type ProjectEntry, renameProject } from "../engine/project";
import type { Target } from "../engine/target";
import { type PlainId, t } from "../i18n";
import { errorMessage } from "../lib/guards";
import { TYPING } from "../lib/shortcuts";
import { useLoaded } from "../lib/useLoaded";
import { comboFor, comboText } from "../keys/keymaps";
import { useSettings } from "../settings/store";
import { showInFinder } from "../settings/system";
import { useDropTarget } from "../Shell";
import { SANS, scrollbar, useTheme } from "../theme";
import { ago } from "../welcome/files";
import { FILE_MANAGER } from "../lib/platform";

const HOVER = { opacity: 0.72 } as const;
const CARD_MIN = 220;

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const KIND_LABELS: Readonly<Record<ProjectEntry["kind"], PlainId>> = { app: "projects.kind.app", binary: "projects.kind.binary", gpu: "projects.kind.gpu", model: "projects.kind.model" };

function chatsLabel(chats: number): string {
  if (chats === 0) return t("projects.noChats");
  return chats === 1 ? t("projects.oneChat") : t("projects.chats", { count: chats });
}

function deleteQuestion(chats: number, name: string): string {
  if (chats === 0) return t("projects.deleteConfirm.none", { name });
  return chats === 1 ? t("projects.deleteConfirm.one", { name }) : t("projects.deleteConfirm.many", { count: chats, name });
}

function ProjectIcon({ path, px }: { readonly path: string; readonly px: number }): ReactElement {
  const { p } = useTheme();
  return <FileIcon path={path} px={px} fallback={<Icon name="folder" size={px * 0.7} color={p.muted} />} />;
}

function Pill({ text }: { readonly text: string }): ReactElement {
  const { p } = useTheme();
  return <div style={{ paddingLeft: 6, paddingRight: 6, borderRadius: 5, backgroundColor: p.fill2, fontSize: 11, lineHeight: 17, color: p.muted }}>{text}</div>;
}

type MenuItem = { readonly label: string; readonly icon: string; readonly run: () => void };

function CardMenu({ groups, onClose }: { readonly groups: readonly (readonly MenuItem[])[]; readonly onClose: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 220, padding: 6, borderWidth: 1, borderColor: p.line3, borderRadius: 12, backgroundColor: p.raised2 }}>
      {groups.map((items, ix) => (
        <div key={ix} style={{ display: "flex", flexDirection: "column" }}>
          {items.map((item) => (
            <div key={item.label} onClick={() => { onClose(); item.run(); }} role="menuitem" aria-label={item.label} style={{ display: "flex", alignItems: "center", gap: 10, height: 32, paddingLeft: 8, paddingRight: 8, borderRadius: 8, cursor: "pointer", hover: HOVER }}>
              <Icon name={item.icon} size={17} color={p.muted} />
              <div style={{ color: p.text3 }}>{item.label}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ProjectCard({ entry, current, chats, onOpen, onChanged, onProblem }: {
  readonly entry: ProjectEntry;
  readonly current: boolean;
  readonly chats: number;
  readonly onOpen: () => void;
  readonly onChanged: () => void;
  readonly onProblem: (text: string) => void;
}): ReactElement {
  const { p } = useTheme();
  const menu = usePopover();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const file = documentPath(entry.id);
  const source = existsSync(entry.original) ? entry.original : (file ?? entry.original);
  const pills = [t(KIND_LABELS[entry.kind]), entry.arch, file ? size(statSync(file).size) : ""].filter(Boolean);
  const finishRename = (): void => {
    const name = (renaming ?? "").trim();
    setRenaming(null);
    if (!name || name === entry.name) return;
    try {
      renameDocument(entry.id, name);
      renameProject(entry.id, name);
      onChanged();
    } catch (err) {
      onProblem(errorMessage(err));
    }
  };
  const saveCopy = async (): Promise<void> => {
    if (!file) return onProblem(t("projects.notSaved"));
    const to = await askSavePath(entry.name);
    if (to) copyFileSync(file, to);
  };
  const groups: readonly (readonly MenuItem[])[] = [
    [{ label: t("projects.open"), icon: "open-tab", run: onOpen }, { label: t("projects.showIn", { app: FILE_MANAGER }), icon: "folder", run: () => showInFinder(file ?? entry.original) }],
    [{ label: t("projects.saveCopy"), icon: "copy", run: () => void saveCopy() }, { label: t("projects.rename"), icon: "rename", run: () => setRenaming(entry.name) }],
    [
      { label: t("projects.forget"), icon: "close", run: () => { forgetProject(entry.id); onChanged(); } },
      ...(current ? [] : [{ label: t("projects.delete"), icon: "trash", run: () => setDeleting(true) }]),
    ],
  ];
  const drop = useDropTarget();
  const remove = (): void => {
    setDeleting(false);
    try {
      deleteDocument(entry.id);
      deleteProject(entry.id);
      onChanged();
    } catch (err) {
      onProblem(errorMessage(err));
    }
  };
  return (
    <div {...drop} style={{ position: "relative", display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: CARD_MIN, minWidth: CARD_MIN, padding: 14, borderWidth: 1, borderColor: current ? p.fill : p.line2, borderRadius: 12, ...(current ? { backgroundColor: p.fill } : {}) }}>
      <div onClick={() => renaming === null && onOpen()} role="button" aria-label={t("projects.openNamed", { name: entry.name })} style={{ display: "flex", flexDirection: "column", gap: 12, cursor: "pointer", hover: HOVER }}>
        <div style={{ pointerEvents: "none" }}><ProjectIcon path={source} px={40} /></div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {renaming === null
            ? <div style={{ fontWeight: 600, color: p.text, pointerEvents: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.name}</div>
            : <input {...TYPING} autoFocus value={renaming} aria-label={t("projects.name")} onChange={(e) => setRenaming(e.value ?? "")} onSubmit={finishRename} onBlur={finishRename} style={{ height: 24, paddingLeft: 6, paddingRight: 6, borderRadius: 6, backgroundColor: p.fill2, fontWeight: 600, color: p.text }} />}
          <div style={{ fontSize: 12, color: p.faint, pointerEvents: "none" }}>{`${chatsLabel(chats)} · ${ago(entry.openedAt, Date.now())}`}</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, pointerEvents: "none" }}>
          {pills.map((pill) => <Pill key={pill} text={pill} />)}
        </div>
      </div>
      {deleting && (
        <div role="alertdialog" aria-label={t("projects.deleteNamed", { name: entry.name })} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12, paddingTop: 12, paddingBottom: 12, paddingLeft: 12, paddingRight: 12, borderRadius: 10, backgroundColor: p.errBg }}>
          <div style={{ fontSize: 12.5, color: p.text2 }}>{deleteQuestion(chats, entry.name)}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <div onClick={remove} role="button" aria-label={t("projects.deleteProject")} style={{ display: "flex", alignItems: "center", height: 28, paddingLeft: 12, paddingRight: 12, borderRadius: 7, backgroundColor: p.error, cursor: "pointer", hover: HOVER }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#ffffff", pointerEvents: "none" }}>{t("projects.deleteButton")}</div>
            </div>
            <div onClick={() => setDeleting(false)} role="button" aria-label={t("projects.keep")} style={{ display: "flex", alignItems: "center", height: 28, paddingLeft: 12, paddingRight: 12, borderRadius: 7, backgroundColor: p.fill2, cursor: "pointer", hover: HOVER }}>
              <div style={{ fontSize: 12.5, color: p.text3, pointerEvents: "none" }}>{t("projects.cancel")}</div>
            </div>
          </div>
        </div>
      )}
      <div style={{ position: "absolute", top: 10, right: 10, display: "flex" }}>
        <div onMouseDown={menu.onTriggerDown} onClick={menu.onTriggerClick} role="button" aria-label={t("projects.more", { name: entry.name })} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 7, cursor: "pointer", hover: HOVER }}>
          <Icon name="more" size={15} color={p.muted} />
        </div>
        {menu.open && (
          <Popover side="bottom" align="end" gap={6} onDismiss={menu.dismiss}>
            <CardMenu groups={groups} onClose={menu.close} />
          </Popover>
        )}
      </div>
    </div>
  );
}

/** Every project, one `.eleven` file each in Documents/Eleven: open, reveal, copy, rename or drop one from the list. */
export function ProjectsPage({ chat, onOpen }: { readonly chat: Chat; readonly onOpen: (target: Target) => void }): ReactElement {
  const { p } = useTheme();
  const { settings } = useSettings();
  const drop = useDropTarget();
  const [tick, setTick] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const projects = useLoaded(() => Promise.resolve(listProjects()), `projects:${tick}:${chat.projects.length}`);
  const threads = listThreads();
  const chatsOf = (id: string): number => threads.filter((thread) => thread.project === id).length;
  const open = (entry: ProjectEntry): void => {
    const target = chat.openProject(entry);
    if (target && (target.kind === "binary" || target.kind === "app")) onOpen(target);
  };
  const list = projects.kind === "ready" ? projects.value : [];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexGrow: 1, minHeight: 0, overflowY: "scroll", ...scrollbar(p), paddingTop: 56, paddingBottom: 56, paddingLeft: 32, paddingRight: 32 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, width: "100%", maxWidth: 760 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flexGrow: 1, minWidth: 0, fontSize: 24, lineHeight: 30, fontWeight: 600, color: p.text }}>{t("home.projects")}</div>
            <div {...drop} onClick={chat.openFile} role="button" aria-label={t("projects.openFile")} style={{ display: "flex", alignItems: "center", gap: 8, height: 32, flexShrink: 0, paddingLeft: 14, paddingRight: 12, borderRadius: 8, backgroundColor: p.primary, cursor: "pointer", hover: HOVER }}>
              <div style={{ fontWeight: 600, color: p.onPrimary, pointerEvents: "none" }}>{t("home.open")}</div>
              <div style={{ fontFamily: SANS, fontSize: 11.5, fontWeight: 500, color: p.onPrimary, opacity: 0.55, pointerEvents: "none" }}>{comboText(comboFor("open", settings.keymap ?? "eleven", settings.shortcuts))}</div>
            </div>
          </div>
          <div style={{ color: p.muted }}>{t("projects.intro")}</div>
        </div>
        {problem && <div {...drop} role="alert" style={{ paddingTop: 10, paddingBottom: 10, paddingLeft: 14, paddingRight: 14, borderRadius: 10, backgroundColor: p.errBg, color: p.error }}>{problem}</div>}
        {list.length === 0 && projects.kind === "ready" && <div style={{ color: p.muted }}>{t("projects.empty")}</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {list.map((entry) => (
            <ProjectCard key={entry.id} entry={entry} current={entry.id === chat.project} chats={chatsOf(entry.id)} onOpen={() => open(entry)} onChanged={() => setTick(tick + 1)} onProblem={setProblem} />
          ))}
        </div>
        <div {...drop} style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 14, paddingBottom: 14, paddingLeft: 16, paddingRight: 16, borderRadius: 12, backgroundColor: p.fill }}>
          <Icon name="download" size={18} color={p.muted} />
          <div style={{ flexGrow: 1, color: p.muted }}>{t("projects.drop")}</div>
        </div>
      </div>
    </div>
  );
}
