import type { ReactElement } from "react";

import { Tooltip } from "../../components/kit";
import { Icon, Popover, usePopover } from "../../components/ui";
import type { ProjectEntry } from "../../engine/project";
import { explainArch } from "../../lib/explain";
import { formatLabel } from "../../lib/fileIcon";
import { t } from "../../i18n";
import { FileIcon } from "../../components/FileIcon";
import { runCommand } from "../../lib/shortcuts";
import { comboFor } from "../../keys/keymaps";
import { useSettings } from "../../settings/store";
import { useTheme } from "../../theme";
import { ago } from "../../welcome/files";
import { FileGlyph } from "../FileGlyph";
import { ELLIPSIS, HOVER, IconButton, useBench } from "../parts";
import { INSET, SideRow } from "./parts";

const MENU_WIDTH = 260;

function Pill({ text }: { readonly text: string }): ReactElement {
  const { p } = useTheme();
  return <div style={{ paddingLeft: 6, paddingRight: 6, borderRadius: 5, backgroundColor: p.fill2, fontSize: 11, lineHeight: 17, color: p.muted, pointerEvents: "none" }}>{text}</div>;
}

/** Opens a recent project in this window; the chat in front comes along. */
export function useOpenProject(): (entry: ProjectEntry) => void {
  const { chat, openTarget } = useBench();
  return (entry) => {
    const target = chat.openProject(entry);
    if (target && (target.kind === "binary" || target.kind === "app")) openTarget(target);
  };
}

/** A project's file icon: its format's logo, an app's own icon, or the Eleven document icon. */
function ProjectIcon({ path }: { readonly path: string }): ReactElement {
  const { p } = useTheme();
  return <FileIcon path={path} px={17} radius={4} fallback={<Icon name="folder" size={17} color={p.muted} />} />;
}

export function ProjectRows({ onDone }: { readonly onDone: () => void }): ReactElement {
  const { chat } = useBench();
  const open = useOpenProject();
  const now = Date.now();
  return (
    <>
      {chat.projects.map((entry) => (
        <SideRow key={entry.id} lead={{ kind: "node", node: <ProjectIcon path={entry.original} /> }} label={entry.name} side={ago(entry.openedAt, now)} on={entry.id === chat.project} onClick={() => { onDone(); open(entry); }} />
      ))}
    </>
  );
}

function MenuTitle({ text }: { readonly text: string }): ReactElement {
  const { p } = useTheme();
  return <div style={{ paddingTop: 4, paddingBottom: 4, paddingLeft: INSET, fontSize: 12, color: p.faint }}>{text}</div>;
}

/** The open project, large, with a menu of recent projects and a way to open another file. */
export function ProjectSwitcher(): ReactElement {
  const { p } = useTheme();
  const { program, chat, wb } = useBench();
  const { settings } = useSettings();
  const menu = usePopover();
  const format = chat.target?.meta.split(" · ")[0] || formatLabel(program.origin || program.path) || "";
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", height: 46, paddingRight: 2 }}>
        <IconButton icon="sidebar" label={t("workbench.side.hideSidebar")} iconSize={16} onClick={() => wb.patch({ sidebarOpen: false })} />
      </div>
      <div style={{ display: "flex", position: "relative" }}>
        <div onMouseDown={menu.onTriggerDown} onClick={menu.onTriggerClick} role="button" aria-expanded={menu.open} aria-label={t("workbench.side.switchProject")} style={{ display: "flex", alignItems: "center", gap: 10, flexGrow: 1, minWidth: 0, padding: INSET, borderRadius: 10, cursor: "pointer", hover: HOVER, ...(menu.open ? { backgroundColor: p.sel } : {}) }}>
          <FileGlyph size={34} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 20, color: p.text, pointerEvents: "none", ...ELLIPSIS }}>{program.name}</div>
            <div style={{ display: "flex", gap: 4 }}>
              {program.arch && <Tooltip label={explainArch(program.arch)}><div style={{ display: "flex" }}><Pill text={program.arch} /></div></Tooltip>}
              {format && <Pill text={format} />}
            </div>
          </div>
          <Icon name="updown" size={14} color={p.muted} />
        </div>
        {menu.open && (
          <Popover side="bottom" align="start" gap={6} onDismiss={menu.dismiss}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: MENU_WIDTH, padding: 6, borderWidth: 1, borderColor: p.line3, borderRadius: 12, backgroundColor: p.raised2 }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <MenuTitle text={t("workbench.side.recentProjects")} />
                <ProjectRows onDone={menu.close} />
              </div>
              <SideRow lead={{ kind: "icon", name: "new" }} label={t("workbench.side.openAnother")} combo={comboFor("open", settings.keymap ?? "eleven", settings.shortcuts)} onClick={() => { menu.close(); runCommand("open"); }} />
            </div>
          </Popover>
        )}
      </div>
    </div>
  );
}
