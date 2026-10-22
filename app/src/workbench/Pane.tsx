import { type ReactElement, useState } from "react";

import { chatTitle } from "../chat/useChat";
import { Tooltip } from "../components/kit";
import { CodeView } from "../components/code";
import { DALVIK } from "../engine/jadx";
import { type PlainId, t } from "../i18n";
import { scrollbar, useTheme } from "../theme";
import { Icon, Spacer } from "../components/ui";
import { type MenuEntry, openMenu } from "../components/ContextMenu";
import { CODE_LANGUAGES, type CodeLanguage, useSettings } from "../settings/store";
import { RewriteView } from "./RewriteView";
import { CodeLines } from "./CodeLines";
import { DebugView } from "./DebugView";
import { DiffView } from "./DiffView";
import { ModelTab, ProfileTab, ShaderTab } from "./GpuTabs";
import { Graph } from "./Graph";
import { EmptyPane, HexView, TableView } from "./Lists";
import { Listing } from "./Listing";
import { SourceView } from "./SourceView";
import { LiveThread } from "./LiveThread";
import type { CodeMode, ModelPage, Tab } from "./model";
import { pageIcon, pageLabel, pagesOf } from "../gpu/models/facts";
import { pageOwnsScroll } from "../gpu/ModelView";
import { useSize } from "../lib/useSize";
import { TYPING } from "../lib/shortcuts";
import { goTo } from "./actions";
import { HOVER, IconButton, MONO_STYLE, SegItem, useBench } from "./parts";
import { ResourceView } from "./ResourceView";
import { TabBar } from "./TabBar";
import { fillsSpace, ToolBody } from "./Tools";
import { showAddress } from "../settings/look";

type Mode = { readonly mode: CodeMode; readonly label: PlainId; readonly icon: string; readonly tip: PlainId };

const MODES: readonly Mode[] = [
  { mode: "asm", label: "workbench.chrome.listing", icon: "assembly", tip: "workbench.chrome.tip.listing" },
  { mode: "pseudo", label: "workbench.chrome.mode.pseudo", icon: "pseudocode", tip: "workbench.chrome.tip.pseudo" },
  { mode: "graph", label: "workbench.chrome.mode.graph", icon: "graph", tip: "workbench.chrome.tip.graph" },
  { mode: "hex", label: "workbench.chrome.mode.hex", icon: "hex", tip: "workbench.chrome.tip.hex" },
];

/** Android methods come from jadx (Java) and apktool (smali); there are no blocks or file bytes to show. */
const DALVIK_MODES: readonly Mode[] = [
  { mode: "asm", label: "workbench.chrome.mode.smali", icon: "assembly", tip: "workbench.chrome.tip.smali" },
  { mode: "pseudo", label: "workbench.chrome.mode.java", icon: "pseudocode", tip: "workbench.chrome.tip.java" },
];

type LanguageMark = { readonly icon: string } | { readonly logo: string };

const LANGUAGE_MARK: Readonly<Record<CodeLanguage, LanguageMark>> = {
  Pseudocode: { icon: "pseudocode" }, C: { logo: "lang-c" }, "C++": { logo: "lang-cpp" }, Rust: { icon: "lang-rust" }, Go: { icon: "lang-go" }, Swift: { logo: "lang-swift" },
  Python: { logo: "lang-python" }, TypeScript: { logo: "lang-typescript" }, Java: { logo: "lang-java" }, "C#": { logo: "lang-csharp" }, Zig: { logo: "lang-zig" },
};

/** A language's name as shown; only the engine's own pseudocode is a word to translate. */
function languageName(language: CodeLanguage): string {
  return language === "Pseudocode" ? t("workbench.chrome.mode.pseudo") : language;
}

/** Which language the pseudocode view shows: the engine's own pseudocode, or the agent's rewrite in another language. */
function LanguagePicker(): ReactElement {
  const { p } = useTheme();
  const { settings, update } = useSettings();
  const current = settings.codeLanguage;
  const entries = CODE_LANGUAGES.map((language): MenuEntry => {
    const mark = language === current ? { icon: "check" } : LANGUAGE_MARK[language];
    return { kind: "action", label: languageName(language), ...mark, run: () => update({ codeLanguage: language }) };
  });
  return (
    <Tooltip label={t("workbench.chrome.rewriteHint")}>
      <div onClick={(event) => openMenu(event.x ?? 0, event.y ?? 0, entries)} role="button" aria-label={t("workbench.chrome.language", { name: languageName(current) })} style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, height: 26, paddingLeft: 9, paddingRight: 7, borderRadius: 7, backgroundColor: p.fill, fontSize: 12, color: p.text3, cursor: "pointer", hover: HOVER }}>
        <div style={{ whiteSpace: "nowrap", pointerEvents: "none" }}>{languageName(current)}</div>
        <Icon name="updown" size={12} color={p.muted} />
      </div>
    </Tooltip>
  );
}

/** Below this pane width the view switch shows only icons. */
const WORDS_FROM = 640;

/** Takes an address like 1a98 or 0x1000016d8, or a function name, and opens it. */
function GoTo({ addr }: { readonly addr: string }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const [draft, setDraft] = useState("");
  const go = (): void => {
    const text = draft.trim();
    if (!text) return;
    const named = bench.addrOf(text);
    if (named) bench.openFn(named, false);
    else if (/^(0x)?[0-9a-f]+$/i.test(text)) goTo(bench, text.startsWith("0x") ? text.toLowerCase() : `0x${text.toLowerCase()}`);
    else return;
    setDraft("");
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexGrow: 0, flexShrink: 1, flexBasis: 260, minWidth: 120, height: 26, paddingLeft: 8, paddingRight: 8, borderWidth: 1, borderColor: p.line2, borderRadius: 7, backgroundColor: p.deep }}>
      <div style={{ fontSize: 11, color: p.faint, ...MONO_STYLE }}>G</div>
      <input {...TYPING} value={draft} placeholder={showAddress(addr)} aria-label={t("command.goto")} onChange={(e) => setDraft(e.value ?? "")} onSubmit={go} style={{ flexGrow: 1, minWidth: 0, fontSize: 12, color: p.text3, ...MONO_STYLE }} />
    </div>
  );
}

function ModeBar({ pane, addr, view, width }: { readonly pane: number; readonly addr: string; readonly view: CodeMode; readonly width: number }): ReactElement {
  const { p } = useTheme();
  const { wb, nameOf, program } = useBench();
  const words = width === 0 || width >= WORDS_FROM;
  const modes = program.arch === DALVIK ? DALVIK_MODES : MODES;
  const marked = wb.s.bookmarks.some((b) => b.addr === addr);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 34, flexShrink: 0, paddingLeft: 10, paddingRight: 8, overflow: "hidden" }}>
      <GoTo addr={addr} />
      <Spacer />
      {view === "pseudo" && <LanguagePicker />}
      <div role="radiogroup" aria-label={t("workbench.chrome.view")} style={{ display: "flex", flexShrink: 0, gap: 2, padding: 2, borderRadius: 8, backgroundColor: p.fill }}>
        {modes.map((m) => (
          <Tooltip key={m.mode} label={words ? t(m.tip) : t("workbench.chrome.modeTip", { name: t(m.label), tip: t(m.tip) })}>
            <div style={{ display: "flex" }}>
              <SegItem label={t(m.label)} name={t("workbench.chrome.viewNamed", { name: t(m.label) })} icon={m.icon} words={words} on={m.mode === view} onBg={p.sel2} padding={words ? 9 : 6} onClick={() => wb.setView(pane, m.mode)} />
            </div>
          </Tooltip>
        ))}
      </div>
      {view === "asm" && <IconButton icon="split" label={t("workbench.chrome.beside")} on={wb.s.linked} color={wb.s.linked ? p.text : p.muted} size={26} iconSize={15} onClick={() => wb.besidePseudo(addr)} />}
      {view === "asm" && program.arch !== DALVIK && <IconButton icon="hex" label={t("workbench.chrome.showBytes")} on={wb.s.showBytes} color={wb.s.showBytes ? p.text : p.muted} size={26} iconSize={15} onClick={() => wb.patch({ showBytes: !wb.s.showBytes })} />}
      <IconButton icon="bookmark" on={marked} color={marked ? p.data : p.muted} label={t("command.bookmark")} size={26} iconSize={15} onClick={() => wb.toggleBookmark({ addr, label: nameOf(addr) })} />
    </div>
  );
}

/** The pages of the model in this tab, switched like a function's views. */
function ModelBar({ name, page, width }: { readonly name: string; readonly page: ModelPage; readonly width: number }): ReactElement | null {
  const { p } = useTheme();
  const { wb, gpuData } = useBench();
  const model = gpuData.kind === "ready" ? gpuData.value.models.find((m) => m.name === name) : undefined;
  if (!model) return null;
  const pages = pagesOf(model);
  if (pages.length < 2) return null;
  const words = width === 0 || width >= WORDS_FROM;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 34, flexShrink: 0, paddingLeft: 10, paddingRight: 8, overflow: "hidden" }}>
      <Spacer />
      <div role="radiogroup" aria-label={t("workbench.chrome.modelView")} style={{ display: "flex", flexShrink: 0, gap: 2, padding: 2, borderRadius: 8, backgroundColor: p.fill }}>
        {pages.map((m) => (
          <SegItem key={m} label={pageLabel(m)} name={t("workbench.chrome.viewNamed", { name: pageLabel(m) })} icon={pageIcon(m)} words={words} on={m === page} onBg={p.sel2} padding={words ? 9 : 6} onClick={() => wb.open({ kind: "model", name, page: m }, false)} />
        ))}
      </div>
    </div>
  );
}

function ThreadView(): ReactElement {
  const { chat } = useBench();
  return (
    <div style={{ display: "flex", justifyContent: "center", flexGrow: 1, minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, flexGrow: 1, minHeight: 0, maxWidth: 720, paddingTop: 24, paddingLeft: 4, paddingRight: 4 }}>
        <div style={{ paddingLeft: 16, fontSize: 17, fontWeight: 600 }}>{`${chatTitle(chat) ?? t("workbench.chrome.newChat")} · ${chat.agents.selected.name}`}</div>
        <LiveThread chatId={chat.tabs.find((tab) => tab.active)?.id ?? null} />
      </div>
    </div>
  );
}

function Body({ tab }: { readonly tab: Tab | undefined }): ReactElement {
  const { p } = useTheme();
  const language = useSettings().settings.codeLanguage;
  if (!tab) return <EmptyPane />;
  switch (tab.kind) {
    case "fn":
      switch (tab.view) {
        case "pseudo":
          return language === "Pseudocode" ? <CodeLines addr={tab.addr} view="pseudo" /> : <RewriteView addr={tab.addr} language={language} />;
        case "asm":
          return <CodeLines addr={tab.addr} view={tab.view} />;
        case "graph":
          return <Graph addr={tab.addr} />;
        case "hex":
          return <HexView addr={tab.addr} />;
        default: {
          const unhandled: never = tab.view;
          return unhandled;
        }
      }
    case "thread":
      return <ThreadView />;
    case "list":
      return <TableView list={tab.list} />;
    case "shader":
      return <ShaderTab library={tab.library} name={tab.name} />;
    case "model":
      return <ModelTab name={tab.name} page={tab.page} tensor={tab.tensor} />;
    case "profile":
      return <ProfileTab title={tab.title} />;
    case "diff":
      return <DiffView />;
    case "debug":
      return <DebugView />;
    case "listing":
      return <Listing />;
    case "source":
      return <SourceView file={tab.file} />;
    case "resource":
      return <ResourceView file={tab.file} />;
    case "text":
      return (
        <div style={{ display: "flex", alignItems: "flex-start", flexGrow: 1, minWidth: 0, minHeight: 0, overflow: "scroll", ...scrollbar(p) }}>
          <CodeView code={tab.text} syntax="code" />
        </div>
      );
    case "tool":
      return <ToolBody tool={tab.tool} />;
    default: {
      const unhandled: never = tab;
      return unhandled;
    }
  }
}

function ownsScroll(tab: Tab | undefined): boolean {
  if (tab?.kind === "list" || tab?.kind === "listing" || tab?.kind === "thread" || tab?.kind === "text") return true;
  if (tab?.kind === "model") return pageOwnsScroll(tab.page);
  if (tab?.kind === "tool") return fillsSpace(tab.tool);
  return tab?.kind === "fn" && tab.view !== "hex";
}

/** One editor pane: its tabs, the view switcher for functions, and the open tab's content. */
export function Pane({ index }: { readonly index: number }): ReactElement {
  const { wb } = useBench();
  const { ref, width } = useSize();
  const pane = wb.s.panes[index];
  const tab = pane?.tabs[pane.active];
  return (
    <div ref={ref} role="region" aria-label={t("workbench.chrome.editor")} style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0 }}>
      <TabBar pane={index} />
      {tab?.kind === "fn" && <ModeBar pane={index} addr={tab.addr} view={tab.view} width={width} />}
      {tab?.kind === "model" && <ModelBar name={tab.name} page={tab.page} width={width} />}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflow: ownsScroll(tab) ? "hidden" : "scroll" }}>
        <Body tab={tab} />
      </div>
    </div>
  );
}
