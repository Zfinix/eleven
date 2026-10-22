import { type ReactElement, useState } from "react";

import { threadMenu } from "../../chat/threadMenu";
import { ThreadName } from "../../chat/ThreadName";
import { loadProject } from "../../engine/project";
import { type PlainId, t } from "../../i18n";
import { goTo } from "../actions";
import { GpuSection } from "../GpuTabs";
import type { ListKind } from "../model";
import { useBench } from "../parts";
import { useTheme } from "../../theme";
import { Faint, SideRow, SideSection } from "./parts";

const NEST = 18;
const RECENT_CHATS = 5;

/** This project's chats, newest first; the running one has a lit dot. */
export function Chats(): ReactElement {
  const { p } = useTheme();
  const { wb, chat } = useBench();
  const [all, setAll] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const current = chat.thread.id;
  const newest = [...chat.saved].sort((a, b) => b.updatedAt - a.updatedAt);
  const shown = all ? newest : newest.slice(0, RECENT_CHATS);
  const hidden = newest.length - shown.length;
  const show = (id: string): void => {
    chat.openThread(id);
    wb.reveal("agent");
  };
  return (
    <SideSection id="threads" title={t("workbench.side.chats")} count={newest.length > 0 ? `${newest.length}` : ""}>
      {newest.length === 0 && <Faint text={t("workbench.side.chats.empty")} />}
      {shown.map((thread) => (thread.id === renaming
        ? <ThreadName key={thread.id} id={thread.id} title={thread.title} height={32} onDone={() => setRenaming(null)} />
        : <SideRow key={thread.id} lead={{ kind: "dot", color: thread.id === current && chat.thread.busy ? p.data : p.line3 }} label={thread.title} on={thread.id === current} onClick={() => show(thread.id)} menu={() => threadMenu(chat, thread.id, thread.title, () => setRenaming(thread.id), () => show(thread.id))} />
      ))}
      {(hidden > 0 || all) && <SideRow lead={{ kind: "none" }} label={all ? t("workbench.side.showFewer") : t("workbench.side.showMore", { count: hidden })} onClick={() => setAll(!all)} />}
    </SideSection>
  );
}

type WorkItem = { readonly key: string; readonly label: string; readonly addr: string };

type WorkKind = { readonly id: string; readonly label: PlainId; readonly icon: string; readonly items: readonly WorkItem[] };

function useWork(): readonly WorkKind[] {
  const { wb, program, nameOf } = useBench();
  const { s } = wb;
  const at = (addr: string, label = nameOf(addr)): WorkItem => ({ key: addr, label, addr });
  const kinds: readonly WorkKind[] = [
    { id: "renames", label: "workbench.side.work.renames", icon: "rename", items: [...s.names.keys()].map((addr) => at(addr)) },
    { id: "bookmarks", label: "workbench.side.work.bookmarks", icon: "bookmark", items: s.bookmarks.map((b) => at(b.addr)) },
    { id: "notes", label: "workbench.side.work.notes", icon: "note", items: [...s.notes.keys()].map((addr) => at(addr)) },
    { id: "comments", label: "workbench.side.work.comments", icon: "thread", items: [...s.comments.entries()].map(([addr, text]) => ({ key: addr, label: text, addr })) },
    { id: "patches", label: "workbench.side.work.patches", icon: "hex", items: loadProject(program.id).patches.map((patch) => ({ key: patch.addr, label: patch.bytes, addr: patch.addr })) },
    { id: "groups", label: "workbench.side.work.groups", icon: "graph", items: s.groups.map((group) => ({ key: `${group.fn}:${group.label}`, label: group.label, addr: group.fn })) },
  ];
  return kinds.filter((kind) => kind.items.length > 0);
}

/** What you saved in this project, one row per kind that has anything; hidden until there is something. */
export function YourWork(): ReactElement | null {
  const bench = useBench();
  const work = useWork();
  const [expanded, setExpanded] = useState<string | null>(null);
  const total = work.reduce((sum, kind) => sum + kind.items.length, 0);
  if (total === 0) return null;
  return (
    <SideSection id="work" title={t("workbench.side.yourWork")} count={`${total}`}>
      {work.map((kind) => (
        <div key={kind.id} style={{ display: "flex", flexDirection: "column" }}>
          <SideRow lead={{ kind: "icon", name: kind.icon }} label={t(kind.label)} side={`${kind.items.length}`} on={expanded === kind.id} onClick={() => setExpanded(expanded === kind.id ? null : kind.id)} />
          {expanded === kind.id && kind.items.map((item) => (
            <SideRow key={item.key} lead={{ kind: "none" }} label={item.label} side={item.addr.slice(-5)} mono indent={NEST} height={28} onClick={() => goTo(bench, item.addr)} />
          ))}
        </div>
      ))}
    </SideSection>
  );
}

const LISTS: readonly { readonly list: ListKind; readonly label: PlainId; readonly open: PlainId; readonly icon: string }[] = [
  { list: "strings", label: "workbench.side.list.strings", open: "workbench.side.list.openStrings", icon: "strings" },
  { list: "imports", label: "workbench.side.list.imports", open: "workbench.side.list.openImports", icon: "library" },
  { list: "segments", label: "workbench.side.list.segments", open: "workbench.side.list.openSegments", icon: "segments" },
];

/** Shaders and models, only when the binary has some. */
function ShadersAndModels(): ReactElement | null {
  const [open, setOpen] = useState(false);
  return (
    <GpuSection frame={(count, body) => count === 0 ? <></> : (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <SideRow lead={{ kind: "icon", name: "gpu" }} label={t("workbench.side.shadersAndModels")} side={`${count}`} on={open} onClick={() => setOpen(!open)} />
        {open && <div style={{ display: "flex", flexDirection: "column", paddingLeft: NEST }}>{body}</div>}
      </div>
    )} />
  );
}

/** The file's own views, always there, so they need no heading: the listing, strings, imports and segments. */
export function FileViews(): ReactElement {
  const { program, wb } = useBench();
  const pane = wb.s.panes[wb.s.focus];
  const tab = pane?.tabs[pane.active];
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, width: "100%", paddingTop: 4, paddingBottom: 10 }}>
      <SideRow lead={{ kind: "icon", name: "assembly" }} label={t("workbench.side.listing")} on={tab?.kind === "listing"} onClick={() => wb.open({ kind: "listing" }, false)} menu={() => [
        { kind: "action", label: t("workbench.side.openListing"), icon: "assembly", run: () => wb.open({ kind: "listing" }, false) },
        { kind: "action", label: t("workbench.side.openInSplit"), icon: "split", run: () => wb.openSplit({ kind: "listing" }) },
      ]} />
      {LISTS.map((d) => (
        <SideRow key={d.list} lead={{ kind: "icon", name: d.icon }} label={t(d.label)} side={program[d.list].length.toLocaleString()} on={tab?.kind === "list" && tab.list === d.list} onClick={() => wb.open({ kind: "list", list: d.list }, false)} menu={() => [
          { kind: "action", label: t(d.open), icon: d.icon, run: () => wb.open({ kind: "list", list: d.list }, false) },
          { kind: "action", label: t("workbench.side.openInSplit"), icon: "split", run: () => wb.openSplit({ kind: "list", list: d.list }) },
        ]} />
      ))}
      <ShadersAndModels />
    </div>
  );
}
