import { join } from "node:path";

import { type ReactElement } from "react";

import { Icon } from "../components/ui";
import { ASSETS } from "../lib/assets";
import { useTheme } from "../theme";
import { type Engine, type EngineId, engineNamed, ENGINES, engineReady, rowState, STOPPED } from "./engines";
import { glass, HOVER, lineHeight } from "./look";
import { Note, OutlineButton, Panel, Percent, Progress, ReadyMark, StepHeading, TextButton } from "./SetupParts";
import type { Engines } from "./useEngines";
import { THIS_DEVICE } from "../lib/platform";

function rowDetail(engine: Engine, engines: Engines): string {
  const install = engines.installs[engine.id];
  const found = engines.found[engine.id];
  switch (rowState(found, install)) {
    case "ready":
      return install.phase === "done" ? "Installed" : `Found on ${THIS_DEVICE}, ${found?.where ?? ""}`;
    case "missing":
      return found?.repair ?? `${engine.about}, ${engine.megabytes} MB`;
    case "failed":
      return install.phase === "failed" ? install.message : STOPPED;
    case "installing":
      if (install.phase !== "running") return "Setting up";
      return install.progress !== null ? `Downloading ${Math.round(engine.megabytes * install.progress)} of ${engine.megabytes} MB` : install.note;
  }
}

function Logo({ engine }: { readonly engine: Engine }): ReactElement {
  return <img src={join(ASSETS, "engines", engine.logo ?? "rea.svg")} objectFit="contain" style={{ width: 32, height: 32, flexShrink: 0 }} />;
}

function Row({ engine, engines }: { readonly engine: Engine; readonly engines: Engines }): ReactElement {
  const { p } = useTheme();
  const g = glass(p);
  const install = engines.installs[engine.id];
  const state = rowState(engines.found[engine.id], install);
  const running = install.phase === "running" ? install : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 60, paddingTop: 10, paddingBottom: 10, paddingLeft: 16, paddingRight: 16, borderTopWidth: 1, borderColor: g.line }}>
      <Logo engine={engine} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{engine.name}</div>
          {engine.tag && state !== "ready" && <div style={{ display: "flex", alignItems: "center", height: 18, paddingLeft: 7, paddingRight: 7, borderRadius: 9, flexShrink: 0, backgroundColor: g.tile, color: p.text4, fontSize: 11 }}>{engine.tag}</div>}
          <div style={{ minWidth: 0, fontSize: 12, lineHeight: lineHeight(12), color: state === "failed" ? p.error : p.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{rowDetail(engine, engines)}</div>
        </div>
        {running && <Progress progress={running.progress} />}
      </div>
      {state === "missing" && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <TextButton label="I have it" onClick={() => engines.locate(engine.id)} />
          <OutlineButton label={engines.found[engine.id]?.repair ? "Repair" : "Install"} onClick={() => engines.install(engine.id)} />
        </div>
      )}
      {state === "failed" && <OutlineButton label="Try again" onClick={() => engines.install(engine.id)} />}
      {running && <Percent progress={running.progress} />}
      {state === "ready" && <ReadyMark />}
    </div>
  );
}

function BundledRow(): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 60, paddingTop: 10, paddingBottom: 10, paddingLeft: 16, paddingRight: 16, borderTopWidth: 1, borderColor: glass(p).line }}>
      <img src={join(ASSETS, "engines", "rea.svg")} objectFit="contain" style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 8 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexGrow: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, whiteSpace: "nowrap" }}>Analysis tools</div>
        <div style={{ minWidth: 0, fontSize: 12, lineHeight: lineHeight(12), color: p.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Comes with Eleven</div>
      </div>
      <ReadyMark />
    </div>
  );
}

export function busyEngines(engines: Engines): readonly EngineId[] {
  return ENGINES.filter((engine) => engines.installs[engine.id].phase === "running").map((engine) => engine.id);
}

export function engineNames(ids: readonly EngineId[]): string {
  return ids.map((id) => engineNamed(id).name).join(" and ");
}

function summary(engines: Engines): string {
  if (engineReady(engines.found)) return `Ready. Eleven opens files with ${engines.found.rizin?.found ? "Rizin" : "Ghidra"}.`;
  const busy = busyEngines(engines);
  return busy.length > 0 ? `Installing ${engineNames(busy)}` : "Install at least one engine. Rizin is the quickest to start.";
}

function InstallAll({ size, onClick }: { readonly size: number; readonly onClick: () => void }): ReactElement {
  const { p } = useTheme();
  return (
    <div onClick={onClick} role="button" aria-label="Install all" style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, height: 32, paddingLeft: 14, paddingRight: 14, borderRadius: 8, backgroundColor: p.primary, color: p.onPrimary, fontWeight: 600, cursor: "pointer", hover: HOVER }}>
      <Icon name="download" size={14} color={p.onPrimary} />
      <div>Install all</div>
      <div style={{ fontWeight: 500, opacity: 0.6 }}>{`${size} MB`}</div>
    </div>
  );
}

/** Rizin is the fast default; Ghidra is optional. Installs keep going while the next steps are open. */
export function EngineStep({ engines }: { readonly engines: Engines }): ReactElement {
  const { p } = useTheme();
  const installable = ENGINES.filter((engine) => {
    const state = rowState(engines.found[engine.id], engines.installs[engine.id]);
    return state === "missing" || state === "failed";
  });
  const total = installable.reduce((sum, engine) => sum + engine.megabytes, 0);
  return (
    <>
      <StepHeading title="Welcome to Eleven" detail="First, the tools Eleven reads apps with. Install what's missing and keep going while it downloads." />
      <Panel label="What Eleven needs">
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 14, paddingBottom: 10, paddingLeft: 16, paddingRight: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>What Eleven needs</div>
            <div style={{ fontSize: 12, lineHeight: lineHeight(12), color: p.muted }}>{summary(engines)}</div>
          </div>
          {installable.length > 1 && <InstallAll size={total} onClick={() => installable.forEach((engine) => engines.install(engine.id))} />}
        </div>
        {ENGINES.map((engine) => <Row key={engine.id} engine={engine} engines={engines} />)}
        <BundledRow />
      </Panel>
      <Note text="Rizin comes with Eleven, so files open right away. Ghidra is optional: install it here for deeper analysis. It goes into Eleven's own folder with Java, so nothing else on your computer changes." />
    </>
  );
}
