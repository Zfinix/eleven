import { useGpuix, useWindowSize } from "@gpuix/react";
import { Fragment, type ReactElement, useEffect, useMemo, useRef, useState } from "react";

import { onEngineChange } from "../analysis/engines";
import { LiveSource } from "../gpu/live";
import type { GpuSource } from "../gpu/source";
import { type GpuData, useGpuData } from "../gpu/useGpu";
import type { Chat } from "../chat/useChat";
import type { Loaded } from "../lib/useLoaded";
import { useCommand } from "../lib/shortcuts";
import { t } from "../i18n";
import { useSize } from "../lib/useSize";
import { useAgentView } from "./useAgentView";
import { useDocument, useOpenInWorkbench } from "./useDocument";
import { describeEdit, type Edit, YOU } from "../engine/edits";
import { redo, undo } from "../engine/history";
import { loadProject, onProjectChange, updateProject } from "../engine/project";
import { type CodeType, isCodeType, withTypes } from "../engine/codeTypes";
import { setValue } from "../engine/edits";
import { SerialQueue } from "../lib/serial";
import { errorMessage } from "../lib/guards";
import { type OpenProblem, openProblem } from "../engine/rea";
import { Shell } from "../Shell";
import { Toast } from "../components/Toast";
import { prepareTarget, type Target } from "../engine/target";
import { CommentBar, LabelBar, OpeningProgress, UndoToast, useSubjectCommands } from "./Annotate";
import { PatchBar, RenameBar } from "./Details";
import { loadDocks, saveDocks } from "./dockOrder";
import { BottomDock } from "./Tools";
import { Dock } from "./Dock";
import { Header } from "./Header";
import type { Program, Tab } from "./model";
import { MenuActions } from "./MenuActions";
import { Nav } from "./Nav";
import { Pane } from "./Pane";
import { Palette } from "./Palette";
import { type Bench, BenchContext, useBench } from "./parts";
import { MIN_PANE, PaneDivider, ResizeOverlay } from "./Resize";
import { loadProgram, openProgram } from "./program";
import { across, type PaneTree, type TreePath } from "./paneTree";
import { fromProject, initialPanes, useWorkbenchState, type Workbench as WorkbenchState } from "./state";
import { StatusBar } from "./StatusBar";
import { currentSettings } from "../settings/store";
import { DEFAULT_SIZES, onLayoutReset } from "./sizes";
import { loadThreadTabs, saveThreadTabs } from "./threadTabs";
import { SliceOverlay } from "../welcome/SliceDialog";
import { tell } from "../notify/notify";
import { openAsk } from "./ask/place";
import { pickToOpen } from "../lib/pick";

/** The window's own margins around the editor card. */
const EDGES = 24;

type Opening = { readonly program: Program; readonly problem: OpenProblem | null; readonly since: number | null };

const NOTHING_YET = (): Promise<never> => Promise.reject(new Error(t("workbench.chrome.stillOpening")));

function pendingProgram(target: Target): Program {
  return {
    id: "", path: target.path, origin: target.original, name: target.name, arch: target.arch, total: 0,
    functions: [], strings: [], imports: [], segments: [], evidence: "", engine: "Eleven",
    log: () => [], code: NOTHING_YET, refs: NOTHING_YET, dossier: null, hex: NOTHING_YET, focusLine: () => -1, retype: null,
  };
}

function hasCode(target: Target): boolean {
  return target.kind !== "gpu" && target.kind !== "model";
}

/** Opens faster than this are over before you could have switched away. */
const READY_NOTICE_MS = 8000;

function useProgram(target: Target): Opening {
  const [opening, setOpening] = useState<Opening>(() => ({ program: pendingProgram(target), problem: null, since: hasCode(target) ? Date.now() : null }));
  const [engine, setEngine] = useState(0);
  useEffect(() => onEngineChange(() => setEngine((n) => n + 1)), []);
  useEffect(() => {
    if (!hasCode(target)) return;
    if (engine > 0) setOpening({ program: pendingProgram(target), problem: null, since: Date.now() });
    let live = true;
    const started = Date.now();
    const slow = (): boolean => live && Date.now() - started >= READY_NOTICE_MS;
    const open = async (): Promise<void> => {
      const { first, full } = openProgram(target);
      let shown = pendingProgram(target);
      try {
        shown = await first;
        if (live) setOpening({ program: shown, problem: null, since: null });
        const program = shown.preview ? await full : shown;
        if (slow()) void tell({ kind: "opened", project: program.id, name: program.name, engine: program.engine, functions: program.functions.length }, { open: () => undefined });
        if (live) setOpening({ program, problem: null, since: null });
      } catch (err) {
        const problem = openProblem(err);
        if (slow()) void tell({ kind: "openFailed", name: target.name, advice: problem.advice }, { open: () => undefined });
        if (live) setOpening({ program: shown, problem, since: null });
      }
    };
    void open();
    return () => {
      live = false;
    };
  }, [target, engine]);
  return opening;
}

/** Each thread keeps the tabs that were open with it, so switching threads swaps them back in. */
function useThreadTabs(wb: WorkbenchState, threadId: string, started: boolean, program: Program): void {
  const owner = useRef<string | null>(null);
  const arriving = useRef<string | null>(null);
  useEffect(() => {
    owner.current = null;
    arriving.current = threadId;
    const saved = loadThreadTabs(threadId);
    if (saved && currentSettings().restoreLayout) wb.showTabs(saved);
  }, [threadId, program]);
  useEffect(() => {
    if (arriving.current) {
      owner.current = arriving.current;
      arriving.current = null;
      return;
    }
    if (owner.current && started) saveThreadTabs(owner.current, wb.s.panes, wb.s.tree, wb.s.focus);
  }, [wb.s.panes, wb.s.tree, wb.s.focus, threadId, started]);
}

function useWorkbenchCommands(wb: WorkbenchState, tab: Tab | undefined): void {
  const view = tab?.kind === "fn" ? tab.view : null;
  const search = (): void => wb.patch({ paletteOpen: true, paletteQuery: "" });
  useCommand("palette", search);
  useCommand("goto", search);
  useCommand("back", wb.back);
  useCommand("forward", wb.forward);
  useCommand("graph", () => view && wb.setView(wb.s.focus, view === "graph" ? "pseudo" : "graph"));
  useCommand("pseudo", () => view && wb.setView(wb.s.focus, "pseudo"));
  useCommand("strings", () => wb.open({ kind: "list", list: "strings" }, false));
  useCommand("split", () => wb.split(wb.s.focus));
  useCommand("splitDown", () => wb.split(wb.s.focus, "bottom"));
  useCommand("agent", () => {
    if (!openAsk(wb, null)) wb.toggleTool("agent");
  });
  useCommand("terminal", () => wb.toggleTool("terminal"));
  useCommand("details", () => wb.patch({ bottomOpen: !wb.s.bottomOpen }));
}

function codeType(value: string | undefined): CodeType | null {
  return isCodeType(value) ? value : null;
}

/** Hands every type change in the project (yours, undo, redo) to the engine, then has open views read the code again. */
function useRetyping(program: Program, wb: WorkbenchState): void {
  useEffect(() => {
    const retype = program.retype;
    if (!retype || !program.id) return;
    const queue = new SerialQueue();
    let applied = loadProject(program.id).types;
    return onProjectChange((id) => {
      if (id !== program.id) return;
      const before = applied;
      const after = loadProject(id).types;
      const changed = [...new Set([...before.keys(), ...after.keys()])].filter((addr) => before.get(addr) !== after.get(addr));
      applied = after;
      if (changed.length === 0) return;
      void queue.run(async () => {
        for (const addr of changed) {
          try {
            await retype(addr, codeType(after.get(addr)), codeType(before.get(addr)));
          } catch (err) {
            const was = before.get(addr) ?? null;
            const kept = new Map(applied);
            if (was === null) kept.delete(addr);
            else kept.set(addr, was);
            applied = kept;
            updateProject(program.id, (project) => setValue(project, "types", addr, was), null);
            wb.notify(t("workbench.chrome.changeFailed", { addr, error: errorMessage(err) }), null);
          }
        }
        wb.reread();
      });
    });
  }, [program]);
}

function useBenchValue(program: Program, onBack: () => void, openTarget: (target: Target) => void, chat: Chat, gpu: GpuSource, gpuData: Loaded<GpuData>, refreshGpu: () => void): Bench {
  const wb = useWorkbenchState(initialPanes(program), loadDocks());
  const { s } = wb;
  const { renderer } = useGpuix();
  const [compare, setCompare] = useState<Program | null>(null);
  const loading = useRef(false);
  const openCompare = (): void => {
    wb.patch({ paletteOpen: false });
    void (async (): Promise<void> => {
      try {
        const first = await pickToOpen(renderer, t("workbench.chrome.compareWith"));
        if (!first) return;
        const loaded = await loadProgram(prepareTarget(first));
        setCompare(loaded);
        wb.open({ kind: "diff" }, false);
      } catch (err) {
        chat.thread.note(t("workbench.chrome.compareFailed", { error: errorMessage(err) }));
      }
    })();
  };
  useEffect(() => {
    if (program.functions.length === 0) return;
    setCompare(null);
    wb.reset(initialPanes(program));
    wb.restore(loadProject(program.id));
    loading.current = true;
  }, [program]);
  useEffect(() => {
    if (loading.current) {
      loading.current = false;
      return;
    }
    const mine = <T extends object>(local: T, saved: T): T => (fromProject(local) ? saved : local);
    if (program.functions.length > 0) updateProject(program.id, (project) => ({ ...project, names: mine(s.names, project.names), bookmarks: mine(s.bookmarks, project.bookmarks), notes: mine(s.notes, project.notes), comments: mine(s.comments, project.comments), colors: mine(s.colors, project.colors), groups: mine(s.groups, project.groups), breakpoints: mine(s.breakpoints, project.breakpoints) }), YOU);
  }, [s.names, s.bookmarks, s.notes, s.comments, s.colors, s.groups, s.breakpoints]);
  useThreadTabs(wb, chat.thread.id, chat.thread.state.messages.length > 0, program);
  useEffect(() => onLayoutReset(() => wb.patch({ sizes: DEFAULT_SIZES })), []);
  useEffect(() => saveDocks(s.docks), [s.docks]);
  const pane = s.panes[s.focus] ?? s.panes[0];
  const tab = pane?.tabs[pane.active];
  const fallback = program.functions[0]?.addr ?? "";
  const focusAddr = tab?.kind === "fn" ? tab.addr : (program.functions.find((f) => f.name === "entry")?.addr ?? fallback);
  useRetyping(program, wb);
  const functions = useMemo(() => withTypes(program.functions, s.types), [program, s.types]);
  const shown = useMemo(() => (functions === program.functions ? program : { ...program, functions }), [program, functions]);
  const byAddr = useMemo(() => new Map(functions.map((f) => [f.addr, f.name])), [functions]);
  const byName = useMemo(() => new Map(functions.map((f) => [f.name, f.addr])), [functions]);
  const renamed = useMemo(() => new Map([...s.names].map(([addr, name]) => [name, addr])), [s.names]);
  const nameOf = (addr: string): string => s.names.get(addr) ?? byAddr.get(addr) ?? addr;
  const addrOf = (name: string): string | null => (byAddr.has(name) ? name : (byName.get(name) ?? renamed.get(name) ?? null));
  useAgentView(program, wb, tab, focusAddr, nameOf(focusAddr));
  useWorkbenchCommands(wb, tab);
  const step = (run: (id: string) => Edit | null, done: (edit: string) => string, none: string): void => {
    try {
      const edit = run(program.id);
      wb.notify(edit ? done(describeEdit(edit, nameOf, (addr) => byAddr.get(addr) ?? addr)) : none, null);
    } catch (err) {
      wb.notify(errorMessage(err), null);
    }
  };
  useCommand("undo", () => step((id) => undo(id), (edit) => t("workbench.chrome.undid", { edit }), t("workbench.chrome.nothingToUndo")));
  useCommand("redo", () => step((id) => redo(id), (edit) => t("workbench.chrome.redid", { edit }), t("workbench.chrome.nothingToRedo")));
  const agentTab = chat.thread.state.tabs[chat.thread.state.active]?.procedure ?? null;
  useEffect(() => {
    const addr = agentTab ? addrOf(agentTab) : null;
    if (addr) wb.open({ kind: "fn", addr }, false);
  }, [agentTab, chat.thread.state.opened, program]);
  return {
    program: shown, compare, openCompare, wb, nameOf, addrOf, focusAddr, onBack, openTarget,
    openFn: (addr, preview) => {
      if (functions.some((f) => f.addr === addr)) wb.open({ kind: "fn", addr }, preview);
    },
    agentName: chat.agents.selected.name,
    agentColor: "",
    chat,
    gpu,
    gpuData,
    refreshGpu,
  };
}

/** One node of the pane tree: a pane, or its children in a row or column with a draggable divider between each pair. */
function PaneNode({ tree, path }: { readonly tree: PaneTree; readonly path: TreePath }): ReactElement {
  const { ref, width, height } = useSize();
  if (tree.kind === "pane") return <Pane index={tree.pane} />;
  const vertical = tree.dir === "column";
  return (
    <div ref={ref} style={{ display: "flex", flexDirection: tree.dir, flexGrow: 1, minWidth: 0, minHeight: 0 }}>
      {tree.children.map((child, ix) => (
        <Fragment key={ix}>
          {ix > 0 && <PaneDivider path={path} index={ix - 1} vertical={vertical} length={vertical ? height : width} />}
          <div style={{ display: "flex", flexGrow: tree.weights[ix] ?? 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0 }}>
            <PaneNode tree={child} path={[...path, ix]} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function PaneRow(): ReactElement {
  const { wb } = useBench();
  return (
    <div style={{ display: "flex", flexGrow: 1, minWidth: 0, minHeight: 0 }}>
      <PaneNode tree={wb.s.tree} path={[]} />
    </div>
  );
}

function Editor({ problem, since }: { readonly problem: OpenProblem | null; readonly since: number | null }): ReactElement {
  const { wb } = useBench();
  const { s } = wb;
  const focusTab = s.panes[s.focus]?.tabs[s.panes[s.focus]?.active ?? 0];
  const codeTab = focusTab?.kind === "fn";
  const [dismissed, setDismissed] = useState<string | null>(null);
  useSubjectCommands();
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, fontSize: 13, lineHeight: 18.85 }}>
      <Header />
      <div style={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
          <div style={{ position: "relative", display: "flex", flexGrow: 1, minHeight: 0 }}>
            <PaneRow />
            {since !== null && <OpeningProgress since={since} />}
          </div>
          {s.renaming && codeTab && <RenameBar addr={s.renaming} />}
          {s.patching && codeTab && <PatchBar addr={s.patching} />}
          {s.commenting && codeTab && <CommentBar addr={s.commenting} />}
          {s.labelling && codeTab && <LabelBar fn={s.labelling.fn} start={s.labelling.start} />}
          {s.bottomOpen && s.docks.bottom.length > 0 && <BottomDock />}
        </div>
        {s.rightOpen && s.docks.right.length > 0 && <Dock />}
      </div>
      <StatusBar />
      {problem && problem.raw !== dismissed && <Toast title={t("workbench.chrome.readFailed")} detail={problem.advice} raw={problem.raw} onClose={() => setDismissed(problem.raw)} />}
      <UndoToast />
      {s.paletteOpen && <Palette />}
      <SliceOverlay />
      <MenuActions />
    </div>
  );
}

/** Folds the sidebar when the window is too narrow for the panes, and unfolds it once there is room; the agent panel never folds. */
function useFitPanels(wb: WorkbenchState): void {
  const { width } = useWindowSize();
  const folded = useRef(false);
  const { s } = wb;
  useEffect(() => {
    if (width <= 0) return;
    const room = width - s.sizes.sidebar - (s.rightOpen && s.docks.right.length > 0 ? s.sizes.dock : 0);
    const wanted = s.sidebarOpen || folded.current;
    const show = wanted && room >= across(s.tree) * MIN_PANE + EDGES;
    folded.current = wanted && !show;
    if (show !== s.sidebarOpen) wb.patch({ sidebarOpen: show });
  }, [width, s.tree, s.rightOpen, s.docks]);
}

/** A shader library or model opened on its own has no functions, so its first shader or model opens instead. */
function useOpenFirstGpuItem(bench: Bench, code: boolean): void {
  const { gpuData, wb } = bench;
  useEffect(() => {
    if (code || gpuData.kind !== "ready") return;
    const lib = gpuData.value.libraries[0];
    const fn = lib?.functions[0];
    const model = gpuData.value.models[0];
    if (lib && fn) wb.open({ kind: "shader", library: lib.name, name: fn.name }, false);
    else if (model) wb.open({ kind: "model", name: model.name }, false);
  }, [gpuData.kind, code]);
}

/** The full workbench: explorer, tabbed editors with splits, details and agent docks. */
export function Workbench({ target, chat, onBack, onOpen }: { readonly target: Target; readonly chat: Chat; readonly onBack: () => void; readonly onOpen: (target: Target) => void }): ReactElement {
  const { program, problem, since } = useProgram(target);
  const gpu = useMemo<GpuSource>(() => new LiveSource(target), [target]);
  return <WorkbenchView program={program} problem={problem} since={since} code={hasCode(target)} gpu={gpu} chat={chat} onBack={onBack} onOpen={onOpen} />;
}

/** The workbench around a program that is already loaded, or still opening. */
export function WorkbenchView({ program, problem, since, code, gpu, chat, onBack, onOpen }: {
  readonly program: Program;
  readonly problem: OpenProblem | null;
  readonly since: number | null;
  readonly code: boolean;
  readonly gpu: GpuSource;
  readonly chat: Chat;
  readonly onBack: () => void;
  readonly onOpen: (target: Target) => void;
}): ReactElement {
  const [generation, setGeneration] = useState(0);
  const gpuData = useGpuData(gpu, `${program.origin}:${generation}`);
  const bench = useBenchValue(program, onBack, onOpen, chat, gpu, gpuData, () => setGeneration((n) => n + 1));
  useOpenFirstGpuItem(bench, code);
  useFitPanels(bench.wb);
  useDocument(bench);
  const openPath = useOpenInWorkbench(bench);
  const nav = bench.wb.s.sidebarOpen ? <Nav /> : null;
  return (
    <BenchContext.Provider value={bench}>
      <div style={{ position: "relative", display: "flex", width: "100%", height: "100%" }}>
        <Shell side={nav ? <div style={{ display: "flex", fontSize: 13, lineHeight: 18.85 }}>{nav}</div> : null} onDrop={(e) => e.paths?.[0] && openPath(e.paths[0])}>
          <Editor problem={problem} since={since} />
        </Shell>
        <ResizeOverlay />
      </div>
    </BenchContext.Provider>
  );
}
