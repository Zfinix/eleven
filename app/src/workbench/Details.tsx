import { useEffect, useState, type ReactElement } from "react";

import { useTheme } from "../theme";
import { useLoaded } from "../lib/useLoaded";
import { YOU } from "../engine/edits";
import { loadProject, onProjectChange, updateProject } from "../engine/project";
import type { Refs } from "./model";
import { goTo, subjectMenu } from "./actions";
import { referencesTo, type XRef } from "./layout";
import { EmptyState, ErrorCard, fieldLook } from "../components/kit";
import { patchBytes } from "./patch";
import { HOVER, MONO_STYLE, TextButton, useBench } from "./parts";
import { TYPING } from "../lib/shortcuts";
import { TerminalView } from "../terminal/TerminalView";
import { dirname } from "node:path";
import { showAddress } from "../settings/look";
import { MOD, OS } from "../lib/platform";

function RefRow({ addr, at }: { readonly addr: string; readonly at: string }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { nameOf, openFn } = bench;
  return (
    <div {...subjectMenu(bench, { kind: "function", addr }, () => openFn(addr, false))} role="button" style={{ display: "flex", alignItems: "center", gap: 10, height: 24, paddingLeft: 4, paddingRight: 4, fontSize: 12, cursor: "pointer", hover: HOVER, ...MONO_STYLE }}>
      <div style={{ flexGrow: 1 }}>{nameOf(addr)}</div>
      <div style={{ color: p.faint }}>{showAddress(at)}</div>
    </div>
  );
}

function Heading({ text }: { readonly text: string }): ReactElement {
  const { p } = useTheme();
  return <div style={{ marginTop: 4, marginBottom: 4, fontSize: 11.5, color: p.muted }}>{text}</div>;
}

/** Every place that refers to one address, each opening at that line. */
function ReferencesTo({ addr }: { readonly addr: string }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { program, nameOf, wb } = bench;
  const refs = useLoaded<readonly XRef[]>(() => (program.dossier ? referencesTo(program.path, addr) : Promise.resolve([])), `${program.id}:${addr}:xrefs`);
  const row = { display: "flex", alignItems: "center", gap: 10, height: 24, paddingLeft: 4, paddingRight: 4, fontSize: 12, cursor: "pointer", hover: HOVER, ...MONO_STYLE } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Heading text={`References to ${nameOf(addr)}`} />
        <div onClick={() => wb.patch({ refsOf: null })} role="button" style={{ fontSize: 11.5, color: p.link, cursor: "pointer", hover: HOVER }}>Show callers and calls instead</div>
      </div>
      {refs.kind === "loading" && <div style={{ color: p.muted }}>Finding references…</div>}
      {refs.kind === "failed" && <ErrorCard title="Couldn't find references" detail="REA couldn't list what points here. Try again after the file finishes loading." raw={refs.message} />}
      {refs.kind === "ready" && refs.value.length === 0 && <div style={{ color: p.muted }}>Nothing refers to this directly. It may be reached through a pointer or a computed address.</div>}
      {refs.kind === "ready" && refs.value.map((ref) => (
        <div key={ref.from} {...subjectMenu(bench, ref.fn ? { kind: "line", fn: ref.fn, view: "asm", number: -1, text: "", addr: ref.from, token: null } : { kind: "bytes", fn: "", addr: ref.from, bytes: [] }, () => goTo(bench, ref.from))} role="button" style={row}>
          <div style={{ flexGrow: 1 }}>{ref.fn ? nameOf(ref.fn) : "Data"}</div>
          <div style={{ color: p.faint }}>{showAddress(ref.from)}</div>
        </div>
      ))}
    </div>
  );
}

export function References(): ReactElement {
  const { p } = useTheme();
  const { program, focusAddr, nameOf, wb } = useBench();
  const refs = useLoaded<Refs>(() => program.refs(focusAddr), `${program.name}:${focusAddr}:refs`);
  if (wb.s.refsOf) return <ReferencesTo addr={wb.s.refsOf} />;
  if (refs.kind !== "ready") {
    if (refs.kind === "failed") return <ErrorCard title="Couldn't find references" detail={`${program.engine} couldn't list the callers. Try again after the file finishes loading.`} raw={refs.message} />;
    return <div style={{ marginTop: 4, color: p.muted }}>Finding references…</div>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: 2, gap: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Heading text="Called by" />
        {refs.value.callers.map((c) => <RefRow key={c.addr} addr={c.addr} at={c.at} />)}
        {refs.value.callers.length === 0 && <div style={{ marginTop: 2, marginLeft: 4, marginRight: 4, color: p.muted }}>{nameOf(focusAddr) === "entry" ? "Nothing calls this. It's where the program starts." : "Nothing calls this directly. It may be reached through a pointer."}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Heading text="Calls" />
        {refs.value.callees.map((addr) => <RefRow key={addr} addr={addr} at={addr} />)}
      </div>
    </div>
  );
}

export function Patches(): ReactElement {
  const { p } = useTheme();
  const { program, chat, openFn } = useBench();
  const [patches, setPatches] = useState(() => loadProject(program.id).patches);
  useEffect(() => {
    setPatches(loadProject(program.id).patches);
    return onProjectChange((id) => {
      if (id === program.id) setPatches(loadProject(program.id).patches);
    });
  }, [program.id]);
  const remove = (addr: string): void => {
    updateProject(program.id, (project) => ({ ...project, patches: project.patches.filter((patch) => patch.addr !== addr) }), YOU);
  };
  const writeCopy = (): void => {
    void (async (): Promise<void> => {
      try {
        chat.thread.note(`Wrote a patched copy to ${await patchBytes(program, [])}`);
      } catch (err) {
        chat.thread.note(`Couldn't patch. ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  };
  if (patches.length === 0) {
    return <div style={{ marginTop: 4, color: p.muted }}>{`No patches yet. Open a function, then pick "Patch bytes here" in ${MOD}K.`}</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ flexGrow: 1, color: p.muted }}>{`${patches.length} ${patches.length === 1 ? "patch" : "patches"}, saved with this file. The binary is never changed in place.`}</div>
        <TextButton label="Write patched copy" tone="primary" onClick={writeCopy} />
      </div>
      {patches.map((patch) => (
        <div key={patch.addr} style={{ display: "flex", alignItems: "center", gap: 10, height: 26, paddingLeft: 4, paddingRight: 4, fontSize: 12, ...MONO_STYLE }}>
          <div onClick={() => openFn(patch.addr, false)} role="button" style={{ color: p.text, cursor: "pointer", hover: HOVER }}>{showAddress(patch.addr)}</div>
          <div style={{ flexGrow: 1, color: p.string }}>{patch.bytes}</div>
          <div onClick={() => remove(patch.addr)} role="button" aria-label={`Remove patch at ${patch.addr}`} style={{ color: p.muted, cursor: "pointer", hover: HOVER }}>Remove</div>
        </div>
      ))}
    </div>
  );
}

export function Terminal(): ReactElement {
  const { program } = useBench();
  if (OS === "windows") return <EmptyState title="The terminal isn't available on Windows yet" hint="Open Windows Terminal or PowerShell next to Eleven for now." />;
  return <TerminalView cwd={dirname(program.origin)} />;
}

/** The inline rename strip under the editor. */
export function RenameBar({ addr }: { readonly addr: string }): ReactElement {
  const { p } = useTheme();
  const { wb } = useBench();
  const [focused, setFocused] = useState(true);
  const draft = wb.s.renameDraft.trim();
  const problem = draft ? nameProblem(draft) : null;
  const save = (): void => {
    const before = wb.s.names.get(addr) ?? "";
    if (problem) return;
    wb.patch({ renaming: null });
    if (!draft || draft === before) return;
    wb.rename(addr, draft);
    wb.notify(`Renamed to ${draft}`, () => wb.rename(addr, before));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12, borderTopWidth: 1, borderColor: p.fill, backgroundColor: p.raised }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ color: p.muted, whiteSpace: "nowrap" }}>{`Rename ${addr} to`}</div>
        <input {...TYPING} autoFocus value={wb.s.renameDraft} aria-label="New name" aria-invalid={problem !== null} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={(e) => wb.patch({ renameDraft: e.value ?? "" })} onSubmit={save} style={{ flexGrow: 1, maxWidth: 300, height: 28, paddingLeft: 10, paddingRight: 10, borderRadius: 7, backgroundColor: p.deep, fontSize: 12.5, color: p.text, ...MONO_STYLE, ...fieldLook(p, focused, problem !== null) }} />
        <TextButton label="Save" tone="primary" onClick={save} />
        <TextButton label="Cancel" tone="ghost" onClick={() => wb.patch({ renaming: null })} />
        <div style={{ color: p.muted, fontSize: 12, whiteSpace: "nowrap" }}>Saved in your project file, not the binary.</div>
      </div>
      {problem && <div role="alert" style={{ color: p.error, fontSize: 12 }}>{problem}</div>}
    </div>
  );
}

/** Why a name can't be used, in one sentence with a fix, or null when it's fine. */
export function nameProblem(name: string): string | null {
  const suggestion = name.replace(/\s+/g, "_").replace(/[^\w$.:]/g, "_").replace(/^(\d)/, "_$1");
  if (/\s/.test(name)) return `Names can't have spaces. Try ${suggestion}.`;
  if (/^\d/.test(name)) return `Names can't start with a number. Try ${suggestion}.`;
  if (/[^\w$.:]/.test(name)) return `Use letters, numbers, _ . : or $. Try ${suggestion}.`;
  return null;
}

/** The inline byte-patch strip under the editor; writes a patched copy of the binary. */
export function PatchBar({ addr }: { readonly addr: string }): ReactElement {
  const { p } = useTheme();
  const { wb, program, chat } = useBench();
  const close = (): void => wb.patch({ patching: null, patchDraft: "" });
  const save = (): void => {
    const bytes = wb.s.patchDraft.trim();
    close();
    if (!bytes) return;
    void (async (): Promise<void> => {
      try {
        chat.thread.note(`Wrote a patched copy to ${await patchBytes(program, [{ addr, bytes }])}`);
      } catch (err) {
        chat.thread.note(`Couldn't patch. ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12, borderTopWidth: 1, borderColor: p.fill, backgroundColor: p.raised }}>
      <div style={{ color: p.muted, whiteSpace: "nowrap" }}>{`New bytes at ${addr}`}</div>
      <input {...TYPING} autoFocus value={wb.s.patchDraft} placeholder="90 90 90" aria-label="New bytes" onChange={(e) => wb.patch({ patchDraft: e.value ?? "" })} onSubmit={save} style={{ flexGrow: 1, maxWidth: 300, height: 28, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: p.line3, borderRadius: 7, backgroundColor: p.deep, fontSize: 12.5, color: p.text, ...MONO_STYLE }} />
      <TextButton label="Write copy" tone="primary" onClick={save} />
      <TextButton label="Cancel" tone="outline" onClick={close} />
      <div style={{ color: p.muted, fontSize: 12, whiteSpace: "nowrap" }}>Saved as a copy, not over the original.</div>
    </div>
  );
}
