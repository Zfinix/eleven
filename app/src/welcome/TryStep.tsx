import { type ReactElement, useEffect, useRef, useState } from "react";

import { Composer } from "../chat/Composer";
import type { Chat } from "../chat/useChat";
import { Icon } from "../components/ui";
import { type PlainId, t } from "../i18n";
import { useTheme } from "../theme";
import { glass, HOVER, lineHeight, PROBLEM_WASH } from "./look";
import { OutlineButton, Percent, PrimaryButton, Progress, StepHeading } from "./SetupParts";
import { ready, stripFor, type Strip } from "./strip";
import type { AgentSetup } from "./useAgentSetup";
import type { Engines } from "./useEngines";
import { OS, type Os, SAMPLE_APP } from "../lib/platform";

const CALCULATOR = SAMPLE_APP.path;
/** Questions that suit each platform's SAMPLE_APP. */
const IDEAS: Readonly<Record<Os, readonly [PlainId, ...PlainId[]]>> = {
  mac: ["setup.try.idea.mac.equals", "setup.try.idea.mac.history", "setup.try.idea.mac.modes"],
  windows: ["setup.try.idea.windows.save", "setup.try.idea.windows.find", "setup.try.idea.windows.encoding"],
  linux: ["setup.try.idea.linux.enter", "setup.try.idea.linux.parse", "setup.try.idea.linux.digits"],
};

function StripView({ strip, onAct }: { readonly strip: Strip; readonly onAct: () => void }): ReactElement {
  const { p } = useTheme();
  const g = glass(p);
  const dot = strip.tone === "failed" ? p.error : strip.tone === "busy" ? p.link : strip.tone === "signin" ? p.data : p.muted;
  return (
    <div role="status" style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, marginLeft: 10, marginRight: 10, paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12, borderRadius: 12, backgroundColor: strip.tone === "failed" ? PROBLEM_WASH : g.tile }}>
      <div style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, backgroundColor: dot, pointerEvents: "none" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1, minWidth: 0 }}>
        <div style={{ color: p.text, lineHeight: lineHeight(13) }}>{strip.text}</div>
        {strip.tone === "busy" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flexGrow: 1 }}><Progress progress={strip.progress ?? null} /></div>
            <Percent progress={strip.progress ?? null} />
          </div>
        )}
      </div>
      {strip.action && (strip.action.primary ? <PrimaryButton label={strip.action.label} onClick={onAct} /> : <OutlineButton label={strip.action.label} onClick={onAct} />)}
    </div>
  );
}

function Idea({ text, on, onUse }: { readonly text: string; readonly on: boolean; readonly onUse: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onUse} role="button" aria-label={text} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, paddingTop: 12, paddingBottom: 12, paddingLeft: 14, paddingRight: 14, borderWidth: 1, borderColor: on ? "transparent" : p.fill, borderRadius: 14, backgroundColor: on ? p.fill : "transparent", cursor: "pointer", hover: HOVER }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: p.muted, pointerEvents: "none" }}>
        <Icon name="app" size={12} color={p.muted} />
        <div>{SAMPLE_APP.name}</div>
      </div>
      <div style={{ pointerEvents: "none" }}>{text}</div>
    </div>
  );
}

export function tryTitle(isReady: boolean, waiting: boolean): string {
  if (isReady) return t("setup.try.ready");
  return waiting ? t("setup.try.waiting") : t("setup.try.almost");
}

/** The real home composer with a sample app attached; a send waits for any install still running. */
export function TryStep({ chat, engines, setup, onSent }: { readonly chat: Chat; readonly engines: Engines; readonly setup: AgentSetup; readonly onSent: () => void }): ReactElement {
  const { thread, agents } = chat;
  const [waiting, setWaiting] = useState<string | null>(null);
  const [seed, setSeed] = useState<{ readonly text: string }>(() => ({ text: t(IDEAS[OS][0]) }));
  const attached = useRef(false);
  useEffect(() => {
    if (attached.current || chat.target) return;
    attached.current = true;
    chat.choose(CALCULATOR);
  }, []);
  const readiness = { found: engines.found, installs: engines.installs, agentName: agents.selected.name, agent: setup.status(agents.selected).kind, waiting: waiting !== null };
  const go = ready(readiness);
  useEffect(() => {
    if (!go || waiting === null) return;
    setWaiting(null);
    thread.send(waiting);
    onSent();
  }, [go, waiting]);
  const send = (text: string): void => {
    if (!go) {
      setWaiting(text);
      return;
    }
    thread.send(text);
    onSent();
  };
  const strip = stripFor(readiness);
  const act = (): void => {
    if (!strip?.action) return;
    switch (strip.action.does) {
      case "installEngines":
        strip.engines.forEach((id) => engines.install(id));
        return;
      case "installAgent":
        setup.install(agents.selected);
        return;
      case "signIn":
        setup.signIn(agents.selected);
        return;
      case "unqueue":
        setWaiting(null);
        return;
      default: {
        const unhandled: never = strip.action.does;
        return unhandled;
      }
    }
  };
  return (
    <>
      <StepHeading title={tryTitle(go, waiting !== null)} detail={t("setup.try.detail", { app: SAMPLE_APP.name })} />
      <Composer place="landing" target={chat.target} agents={agents} thread={{ ...thread, send }} onAttach={chat.openFile} onDetach={chat.detach} onPickAgent={chat.pickAgent} slot={strip && <StripView strip={strip} onAct={act} />} seed={seed} queued={waiting !== null} blocked={strip?.blocks === true} />
      <div style={{ display: "grid", gridTemplateColumns: 3, gap: 10 }}>
        {IDEAS[OS].map((id) => {
          const text = t(id);
          return <Idea key={id} text={text} on={seed.text === text} onUse={() => setSeed({ text })} />;
        })}
      </div>
    </>
  );
}
