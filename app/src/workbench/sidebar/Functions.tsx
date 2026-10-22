import { join } from "node:path";

import type { ReactElement } from "react";

import { type MenuEntry, openMenu } from "../../components/ContextMenu";
import { Icon } from "../../components/ui";
import { type PlainId, t } from "../../i18n";
import { ASSETS } from "../../lib/assets";
import { TYPING } from "../../lib/shortcuts";
import { useTheme } from "../../theme";
import { ask, subjectMenu } from "../actions";
import { ELLIPSIS, HOVER, MONO_STYLE, useBench } from "../parts";
import type { FunctionModules } from "./functionModules";
import { useFolders } from "./memory";
import { type FnRow, type FnShow, type FnSort, logoFor, rowFile } from "./model";
import { Heading, useSectionOpen } from "./parts";
import { PAST_CHEVRON, TreeFolder, treeIndent } from "./SourceRows";

const SHOWS: readonly { readonly id: FnShow; readonly label: PlainId; readonly chip: PlainId | null }[] = [
  { id: "all", label: "workbench.side.show.all", chip: null },
  { id: "yours", label: "workbench.side.show.yours", chip: "workbench.side.chip.yours" },
  { id: "renamed", label: "workbench.side.show.renamed", chip: "workbench.side.chip.renamed" },
  { id: "imports", label: "workbench.side.show.imports", chip: "workbench.side.show.imports" },
];

const SORTS: readonly { readonly id: FnSort; readonly label: PlainId }[] = [
  { id: "files", label: "workbench.side.sort.files" },
  { id: "modules", label: "workbench.side.sort.modules" },
  { id: "address", label: "workbench.side.sort.address" },
  { id: "name", label: "workbench.side.sort.name" },
];

/** The menu at the end of the filter field: what to show, then how to group it. */
function filterMenu(view: FnView): readonly MenuEntry[] {
  const pick = (label: PlainId, on: boolean, run: () => void): MenuEntry => ({ kind: "action", label: t(label), ...(on ? { icon: "check" } : {}), run });
  return [
    ...SHOWS.map((show) => pick(show.label, view.show === show.id, () => view.setShow(show.id))),
    { kind: "separator" },
    ...SORTS.filter((sort) => sort.id !== "modules" || view.modules).map((sort) => pick(sort.label, view.sort === sort.id, () => view.setSort(sort.id))),
  ];
}

export type FnView = {
  readonly sort: FnSort;
  readonly show: FnShow;
  /** How the list starts: by module when the binary registers modules. */
  readonly byDefault: FnSort;
  /** Which module each function belongs to, or null when the binary names no modules. */
  readonly modules: FunctionModules | null;
  readonly setSort: (sort: FnSort) => void;
  readonly setShow: (show: FnShow) => void;
};

/** The Functions heading, then one filter field: ↩ opens the first match, or asks the agent when nothing matches. */
export function FunctionsHead({ view, first }: { readonly view: FnView; readonly first: string | null }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { program, wb, openFn } = bench;
  const { open } = useSectionOpen("functions");
  const chip = SHOWS.find((show) => show.id === view.show)?.chip ?? null;
  const filtered = view.show !== "all" || view.sort !== view.byDefault;
  const submit = (): void => {
    const query = wb.s.filter.trim();
    if (!query) return;
    if (first) openFn(first, false);
    else ask(bench, t("workbench.side.askFind", { name: program.name, query }));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <Heading id="functions" title={t("workbench.side.functions")} count={program.total > 0 ? program.total.toLocaleString() : ""} />
      {open && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, height: 28, marginTop: 2, marginBottom: 6, paddingLeft: 9, paddingRight: 4, borderRadius: 7, backgroundColor: p.fill }}>
          <Icon name="search" size={12} color={p.muted} />
          <input {...TYPING} value={wb.s.filter} placeholder={t("workbench.side.filter")} aria-label={t("workbench.side.filterFunctions")} onChange={(e) => wb.patch({ filter: e.value ?? "" })} onSubmit={submit} style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, color: p.text }} />
          {chip && (
            <div onClick={() => view.setShow("all")} role="button" aria-label={t("workbench.side.showAllFunctions")} style={{ display: "flex", alignItems: "center", gap: 4, height: 20, flexShrink: 0, paddingLeft: 6, paddingRight: 6, borderRadius: 5, backgroundColor: p.sel2, fontSize: 11.5, color: p.text3, cursor: "pointer", hover: HOVER }}>
              <div style={{ pointerEvents: "none" }}>{`${t(chip)} ×`}</div>
            </div>
          )}
          <div onClick={(e) => openMenu(e.x ?? 0, e.y ?? 0, filterMenu(view))} role="button" aria-label={t("workbench.side.filterAndGroup")} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, flexShrink: 0, borderRadius: 5, cursor: "pointer", hover: HOVER }}>
            <Icon name="sort" size={13} color={filtered ? p.text : p.muted} />
          </div>
        </div>
      )}
      {open && view.sort === "modules" && <div style={{ paddingLeft: 8, paddingRight: 8, paddingBottom: 4, fontSize: 11, color: p.faint }}>{t("workbench.side.moduleGuessNote")}</div>}
    </div>
  );
}

function matchText(count: number, yoursFirst: boolean): string {
  if (count === 1) return yoursFirst ? t("workbench.side.match.oneYours") : t("workbench.side.match.oneModule");
  const shown = count.toLocaleString();
  return yoursFirst ? t("workbench.side.match.manyYours", { count: shown }) : t("workbench.side.match.manyModule", { count: shown });
}

/** Under the results while filtering: how many matched, or that ↩ asks the agent. */
export function MatchNote({ count, yoursFirst }: { readonly count: number; readonly yoursFirst: boolean }): ReactElement {
  const { p } = useTheme();
  const text = count === 0 ? t("workbench.side.noMatch") : matchText(count, yoursFirst);
  return <div style={{ paddingTop: 6, paddingBottom: 6, paddingLeft: 8, paddingRight: 8, fontSize: 11.5, color: p.faint }}>{text}</div>;
}

/** An origin or module heading inside Functions, with its count. */
function GroupRow({ row, onToggle }: { readonly row: Extract<FnRow, { kind: "node" }>; readonly onToggle: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onToggle} role="treeitem" aria-expanded={row.open} aria-label={row.name} style={{ display: "flex", alignItems: "center", gap: 6, height: 26, marginTop: row.path === "#yours" ? 0 : 8, flexShrink: 0, paddingLeft: 8, paddingRight: 8, borderRadius: 6, cursor: "pointer", hover: HOVER }}>
      <Icon name={row.open ? "disclosure" : "forward"} size={10} color={p.faint} />
      <div style={{ flexGrow: 1, minWidth: 0, fontSize: 11.5, fontWeight: 500, color: p.muted, pointerEvents: "none" }}>{row.name}</div>
      {row.count > 0 && <div style={{ flexShrink: 0, fontSize: 11.5, color: p.faint, pointerEvents: "none" }}>{row.count.toLocaleString()}</div>}
    </div>
  );
}

const OUTSIDE = /^#(?:libraries|imports|runtime)(?:\/|$)/;

/** A package, namespace or class; folders outside your code, and the unnamed functions, draw quieter. */
function TreeRow({ row, onToggle }: { readonly row: Extract<FnRow, { kind: "node" }>; readonly onToggle: () => void }): ReactElement {
  const { p } = useTheme();
  const unnamed = row.path.endsWith("/#unnamed");
  const outside = OUTSIDE.test(row.path);
  const icon = row.tree === "class" ? "class" : unnamed ? "unnamed" : outside ? "shelf" : null;
  const color = row.tree === "class" ? p.kind : unnamed || outside ? p.faint : null;
  return <TreeFolder name={row.name} open={row.open} depth={row.depth} count={row.count > 0 ? row.count.toLocaleString() : ""} icon={icon} iconColor={color} onClick={onToggle} />;
}

/** A decompiled source file: the arrow folds its functions, the name opens the whole file. */
function FileRow({ row, onToggle }: { readonly row: Extract<FnRow, { kind: "node" }>; readonly onToggle: () => void }): ReactElement {
  const { p } = useTheme();
  const { wb } = useBench();
  const file = rowFile(row.path);
  const on = wb.s.panes.some((pane) => {
    const tab = pane.tabs[pane.active];
    return tab?.kind === "source" && tab.file === file;
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, height: 26, flexShrink: 0, paddingLeft: treeIndent(row.depth), paddingRight: 8, borderRadius: 6, ...(on ? { backgroundColor: p.sel } : {}) }}>
      {row.count === 0 ? <div style={{ width: 10, flexShrink: 0 }} /> : (
        <div onClick={onToggle} role="button" aria-expanded={row.open} aria-label={row.open ? t("workbench.side.fold", { name: row.name }) : t("workbench.side.unfold", { name: row.name })} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 10, height: 26, flexShrink: 0, cursor: "pointer", hover: HOVER }}>
          <Icon name={row.open ? "disclosure" : "forward"} size={10} color={p.faint} />
        </div>
      )}
      <div onClick={() => wb.open({ kind: "source", file }, true)} role="button" aria-label={t("workbench.side.openNamed", { name: row.name })} style={{ display: "flex", alignItems: "center", gap: 7, flexGrow: 1, minWidth: 0, height: 26, cursor: "pointer", hover: HOVER }}>
        <img src={join(ASSETS, "icons", `${logoFor(row.ext)}.svg`)} objectFit="contain" style={{ width: 14, height: 14, flexShrink: 0, pointerEvents: "none" }} />
        <div style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, color: on ? p.text : p.text3, pointerEvents: "none", ...ELLIPSIS }}>{row.name}</div>
        {row.count > 0 && <div style={{ flexShrink: 0, fontSize: 11.5, color: p.faint, pointerEvents: "none" }}>{`${row.count}`}</div>}
      </div>
    </div>
  );
}

function Highlighted({ text, hit }: { readonly text: string; readonly hit: string }): ReactElement {
  const { p } = useTheme();
  const at = hit ? text.toLowerCase().indexOf(hit.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <div style={{ color: p.text, backgroundColor: p.sel2, borderRadius: 3 }}>{text.slice(at, at + hit.length)}</div>
      {text.slice(at + hit.length)}
    </>
  );
}

/** One function: under its folder a small glyph and its name; as a filter result, the match marked and where it lives underneath. */
function FunctionRow({ row }: { readonly row: Extract<FnRow, { kind: "fn" }> }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { openFn, focusAddr, wb } = bench;
  const { fn } = row;
  const on = fn.addr === focusAddr;
  const renamed = wb.s.names.has(fn.addr);
  const bind = subjectMenu(bench, { kind: "function", addr: fn.addr }, () => openFn(fn.addr, true));
  if (row.where) {
    return (
      <div {...bind} role="treeitem" aria-selected={on} aria-label={t("workbench.side.functionNamed", { name: row.label })} style={{ display: "flex", flexDirection: "column", justifyContent: "center", minHeight: 38, flexShrink: 0, paddingTop: 3, paddingBottom: 3, paddingLeft: 8, paddingRight: 8, borderRadius: 6, cursor: "pointer", hover: HOVER, ...(on ? { backgroundColor: p.sel } : {}) }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, pointerEvents: "none" }}>
          <div style={{ display: "flex", flexGrow: 1, minWidth: 0, fontSize: 12, color: p.text3, ...MONO_STYLE, ...ELLIPSIS }}><Highlighted text={row.label} hit={wb.s.filter.trim()} /></div>
          {renamed && <div aria-label={t("workbench.side.show.renamed")} style={{ width: 6, height: 6, flexShrink: 0, borderRadius: 3, backgroundColor: p.link }} />}
          <div style={{ flexShrink: 0, fontSize: 11, color: p.faint, ...MONO_STYLE }}>{fn.addr.slice(-5)}</div>
        </div>
        <div style={{ fontSize: 11.5, color: p.faint, pointerEvents: "none", ...ELLIPSIS }}>{row.where}</div>
      </div>
    );
  }
  return (
    <div {...bind} role="treeitem" aria-selected={on} aria-label={t("workbench.side.functionNamed", { name: row.label })} style={{ display: "flex", alignItems: "center", gap: 8, height: 24, flexShrink: 0, paddingLeft: treeIndent(row.depth - 1) + PAST_CHEVRON, paddingRight: 8, borderRadius: 6, cursor: "pointer", hover: HOVER, ...(on ? { backgroundColor: p.sel } : {}) }}>
      <Icon name={fn.kind === "function" ? "function" : "thunk"} size={12} color={p.link} />
      <div style={{ flexGrow: 1, minWidth: 0, fontSize: 12, color: on ? p.text : p.text3, pointerEvents: "none", ...MONO_STYLE, ...ELLIPSIS }}>{row.label}</div>
      {row.module?.evidence === "layout" && <div aria-label={t("workbench.side.moduleGuessed")} style={{ flexShrink: 0, fontSize: 12, color: p.faint, pointerEvents: "none" }}>{"≈"}</div>}
      {renamed && <div aria-label={t("workbench.side.show.renamed")} style={{ width: 6, height: 6, flexShrink: 0, borderRadius: 3, backgroundColor: p.link }} />}
    </div>
  );
}

export function FnRowView({ row }: { readonly row: FnRow }): ReactElement {
  const folders = useFolders();
  switch (row.kind) {
    case "node": {
      const toggle = (): void => folders.toggle(`fn:${row.path}`);
      if (row.tree === "group") return <GroupRow row={row} onToggle={toggle} />;
      return row.tree === "file" ? <FileRow row={row} onToggle={toggle} /> : <TreeRow row={row} onToggle={toggle} />;
    }
    case "fn":
      return <FunctionRow row={row} />;
    default: {
      const unhandled: never = row;
      return unhandled;
    }
  }
}
