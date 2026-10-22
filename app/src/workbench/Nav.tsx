import { statSync } from "node:fs";

import { type ReactElement, useEffect, useMemo, useState } from "react";

import { EmptyState } from "../components/kit";
import { binaryInfoOf } from "../engine/binaryInfo";
import { t, useLanguage } from "../i18n";
import { swiftTypes } from "../engine/swiftTypes";
import { useListWindow } from "../lib/useListWindow";
import { useLoaded } from "../lib/useLoaded";
import { useSettings } from "../settings/store";
import { onGlass, ThemeContext, useTheme } from "../theme";
import { useBench } from "./parts";
import { ResizeHandle } from "./Resize";
import { Footer, type FooterMenu } from "./sidebar/Footer";
import { FnRowView, FunctionsHead, type FnView, MatchNote } from "./sidebar/Functions";
import { hasFunctionModules, indexFunctionModules } from "./sidebar/functionModules";
import { FolderContext, type FolderState, loadFolds, saveFolds } from "./sidebar/memory";
import { functionRows, type FnShow, type FnSort, sourcePaths } from "./sidebar/model";
import { Faint, useSectionOpen } from "./sidebar/parts";
import { Blocks, InThisModel, Kernels } from "./sidebar/ModelSections";
import { Chats, FileViews, YourWork } from "./sidebar/Sections";
import { SourceFiles } from "./sidebar/SourceFiles";
import { Resources } from "./sidebar/Resources";
import { ProjectSwitcher } from "./sidebar/Top";

const FN_KEY = "fn:";

/** Binaries that register modules start grouped by module; the rest by package or file. */
function useFnView(): FnView {
  const { program } = useBench();
  const modules = useMemo(() => (hasFunctionModules(program.functions) ? indexFunctionModules(program.functions) : null), [program.functions]);
  const byDefault: FnSort = modules ? "modules" : "files";
  const [picked, setSort] = useState<FnSort | null>(null);
  const [show, setShow] = useState<FnShow>("all");
  const sort = picked === "modules" && !modules ? byDefault : (picked ?? byDefault);
  return { sort, show, byDefault, modules, setSort, setShow };
}

/** Mach-O files can hold Swift types to name files after; anything else can only have the paths in its strings. */
function mayHaveSwift(path: string): boolean {
  try {
    return binaryInfoOf(path, statSync(path).size).format === "Mach-O";
  } catch {
    return false;
  }
}

/** Whether the binary has source files to start from; null only while a Mach-O file's Swift types are still being read. */
function useHasSources(): boolean | null {
  const { program } = useBench();
  const quick = useMemo(() => (sourcePaths(program.strings.map((row) => row.b)).length > 0 ? true : mayHaveSwift(program.path) ? null : false), [program]);
  const types = useLoaded(() => (quick === null ? swiftTypes(program.path, program.arch) : Promise.resolve([])), `${program.id}:${quick}`);
  if (quick !== null) return quick;
  return types.kind === "loading" ? null : types.kind === "ready" && types.value.length > 0;
}

/**
 * Sections and folders as this project last had them. The first time, Source files leads when the binary has
 * any, and Functions opens when it doesn't; nothing is saved until that start is known.
 */
function useFolderMemory(hasSources: boolean | null): FolderState & { readonly flipped: ReadonlySet<string> } {
  const { program, wb } = useBench();
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set(loadFolds(program.id).flipped));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    setFlipped(new Set(loadFolds(program.id).flipped));
  }, [program.id]);
  useEffect(() => {
    if (hasSources === null || ready) return;
    const saved = loadFolds(program.id).closed;
    wb.patch({ navClosed: saved ?? (hasSources ? ["functions"] : []) });
    setReady(true);
  }, [program.id, hasSources, ready]);
  useEffect(() => {
    if (ready) saveFolds(program.id, { closed: wb.s.navClosed, flipped: [...flipped] });
  }, [program.id, ready, wb.s.navClosed, flipped]);
  return useMemo(() => ({
    flipped,
    isOpen: (key: string, byDefault = false) => byDefault !== flipped.has(key),
    toggle: (key: string) => {
      setFlipped((now) => {
        const next = new Set(now);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
  }), [flipped]);
}

/** The sections, then one row per function or class, so only rows near the viewport are built. */
function NavList({ view, flipped, hasSources }: { readonly view: FnView; readonly flipped: ReadonlySet<string>; readonly hasSources: boolean | null }): ReactElement {
  const { program, wb, nameOf, chat } = useBench();
  const { open } = useSectionOpen("functions");
  const language = useLanguage();
  const gpu = chat.target?.kind === "gpu";
  const noCode = chat.target?.kind === "model" || gpu;
  const fnFlipped = useMemo(() => new Set([...flipped].filter((key) => key.startsWith(FN_KEY)).map((key) => key.slice(FN_KEY.length))), [flipped]);
  const query = wb.s.filter.trim();
  const rows = useMemo(
    () => (open && !noCode ? functionRows(program.functions, { nameOf, renamed: new Set(wb.s.names.keys()), query: wb.s.filter, show: view.show, sort: view.sort, ...(view.modules ? { modules: view.modules } : {}), flipped: fnFlipped, yoursOpen: hasSources === false, bareFiles: program.bareFiles ?? [] }) : []),
    [open, noCode, program, wb.s.names, wb.s.filter, view.show, view.sort, view.modules, fnFlipped, hasSources, language],
  );
  const searching = open && !noCode && query.length > 0 && (view.sort === "files" || view.sort === "modules");
  const firstMatch = rows.find((row) => row.kind === "fn");
  const fixed = noCode
    ? gpu ? [<Chats key="threads" />, <Kernels key="kernels" />] : [<Chats key="threads" />, <InThisModel key="model" />, <Blocks key="blocks" />]
    : [<Chats key="threads" />, <YourWork key="work" />, <FileViews key="views" />, <SourceFiles key="source" />, <Resources key="resources" />, <FunctionsHead key="functions" view={view} first={firstMatch?.kind === "fn" ? firstMatch.fn.addr : null} />];
  const after = searching
    ? [<MatchNote key="note" count={rows.length} yoursFirst={view.sort === "files"} />]
    : open && !noCode && rows.length === 0 ? [program.functions.length === 0 ? <Faint key="none" text={t("workbench.side.loadingFunctions")} /> : (
      <div key="none" style={{ display: "flex", flexDirection: "column", paddingTop: 4, paddingBottom: 8 }}>
        <EmptyState title={t("workbench.side.empty.title")} hint={t("workbench.side.empty.hint")} />
      </div>
    )] : [];
  const total = fixed.length + rows.length + after.length;
  const shown = useListWindow(total);
  const itemAt = (ix: number): ReactElement | undefined => {
    if (ix < fixed.length) return <div key={`s${ix}`} style={{ display: "flex", flexDirection: "column", width: "100%" }}>{fixed[ix]}</div>;
    const row = rows[ix - fixed.length];
    if (row) return <FnRowView key={row.kind === "node" ? `n:${row.path}` : row.fn.addr} row={row} />;
    return after[ix - fixed.length - rows.length];
  };
  return (
    <virtual-list itemCount={total} windowStart={shown.start} estimatedItemHeight={28} onVisibleRange={shown.onVisibleRange} style={{ flexGrow: 1, minHeight: 0, marginTop: 8, paddingTop: 6 }}>
      {Array.from({ length: shown.end - shown.start }, (_, i) => itemAt(shown.start + i))}
    </virtual-list>
  );
}

/** The workspace sidebar on the window's glass: the project, your work, the file's views, its source files, resources and functions, then Eleven. */
export function Nav(): ReactElement {
  const { wb } = useBench();
  const theme = useTheme();
  const { settings } = useSettings();
  const glass = useMemo(() => ({ ...theme, p: onGlass(theme.p, settings.transparency) }), [theme, settings.transparency]);
  const view = useFnView();
  const hasSources = useHasSources();
  const folders = useFolderMemory(hasSources);
  const [menu, setMenu] = useState<FooterMenu>({ open: false, sub: null });
  return (
    <ThemeContext.Provider value={glass}>
      <FolderContext.Provider value={folders}>
        <div role="navigation" aria-label={t("workbench.side.workspace")} style={{ position: "relative", display: "flex", flexDirection: "column", width: wb.s.sizes.sidebar, flexShrink: 0, minHeight: 0, paddingLeft: 10, paddingRight: 10, paddingBottom: 10 }}>
          <ResizeHandle edge="sidebar" />
          <ProjectSwitcher />
          <NavList view={view} flipped={folders.flipped} hasSources={hasSources} />
          <Footer menu={menu} onMenu={setMenu} />
        </div>
      </FolderContext.Provider>
    </ThemeContext.Provider>
  );
}
