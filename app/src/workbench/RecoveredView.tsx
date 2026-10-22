import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { type ReactElement, useEffect, useMemo, useState } from "react";

import type { Syntax } from "../components/code";
import { Button, ErrorCard } from "../components/kit";
import { Icon } from "../components/ui";
import { forgetRecreation, languageOf, recreate, type RecreateFn, type RecreateKey, type RecreateRequest, savedPath, savedRecreation } from "../engine/recreate";
import { listOf, type PlainId, t, thisDevice } from "../i18n";
import { swiftTypes, type SwiftType } from "../engine/swiftTypes";
import { ASSETS } from "../lib/assets";
import { errorMessage } from "../lib/guards";
import { FILE_MANAGER } from "../lib/platform";
import { useLoaded } from "../lib/useLoaded";
import { showInFinder, tildePath } from "../settings/system";
import { scrollbar, useTheme } from "../theme";
import { ask, copy } from "./actions";
import type { SourceText } from "./model";
import { type Bench, ELLIPSIS, HOVER, MONO_STYLE, TextButton, useBench } from "./parts";
import { sourcePlace } from "./ask/place";
import { PLACEHOLDER_LINES, useTypewriter, Working } from "./RewriteView";
import { logoFor } from "./sidebar/model";
import { SourceLines } from "./SourceView";
import { type FileTrace, stemOf, type TraceReason, traceFile } from "./sources";

const MAX_DISK_BYTES = 4 * 1024 * 1024;
const MAX_WITH_CODE = 6;
const MAX_CODE_LINES = 150;
const MAX_ROWS = 200;
const SIGN_IN = /auth|sign.?in|log.?in|credential|api key/i;

const WHY: Readonly<Record<TraceReason, string>> = {
  metadata: "method in the type’s metadata",
  accessor: "the type’s metadata accessor",
  path: "uses this file’s path",
  named: "named in the binary",
};

/** WHY in the reader's language; WHY itself stays English since it keys saved recreations and goes to the agent. */
const WHY_LABEL: Readonly<Record<TraceReason, PlainId>> = {
  metadata: "workbench.view.recovered.why.metadata",
  accessor: "workbench.view.recovered.why.accessor",
  path: "workbench.view.recovered.why.path",
  named: "workbench.view.recovered.why.named",
};

type Recreation =
  | { readonly kind: "idle" }
  | { readonly kind: "reading"; readonly step: string | null }
  | { readonly kind: "writing"; readonly step: string | null; readonly code: string }
  | { readonly kind: "done"; readonly source: SourceText }
  | { readonly kind: "failed"; readonly message: string };

/** What the file was built from, as a list the reader's language joins: "3 functions and 1 type". */
function builtFrom(fns: number, types: number): string {
  const parts = [fns === 1 ? t("workbench.view.recovered.oneFunction") : t("workbench.view.recovered.functions", { count: fns })];
  if (types) parts.push(types === 1 ? t("workbench.view.recovered.oneType") : t("workbench.view.recovered.types", { count: types }));
  return listOf(parts);
}

function languageName(file: string): string {
  const language = languageOf(file);
  return language.fence ? language.label : t("workbench.view.recovered.originalLanguage");
}

function syntaxOf(file: string): Syntax {
  return /\.(?:c|h|cc|cpp|cxx|hh|hpp|m|mm|metal)$/i.test(file) ? "c" : "code";
}

function typeLabel(type: SwiftType): string {
  return `${type.kind} ${type.name}`;
}

/** The original file when its path is absolute and it exists on this machine, as a build of your own leaves it. */
async function originalOnDisk(file: string): Promise<string | null> {
  if (!isAbsolute(file)) return null;
  try {
    if ((await stat(file)).size > MAX_DISK_BYTES) return null;
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

/** What a file's tab shows when the engine can't decompile files: the original if it's here, otherwise what the binary holds of it. */
export function RecoveredView({ file }: { readonly file: string }): ReactElement {
  const { p } = useTheme();
  const { program } = useBench();
  const original = useLoaded(() => originalOnDisk(file), file);
  const guessed = !program.strings.some((row) => row.b.includes(file));
  const trace = useLoaded(async () => traceFile(program, file, guessed, await swiftTypes(program.path, program.arch)), `${program.id}:${file}`);
  if (original.kind === "ready" && original.value !== null) return <OriginalFile file={file} text={original.value} />;
  switch (trace.kind) {
    case "loading":
      return <div style={{ padding: 16, color: p.muted }}>{t("workbench.view.recovered.tracing", { name: file.split("/").pop() ?? file })}</div>;
    case "failed":
      return <div style={{ padding: 16 }}><ErrorCard title={t("workbench.view.recovered.traceFailed", { file })} detail={t("workbench.view.recovered.traceFailed.detail")} raw={trace.message} /></div>;
    case "ready":
      return <TracedFile trace={trace.value} />;
    default: {
      const unhandled: never = trace;
      return unhandled;
    }
  }
}

function OriginalFile({ file, text }: { readonly file: string; readonly text: string }): ReactElement {
  const { p } = useTheme();
  const source = useMemo(() => ({ text, starts: [] }), [text]);
  const ask = useMemo(() => sourcePlace(file, syntaxOf(file)), [file]);
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 8, paddingLeft: 16, paddingRight: 12 }}>
        <div style={{ flexGrow: 1, minWidth: 0, fontSize: 12, color: p.muted, ...ELLIPSIS }}>{t("workbench.view.recovered.original", { device: thisDevice(), path: tildePath(file) })}</div>
        <TextButton label={t("settings.showIn", { app: FILE_MANAGER })} tone="ghost" onClick={() => showInFinder(file)} />
      </div>
      <SourceLines source={source} syntax={syntaxOf(file)} ask={ask} />
    </div>
  );
}

function keyOf(bench: Bench, trace: FileTrace): RecreateKey {
  const fns = trace.fns.map((fn): RecreateFn => ({ name: bench.nameOf(fn.addr), addr: fn.addr, why: WHY[fn.why] }));
  return { projectId: bench.program.id, agent: bench.chat.agents.selected, file: trace.file, types: trace.types.map(typeLabel), fns };
}

async function pseudocodeOf(bench: Bench, fns: readonly RecreateFn[]): Promise<RecreateRequest["pseudocode"]> {
  const read = await Promise.all(fns.slice(0, MAX_WITH_CODE).map(async (fn) => {
    try {
      return [{ name: fn.name, addr: fn.addr, code: (await bench.program.code(fn.addr, "pseudo")).split("\n").slice(0, MAX_CODE_LINES).join("\n") }];
    } catch {
      return [];
    }
  }));
  return read.flat();
}

/** Runs a recreation and follows it; a saved one shows straight away, and nothing starts until asked. */
function useRecreation(bench: Bench, trace: FileTrace): {
  readonly state: Recreation;
  readonly shape: readonly string[];
  readonly key: RecreateKey;
  readonly attempt: number;
  readonly start: () => void;
  readonly again: () => void;
} {
  const agentId = bench.chat.agents.selected.id;
  const key = useMemo(() => keyOf(bench, trace), [trace, agentId]);
  const [state, setState] = useState<Recreation>({ kind: "idle" });
  const [shape, setShape] = useState<readonly string[]>(PLACEHOLDER_LINES);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ kind: "idle" });
    void (async (): Promise<void> => {
      const saved = await savedRecreation(key);
      if (live && saved) setState({ kind: "done", source: saved });
    })();
    return () => {
      live = false;
    };
  }, [key]);
  const start = (): void => {
    const run = attempt + 1;
    setAttempt(run);
    setState({ kind: "reading", step: null });
    void (async (): Promise<void> => {
      try {
        const pseudocode = await pseudocodeOf(bench, key.fns);
        if (pseudocode.length) setShape(pseudocode.flatMap((fn) => fn.code.split("\n")));
        const native = bench.chat.agents.installed.get(key.agent.id)?.command ?? null;
        const req: RecreateRequest = { ...key, native, binary: { path: bench.program.path, name: bench.program.name, arch: bench.program.arch }, strings: trace.strings, pseudocode };
        const source = await recreate(req, ({ step, code }) => setState(code === null ? { kind: "reading", step } : { kind: "writing", step, code }));
        setState({ kind: "done", source });
        bench.chat.thread.note(t("workbench.view.recovered.recreated", { agent: key.agent.name, file: trace.file.split("/").pop() ?? trace.file, from: builtFrom(key.fns.length, key.types.length), path: tildePath(savedPath(key)) }));
      } catch (err) {
        setState({ kind: "failed", message: errorMessage(err) });
      }
    })();
  };
  const again = (): void => {
    void (async (): Promise<void> => {
      await forgetRecreation(key);
      start();
    })();
  };
  return { state, shape, key, attempt, start, again };
}

function askAbout(bench: Bench, trace: FileTrace, key: RecreateKey, saved: boolean): void {
  const name = trace.file.split("/").pop() ?? trace.file;
  if (saved) {
    ask(bench, `Read \`${savedPath(key)}\`: it's ${key.agent.name}'s recreation of \`${name}\`, one of the source files ${bench.program.name} was built from. Check it against the binary and tell me which parts are least certain.`);
    return;
  }
  const parts = [...trace.types.map((type) => `\`${typeLabel(type)}\``), ...key.fns.slice(0, 20).map((fn) => `\`${fn.name}\` (\`${fn.addr}\`)`)];
  ask(bench, `What did \`${name}\` do? It's one of the source files ${bench.program.name} was built from.${parts.length ? ` Eleven traced these to it: ${parts.join(", ")}.` : ""} Read them and explain what the file did.`);
}

function TracedFile({ trace }: { readonly trace: FileTrace }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const agent = bench.chat.agents.selected;
  const { state, shape, key, attempt, start, again } = useRecreation(bench, trace);
  const [evidence, setEvidence] = useState(false);
  const name = trace.file.split("/").pop() ?? trace.file;
  const restart = `${trace.file}:${agent.id}:${attempt}`;
  const live = state.kind === "reading" || state.kind === "writing";
  const [typing, setTyping] = useState(false);
  useEffect(() => setTyping(false), [restart]);
  useEffect(() => {
    if (live) {
      setTyping(true);
      setEvidence(false);
    }
  }, [live]);
  const full = state.kind === "writing" ? state.code : state.kind === "done" ? state.source.text : "";
  const shown = useTypewriter(full, typing, restart);
  if (live || (state.kind === "done" && typing && shown < full.length)) {
    return <Working code={full.slice(0, shown)} step={live ? state.step : null} shape={shape} title={t("workbench.view.recovered.recreating", { agent: agent.name, name })} syntax={syntaxOf(trace.file)} />;
  }
  if (state.kind === "failed") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
        <ErrorCard title={t("workbench.view.recovered.failed", { name })} detail={SIGN_IN.test(state.message) ? t("workbench.view.recovered.signIn", { agent: agent.name }) : t("workbench.view.recovered.failed.detail")} raw={state.message} />
        <div style={{ display: "flex" }}><TextButton label={t("workbench.view.tryAgain")} tone="outline" onClick={start} /></div>
      </div>
    );
  }
  if (state.kind === "done" && !evidence) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, paddingTop: 8, paddingLeft: 16, paddingRight: 12 }}>
          <div style={{ flexGrow: 1, flexBasis: 260, fontSize: 12, color: p.muted }}>{t("workbench.view.recovered.done", { language: languageName(trace.file), agent: agent.name, from: builtFrom(trace.fns.length, trace.types.length) })}</div>
          <TextButton label={t("workbench.view.recovered.builtFrom")} tone="ghost" onClick={() => setEvidence(true)} />
          <TextButton label={t("workbench.view.copy")} tone="ghost" onClick={() => copy(bench, state.source.text, name)} />
          <TextButton label={t("workbench.view.recovered.again")} tone="ghost" onClick={again} />
        </div>
        <SourceLines source={state.source} syntax={syntaxOf(trace.file)} labels ask={sourcePlace(trace.file, syntaxOf(trace.file))} />
      </div>
    );
  }
  return <Evidence trace={trace} saved={state.kind === "done"} onRecreate={start} onShowFile={() => setEvidence(false)} onAsk={() => askAbout(bench, trace, key, state.kind === "done")} />;
}

function SectionTitle({ text, count = "" }: { readonly text: string; readonly count?: string }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 2 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: p.faint }}>{text}</div>
      {count && <div style={{ fontSize: 12, color: p.faint }}>{count}</div>}
    </div>
  );
}

/** What the binary holds of a file: its types, the functions traced to it and why, and the strings that mention it. */
function Evidence({ trace, saved, onRecreate, onShowFile, onAsk }: {
  readonly trace: FileTrace;
  readonly saved: boolean;
  readonly onRecreate: () => void;
  readonly onShowFile: () => void;
  readonly onAsk: () => void;
}): ReactElement {
  const { p } = useTheme();
  const { openFn, nameOf, chat } = useBench();
  const agent = chat.agents.selected;
  const name = trace.file.split("/").pop() ?? trace.file;
  const logo = join(ASSETS, "icons", `${logoFor((name.split(".").pop() ?? "").toLowerCase())}.svg`);
  const where = trace.guessed ? t("workbench.view.recovered.guessedFrom", { name: stemOf(trace.file) }) : trace.file;
  const why = trace.guessed ? t("workbench.view.recovered.guessed") : t("workbench.view.recovered.compiled");
  const hint = trace.fns.length ? t("workbench.view.recovered.writes", { language: languageName(trace.file) }) : t("workbench.view.recovered.looks", { agent: agent.name });
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", ...scrollbar(p) }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 760, paddingTop: 28, paddingBottom: 40, paddingLeft: 32, paddingRight: 32 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src={logo} objectFit="contain" style={{ width: 22, height: 22 }} />
            <div style={{ fontSize: 17, fontWeight: 600, color: p.text, userSelect: "text" }}>{name}</div>
          </div>
          <div style={{ fontSize: 12, color: p.faint, userSelect: "text", ...MONO_STYLE }}>{where}</div>
          <div style={{ maxWidth: 600, color: p.muted }}>{why}</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {saved
            ? <Button label={t("workbench.view.recovered.show")} tone="primary" icon="spark" onClick={onShowFile} />
            : <Button label={t("workbench.view.recovered.recreateWith", { agent: agent.name })} tone="primary" icon="spark" onClick={onRecreate} />}
          <Button label={t("workbench.view.recovered.askInChat")} tone="outline" onClick={onAsk} />
          {!saved && <div style={{ fontSize: 12, color: p.faint }}>{hint}</div>}
        </div>
        {trace.types.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <SectionTitle text={t("workbench.view.recovered.typesTitle")} />
            {trace.types.map((type) => (
              <div key={type.name} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 30, paddingLeft: 8, paddingRight: 8, borderRadius: 8, backgroundColor: p.raised }}>
                <div style={{ fontSize: 12, color: p.keyword, ...MONO_STYLE }}>{type.kind}</div>
                <div style={{ flexGrow: 1, minWidth: 0, fontSize: 12, color: p.kind, userSelect: "text", ...MONO_STYLE, ...ELLIPSIS }}>{type.name}</div>
                <div style={{ fontSize: 11.5, color: p.faint }}>{type.methods.length === 0 ? t("workbench.view.recovered.swiftMetadata") : type.methods.length === 1 ? t("workbench.view.recovered.oneMethod") : t("workbench.view.recovered.methods", { count: type.methods.length })}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <SectionTitle text={t("workbench.view.recovered.functionsTitle")} count={trace.fns.length ? String(trace.fns.length) : ""} />
          {trace.fns.slice(0, MAX_ROWS).map((fn) => (
            <div key={fn.addr} onClick={() => openFn(fn.addr, true)} role="button" aria-label={t("workbench.view.open", { name: nameOf(fn.addr) })} style={{ display: "flex", alignItems: "center", gap: 10, height: 30, flexShrink: 0, paddingLeft: 8, paddingRight: 8, borderRadius: 8, cursor: "pointer", hover: HOVER }}>
              <Icon name="function" size={14} color={p.muted} />
              <div style={{ flexGrow: 1, minWidth: 0, fontSize: 12, color: p.text3, pointerEvents: "none", ...MONO_STYLE, ...ELLIPSIS }}>{nameOf(fn.addr)}</div>
              <div style={{ flexShrink: 0, fontSize: 11.5, color: p.faint, pointerEvents: "none", whiteSpace: "nowrap" }}>{t(WHY_LABEL[fn.why])}</div>
              <div style={{ flexShrink: 0, fontSize: 11, color: p.faint, pointerEvents: "none", ...MONO_STYLE }}>{fn.addr.slice(-5)}</div>
            </div>
          ))}
          {trace.fns.length === 0 && (
            <div style={{ paddingTop: 10, paddingBottom: 10, paddingLeft: 8, paddingRight: 8, borderRadius: 8, backgroundColor: p.raised, color: p.muted }}>
              {t("workbench.view.recovered.nothing", { agent: agent.name })}
            </div>
          )}
        </div>
        {trace.strings.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <SectionTitle text={t("workbench.view.recovered.strings")} />
            {trace.strings.map((text) => <div key={text} style={{ height: 28, display: "flex", alignItems: "center", paddingLeft: 8, paddingRight: 8, fontSize: 12, color: p.string, userSelect: "text", ...MONO_STYLE, ...ELLIPSIS }}>{JSON.stringify(text)}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
