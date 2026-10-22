import { type ReactElement, useEffect, useState } from "react";

import { Shimmer } from "../chat/Conversation";
import { ErrorCard, Tooltip } from "../components/kit";
import { type MenuEntry, openMenu } from "../components/ContextMenu";
import { Icon } from "../components/ui";
import { explainKernel, forgetKernelRewrite, KERNEL_EXTENSION, KERNEL_FENCE, KERNEL_LANGUAGES, type KernelLanguage, type KernelNote, type KernelRequest, rewriteKernel, savedKernelRewrite } from "../gpu/kernelRewrite";
import { CodeLinesOf, type ShaderExtras } from "../gpu/ShaderView";
import type { ShaderFunction, ShaderLibrary } from "../gpu/types";
import type { Loaded } from "../gpu/useGpu";
import { errorMessage } from "../lib/guards";
import { useNow } from "../lib/useNow";
import { useCodeLook } from "../settings/look";
import { SANS, scrollbar, useTheme } from "../theme";
import { type PlainId, t } from "../i18n";
import { copy } from "./actions";
import type { AskPlace } from "./ask/place";
import { exportKernel } from "./export";
import { type Bench, HOVER, TextButton, useBench } from "./parts";
import { PLACEHOLDER_LINES, useTypewriter, Working } from "./RewriteView";

type Shown = "PTX" | KernelLanguage;

type Phase =
  | { readonly kind: "reading"; readonly step: string | null }
  | { readonly kind: "writing"; readonly step: string | null; readonly code: string }
  | { readonly kind: "done"; readonly code: string }
  | { readonly kind: "failed"; readonly message: string };

type Notes =
  | { readonly kind: "off" }
  | { readonly kind: "working"; readonly step: string | null }
  | { readonly kind: "ready"; readonly notes: readonly KernelNote[] }
  | { readonly kind: "failed"; readonly message: string };

const NOTE: Readonly<Record<KernelLanguage, PlainId>> = { "CUDA C++": "gpu.kernel.note.cuda", "HIP C++": "gpu.kernel.note.hip", Metal: "gpu.kernel.note.metal" };
const ICON: Readonly<Record<KernelLanguage, string>> = { "CUDA C++": "lang-cpp", "HIP C++": "lang-cpp", Metal: "lang-metal" };
const FRAME_MS = 33;

/** The shader's own code as a place to ask about: PTX for CUDA, AIR for Metal, the code object's metadata for HIP. */
export function shaderPlace(lib: ShaderLibrary, fn: ShaderFunction): AskPlace {
  const what = lib.api === "cuda" ? "PTX" : lib.api === "hip" ? "code object metadata" : "AIR";
  return { fn: `ir:${lib.name}:${fn.symbol}`, view: "text", about: `the ${what} of the ${lib.api === "metal" ? `${fn.kind} shader` : "kernel"} ${fn.name} in ${lib.name}`, fence: lib.api === "cuda" ? "ptx" : "llvm", syntax: lib.api === "cuda" ? "ptx" : "code", owner: null, label: what };
}

function rewritePlaceOf(lib: ShaderLibrary, fn: ShaderFunction, language: KernelLanguage): AskPlace {
  return { fn: `kernel:${lib.name}:${fn.symbol}:${language}`, view: "text", about: `the ${language} rewrite of the CUDA kernel ${fn.name} in ${lib.name}`, fence: KERNEL_FENCE[language], syntax: "c", owner: null, label: `${language} rewrite` };
}

function requestFor(bench: Bench, lib: ShaderLibrary, fn: ShaderFunction, ptx: string): KernelRequest {
  const { chat, program } = bench;
  const agent = chat.agents.selected;
  return {
    agent,
    native: chat.agents.installed.get(agent.id)?.command ?? null,
    projectId: program.id,
    binary: { path: program.path },
    library: lib.name,
    kernel: fn.name,
    ptx,
    params: fn.bindings,
    stats: fn.stats,
  };
}

/** Runs the rewrite and follows it live; reopening a kernel already rewritten reads the saved copy. */
function useKernelRewrite(req: KernelRequest | null, language: KernelLanguage | null, attempt: number): Phase {
  const [phase, setPhase] = useState<Phase>({ kind: "reading", step: null });
  useEffect(() => {
    if (!req || !language) return;
    let live = true;
    setPhase({ kind: "reading", step: null });
    void (async (): Promise<void> => {
      try {
        const saved = await savedKernelRewrite(req, language);
        if (!live) return;
        if (saved !== null) return setPhase({ kind: "done", code: saved });
        const code = await rewriteKernel(req, language, ({ step, code: sofar }) => {
          if (live) setPhase(sofar === null ? { kind: "reading", step } : { kind: "writing", step, code: sofar });
        });
        if (live) setPhase({ kind: "done", code });
      } catch (err) {
        if (live) setPhase({ kind: "failed", message: errorMessage(err) });
      }
    })();
    return () => {
      live = false;
    };
  }, [req?.ptx, req?.agent.id, language, attempt]);
  return phase;
}

function useKernelNotes(req: KernelRequest | null, on: boolean, attempt: number): Notes {
  const [notes, setNotes] = useState<Notes>({ kind: "off" });
  useEffect(() => {
    if (!req || !on) return setNotes({ kind: "off" });
    let live = true;
    setNotes({ kind: "working", step: null });
    void (async (): Promise<void> => {
      try {
        const found = await explainKernel(req, ({ step }) => {
          if (live) setNotes({ kind: "working", step });
        });
        if (live) setNotes({ kind: "ready", notes: found });
      } catch (err) {
        if (live) setNotes({ kind: "failed", message: errorMessage(err) });
      }
    })();
    return () => {
      live = false;
    };
  }, [req?.ptx, req?.agent.id, on, attempt]);
  return notes;
}

function Toggle({ label, icon, on, tip, onClick }: { readonly label: string; readonly icon: string; readonly on: boolean; readonly tip: string; readonly onClick: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <Tooltip label={tip}>
      <div onClick={onClick} role="button" aria-pressed={on} style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, height: 26, paddingLeft: 9, paddingRight: 9, borderRadius: 7, backgroundColor: on ? p.sel2 : p.fill, fontSize: 12, color: on ? p.text : p.text3, cursor: "pointer", hover: HOVER }}>
        <Icon name={icon} size={13} color={on ? p.text : p.muted} />
        <div style={{ whiteSpace: "nowrap", pointerEvents: "none" }}>{label}</div>
      </div>
    </Tooltip>
  );
}

function ViewAs({ shown, agent, onPick }: { readonly shown: Shown; readonly agent: string; readonly onPick: (next: Shown) => void }): ReactElement {
  const { p } = useTheme();
  const entry = (label: Shown, mark: { readonly icon: string } | { readonly logo: string }, note: string): MenuEntry => ({ kind: "action", label, ...(label === shown ? { icon: "check" } : mark), keys: note, run: () => onPick(label) });
  const entries: readonly MenuEntry[] = [
    entry("PTX", { icon: "assembly" }, t("gpu.kernel.inFile")),
    { kind: "separator" },
    ...KERNEL_LANGUAGES.map((language) => entry(language, { logo: ICON[language] }, t(NOTE[language]))),
  ];
  return (
    <Tooltip label={t("gpu.kernel.viewAs.tip", { agent })}>
      <div onClick={(event) => openMenu(event.x ?? 0, event.y ?? 0, entries)} role="button" aria-label={t("gpu.kernel.viewAs.label", { language: shown })} style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, height: 26, paddingLeft: 9, paddingRight: 7, borderRadius: 7, backgroundColor: p.fill, fontSize: 12, color: p.text3, cursor: "pointer", hover: HOVER }}>
        <div style={{ color: p.muted, whiteSpace: "nowrap", pointerEvents: "none" }}>{t("gpu.kernel.viewAs")}</div>
        <div style={{ whiteSpace: "nowrap", pointerEvents: "none" }}>{shown}</div>
        <Icon name="updown" size={12} color={p.muted} />
      </div>
    </Tooltip>
  );
}

/** "Claude is explaining acc_f32", shimmering, with the step it's on beside it. */
export function Busy({ title, step }: { readonly title: string; readonly step: string | null }): ReactElement {
  const { p } = useTheme();
  const now = useNow(true, FRAME_MS);
  return (
    <div aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 28, flexShrink: 0, paddingLeft: 18, paddingRight: 16 }}>
      <div style={{ display: "flex", opacity: Math.floor(now / 600) % 2 === 0 ? 1 : 0.45 }}><Icon name="spark" size={14} color={p.data} /></div>
      <Shimmer text={title} color={p.text} now={now} />
      {step && <div style={{ flexShrink: 1, minWidth: 0, fontSize: 12, color: p.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{step}</div>}
    </div>
  );
}

function Column({ label, children }: { readonly label: string; readonly children: ReactElement }): ReactElement {
  const { p } = useTheme();
  const look = useCodeLook();
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0, overflow: "scroll", ...scrollbar(p), paddingTop: 4, paddingBottom: 24, fontFamily: look.family, fontSize: look.size, lineHeight: look.lineHeight }}>
      {label && <div style={{ flexShrink: 0, paddingLeft: 18, paddingBottom: 6, fontFamily: SANS, fontSize: 11.5, color: p.faint }}>{label}</div>}
      {children}
    </div>
  );
}

/** The kernel tab's View as, Explain and Beside PTX, and what they put in place of the plain PTX. */
export function useKernelExtras(lib: ShaderLibrary, fn: ShaderFunction, ir: Loaded<string>): ShaderExtras | undefined {
  const { p } = useTheme();
  const bench = useBench();
  const agent = bench.chat.agents.selected;
  const [shown, setShown] = useState<Shown>("PTX");
  const [explain, setExplain] = useState(false);
  const [compare, setCompare] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ptx = ir.kind === "ready" ? ir.value : null;
  const req = ptx === null ? null : requestFor(bench, lib, fn, ptx);
  const language = shown === "PTX" ? null : shown;
  const phase = useKernelRewrite(lib.api === "cuda" ? req : null, language, attempt);
  const notes = useKernelNotes(lib.api === "cuda" ? req : null, explain && language === null, attempt);
  const restart = `${fn.symbol}:${shown}:${agent.id}:${attempt}`;
  const live = language !== null && (phase.kind === "reading" || phase.kind === "writing");
  const [typing, setTyping] = useState(false);
  useEffect(() => setTyping(false), [restart]);
  useEffect(() => {
    if (live) setTyping(true);
  }, [live]);
  const full = phase.kind === "writing" || phase.kind === "done" ? phase.code : "";
  const typed = useTypewriter(full, typing, restart);
  if (lib.api !== "cuda") return undefined;
  const name = fn.name.replace(/\(.*$/, "");
  const pick = (next: Shown): void => {
    setShown(next);
    if (next !== "PTX") setExplain(false);
  };
  const toolbar = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
      <ViewAs shown={shown} agent={agent.name} onPick={pick} />
      {language === null && <Toggle label={t("gpu.kernel.explain")} icon="text" on={explain} tip={t("gpu.kernel.explain.tip")} onClick={() => setExplain(!explain)} />}
      {language !== null && phase.kind === "done" && <Toggle label={t("gpu.kernel.beside")} icon="split" on={compare} tip={t("gpu.kernel.beside.tip")} onClick={() => setCompare(!compare)} />}
    </div>
  );
  if (language === null) {
    const status = ((): ReactElement | null => {
      switch (notes.kind) {
        case "off":
        case "ready":
          return null;
        case "working":
          return <Busy title={t("gpu.kernel.explaining", { agent: agent.name, name })} step={notes.step} />;
        case "failed":
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, paddingLeft: 18, paddingRight: 12, paddingBottom: 4 }}>
              <div style={{ flexGrow: 1, fontSize: 12, color: p.error }}>{t("gpu.kernel.explainFailed", { name, error: notes.message })}</div>
              <TextButton label={t("workbench.view.tryAgain")} tone="ghost" onClick={() => setAttempt((n) => n + 1)} />
            </div>
          );
        default: {
          const unhandled: never = notes;
          return unhandled;
        }
      }
    })();
    return { subtitle: null, toolbar, status, body: null, notes: notes.kind === "ready" ? notes.notes : [] };
  }
  const subtitle = t("gpu.kernel.subtitle", { language });
  if (live || (phase.kind === "done" && typing && typed < full.length)) {
    const body = <div style={{ display: "flex", flexDirection: "column", flexGrow: 999, flexBasis: 420, minWidth: 0 }}><Working code={full.slice(0, typed)} step={live ? phase.step : null} shape={PLACEHOLDER_LINES} title={t("gpu.kernel.rewriting", { agent: agent.name, name, language })} syntax="c" /></div>;
    return { subtitle, toolbar, status: null, body, notes: [] };
  }
  const again = (): void => {
    void (async (): Promise<void> => {
      if (req) await forgetKernelRewrite(req, language);
      setAttempt((n) => n + 1);
    })();
  };
  if (phase.kind === "failed") {
    const body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, flexGrow: 1, padding: 16 }}>
        <ErrorCard title={t("gpu.kernel.failed", { name, language })} detail={t("gpu.kernel.failed.detail")} raw={phase.message} />
        <div style={{ display: "flex" }}><TextButton label={t("workbench.view.tryAgain")} tone="outline" onClick={() => setAttempt((n) => n + 1)} /></div>
      </div>
    );
    return { subtitle, toolbar, status: null, body: <div style={{ display: "flex", flexGrow: 999, flexBasis: 420, minWidth: 0 }}>{body}</div>, notes: [] };
  }
  if (phase.kind !== "done") return { subtitle, toolbar, status: null, body: null, notes: [] };
  const code = phase.code;
  const save = (): void => {
    void (async (): Promise<void> => {
      try {
        const path = await exportKernel(bench.program, name, KERNEL_EXTENSION[language], code);
        bench.wb.notify(t("gpu.kernel.saved", { name, path }), null);
      } catch (err) {
        bench.wb.notify(t("gpu.kernel.saveFailed", { name, error: errorMessage(err) }), null);
      }
    })();
  };
  const status = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, paddingLeft: 18, paddingRight: 12, paddingBottom: 4 }}>
      <div style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, fontSize: 12, color: p.muted }}>{t("gpu.kernel.done", { language, agent: agent.name })}</div>
      <TextButton label={t("workbench.view.copy")} tone="ghost" onClick={() => copy(bench, code, t("workbench.view.rewrite.copied", { name, language }))} />
      <TextButton label={t("gpu.kernel.save")} tone="ghost" onClick={save} />
      <TextButton label={t("workbench.view.rewrite.again")} tone="ghost" onClick={again} />
    </div>
  );
  const rewritten = <CodeLinesOf code={code} grammar="c" ask={rewritePlaceOf(lib, fn, language)} />;
  const body = compare && ptx !== null
    ? (
      <div style={{ display: "flex", gap: 12, flexGrow: 999, flexBasis: 420, minWidth: 0 }}>
        <Column label={t("gpu.kernel.ptx")}><CodeLinesOf code={ptx} grammar="ptx" ask={shaderPlace(lib, fn)} /></Column>
        <Column label={t("gpu.kernel.rewrittenBy", { language, agent: agent.name })}>{rewritten}</Column>
      </div>
    )
    : <div style={{ display: "flex", flexGrow: 999, flexBasis: 420, minWidth: 0 }}><Column label="">{rewritten}</Column></div>;
  return { subtitle, toolbar, status, body, notes: [] };
}
