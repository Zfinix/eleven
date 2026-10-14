import { useGpuix } from "@gpuix/react";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";

import { useLiveChat } from "./bridge/live";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Home } from "./home/Home";
import { type Chat, useChat } from "./chat/useChat";
import { useCommand } from "./lib/shortcuts";
import type { Page } from "./settings/pages";
import { onOpenSettings } from "./settings/open";
import { SettingsScreen } from "./settings/SettingsScreen";
import { currentSettings, loadSettings, saveSettings, type Settings, useSettings } from "./settings/store";
import { listProjects } from "./engine/project";
import { prepareTarget, type Target } from "./engine/target";
import { type Appearance, frostRadius, paletteFor, ThemeContext } from "./theme";
import { markWelcomeDone, needsWelcome, Setup } from "./welcome/Setup";
import { Workbench } from "./workbench/Workbench";

type Screen =
  | { readonly kind: "home" }
  | { readonly kind: "settings"; readonly page: Page }
  | { readonly kind: "setup" }
  | { readonly kind: "workbench"; readonly target: Target };

const HOME: Screen = { kind: "home" };

function Overlay({ screen, chat, onBack, onSetup, onWorkbench }: {
  readonly screen: Screen;
  readonly chat: Chat;
  readonly onBack: () => void;
  readonly onWorkbench: (target: Target) => void;
  readonly onSetup: () => void;
}): ReactElement | null {
  switch (screen.kind) {
    case "home":
      return null;
    case "settings":
      return <SettingsScreen key={screen.page} initial={screen.page} onBack={onBack} onSetup={onSetup} />;
    case "workbench":
      return <Workbench key={screen.target.path} target={screen.target} chat={chat} onBack={onBack} onOpen={onWorkbench} />;
    case "setup":
      return <Setup chat={chat} onDone={onBack} />;
    default: {
      const unhandled: never = screen;
      return unhandled;
    }
  }
}

function autoOpens(when: Settings["openWorkbench"], chatting: boolean): boolean {
  switch (when) {
    case "Always":
      return true;
    case "When the agent opens code":
      return chatting;
    case "Only when I ask":
      return false;
    default: {
      const unhandled: never = when;
      return unhandled;
    }
  }
}

/** Models and shaders have nothing to chat about first, so they open straight in the workbench. */
function hasCode(target: Target): boolean {
  return target.kind === "binary" || target.kind === "app";
}

/** The most recent binary or app project, when Settings asks to start there instead of Home. */
function lastProject(): Target | null {
  if (currentSettings().launch !== "The last project") return null;
  const last = listProjects().find((entry) => entry.kind === "binary" || entry.kind === "app");
  if (!last) return null;
  try {
    return prepareTarget(last.original);
  } catch {
    return null;
  }
}

function firstScreen(reopened: Target | null): Screen {
  if (needsWelcome()) return { kind: "setup" };
  return reopened ? { kind: "workbench", target: reopened } : HOME;
}

/** The conversation lives here, so it survives moving between screens. */
export function App({ initial }: { readonly initial: Target | null }): ReactElement {
  const [appearance, setAppearance] = useState<Appearance>(loadSettings().appearance);
  const [reopened] = useState<Target | null>(() => (initial ? null : lastProject()));
  const [screen, setScreen] = useState<Screen>(() => firstScreen(reopened));
  /** The screen Settings was opened from, so Back returns there instead of Home. */
  const [returnTo, setReturnTo] = useState<Screen | null>(null);
  const [target, setTarget] = useState<Target | null>(initial ?? reopened);
  const chat = useChat(target, setTarget);
  useLiveChat(chat);
  const shown = useRef<string | null>(null);
  const here = useRef<Screen>(screen);
  here.current = screen;
  const chatting = chat.thread.state.messages.some((message) => message.kind === "user");
  const { openWorkbench, frost } = useSettings().settings;
  const { renderer } = useGpuix();
  useEffect(() => {
    if (renderer && "setWindowBlurRadius" in renderer && typeof renderer.setWindowBlurRadius === "function") renderer.setWindowBlurRadius(frostRadius(frost));
  }, [renderer, frost]);
  useEffect(() => {
    if (!target) return;
    if (hasCode(target) && !autoOpens(openWorkbench, chatting)) return;
    if (screen.kind !== "home" && screen.kind !== "workbench") return;
    const key = `${chat.thread.id}:${target.path}`;
    if (shown.current === key) return;
    shown.current = key;
    setScreen({ kind: "workbench", target });
  }, [target?.path, chatting, chat.thread.id, openWorkbench]);
  useCommand("open", chat.openFile);
  useCommand("thread", () => {
    chat.thread.reset();
    setScreen(HOME);
  });
  useCommand("stop", () => {
    if (chat.thread.busy) chat.thread.stop();
  });
  const openSettingsAt = (page: Page): void => {
    const current = here.current;
    if (current.kind !== "settings") setReturnTo(current.kind === "home" ? null : current);
    setScreen({ kind: "settings", page });
  };
  useCommand("settings", () => openSettingsAt("general"));
  useEffect(() => onOpenSettings(openSettingsAt), []);
  const back = (): void => {
    markWelcomeDone();
    const current = here.current;
    setScreen(current.kind === "settings" && returnTo ? returnTo : HOME);
  };
  const home = screen.kind === "home";
  const theme = useMemo(() => ({ p: paletteFor(appearance), appearance, setAppearance: (next: Appearance): void => {
    setAppearance(next);
    saveSettings({ ...loadSettings(), appearance: next });
  } }), [appearance]);
  return (
    <ThemeContext.Provider value={theme}>
      <ErrorBoundary onHome={() => setScreen(HOME)}>
        {home ? (
          <Home chat={chat} routes={{ onWorkbench: (picked) => setScreen({ kind: "workbench", target: picked }), onSetup: () => setScreen({ kind: "setup" }), onSettings: (page) => setScreen({ kind: "settings", page }) }} />
        ) : (
          <Overlay screen={screen} chat={chat} onBack={back} onSetup={() => setScreen({ kind: "setup" })} onWorkbench={(next) => setScreen({ kind: "workbench", target: next })} />
        )}
      </ErrorBoundary>
    </ThemeContext.Provider>
  );
}
