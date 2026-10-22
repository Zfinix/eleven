import { type ReactElement, useMemo } from "react";

import { Composer } from "../chat/Composer";
import type { ModelInfo } from "../gpu/types";
import { indexMentions, type Mention, type MentionIndex } from "../chat/mentions";
import type { Bookmark } from "../engine/project";
import { enabledSkills, skillPrompt } from "../skills/load";
import { useTheme } from "../theme";
import { type PlainId, t } from "../i18n";
import { appIcon, Icon } from "../components/ui";
import { ask } from "./actions";
import { LiveThread } from "./LiveThread";
import type { Program } from "./model";
import { ELLIPSIS, HOVER, isGpuBench, isModelBench, useBench } from "./parts";

const PLAYBOOKS_SHOWN = 4;
const SNIPPET = 40;

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET ? `${flat.slice(0, SNIPPET)}…` : flat;
}

/** Everything in the open file the @ picker can point at, with your renames applied. */
function useMentions(): MentionIndex {
  const { program, nameOf, wb } = useBench();
  const { names, bookmarks, notes } = wb.s;
  return useMemo(() => indexMentions(mentionsOf(program, nameOf, bookmarks, notes)), [program, names, bookmarks, notes]);
}

function mentionsOf(program: Program, nameOf: (addr: string) => string, bookmarks: readonly Bookmark[], notes: ReadonlyMap<string, string>): readonly Mention[] {
  return [
    ...bookmarks.map((mark): Mention => ({ kind: "bookmark", label: mark.label, addr: mark.addr, detail: nameOf(mark.addr) })),
    ...[...notes].map(([addr, note]): Mention => ({ kind: "note", label: nameOf(addr), addr, detail: snippet(note) })),
    ...program.functions.map((fn): Mention => ({ kind: "function", label: nameOf(fn.addr), addr: fn.addr, detail: fn.addr })),
    ...program.strings.map((row): Mention => ({ kind: "string", label: `"${snippet(row.b)}"`, addr: row.a, detail: row.a })),
  ];
}

/** Questions that fit what the file actually holds: a chat template, quantized weights, a graph. */
function modelQuestions(model: ModelInfo | undefined): readonly string[] {
  const ids: readonly PlainId[] = [
    "workbench.view.agent.model.contents",
    ...(model?.template ? ["workbench.view.agent.model.template" as const] : []),
    ...(model && model.mix.some((m) => /^(I?Q\d)/.test(m.type)) ? ["workbench.view.agent.model.quantized" as const] : []),
    ...(model && model.nodes.length > 0 ? ["workbench.view.agent.model.io" as const] : []),
    ...(model && model.loads.length > 0 ? ["workbench.view.agent.model.imports" as const] : []),
  ];
  return ids.map((id) => t(id));
}

/** A model has no functions to point at, so it starts from questions about the file instead of playbooks. */
function EmptyModelChat(): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { gpuData, program } = bench;
  const model = gpuData.kind === "ready" ? gpuData.value.models[0] : undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 20, flexGrow: 1, paddingLeft: 8, paddingRight: 8 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <img src={appIcon(p.icon)} style={{ width: 64, height: 64 }} />
        <div style={{ fontSize: 18, color: p.text2 }}>{t("workbench.view.agent.knowAboutIt")}</div>
        <div style={{ fontSize: 12, color: p.muted }}>{model ? t("workbench.view.agent.tensors", { name: program.name, count: model.tensors.length.toLocaleString("en-US") }) : program.name}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {modelQuestions(model).map((question) => (
          <div key={question} onClick={() => ask(bench, question)} role="button" style={{ display: "flex", alignItems: "center", gap: 10, height: 36, paddingLeft: 10, paddingRight: 10, borderRadius: 8, cursor: "pointer", hover: HOVER }}>
            <Icon name="model" size={15} color={p.data} />
            <div style={{ flexGrow: 1, minWidth: 0, color: p.text3, ...ELLIPSIS }}>{question}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const GPU_QUESTIONS: readonly PlainId[] = [
  "workbench.view.agent.gpu.purpose",
  "workbench.view.agent.gpu.registers",
  "workbench.view.agent.gpu.targets",
];

/** Kernel files start from questions about the GPU code rather than playbooks for functions. */
function EmptyGpuChat(): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { gpuData, program } = bench;
  const count = gpuData.kind === "ready" ? gpuData.value.libraries.reduce((sum, lib) => sum + lib.functions.length, 0) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 20, flexGrow: 1, paddingLeft: 8, paddingRight: 8 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <img src={appIcon(p.icon)} style={{ width: 64, height: 64 }} />
        <div style={{ fontSize: 18, color: p.text2 }}>{t("workbench.view.agent.knowAboutIt")}</div>
        <div style={{ fontSize: 12, color: p.muted }}>{count === 0 ? program.name : count === 1 ? t("workbench.view.agent.oneKernel", { name: program.name }) : t("workbench.view.agent.kernels", { name: program.name, count: count.toLocaleString("en-US") })}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {GPU_QUESTIONS.map((id) => t(id)).map((question) => (
          <div key={question} onClick={() => ask(bench, question)} role="button" style={{ display: "flex", alignItems: "center", gap: 10, height: 36, paddingLeft: 10, paddingRight: 10, borderRadius: 8, cursor: "pointer", hover: HOVER }}>
            <Icon name="gpu" size={15} color={p.data} />
            <div style={{ flexGrow: 1, minWidth: 0, color: p.text3, ...ELLIPSIS }}>{question}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyChat(): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { program, focusAddr, nameOf } = bench;
  const playbooks = useMemo(() => enabledSkills().slice(0, PLAYBOOKS_SHOWN), []);
  const here = program.functions.length > 0 ? `${nameOf(focusAddr)} at ${focusAddr}` : program.name;
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 20, flexGrow: 1, paddingLeft: 8, paddingRight: 8 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <img src={appIcon(p.icon)} style={{ width: 64, height: 64 }} />
        <div style={{ fontSize: 18, color: p.text2 }}>{t("workbench.view.agent.digInto")}</div>
        <div style={{ fontSize: 12, color: p.muted }}>{t("workbench.view.agent.functions", { name: program.name, count: program.functions.length.toLocaleString() })}</div>
      </div>
      {playbooks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ paddingLeft: 10, paddingBottom: 4, fontSize: 11.5, color: p.faint }}>{t("workbench.view.agent.playbooks")}</div>
          {playbooks.map((skill) => (
            <div key={skill.name} onClick={() => ask(bench, skillPrompt(skill, here))} role="button" style={{ display: "flex", alignItems: "center", gap: 10, height: 36, paddingLeft: 10, paddingRight: 10, borderRadius: 8, cursor: "pointer", hover: HOVER }}>
              <Icon name="bolt" size={15} color={p.data} />
              <div style={{ flexGrow: 1, minWidth: 0, color: p.text3, ...ELLIPSIS }}>{skill.description || skill.name}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentTab(): ReactElement {
  const bench = useBench();
  const { chat, focusAddr, nameOf, program } = bench;
  const model = isModelBench(bench);
  const gpu = isGpuBench(bench);
  const mentions = useMentions();
  const mention = program.functions.length > 0 ? nameOf(focusAddr) : null;
  const active = chat.tabs.find((tab) => tab.active) ?? null;
  const empty = chat.thread.state.messages.length === 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      {empty
        ? (model ? <EmptyModelChat /> : gpu ? <EmptyGpuChat /> : <EmptyChat />)
        : <LiveThread chatId={active?.id ?? null} />}
      <div style={{ display: "flex", flexShrink: 0, paddingLeft: 10, paddingRight: 10, paddingBottom: 10 }}>
        <Composer place="dock" target={chat.target} agents={chat.agents} thread={chat.thread} onAttach={chat.openFile} onDetach={chat.detach} onPickAgent={chat.pickAgent} mention={mention} mentions={mentions} hint={model ? t("workbench.view.agent.hint.model") : gpu ? t("workbench.view.agent.hint.gpu") : null} />
      </div>
    </div>
  );
}

