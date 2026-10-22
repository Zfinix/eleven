import { type EventPayload, type PublicInstance, useGpuix } from "@gpuix/react";
import { type ReactElement, useEffect, useRef, useState } from "react";

import { ask, goTo } from "./actions";
import { codeForString } from "./layout";
import { exportAllPseudocode, exportFunction, exportObjcInventory } from "./export";
import { patchBytes } from "./patch";
import { YOU } from "../engine/edits";
import { loadProject, updateProject } from "../engine/project";
import { copyText } from "../chat/useThread";
import { SANS, scrollbar, useTheme } from "../theme";
import type { CommandId } from "../keys/commands";
import { HOVER, MONO_STYLE, overlay, useBench } from "./parts";
import { noteTyping, runCommand } from "../lib/shortcuts";
import { type Combo, comboFor, comboKeys } from "../keys/keymaps";
import { useSettings } from "../settings/store";
import { Icon } from "../components/ui";
import { showAddress } from "../settings/look";
import { MOD, primaryHeld } from "../lib/platform";
import { type PlainId, t } from "../i18n";

const MAX_RECENT = 3;
const MAX_FUNCTIONS = 6;
const MAX_DATA = 6;

type Kind = "fn" | "str" | "imp" | "seg" | "ai" | "act";

type Section = "function" | "view" | "file";

const SECTION_TITLE: Readonly<Record<Section, PlainId>> = { function: "workbench.palette.thisFunction", view: "workbench.palette.view", file: "workbench.palette.file" };

type Action = { readonly section: Section; readonly icon: string; readonly label: string; readonly command: CommandId | null; readonly run: () => void };

type Option = {
  readonly key: string;
  readonly kind: Kind;
  readonly icon: string;
  readonly label: string;
  readonly note: string;
  readonly addr: string;
  readonly combo: Combo;
  readonly mono: boolean;
  readonly run: () => void;
  readonly runInTab: () => void;
};

type Group = { readonly title: string; readonly options: readonly Option[] };

function useActions(): readonly Action[] {
  const { wb, program, nameOf, focusAddr, chat, openCompare } = useBench();
  const { s } = wb;
  const savedPatches = loadProject(program.id).patches.length;
  const close = (): void => wb.patch({ paletteOpen: false });
  const exported = (work: Promise<string>): void => {
    close();
    void (async (): Promise<void> => {
      try {
        chat.thread.note(t("workbench.export.saved", { path: await work }));
      } catch (err) {
        chat.thread.note(t("workbench.export.failed", { message: err instanceof Error ? err.message : String(err) }));
      }
    })();
  };
  return [
    { section: "function", icon: "rename", label: t("workbench.action.rename"), command: "rename", run: () => wb.patch({ paletteOpen: false, renaming: focusAddr, renameDraft: nameOf(focusAddr) }) },
    { section: "function", icon: "references", label: t("workbench.palette.findCallers"), command: "xrefs", run: () => { close(); runCommand("xrefs"); } },
    { section: "function", icon: "bookmark", label: t("workbench.action.bookmark"), command: "bookmark", run: () => { close(); runCommand("bookmark"); } },
    { section: "function", icon: "copy", label: t("workbench.action.copyAddress"), command: null, run: () => { close(); copyText(focusAddr); } },
    { section: "function", icon: "copy", label: t("workbench.palette.copyPseudocode"), command: null, run: () => { close(); void (async () => copyText(await program.code(focusAddr, "pseudo")))(); } },
    { section: "function", icon: "download", label: t("workbench.palette.exportPseudocode"), command: null, run: () => exported(exportFunction(program, focusAddr, "pseudo", nameOf(focusAddr))) },
    { section: "function", icon: "download", label: t("workbench.palette.exportAssembly"), command: null, run: () => exported(exportFunction(program, focusAddr, "asm", nameOf(focusAddr))) },
    { section: "function", icon: "hex", label: t("workbench.palette.patch"), command: "patch", run: () => wb.patch({ paletteOpen: false, patching: focusAddr, patchDraft: "" }) },
    { section: "view", icon: "pseudocode", label: t("workbench.view.pseudocode"), command: "pseudo", run: () => { close(); runCommand("pseudo"); } },
    { section: "view", icon: "graph", label: t("workbench.view.graph"), command: "graph", run: () => { close(); runCommand("graph"); } },
    { section: "view", icon: "strings", label: t("workbench.palette.strings"), command: "strings", run: () => { close(); wb.open({ kind: "list", list: "strings" }, false); } },
    { section: "view", icon: "split", label: t("workbench.action.splitRight"), command: "split", run: () => wb.split(s.focus) },
    { section: "view", icon: "split", label: t("workbench.action.splitDown"), command: "splitDown", run: () => wb.split(s.focus, "bottom") },
    ...(s.panes.length > 1
      ? [
          { section: "view", icon: "close", label: t("workbench.action.closeSplit"), command: null, run: () => wb.closePane(s.focus) },
          { section: "view", icon: "split", label: t("workbench.action.equalSplits"), command: null, run: () => { close(); wb.equalizePanes(); } },
        ] as const
      : []),
    { section: "view", icon: "slash", label: t("workbench.palette.terminal"), command: "terminal", run: () => { close(); wb.reveal("terminal"); } },
    { section: "view", icon: "panel", label: t("workbench.palette.toggleDetails"), command: "details", run: () => wb.patch({ paletteOpen: false, bottomOpen: !s.bottomOpen }) },
    { section: "view", icon: "sidebar", label: t("workbench.palette.toggleSidebar"), command: null, run: () => wb.patch({ paletteOpen: false, sidebarOpen: !s.sidebarOpen }) },
    { section: "view", icon: "thread", label: t("workbench.palette.toggleAgent"), command: "agent", run: () => { close(); wb.toggleTool("agent"); } },
    { section: "file", icon: "references", label: t("workbench.palette.compare"), command: null, run: openCompare },
    { section: "file", icon: "debug", label: t("workbench.palette.debug"), command: "debug", run: () => { close(); wb.reveal("debug"); } },
    { section: "file", icon: "download", label: t("workbench.palette.exportAll"), command: null, run: () => exported(exportAllPseudocode(program)) },
    { section: "file", icon: "download", label: t("workbench.palette.exportObjc"), command: null, run: () => exported(exportObjcInventory(program)) },
    ...(savedPatches > 0
      ? [
          { section: "file", icon: "hex", label: savedPatches === 1 ? t("workbench.palette.writePatchedOne") : t("workbench.palette.writePatched", { count: savedPatches }), command: null, run: () => exported(patchBytes(program, [])) },
          { section: "file", icon: "close", label: t("workbench.palette.clearPatches"), command: null, run: () => { close(); updateProject(program.id, (project) => ({ ...project, patches: [] }), YOU); chat.thread.note(t("workbench.palette.clearedPatches")); } },
        ] as const
      : []),
    { section: "file", icon: "settings", label: t("workbench.palette.settings"), command: "settings", run: () => { close(); runCommand("settings"); } },
  ];
}

function segmentNote(range: string): string {
  const [start, end] = range.split(" to ").map((part) => Number.parseInt(part.replace(/^0x/, ""), 16));
  if (start === undefined || end === undefined || Number.isNaN(start) || Number.isNaN(end) || end < start) return t("workbench.palette.segment");
  const bytes = end - start;
  const size = bytes >= 1 << 20 ? `${Math.round(bytes / (1 << 20))} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
  return t("workbench.palette.segmentSize", { size });
}

function useGroups(query: string): readonly Group[] {
  const bench = useBench();
  const { wb, program, nameOf, openFn, addrOf, focusAddr, chat } = bench;
  const { settings } = useSettings();
  const actions = useActions();
  const combo = (id: CommandId | null): Combo => (id ? comboFor(id, settings.keymap ?? "eleven", settings.shortcuts) : "");
  const close = (): void => wb.patch({ paletteOpen: false });
  const agent = chat.agents.selected.name;
  const option = (key: string, kind: Kind, icon: string, label: string, run: () => void, more: Partial<Pick<Option, "note" | "addr" | "combo" | "mono" | "runInTab">> = {}): Option => ({
    key, kind, icon, label, run, runInTab: more.runInTab ?? run, note: more.note ?? "", addr: more.addr ?? "", combo: more.combo ?? "", mono: more.mono ?? false,
  });
  const fnOption = (prefix: string, addr: string, note = ""): Option => option(`${prefix}:${addr}`, "fn", "function", nameOf(addr), () => openFn(addr, true), { addr, note, mono: true, runInTab: () => openFn(addr, false) });
  const jumpToString = (address: string): void => {
    close();
    void (async (): Promise<void> => {
      const fn = program.dossier ? await codeForString(program.path, address) : null;
      if (fn && addrOf(fn)) openFn(fn, false);
      else wb.open({ kind: "list", list: "strings" }, false);
    })();
  };
  const matches = (...texts: readonly string[]): boolean => !query || texts.some((text) => text.toLowerCase().includes(query));
  const known = new Set(program.functions.map((f) => f.addr));
  const recent = query ? [] : [...new Set([...wb.s.trail].reverse())].filter((addr) => addr !== focusAddr && known.has(addr)).slice(0, MAX_RECENT).map((addr) => fnOption("recent", addr));
  const goto = /^0x[0-9a-f]+$/.test(query) && !known.has(query) ? [option(`go:${query}`, "act", "search", t("workbench.action.goTo", { address: query }), () => { close(); goTo(bench, query); }, { mono: true })] : [];
  const askText = query ? wb.s.paletteQuery.trim() : t("workbench.palette.askPrompt", { name: nameOf(focusAddr), address: focusAddr });
  const askLabel = query ? t("workbench.palette.askQuery", { agent, query: wb.s.paletteQuery.trim() }) : t("workbench.palette.askAbout", { agent, name: nameOf(focusAddr) });
  const asking = program.functions.length > 0 || query ? [option("ask", "ai", "spark", askLabel, () => { close(); ask(bench, askText); }, { note: query ? "" : t("workbench.palette.askNote"), combo: combo("agent") })] : [];
  const fns = program.functions.filter((f) => matches(nameOf(f.addr), f.addr)).slice(0, MAX_FUNCTIONS).map((f) => fnOption("fn", f.addr));
  const data = query.length < 2 ? [] : [
    ...program.strings.filter((row) => matches(row.b)).slice(0, MAX_DATA).map((row) => option(`str:${row.a}`, "str", "strings", row.b, () => jumpToString(row.a), { note: t("workbench.palette.stringNote"), addr: row.a, mono: true })),
    ...program.imports.filter((row) => matches(row.a, row.b)).slice(0, MAX_DATA).map((row) => option(`imp:${row.a}:${row.b}`, "imp", "library", row.b, () => { close(); wb.open({ kind: "list", list: "imports" }, false); }, { note: row.a, mono: true })),
    ...program.segments.filter((row) => matches(row.a)).slice(0, MAX_DATA).map((row) => option(`seg:${row.a}`, "seg", "segments", row.a, () => { close(); wb.open({ kind: "list", list: "segments" }, false); }, { note: segmentNote(row.b), addr: row.b.split(" to ")[0] ?? "", mono: true })),
  ];
  const sections: readonly Section[] = ["function", "view", "file"];
  const commands = sections.map((section): Group => ({
    title: t(SECTION_TITLE[section]),
    options: actions.filter((a) => a.section === section && matches(a.label)).map((a) => option(`act:${actions.indexOf(a)}`, "act", a.icon, a.label, a.run, { combo: combo(a.command) })),
  }));
  const askGroup = { title: t("workbench.palette.askGroup"), options: asking };
  const found = [{ title: t("workbench.palette.functions"), options: fns }, { title: t("workbench.palette.data"), options: data }];
  const anyFound = [goto, recent, fns, data, ...commands.map((g) => g.options)].some((list) => list.length > 0);
  if (query && !anyFound) return [];
  return [
    { title: "", options: goto },
    { title: t("workbench.palette.recent"), options: recent },
    ...(query ? [...found, askGroup] : [askGroup, ...found]),
    ...commands,
  ].filter((group) => group.options.length > 0);
}

function OptionIcon({ option }: { readonly option: Option }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 17, height: 17, flexShrink: 0, pointerEvents: "none" }}>
      <Icon name={option.icon} size={17} color={option.kind === "ai" ? p.data : p.muted} />
    </div>
  );
}

function Cap({ cap }: { readonly cap: string }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: 20, height: 20, paddingLeft: 5, paddingRight: 5, borderRadius: 5, backgroundColor: p.glassTile, fontFamily: SANS, fontSize: 11.5, color: p.text4, pointerEvents: "none" }}>
      <div>{cap}</div>
    </div>
  );
}

function Caps({ caps }: { readonly caps: readonly string[] }): ReactElement {
  return (
    <div aria-label={caps.join("")} style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0, pointerEvents: "none" }}>
      {caps.map((cap, index) => <Cap key={index} cap={cap} />)}
    </div>
  );
}

function Hint({ caps, label }: { readonly caps: readonly string[]; readonly label: string }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <Caps caps={caps} />
      {label && <div style={{ color: p.faint }}>{label}</div>}
    </div>
  );
}

/** The ⌘K search: recent places, the agent, functions, data and actions, each with an icon colored by kind. */
export function Palette(): ReactElement {
  const { p } = useTheme();
  const { renderer } = useGpuix();
  const bench = useBench();
  const { wb, program } = bench;
  const [active, setActive] = useState(0);
  const activeRow = useRef<PublicInstance | null>(null);
  const inTab = useRef(false);
  const query = wb.s.paletteQuery.trim().toLowerCase();
  const close = (): void => wb.patch({ paletteOpen: false });
  const groups = useGroups(query);
  const all = groups.flatMap((group) => group.options);
  const current = Math.min(active, Math.max(0, all.length - 1));
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    const id = activeRow.current?.id;
    if (id !== undefined) renderer?.scrollIntoView?.(id);
  }, [current]);
  const submit = (inTab: boolean): void => {
    const picked = all[current];
    if (!picked) {
      if (wb.s.paletteQuery.trim()) {
        close();
        ask(bench, wb.s.paletteQuery.trim());
      }
      return;
    }
    if (inTab) picked.runInTab();
    else picked.run();
  };
  const onKey = (e: EventPayload): void => {
    noteTyping(e);
    if (e.key === "escape") close();
    if (e.key === "down") setActive((current + 1) % Math.max(1, all.length));
    if (e.key === "up") setActive((current - 1 + all.length) % Math.max(1, all.length));
    if (e.key === "enter" && primaryHeld(e.modifiers)) {
      inTab.current = true;
      submit(true);
    }
  };
  const { shadow, scrim } = overlay(p);
  const rowFor = (option: Option): ReactElement => {
    const on = all[current]?.key === option.key;
    return (
      <div key={option.key} {...(on ? { ref: activeRow } : {})} onClick={option.run} onMouseEnter={() => setActive(all.indexOf(option))} role="option" aria-selected={on} aria-label={option.label} style={{ display: "flex", alignItems: "center", gap: 10, height: 36, flexShrink: 0, paddingLeft: 10, paddingRight: 10, borderRadius: 8, cursor: "pointer", ...(on ? { backgroundColor: p.sel } : {}) }}>
        <OptionIcon option={option} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexGrow: 1, minWidth: 0, overflow: "hidden", pointerEvents: "none" }}>
          <div style={{ flexShrink: 1, minWidth: 0, color: p.text3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...(option.mono ? { fontSize: 12.5, ...MONO_STYLE } : {}) }}>{option.label}</div>
          {option.note && <div style={{ flexShrink: 0, fontSize: 12, color: p.faint, whiteSpace: "nowrap" }}>{option.note}</div>}
        </div>
        {option.addr && <div style={{ flexShrink: 0, fontSize: 11.5, color: p.faint, pointerEvents: "none", ...MONO_STYLE }}>{showAddress(option.addr)}</div>}
        {option.combo && <Caps caps={comboKeys(option.combo)} />}
      </div>
    );
  };
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 96, backgroundColor: scrim }}>
      <div onMouseDownOutside={close} role="dialog" aria-label={t("workbench.palette.title")} style={{ display: "flex", flexDirection: "column", flexGrow: 1, maxWidth: 620, marginLeft: 16, marginRight: 16, borderWidth: 1, borderColor: p.line3, borderRadius: 14, backgroundColor: p.raised2, overflow: "hidden", boxShadow: { offsetX: 0, offsetY: 24, blurRadius: 60, spreadRadius: 0, color: shadow } }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, height: 52, flexShrink: 0, paddingLeft: 16, paddingRight: 16, borderBottomWidth: 1, borderColor: p.line2 }}>
          <Icon name="search" size={17} color={p.muted} />
          <input autoFocus value={wb.s.paletteQuery} placeholder={t("workbench.palette.placeholder")} aria-label={t("workbench.palette.search")} onChange={(e) => wb.patch({ paletteQuery: e.value ?? "" })} onKeyDown={onKey} onSubmit={() => {
            if (inTab.current) inTab.current = false;
            else submit(false);
          }} style={{ flexGrow: 1, fontSize: 15, color: p.text }} />
          <div onClick={close} role="button" aria-label={t("workbench.palette.close")} style={{ display: "flex", cursor: "pointer", hover: HOVER }}>
            <Cap cap="esc" />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxHeight: 560, overflowY: "scroll", ...scrollbar(p), paddingTop: 6, paddingBottom: 8, paddingLeft: 8, paddingRight: 8 }}>
          {groups.map((group) => (
            <div key={group.title || "goto"} role="group" aria-label={group.title || t("workbench.palette.goToGroup")} style={{ display: "flex", flexDirection: "column", flexShrink: 0, paddingTop: 6 }}>
              {group.title && <div style={{ paddingTop: 6, paddingBottom: 4, paddingLeft: 10, paddingRight: 10, fontSize: 12, fontWeight: 500, color: p.muted }}>{group.title}</div>}
              {group.options.map(rowFor)}
            </div>
          ))}
          {all.length === 0 && <div style={{ flexShrink: 0, paddingTop: 28, paddingBottom: 28, textAlign: "center", color: p.muted }}>{t("workbench.palette.empty")}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, height: 36, flexShrink: 0, paddingLeft: 14, paddingRight: 14, borderTopWidth: 1, borderColor: p.line2, fontSize: 12 }}>
          <Hint caps={["↑", "↓"]} label={t("workbench.palette.move")} />
          <Hint caps={["↩"]} label={t("workbench.palette.open")} />
          <Hint caps={[MOD.replace("+", ""), "↩"]} label={t("workbench.palette.newTab")} />
          <div style={{ flexGrow: 1 }} />
          <div style={{ color: p.faint, whiteSpace: "nowrap" }}>{`${program.name} · ${program.arch}`}</div>
        </div>
      </div>
    </div>
  );
}
