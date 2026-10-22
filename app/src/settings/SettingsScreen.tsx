import { release } from "node:os";

import { type ReactElement, useEffect, useRef, useState } from "react";

import { detectInstalled, type Presence } from "../agents/detect";
import { resolveLaunch } from "../agents/launch";
import { activeEngine } from "../analysis/engines";
import { useAgents } from "../chat/useAgents";
import { t, thisDevice } from "../i18n";
import { signedIn } from "../welcome/agentSetup";
import { Shell } from "../Shell";
import { scrollbar, useTheme } from "../theme";
import { copyText, ghidraVersion, latestRelease, rizinVersion } from "./actions";
import { isNewer } from "../lib/version";
import { buildPages, type Ctx, rowMatches } from "./catalog";
import { GroupView, PageHeader, SettingsToast } from "./controls";
import { AddressPreview, CodePreview, PresetCards, ThemeCards, WindowPreview } from "./extras";
import { checkAppUpdate, updateShort, useSettingsInfo } from "./info";
import { KeyboardSection } from "./KeyboardSection";
import type { GroupModel } from "./model";
import { Nav } from "./Nav";
import { KEYBOARD_WORDS, type Page, PAGES, pageIntro, pageTitle } from "./pages";
import { type Settings, useSettings } from "./store";
import { appVersion, openLink } from "./system";
import { OS_NAME } from "../lib/platform";

const TOAST_MS = 2200;

function Preview({ group, settings }: { readonly group: GroupModel; readonly settings: Settings }): ReactElement | null {
  switch (group.preview) {
    case "code":
      return <CodePreview settings={settings} />;
    case "address":
      return <AddressPreview settings={settings} />;
    case "window":
      return <WindowPreview transparency={settings.transparency} frost={settings.frost} />;
    case undefined:
      return null;
    default: {
      const unhandled: never = group.preview;
      return unhandled;
    }
  }
}

/** Eleven's settings: a page list on the frosted backdrop and the chosen page on the shared content card. */
export function SettingsScreen({ initial = "general", onBack, onSetup }: { readonly initial?: Page; readonly onBack: () => void; readonly onSetup: () => void }): ReactElement {
  const store = useSettings();
  const agents = useAgents();
  const { p, setAppearance } = useTheme();
  const { info, refresh } = useSettingsInfo();
  const [page, setPage] = useState<Page>(initial);
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [toastText, setToastText] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [rescanned, setRescanned] = useState<ReadonlyMap<string, Presence> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const toast = (text: string): void => {
    setConfirm(null);
    setToastText(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastText(""), TOAST_MS);
  };
  const installed = rescanned ?? agents.installed;
  const checkApp = async (): Promise<void> => {
    const result = await checkAppUpdate();
    refresh();
    toast(result.state.kind === "current" ? t("update.elevenCurrent") : updateShort(result).replace(/[.。]$/, ""));
  };
  const checkEngine = async (id: "rizin" | "ghidra"): Promise<void> => {
    const name = id === "rizin" ? "Rizin" : "Ghidra";
    const here = id === "rizin" ? (info.engines.rizin.path ? await rizinVersion(info.engines.rizin.path) : null) : info.engines.ghidra.path ? ghidraVersion(info.engines.ghidra.path) : null;
    const release = await latestRelease(id === "rizin" ? "rizinorg/rizin" : "NationalSecurityAgency/ghidra");
    if (!release) return toast(t("update.unreachable"));
    if (here && isNewer(release.version, here)) {
      openLink(release.url);
      return toast(t("update.engineOut", { name, version: release.version }));
    }
    toast(t("update.engineCurrent", { name }));
  };
  const ctx: Ctx = {
    settings: store.settings,
    update: store.update,
    agents,
    installed,
    info,
    icon: p.icon,
    browsing,
    drafts,
    setDraft: (key, value) => setDrafts({ ...drafts, [key]: value }),
    setBrowsing,
    toast,
    ask: setConfirm,
    refresh,
    rescan: () => void (async () => {
      const found = await detectInstalled(agents.list);
      setRescanned(found);
      toast(found.size === 1 ? t("settings.rescan.foundOne", { device: thisDevice() }) : t("settings.rescan.found", { count: found.size, device: thisDevice() }));
    })(),
    install: (id) => void (async () => {
      const agent = agents.list.find((entry) => entry.id === id);
      if (!agent) return;
      toast(t("settings.agent.getting", { name: agent.name }));
      try {
        await resolveLaunch(agent, null);
        toast(t("settings.agent.ready", { name: agent.name }));
      } catch {
        toast(t("settings.agent.getFailed", { name: agent.name }));
      }
    })(),
    checkApp: () => void checkApp(),
    checkEngine: (id) => void checkEngine(id),
    copyDetails: () => void (async () => {
      const details = [
        `Eleven ${appVersion()} (${process.arch}, ${OS_NAME} ${release()})`,
        `Engine: ${activeEngine()?.name ?? "none"}`,
        `Rizin: ${info.engines.rizin.version ?? "not found"}`,
        `Ghidra: ${info.engines.ghidra.version ?? "not found"}`,
        `Java: ${info.java.version ?? "not found"}`,
        `REA: ${info.rea.version ?? "not found"}`,
        `Debugger: ${info.lldb ? "found" : "not found"}`,
      ].join("\n");
      await copyText(details);
      toast(t("settings.copied"));
    })(),
    setup: onSetup,
  };
  const pages = buildPages(ctx);
  const needle = query.trim().toLowerCase();
  const hits = needle === "" ? [] : PAGES.flatMap((id) => pages[id].flatMap((group) => {
    const rows = group.rows.filter((row) => rowMatches(row, group, pageTitle(id), needle));
    return rows.length > 0 ? [{ page: id, group: { ...group, rows } }] : [];
  }));
  const shown = (id: Page): boolean => needle === "" || hits.some((hit) => hit.page === id) || pageTitle(id).toLowerCase().includes(needle) || (id === "keyboard" && KEYBOARD_WORDS.includes(needle));
  const badges = new Set<Page>([...(activeEngine() === null ? ["engines" as const] : []), ...(installed.size === 0 || agents.list.some((agent) => installed.has(agent.id) && signedIn(agent) === false) ? ["agents" as const] : [])]);
  const open = (next: Page): void => {
    setPage(next);
    setQuery("");
    setConfirm(null);
  };
  const cancel = (): void => setConfirm(null);

  return (
    <Shell side={<Nav page={page} query={query} shown={shown} badges={badges} onQuery={(next) => { setQuery(next); setConfirm(null); }} onOpen={open} onBack={onBack} />}>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexGrow: 1, minHeight: 0, overflowY: "scroll", ...scrollbar(p), paddingTop: 40, paddingBottom: 56, paddingLeft: 28, paddingRight: 28 }}>
          <div style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: 720 }}>
            {needle !== "" ? (
              <>
                <PageHeader title={t("settings.results")} intro={t("settings.results.intro", { query: query.trim() })} />
                {hits.map((hit) => (
                  <GroupView key={`${hit.page}:${hit.group.label ?? ""}`} group={hit.group} confirm={confirm} onCancel={cancel} link={{ text: pageTitle(hit.page), go: () => open(hit.page) }} />
                ))}
                {hits.length === 0 && <div style={{ color: p.muted }}>{t("settings.results.none", { query: query.trim() })}</div>}
              </>
            ) : page === "keyboard" ? (
              <KeyboardSection store={store} />
            ) : (
              <>
                <PageHeader title={pageTitle(page)} intro={pageIntro(page)} />
                {page === "appearance" && <ThemeCards value={store.settings.appearance} onPick={(appearance) => { setAppearance(appearance); store.update({ appearance }); }} />}
                {page === "permissions" && <PresetCards table={store.settings.permissions} onPick={(permissions) => store.update({ permissions })} />}
                {pages[page].map((group) => (
                  <GroupView key={group.label ?? "top"} group={group} confirm={confirm} onCancel={cancel} preview={<Preview group={group} settings={store.settings} />} />
                ))}
              </>
            )}
          </div>
        </div>
        {toastText !== "" && <SettingsToast text={toastText} />}
      </div>
    </Shell>
  );
}
