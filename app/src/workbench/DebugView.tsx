import { useCommand } from "../lib/shortcuts";
import { type ReactElement, useEffect, useRef, useState } from "react";

import { scrollbar, useTheme } from "../theme";
import { type Debug, type DebugProblem, useDebug, type DebugStatus, type LoadedScope, type OutputLine } from "../debug/useDebug";
import type { StackFrame, Thread, Variable } from "../debug/dap";
import { ask } from "./actions";
import { claimDebugStart } from "../debug/live";
import { TYPING } from "../lib/shortcuts";
import { useSettings } from "../settings/store";
import { type PlainId, t } from "../i18n";
import { Dot } from "../components/ui";
import { HOVER, IconButton, MONO_STYLE, SegItem, TextButton, useBench } from "./parts";

type Stopped = Extract<DebugStatus, { kind: "stopped" }>;

type Page = "stack" | "threads" | "registers" | "breakpoints" | "output";

const PAGES: readonly { readonly page: Page; readonly label: PlainId }[] = [
  { page: "stack", label: "debug.page.stack" },
  { page: "threads", label: "debug.page.threads" },
  { page: "registers", label: "debug.page.registers" },
  { page: "breakpoints", label: "debug.page.breakpoints" },
  { page: "output", label: "debug.page.output" },
];

const PROBLEM: Readonly<Record<DebugProblem, PlainId>> = { noDebugger: "debug.problem.noDebugger", protected: "debug.problem.protected" };

function useVarLimit(): number {
  return Number(useSettings().settings.variableLimit.replace(",", ""));
}

function isRegisters(scope: LoadedScope): boolean {
  return /register/i.test(scope.name);
}

function owner(functions: readonly { readonly addr: string }[], addr: string): string | null {
  const at = BigInt(addr);
  let best: { readonly addr: string; readonly at: bigint } | null = null;
  for (const fn of functions) {
    const start = BigInt(fn.addr);
    if (start <= at && (!best || start > best.at)) best = { addr: fn.addr, at: start };
  }
  return best?.addr ?? null;
}

function Heading({ text }: { readonly text: string }): ReactElement {
  const { p } = useTheme();
  return <div style={{ fontSize: 11.5, color: p.muted, marginBottom: 2 }}>{text}</div>;
}

function Frames({ frames }: { readonly frames: readonly StackFrame[] }): ReactElement {
  const { p } = useTheme();
  const { program, openFn } = useBench();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Heading text={t("debug.callStack")} />
      {frames.length === 0 && <div style={{ color: p.muted }}>{t("debug.noFrames")}</div>}
      {frames.map((frame, ix) => {
        const fn = frame.pc ? owner(program.functions, frame.pc) : null;
        return (
          <div key={frame.id} onClick={() => fn && openFn(fn, false)} style={{ display: "flex", gap: 10, fontSize: 12, ...(fn ? { cursor: "pointer", hover: HOVER } : {}), ...MONO_STYLE }}>
            <div style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: ix === 0 ? p.text : p.text3 }}>{frame.name || "??"}</div>
            <div style={{ flexShrink: 0, color: p.faint }}>{frame.pc ?? (frame.line > 0 ? `:${frame.line}` : "")}</div>
          </div>
        );
      })}
    </div>
  );
}

function VarRow({ v, load, depth }: { readonly v: Variable; readonly load: (reference: number) => Promise<readonly Variable[]>; readonly depth: number }): ReactElement {
  const { p } = useTheme();
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<readonly Variable[] | null>(null);
  const limit = useVarLimit();
  const expandable = v.reference > 0;
  const toggle = (): void => {
    if (!expandable) return;
    if (children === null) void (async (): Promise<void> => setChildren((await load(v.reference)).slice(0, limit)))();
    setOpen((was) => !was);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div onClick={toggle} style={{ display: "flex", userSelect: "text", gap: 8, fontSize: 12, paddingLeft: depth * 14, ...(expandable ? { cursor: "pointer", hover: HOVER } : {}), ...MONO_STYLE }}>
        <div style={{ flexShrink: 0, width: 10, color: p.muted }}>{expandable ? (open ? "▾" : "▸") : ""}</div>
        <div style={{ flexShrink: 0, color: p.text }}>{v.name}</div>
        <div style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: p.string }}>{v.value}</div>
      </div>
      {open && children?.map((child, ix) => <VarRow key={`${child.name}:${ix}`} v={child} load={load} depth={depth + 1} />)}
    </div>
  );
}

function Scopes({ scopes, load }: { readonly scopes: readonly LoadedScope[]; readonly load: (reference: number) => Promise<readonly Variable[]> }): ReactElement {
  const { p } = useTheme();
  const limit = useVarLimit();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {scopes.length === 0 && <div style={{ color: p.muted }}>{t("debug.nothingHere")}</div>}
      {scopes.map((scope) => (
        <div key={scope.name} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Heading text={scope.name} />
          {scope.vars.length === 0 && <div style={{ color: p.muted }}>{t("debug.nothingHere")}</div>}
          {scope.vars.slice(0, limit).map((v, ix) => <VarRow key={`${v.name}:${ix}`} v={v} load={load} depth={0} />)}
          {scope.vars.length > limit && <div style={{ fontSize: 11.5, color: p.faint }}>{t("debug.more", { count: (scope.vars.length - limit).toLocaleString() })}</div>}
        </div>
      ))}
    </div>
  );
}

function Threads({ threads, current }: { readonly threads: readonly Thread[]; readonly current: number }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {threads.length === 0 && <div style={{ color: p.muted }}>{t("debug.noThreads")}</div>}
      {threads.map((thread) => (
        <div key={thread.id} style={{ display: "flex", gap: 10, fontSize: 12, ...MONO_STYLE }}>
          <div style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: thread.id === current ? p.text : p.text3 }}>{thread.name}</div>
          <div style={{ flexShrink: 0, color: p.faint }}>{thread.id === current ? t("debug.stoppedHere") : ""}</div>
        </div>
      ))}
    </div>
  );
}

function Output({ lines }: { readonly lines: readonly OutputLine[] }): ReactElement {
  const { p } = useTheme();
  const color = (line: OutputLine): string => {
    switch (line.kind) {
      case "program":
        return p.text2;
      case "error":
        return p.error;
      case "asked":
        return p.muted;
      case "answer":
        return p.string;
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", userSelect: "text", fontSize: 12, ...MONO_STYLE }}>
      {lines.length === 0 && <div style={{ color: p.muted }}>{t("debug.noOutput")}</div>}
      {lines.map((line, ix) => <div key={ix} style={{ color: color(line) }}>{line.kind === "asked" ? `› ${line.text}` : line.text}</div>)}
    </div>
  );
}

function Breakpoints(): ReactElement {
  const { p } = useTheme();
  const { program, nameOf, openFn, wb } = useBench();
  const addrs = [...wb.s.breakpoints.keys()];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Heading text={t("debug.breakpoints.saved")} />
      {addrs.length === 0 && <div style={{ color: p.muted }}>{t("debug.breakpoints.none")}</div>}
      {addrs.map((addr) => {
        const fn = owner(program.functions, addr);
        return (
          <div key={addr} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, ...MONO_STYLE }}>
            <div onClick={() => fn && openFn(fn, false)} style={{ display: "flex", alignItems: "center", flexGrow: 1, minWidth: 0, gap: 10, cursor: "pointer", hover: HOVER }}>
              <Dot color={p.error} size={8} />
              <div style={{ flexShrink: 0, color: p.text }}>{addr}</div>
              <div style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: p.faint }}>{fn ? nameOf(fn) : ""}</div>
            </div>
            <IconButton icon="close" label={t("debug.breakpoints.remove")} size={22} iconSize={10} onClick={() => wb.toggleBreakpoint(addr)} />
          </div>
        );
      })}
    </div>
  );
}

function Toolbar({ debug, onAsk }: { readonly debug: Debug; readonly onAsk: (() => void) | null }): ReactElement {
  const { p } = useTheme();
  const { status } = debug;
  const stopped = status.kind === "stopped";
  const live = stopped || status.kind === "running";
  const step = stopped ? p.link : p.faint;
  const noop = (): void => undefined;
  return (
    <div role="toolbar" aria-label={t("debug.controls")} style={{ display: "flex", alignItems: "center", alignSelf: "flex-start", gap: 2, padding: 3, borderRadius: 10, backgroundColor: p.fill }}>
      {stopped
        ? <IconButton icon="debug-continue" label={t("debug.continue")} color={p.link} onClick={debug.cont} />
        : <IconButton icon="debug-pause" label={t("debug.pause")} color={status.kind === "running" ? p.link : p.faint} onClick={debug.pause} />}
      <div style={{ width: 8 }} />
      <IconButton icon="debug-step-over" label={t("debug.stepOver")} color={step} onClick={stopped ? debug.stepOver : noop} />
      <IconButton icon="debug-step-into" label={t("debug.stepInto")} color={step} onClick={stopped ? debug.stepIn : noop} />
      <IconButton icon="debug-step-out" label={t("debug.stepOut")} color={step} onClick={stopped ? debug.stepOut : noop} />
      <IconButton icon="debug-step-instruction" label={t("debug.stepInstruction")} color={step} onClick={stopped ? debug.stepInstruction : noop} />
      <div style={{ width: 8 }} />
      <IconButton icon="debug-restart" label={t("debug.restart")} color={live ? p.string : p.faint} onClick={live ? debug.restart : noop} />
      <IconButton icon="debug-stop" label={t("debug.stop")} color={live ? p.error : p.faint} onClick={live ? debug.stop : noop} />
      {onAsk && <IconButton icon="agent" label={t("debug.askWhy")} onClick={onAsk} />}
    </div>
  );
}

function Header({ status, name }: { readonly status: DebugStatus; readonly name: string }): ReactElement {
  const { p } = useTheme();
  const [color, title, detail] =
    status.kind === "stopped" ? [p.data, t("debug.status.paused"), `${status.reason}, ${status.frames[0]?.name ?? name}`]
    : status.kind === "running" ? [p.string, t("debug.status.running"), name]
    : [p.faint, t("debug.status.starting"), name];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Dot color={color} size={8} />
      <div style={{ fontWeight: 600, color: p.text }}>{title}</div>
      <div style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: p.muted }}>{detail}</div>
    </div>
  );
}

function Evaluate({ debug }: { readonly debug: Debug }): ReactElement {
  const { p } = useTheme();
  const [text, setText] = useState("");
  const run = (): void => {
    debug.evaluate(text);
    setText("");
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 32, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.line3, borderRadius: 9, backgroundColor: p.deep }}>
      <div style={{ color: p.faint, ...MONO_STYLE }}>›</div>
      <input {...TYPING} value={text} placeholder={t("debug.evaluate.placeholder")} aria-label={t("debug.evaluate")} onChange={(e) => setText(e.value ?? "")} onSubmit={run} style={{ flexGrow: 1, minWidth: 0, height: 30, fontSize: 12, color: p.text, ...MONO_STYLE }} />
    </div>
  );
}

function Session({ debug, page, setPage, onAsk }: { readonly debug: Debug; readonly page: Page; readonly setPage: (page: Page) => void; readonly onAsk: (stopped: Stopped) => void }): ReactElement {
  const { p } = useTheme();
  const { program } = useBench();
  const { status } = debug;
  const stopped = status.kind === "stopped" ? status : null;
  const waiting = <div style={{ color: p.muted }}>{t("debug.pauseToSee")}</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, paddingBottom: 8 }}>
        <Header status={status} name={program.name} />
        <Toolbar debug={debug} onAsk={stopped ? () => onAsk(stopped) : null} />
      </div>
      <div role="tablist" style={{ display: "flex", flexWrap: "wrap", gap: 2, paddingLeft: 10, paddingRight: 10, paddingBottom: 6 }}>
        {PAGES.map((item) => <SegItem key={item.page} label={t(item.label)} on={page === item.page} onBg={p.sel2} padding={9} onClick={() => setPage(item.page)} />)}
      </div>
      <div style={{ flexGrow: 1, minHeight: 0, overflow: "scroll", ...scrollbar(p), paddingLeft: 12, paddingRight: 12, paddingTop: 4, paddingBottom: 12 }}>
        {page === "stack" && (stopped ? <div style={{ display: "flex", flexDirection: "column", gap: 12 }}><Frames frames={stopped.frames} /><Scopes scopes={stopped.scopes.filter((scope) => !isRegisters(scope))} load={debug.loadVars} /></div> : waiting)}
        {page === "threads" && (stopped ? <Threads threads={stopped.threads} current={stopped.thread} /> : waiting)}
        {page === "registers" && (stopped ? <Scopes scopes={stopped.scopes.filter(isRegisters)} load={debug.loadVars} /> : waiting)}
        {page === "breakpoints" && <Breakpoints />}
        {page === "output" && <Output lines={debug.output} />}
      </div>
      <div style={{ paddingLeft: 12, paddingRight: 12, paddingBottom: 12 }}>
        <Evaluate debug={debug} />
      </div>
    </div>
  );
}

/** Runs the open binary under lldb-dap, breaking at the function in focus, with the stack, registers, output and step controls. */
export function DebugView(): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { program, nameOf, focusAddr, wb } = bench;
  const debug = useDebug();
  const [page, setPage] = useState<Page>("stack");
  const stopped = debug.status.kind === "stopped";
  useCommand("continue", () => stopped && debug.cont());
  useCommand("stepOver", () => stopped && debug.stepOver());
  useCommand("stepIn", () => stopped && debug.stepIn());
  useCommand("stepOut", () => stopped && debug.stepOut());
  const breakFn = nameOf(focusAddr);
  const [pid, setPid] = useState("");
  const { stopAtFunction } = useSettings().settings;
  const breakAt = [...(breakFn && stopAtFunction ? [breakFn] : []), ...wb.s.breakpoints.keys()];
  useEffect(() => debug.syncBreakpoints(breakAt), [wb.s.breakpoints]);
  const pc = debug.status.kind === "stopped" ? (debug.status.frames[0]?.pc ?? null) : null;
  useEffect(() => wb.patch({ debugPc: pc }), [pc]);
  useEffect(() => () => wb.patch({ debugPc: null }), []);
  const start = (): void => debug.launch(program.path, breakAt);
  const latest = useRef(breakAt);
  latest.current = breakAt;
  useEffect(() => {
    claimDebugStart(async (id) => {
      const kind = debug.status.kind;
      if (kind === "running" || kind === "stopped" || kind === "starting") return `A session is already open.\n\n${await debug.describe()}`;
      const stopped = debug.settle();
      if (id === null) debug.launch(program.path, latest.current);
      else debug.attach(id, latest.current);
      await stopped;
      return debug.describe();
    });
    return () => claimDebugStart(null);
  }, [debug.status.kind, program.path]);
  const attach = (): void => {
    const id = Number(pid.trim());
    if (Number.isInteger(id) && id > 0) debug.attach(id, breakAt);
  };
  const askStopped = (at: Stopped): void => {
    const stack = at.frames.slice(0, 8).map((f) => `  ${f.name}${f.pc ? ` ${f.pc}` : ""}`).join("\n");
    const localScope = at.scopes.find((s) => /local/i.test(s.name)) ?? at.scopes[0];
    const locals = (localScope?.vars ?? []).slice(0, 20).map((v) => `  ${v.name} = ${v.value}`).join("\n");
    ask(bench, `The debugger stopped (${at.reason}) in ${program.name}.\n\nCall stack:\n${stack}\n\nLocals:\n${locals || "  (none)"}\n\nExplain where it is and what is happening here.`);
  };
  const { status } = debug;
  if (status.kind === "starting" || status.kind === "running" || status.kind === "stopped") return <Session debug={debug} page={page} setPage={setPage} onAsk={askStopped} />;
  const breaking = breakFn !== "" && stopAtFunction;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "scroll", ...scrollbar(p), padding: 16, gap: 12 }}>
      {status.kind === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
          <div style={{ color: p.muted, maxWidth: 520 }}>{breaking ? t("debug.intro.breaking", { name: program.name, fn: breakFn, arch: program.arch }) : t("debug.intro", { name: program.name, arch: program.arch })}</div>
          <TextButton label={breaking ? t("debug.start.breaking", { fn: breakFn }) : t("debug.start")} tone="primary" onClick={start} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <div style={{ color: p.muted }}>{t("debug.attach.hint")}</div>
            <input {...TYPING} value={pid} placeholder={t("debug.attach.pid")} aria-label={t("debug.attach.processId")} onChange={(e) => setPid(e.value ?? "")} onSubmit={attach} style={{ width: 80, height: 28, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.line3, borderRadius: 7, backgroundColor: p.deep, fontSize: 12.5, color: p.text, ...MONO_STYLE }} />
            <TextButton label={t("debug.attach")} tone="outline" onClick={attach} />
          </div>
          <div style={{ marginTop: 8, alignSelf: "stretch" }}><Breakpoints /></div>
        </div>
      )}
      {status.kind === "exited" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
          <div style={{ color: p.muted }}>{status.code === null ? t("debug.finished") : t("debug.exited", { code: status.code })}</div>
          <TextButton label={t("debug.runAgain")} tone="primary" onClick={debug.retry} />
          {debug.output.length > 0 && <div style={{ alignSelf: "stretch" }}><Output lines={debug.output} /></div>}
        </div>
      )}
      {status.kind === "error" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
          <div style={{ color: p.error, maxWidth: 520 }}>{status.problem ? t(PROBLEM[status.problem]) : status.message}</div>
          <TextButton label={t("debug.tryAgain")} tone="outline" onClick={debug.retry} />
        </div>
      )}
    </div>
  );
}
