import { basename, dirname } from "node:path";

import { type ReactElement, useEffect, useMemo, useState } from "react";

import { Shimmer } from "../../chat/Conversation";
import { openMenu } from "../../components/ContextMenu";
import { Tooltip } from "../../components/kit";
import { Icon } from "../../components/ui";
import type { AgentEntry } from "../../agents/registry";
import { recreatedFiles, watchRecreated } from "../../engine/recreate";
import { swiftTypes, type SwiftType } from "../../engine/swiftTypes";
import { t } from "../../i18n";
import { errorMessage } from "../../lib/guards";
import { useLoaded } from "../../lib/useLoaded";
import { useNow } from "../../lib/useNow";
import { shellIn } from "../../terminal/shell";
import { type Palette, useTheme } from "../../theme";
import { type Arrangement, type ArrangedFile, type ArrangeStep, arrange, type FailReason, failureReason, failureText, forgetArrangement, type Placement, reasonText, savedArrangement } from "../arrange";
import { type Bench, ELLIPSIS, HOVER, MONO_STYLE, useBench } from "../parts";
import { type SourceFiles as Files, sourceFiles, traceStatic } from "../sources";
import { useFolders } from "./memory";
import { sourceTree } from "./model";
import { SideSection } from "./parts";
import { TreeCaption, TreeFile, TreeFolder, TreeMore } from "./SourceRows";

const GUESSED_SHOWN = 7;
const UNPLACED_SHOWN = 50;
const FRAME_MS = 33;
const NO_TYPES: readonly SwiftType[] = [];
const NO_FILES: ReadonlySet<string> = new Set();
type State =
  | { readonly kind: "plain" }
  | { readonly kind: "running"; readonly steps: readonly ArrangeStep[]; readonly evidence: Arrangement | null }
  | { readonly kind: "arranged"; readonly arrangement: Arrangement }
  | { readonly kind: "partial"; readonly arrangement: Arrangement; readonly agent: string; readonly reason: FailReason; readonly signedIn: boolean }
  | { readonly kind: "failed"; readonly message: string };

function placementColor(placement: Placement, p: Palette): string {
  switch (placement) {
    case "exact":
      return p.string;
    case "neighbour":
      return p.link;
    case "guess":
      return p.data;
    default: {
      const unhandled: never = placement;
      return unhandled;
    }
  }
}

function placementLabel(placement: Placement, agent: string): string {
  switch (placement) {
    case "exact":
      return t("workbench.side.placed.exact");
    case "neighbour":
      return t("workbench.side.placed.neighbour");
    case "guess":
      return t("workbench.side.placed.guess", { agent });
    default: {
      const unhandled: never = placement;
      return unhandled;
    }
  }
}

function useArrangement(files: Files, types: readonly SwiftType[]): { readonly state: State; readonly start: (agent?: AgentEntry) => void; readonly reset: () => void; readonly signIn: () => void } {
  const { program, chat, wb } = useBench();
  const [state, setState] = useState<State>({ kind: "plain" });
  useEffect(() => {
    let live = true;
    setState({ kind: "plain" });
    void (async (): Promise<void> => {
      const saved = await savedArrangement(program.id);
      if (live && saved) setState({ kind: "arranged", arrangement: saved });
    })();
    return () => {
      live = false;
    };
  }, [program.id]);
  const start = (pick?: AgentEntry): void => {
    const agent = pick ?? chat.agents.selected;
    let evidence: Arrangement | null = null;
    let steps: readonly ArrangeStep[] = [];
    setState({ kind: "running", steps, evidence });
    void (async (): Promise<void> => {
      try {
        const result = await arrange({
          ask: { agent, native: chat.agents.installed.get(agent.id)?.command ?? null, projectId: program.id, binary: { path: program.path } },
          binaryName: program.name,
          functions: program.functions,
          strings: program.strings,
          types,
          sources: files,
          onStep: (next) => {
            steps = next;
            setState({ kind: "running", steps, evidence });
          },
          onEvidence: (base) => {
            evidence = base;
            setState({ kind: "running", steps, evidence });
          },
        });
        const arrangement: Arrangement = { files: result.files, unplaced: result.unplaced };
        setState(result.agentFailed === null ? { kind: "arranged", arrangement } : { kind: "partial", arrangement, agent: agent.name, reason: failureReason(result.agentFailed), signedIn: false });
      } catch (err) {
        setState({ kind: "failed", message: errorMessage(err) });
      }
    })();
  };
  const reset = (): void => {
    void (async (): Promise<void> => {
      await forgetArrangement(program.id);
      setState({ kind: "plain" });
    })();
  };
  const signIn = (): void => {
    const agent = chat.agents.selected;
    const native = chat.agents.installed.get(agent.id)?.command ?? null;
    shellIn(dirname(program.origin)).send(`${native ? basename(native.path) : agent.id} login\n`);
    wb.reveal("terminal");
    if (state.kind === "partial") setState({ ...state, signedIn: true });
  };
  return { state, start, reset, signIn };
}

function otherAgents(bench: Bench, x: number, y: number, run: (agent: AgentEntry) => void): void {
  const { agents } = bench.chat;
  const others = agents.list.filter((agent) => agent.id !== agents.selected.id && agents.installed.has(agent.id));
  openMenu(x, y, others.length
    ? others.map((agent) => ({ kind: "action", label: agent.name, run: () => { bench.chat.pickAgent(agent.id); run(agent); } }))
    : [{ kind: "action", label: t("workbench.side.addAgent"), icon: "agent", run: () => bench.wb.reveal("agent") }]);
}

function ArrangeButton({ onClick }: { readonly onClick: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <Tooltip label={t("workbench.side.arrange.hint")}>
      <div onClick={onClick} role="button" aria-label={t("workbench.side.arrange")} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, height: 30, flexShrink: 0, marginTop: 4, marginBottom: 8, borderRadius: 8, backgroundColor: p.fill, fontSize: 12.5, color: p.text, cursor: "pointer", hover: HOVER }}>
        <Icon name="spark" size={13} color={p.data} />
        <div style={{ pointerEvents: "none" }}>{t("workbench.side.arrange")}</div>
      </div>
    </Tooltip>
  );
}

function Running({ steps }: { readonly steps: readonly ArrangeStep[] }): ReactElement {
  const { p } = useTheme();
  const now = useNow(true, FRAME_MS);
  const width = `${Math.round((steps.filter((step) => step.done).length / Math.max(steps.length, 1)) * 100)}%`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0, marginTop: 4, marginBottom: 10, padding: 10, borderRadius: 10, backgroundColor: p.well }}>
      <div style={{ fontSize: 12.5 }}><Shimmer text={t("workbench.side.arranging")} color={p.text} now={now} /></div>
      {steps.map((step) => (
        <div key={step.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: step.done ? p.muted : p.text3 }}>
          <div style={{ display: "flex", justifyContent: "center", width: 14, color: step.done ? p.string : p.text }}>{step.done ? "✓" : "•"}</div>
          <div style={{ flexGrow: 1, minWidth: 0 }}>{step.label}</div>
        </div>
      ))}
      <div style={{ height: 4, borderRadius: 2, backgroundColor: p.fill, overflow: "hidden" }}>
        <div style={{ height: 4, width, backgroundColor: p.text3 }} />
      </div>
    </div>
  );
}

type Mix = { readonly exact: number; readonly neighbour: number; readonly guess: number; readonly unplaced: number };

function mixOf(arrangement: Arrangement): Mix {
  const count = (placement: Placement): number => arrangement.files.filter((file) => file.placement === placement).reduce((sum, file) => sum + file.fns.length, 0);
  const exact = count("exact");
  const neighbour = count("neighbour");
  const guess = count("guess");
  const total = exact + neighbour + guess + arrangement.unplaced.length || 1;
  const pct = (n: number): number => Math.round((n / total) * 100);
  return { exact: pct(exact), neighbour: pct(neighbour), guess: pct(guess), unplaced: pct(arrangement.unplaced.length) };
}

function Legend({ color, text, hollow = false }: { readonly color: string; readonly text: string; readonly hollow?: boolean }): ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ width: 6, height: 6, borderRadius: 3, ...(hollow ? { borderWidth: 1, borderColor: color } : { backgroundColor: color }) }} />
      <div>{text}</div>
    </div>
  );
}

/** The bar and its legend: how much the binary placed, how much the agent guessed, and what's left. */
function MixBar({ mix, agent }: { readonly mix: Mix; readonly agent: string | null }): ReactElement {
  const { p } = useTheme();
  return (
    <>
      <div style={{ display: "flex", height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: p.fill }}>
        <div style={{ width: `${mix.exact}%`, backgroundColor: p.string }} />
        <div style={{ width: `${mix.neighbour}%`, backgroundColor: p.link }} />
        {agent !== null && <div style={{ width: `${mix.guess}%`, backgroundColor: p.data }} />}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", columnGap: 12, rowGap: 4, fontSize: 11.5, color: p.muted }}>
        <Legend color={p.string} text={t("workbench.side.mix.exact", { percent: mix.exact })} />
        <Legend color={p.link} text={t("workbench.side.mix.neighbour", { percent: mix.neighbour })} />
        {agent !== null && mix.guess > 0 && <Legend color={p.data} text={t("workbench.side.mix.guess", { percent: mix.guess })} />}
        {mix.unplaced > 0 && <Legend color={p.faint} text={t("workbench.side.mix.unplaced", { percent: mix.unplaced })} hollow />}
      </div>
    </>
  );
}

function TextLink({ label, onClick }: { readonly label: string; readonly onClick: () => void }): ReactElement {
  const { p } = useTheme();
  return <div onClick={onClick} role="button" aria-label={label} style={{ fontSize: 12, color: p.muted, cursor: "pointer", hover: HOVER }}>{label}</div>;
}

function SmallButton({ label, filled, onClick }: { readonly label: string; readonly filled: boolean; readonly onClick: (x: number, y: number) => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={(e) => onClick(e.x ?? 0, e.y ?? 0)} role="button" aria-label={label} style={{ display: "flex", alignItems: "center", height: 26, paddingLeft: 10, paddingRight: 10, borderRadius: 7, fontSize: 12, color: filled ? p.text : p.muted, cursor: "pointer", hover: HOVER, ...(filled ? { backgroundColor: p.fill2 } : {}) }}>
      <div style={{ pointerEvents: "none" }}>{label}</div>
    </div>
  );
}

function folderCount(arrangement: Arrangement): number {
  return new Set(arrangement.files.map((file) => file.path.split("/").slice(0, -1).join("/")).filter(Boolean)).size;
}

function Done({ arrangement, agent, onUndo, onAgain }: { readonly arrangement: Arrangement; readonly agent: string; readonly onUndo: () => void; readonly onAgain: () => void }): ReactElement {
  const { p } = useTheme();
  const folders = folderCount(arrangement);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, marginTop: 4, marginBottom: 8, paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 10, borderRadius: 10, backgroundColor: p.well }}>
      <div style={{ fontSize: 12, color: p.text3 }}>{folders === 1 ? t("workbench.side.arranged.oneFolder", { files: arrangement.files.length }) : t("workbench.side.arranged.folders", { files: arrangement.files.length, folders })}</div>
      <MixBar mix={mixOf(arrangement)} agent={agent} />
      <div style={{ display: "flex", gap: 10 }}>
        <TextLink label={t("workbench.side.backToPlain")} onClick={onUndo} />
        <TextLink label={t("workbench.side.arrangeAgain")} onClick={onAgain} />
      </div>
    </div>
  );
}

function Partial({ state, onRetry, onSignIn, onOther, onUndo }: {
  readonly state: Extract<State, { readonly kind: "partial" }>;
  readonly onRetry: () => void;
  readonly onSignIn: () => void;
  readonly onOther: (x: number, y: number) => void;
  readonly onUndo: () => void;
}): ReactElement {
  const { p } = useTheme();
  const { arrangement, agent, reason, signedIn } = state;
  const left = arrangement.unplaced.length;
  const signing = reason === "signin" && !signedIn;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, marginTop: 4, marginBottom: 8, paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 10, borderRadius: 10, backgroundColor: p.well }}>
      <div style={{ fontSize: 12, color: p.text3 }}>{t("workbench.side.arranged.partial", { count: arrangement.files.length })}</div>
      <div style={{ fontSize: 11.5, lineHeight: 16, color: p.muted }}>{failureText(reason, agent, left)}</div>
      <MixBar mix={mixOf(arrangement)} agent={null} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingTop: 2 }}>
        <SmallButton label={signing ? t("workbench.side.signIn") : t("workbench.side.tryAgain")} filled onClick={signing ? onSignIn : onRetry} />
        <SmallButton label={t("workbench.side.otherAgent")} filled={false} onClick={onOther} />
      </div>
      <TextLink label={t("workbench.side.backToPlain")} onClick={onUndo} />
    </div>
  );
}

function Failed({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }): ReactElement {
  const { p } = useTheme();
  const { program } = useBench();
  const [raw, setRaw] = useState(false);
  return (
    <div role="alert" style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0, marginTop: 4, marginBottom: 8, paddingTop: 9, paddingBottom: 9, paddingLeft: 10, paddingRight: 10, borderRadius: 10, borderWidth: 1, borderColor: p.errLine, backgroundColor: p.errBg }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: p.text }}>{t("workbench.side.arrange.failed")}</div>
      <div style={{ fontSize: 11.5, lineHeight: 16, color: p.text3 }}>{t("workbench.side.arrange.failedDetail", { name: program.name })}</div>
      {raw && <div style={{ marginTop: 2, paddingTop: 6, paddingBottom: 6, paddingLeft: 8, paddingRight: 8, borderRadius: 6, backgroundColor: p.well, fontSize: 11, lineHeight: 15, color: p.muted, userSelect: "text" }}>{message}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 4 }}>
        <SmallButton label={t("workbench.side.tryAgain")} filled onClick={onRetry} />
        <div onClick={() => setRaw(!raw)} role="button" aria-expanded={raw} style={{ fontSize: 12, color: p.muted, textDecoration: "underline", cursor: "pointer", hover: HOVER }}>{raw ? t("workbench.side.hideDetails") : t("workbench.side.showDetails")}</div>
      </div>
    </div>
  );
}

function useRecreatedFiles(projectId: string): ReadonlySet<string> {
  const [version, setVersion] = useState(0);
  useEffect(() => watchRecreated(() => setVersion((n) => n + 1)), []);
  const files = useLoaded(() => recreatedFiles(projectId), `${projectId}:${version}`);
  return files.kind === "ready" ? files.value : NO_FILES;
}

function parentOf(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

/** The tree's closed folders: each starts closed unless it's alone at its level, and a click flips that. */
function closedFolders(paths: readonly string[], isOpen: (key: string, byDefault: boolean) => boolean, prefix: string): ReadonlySet<string> {
  const nodes = sourceTree(paths, new Set());
  const siblings = new Map<string, number>();
  for (const node of nodes) siblings.set(parentOf(node.path), (siblings.get(parentOf(node.path)) ?? 0) + 1);
  return new Set(nodes.filter((node) => node.folder && !isOpen(`${prefix}${node.path}`, siblings.get(parentOf(node.path)) === 1)).map((node) => node.path));
}

function useFileRow(): (file: string, name: string, depth: number, ext: string, opts: { readonly count: string; readonly dim?: boolean; readonly italic?: boolean; readonly mark?: ReactElement | null; readonly why?: string | null }) => ReactElement {
  const { program, wb } = useBench();
  const recreated = useRecreatedFiles(program.id);
  const pane = wb.s.panes[wb.s.focus];
  const tab = pane?.tabs[pane.active];
  return (file, name, depth, ext, opts) => (
    <TreeFile key={file} name={name} ext={ext} depth={depth} count={opts.count} on={tab?.kind === "source" && tab.file === file} dim={opts.dim ?? false} italic={opts.italic ?? false} recreated={recreated.has(file)} mark={opts.mark ?? null}
      onClick={() => wb.open({ kind: "source", file }, true)}
      menu={() => [
        { kind: "action", label: t("workbench.side.open"), icon: "source", run: () => wb.open({ kind: "source", file }, false) },
        { kind: "action", label: t("workbench.side.openInSplit"), icon: "split", run: () => wb.openSplit({ kind: "source", file }) },
        ...(opts.why ? [{ kind: "action" as const, label: t("workbench.side.why"), icon: "info", run: () => wb.notify(opts.why ?? "", null) }] : []),
      ]} />
  );
}

/** The paths the binary names, the files guessed from its types, then the Swift library's own files folded away. */
function PlainList({ files, counts }: { readonly files: Files; readonly counts: ReadonlyMap<string, string> }): ReactElement {
  const folders = useFolders();
  const fileRow = useFileRow();
  const [more, setMore] = useState(false);
  const closed = useMemo(() => closedFolders(files.paths, folders.isOpen, "src:"), [files, folders]);
  const tree = useMemo(() => sourceTree(files.paths, closed), [files, closed]);
  const guessed = more ? files.guessed : files.guessed.slice(0, GUESSED_SHOWN);
  const library = folders.isOpen("src:#library");
  return (
    <>
      {files.paths.length > 0 && <TreeCaption text={t("workbench.side.fromPaths")} first />}
      {tree.map((node) => node.folder
        ? <TreeFolder key={node.path} name={node.name} open={!closed.has(node.path)} depth={node.depth} onClick={() => folders.toggle(`src:${node.path}`)} />
        : fileRow(node.full, node.name, node.depth, node.ext, { count: counts.get(node.full) ?? "" }))}
      {files.guessed.length > 0 && <TreeCaption text={t("workbench.side.fromTypes")} first={files.paths.length === 0} />}
      {guessed.map((g) => fileRow(g.file, g.file, -1, "swift", { count: counts.get(g.file) ?? "", dim: true }))}
      {files.guessed.length > GUESSED_SHOWN && <TreeMore label={more ? t("workbench.side.showFewer") : t("workbench.side.more", { count: files.guessed.length - GUESSED_SHOWN })} onClick={() => setMore(!more)} />}
      {files.library.length > 0 && (
        <>
          <TreeCaption text="" first={false} />
          <TreeFolder name={t("workbench.side.swiftLibrary")} open={library} depth={0} count={String(files.library.length)} faint onClick={() => folders.toggle("src:#library")} />
          {library && files.library.map((path) => fileRow(path, path.split("/").pop() ?? path, 0, "swift", { count: "", dim: true }))}
        </>
      )}
    </>
  );
}

/** The arranged project: folders as the app had them, each file marked by how it got there, then what's left unplaced. */
function ArrangedTree({ arrangement, agent }: { readonly arrangement: Arrangement; readonly agent: string }): ReactElement {
  const { p } = useTheme();
  const { openFn, nameOf } = useBench();
  const folders = useFolders();
  const fileRow = useFileRow();
  const byPath = useMemo(() => new Map(arrangement.files.map((file) => [file.path, file])), [arrangement]);
  const paths = useMemo(() => arrangement.files.map((file) => file.path), [arrangement]);
  const closed = useMemo(() => closedFolders(paths, folders.isOpen, "arr:"), [paths, folders]);
  const tree = useMemo(() => sourceTree(paths, closed), [paths, closed]);
  const unplacedOpen = folders.isOpen("arr:#unplaced");
  const mark = (file: ArrangedFile): ReactElement => {
    const label = placementLabel(file.placement, agent);
    return (
      <Tooltip label={t("workbench.side.placedWhy", { how: label, reason: reasonText(file.reason) })}>
        <div aria-label={label} style={{ width: 6, height: 6, flexShrink: 0, borderRadius: 3, backgroundColor: placementColor(file.placement, p) }} />
      </Tooltip>
    );
  };
  return (
    <>
      {tree.map((node) => {
        if (node.folder) return <TreeFolder key={node.path} name={node.name} open={!closed.has(node.path)} depth={node.depth} onClick={() => folders.toggle(`arr:${node.path}`)} />;
        const file = byPath.get(node.full);
        return file ? fileRow(file.key, node.name, node.depth, node.ext, { count: String(file.fns.length), italic: file.placement === "guess", mark: mark(file), why: t("workbench.side.placedWhy", { how: placementLabel(file.placement, agent), reason: reasonText(file.reason) }) }) : null;
      })}
      {arrangement.unplaced.length > 0 && <TreeFolder name={t("workbench.side.notPlaced")} open={unplacedOpen} depth={0} count={arrangement.unplaced.length.toLocaleString()} faint onClick={() => folders.toggle("arr:#unplaced")} />}
      {unplacedOpen && arrangement.unplaced.slice(0, UNPLACED_SHOWN).map((addr) => (
        <div key={addr} onClick={() => openFn(addr, true)} role="treeitem" aria-label={t("workbench.side.functionNamed", { name: nameOf(addr) })} style={{ display: "flex", alignItems: "center", gap: 8, height: 24, flexShrink: 0, paddingLeft: 38, paddingRight: 8, borderRadius: 6, cursor: "pointer", hover: HOVER }}>
          <Icon name="function" size={12} color={p.link} />
          <div style={{ flexGrow: 1, minWidth: 0, fontSize: 12, color: p.text3, pointerEvents: "none", ...MONO_STYLE, ...ELLIPSIS }}>{nameOf(addr)}</div>
        </div>
      ))}
    </>
  );
}

/** The files the binary was built from: the paths its compiler left behind, files guessed from its Swift types, or the project as it was arranged. */
export function SourceFiles(): ReactElement | null {
  const bench = useBench();
  const { program, chat } = bench;
  const types = useLoaded(() => swiftTypes(program.path, program.arch), program.id);
  const swift = types.kind === "ready" ? types.value : NO_TYPES;
  const files = useMemo(() => sourceFiles(program.strings.map((row) => row.b), swift), [program, swift]);
  const counts = useMemo(() => {
    const count = (file: string, guessed: boolean): string => {
      const n = traceStatic(file, guessed, swift, program.functions, []).fns.length;
      return n ? String(n) : "";
    };
    return new Map([...files.paths.map((path) => [path, count(path, false)] as const), ...files.guessed.map((g) => [g.file, count(g.file, true)] as const)]);
  }, [files, program, swift]);
  const { state, start, reset, signIn } = useArrangement(files, swift);
  const total = files.paths.length + files.guessed.length;
  if (total + files.library.length === 0) return null;
  const agent = chat.agents.selected.name;
  const shown = state.kind === "arranged" || state.kind === "partial" ? state.arrangement.files.length : total;
  return (
    <SideSection id="source" title={t("workbench.side.sourceFiles")} count={shown === 1 ? t("workbench.side.oneFile") : t("workbench.side.files", { count: shown })}>
      {(() => {
        switch (state.kind) {
          case "plain":
            return <><ArrangeButton onClick={() => start()} /><PlainList files={files} counts={counts} /></>;
          case "running":
            return <><Running steps={state.steps} />{state.evidence && <ArrangedTree arrangement={state.evidence} agent={agent} />}</>;
          case "failed":
            return <><Failed message={state.message} onRetry={() => start()} /><PlainList files={files} counts={counts} /></>;
          case "arranged":
            return <><Done arrangement={state.arrangement} agent={agent} onUndo={reset} onAgain={() => start()} /><ArrangedTree arrangement={state.arrangement} agent={agent} /></>;
          case "partial":
            return <><Partial state={state} onRetry={() => start()} onSignIn={signIn} onOther={(x, y) => otherAgents(bench, x, y, start)} onUndo={reset} /><ArrangedTree arrangement={state.arrangement} agent={state.agent} /></>;
          default: {
            const unhandled: never = state;
            return unhandled;
          }
        }
      })()}
    </SideSection>
  );
}
