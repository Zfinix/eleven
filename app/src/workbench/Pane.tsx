import { type ReactElement, useState } from "react";

import { chatTitle } from "../chat/useChat";
import { Tooltip } from "../components/kit";
import { CodeView } from "../components/code";
import { DALVIK } from "../engine/jadx";
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

const MODES: readonly { readonly mode: CodeMode; readonly label: string; readonly icon: string; readonly tip: string }[] = [
  { mode: "asm", label: "Listing", icon: "assembly", tip: "The machine instructions in order, with labels and references" },
  { mode: "pseudo", label: "Pseudocode", icon: "pseudocode", tip: "The function rebuilt as C-like code. Easiest to read, but a guess." },
  { mode: "graph", label: "Graph", icon: "graph", tip: "The function's branches and loops as connected blocks" },
  { mode: "hex", label: "Hex", icon: "hex", tip: "The raw bytes in the file at this address" },
];

/** Android methods come from jadx (Java) and apktool (smali); there are no blocks or file bytes to show. */
const DALVIK_MODES: readonly { readonly mode: CodeMode; readonly label: string; readonly icon: string; readonly tip: string }[] = [
  { mode: "asm", label: "Smali", icon: "assembly", tip: "The method's Dalvik instructions as smali, the way apktool prints them" },
  { mode: "pseudo", label: "Java", icon: "pseudocode", tip: "The method decompiled to Java by jadx" },
];

type LanguageMark = { readonly icon: string } | { readonly logo: string };

const LANGUAGE_MARK: Readonly<Record<CodeLanguage, LanguageMark>> = {
  Pseudocode: { icon: "pseudocode" }, C: { logo: "lang-c" }, "C++": { logo: "lang-cpp" }, Rust: { icon: "lang-rust" }, Go: { icon: "lang-go" }, Swift: { logo: "lang-swift" },
  Python: { logo: "lang-python" }, TypeScript: { logo: "lang-typescript" }, Java: { logo: "lang-java" }, "C#": { logo: "lang-csharp" }, Zig: { logo: "lang-zig" },
};

/** Which language the pseudocode view shows: the engine's own pseudocode, or the agent's rewrite in another language. */
function LanguagePicker(): ReactElement {
  const { p } = useTheme();
  const { settings, update } = useSettings();
  const current = settings.codeLanguage;
  const entries = CODE_LANGUAGES.map((language): MenuEntry => {
    const mark = language === current ? { icon: "check" } : LANGUAGE_MARK[language];
    return { kind: "action", label: language, ...mark, run: () => update({ codeLanguage: language }) };
  });
  return (
    <Tooltip label="Rewrite this function in another language with the chat's agent">
      <div onClick={(event) => openMenu(event.x ?? 0, event.y ?? 0, entries)} role="button" aria-label={`Language: ${current}`} style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, height: 26, paddingLeft: 9, paddingRight: 7, borderRadius: 7, backgroundColor: p.fill, fontSize: 12, color: p.text3, cursor: "pointer", hover: HOVER }}>
        <div style={{ whiteSpace: "nowrap", pointerEvents: "none" }}>{current}</div>
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
      <input {...TYPING} value={draft} placeholder={showAddress(addr)} aria-label="Go to address or symbol" onChange={(e) => setDraft(e.value ?? "")} onSubmit={go} style={{ flexGrow: 1, minWidth: 0, fontSize: 12, color: p.text3, ...MONO_STYLE }} />
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
      <div role="radiogroup" aria-label="View" style={{ display: "flex", flexShrink: 0, gap: 2, padding: 2, borderRadius: 8, backgroundColor: p.fill }}>
        {modes.map((m) => (
          <Tooltip key={m.mode} label={words ? m.tip : `${m.label}: ${m.tip}`}>
            <div style={{ display: "flex" }}>
              <SegItem label={m.label} name={`${m.label} view`} icon={m.icon} words={words} on={m.mode === view} onBg={p.sel2} padding={words ? 9 : 6} onClick={() => wb.setView(pane, m.mode)} />
            </div>
          </Tooltip>
        ))}
      </div>
      {view === "asm" && <IconButton icon="split" label="Pseudocode beside it, lines linked" on={wb.s.linked} color={wb.s.linked ? p.text : p.muted} size={26} iconSize={15} onClick={() => wb.besidePseudo(addr)} />}
      {view === "asm" && program.arch !== DALVIK && <IconButton icon="hex" label="Show bytes" on={wb.s.showBytes} color={wb.s.showBytes ? p.text : p.muted} size={26} iconSize={15} onClick={() => wb.patch({ showBytes: !wb.s.showBytes })} />}
      <IconButton icon="bookmark" on={marked} color={marked ? p.data : p.muted} label="Bookmark" size={26} iconSize={15} onClick={() => wb.toggleBookmark({ addr, label: nameOf(addr) })} />
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
      <div role="radiogroup" aria-label="Model view" style={{ display: "flex", flexShrink: 0, gap: 2, padding: 2, borderRadius: 8, backgroundColor: p.fill }}>
        {pages.map((m) => (
          <SegItem key={m} label={pageLabel(m)} name={`${pageLabel(m)} view`} icon={pageIcon(m)} words={words} on={m === page} onBg={p.sel2} padding={words ? 9 : 6} onClick={() => wb.open({ kind: "model", name, page: m }, false)} />
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
        <div style={{ paddingLeft: 16, fontSize: 17, fontWeight: 600 }}>{`${chatTitle(chat) ?? "New chat"} · ${chat.agents.selected.name}`}</div>
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
    <div ref={ref} role="region" aria-label="Editor" style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0 }}>
      <TabBar pane={index} />
      {tab?.kind === "fn" && <ModeBar pane={index} addr={tab.addr} view={tab.view} width={width} />}
      {tab?.kind === "model" && <ModelBar name={tab.name} page={tab.page} width={width} />}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflow: ownsScroll(tab) ? "hidden" : "scroll" }}>
        <Body tab={tab} />
      </div>
    </div>
  );
}
