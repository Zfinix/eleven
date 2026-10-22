import { type ReactElement, useState } from "react";

import type { Chat } from "../chat/useChat";
import { appIcon } from "../components/ui";
import { listOf, t } from "../i18n";
import { Shell } from "../Shell";
import { scrollbar, useTheme } from "../theme";
import { EngineStep } from "./EngineStep";
import { KeymapStep } from "./KeymapStep";
import { AgentStep } from "./AgentStep";
import { busyEngines } from "./EngineStep";
import { engineNamed, engineReady } from "./engines";
import { glass, lineHeight } from "./look";
import { useAgentSetup } from "./useAgentSetup";
import { nextStep, previousStep, type StepId } from "./steps";
import { PrimaryButton, StepNav, TextButton } from "./SetupParts";
import { TryStep } from "./TryStep";
import { type Engines, useEngines } from "./useEngines";

export { markWelcomeDone, needsWelcome } from "./store";

function Pill({ text }: { readonly text: string }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 26, paddingLeft: 10, paddingRight: 10, borderRadius: 13, backgroundColor: glass(p).tile, color: p.text4, fontSize: 12 }}>
      <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.link, pointerEvents: "none" }} />
      <div>{text}</div>
    </div>
  );
}

function pillText(engines: Engines): string {
  const list = busyEngines(engines).map((id) => { const install = engines.installs[id]; const name = engineNamed(id).name; return install.phase === "running" && install.progress !== null ? `${name} ${Math.round(install.progress * 100)}%` : name; });
  return t("setup.installing", { names: listOf(list) });
}

function Footer({ step, engines, onGo, onSkip }: { readonly step: StepId; readonly engines: Engines; readonly onGo: (id: StepId) => void; readonly onSkip: () => void }): ReactElement | null {
  const before = previousStep(step);
  const after = nextStep(step);
  if (step === "keys") return null;
  const busy = busyEngines(engines).length > 0;
  const label = step === "engine" && busy && !engineReady(engines.found) ? t("setup.continueWhileInstalling") : t("setup.continue");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
      {before && <TextButton label={t("setup.back")} onClick={() => onGo(before)} />}
      {step === "engine" && <TextButton label={t("setup.later")} onClick={onSkip} />}
      <div style={{ flexGrow: 1 }} />
      {step === "agent" && busy && <Pill text={pillText(engines)} />}
      {after && <PrimaryButton label={label} height={36} onClick={() => onGo(after)} />}
      {step === "try" && <TextButton label={t("setup.skipToHome")} onClick={onSkip} />}
    </div>
  );
}

/** First run: engine, agent, shortcuts, then the real composer. Installs keep running between steps. */
export function Setup({ chat, onDone }: { readonly chat: Chat; readonly onDone: () => void }): ReactElement {
  const { p } = useTheme();
  const engines = useEngines();
  const setup = useAgentSetup(chat.agents);
  const [step, setStep] = useState<StepId>("engine");
  const body = (): ReactElement => {
    switch (step) {
      case "engine":
        return <EngineStep engines={engines} />;
      case "agent":
        return <AgentStep chat={chat} setup={setup} />;
      case "keys":
        return <KeymapStep onDone={() => setStep("try")} onBack={() => setStep("agent")} pill={busyEngines(engines).length > 0 && <Pill text={pillText(engines)} />} />;
      case "try":
        return <TryStep chat={chat} engines={engines} setup={setup} onSent={onDone} />;
      default: {
        const unhandled: never = step;
        return unhandled;
      }
    }
  };
  return (
    <Shell side={null} bare onDrop={(e) => step === "try" && e.paths?.[0] && chat.choose(e.paths[0])}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexGrow: 1, minHeight: 0, overflowY: "scroll", ...scrollbar(p), paddingTop: 48, paddingBottom: 48, paddingLeft: 16, paddingRight: 16, fontSize: 13, lineHeight: lineHeight(13) }}>
        <div style={{ flexGrow: 1 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 20, width: "100%", maxWidth: 640, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <img src={appIcon(p.icon)} style={{ width: 32, height: 32 }} />
            <div style={{ fontSize: 17, fontWeight: 600 }}>Eleven</div>
          </div>
          <StepNav current={step} onGo={setStep} />
          {body()}
          <Footer step={step} engines={engines} onGo={setStep} onSkip={onDone} />
        </div>
        <div style={{ flexGrow: 1 }} />
      </div>
    </Shell>
  );
}
