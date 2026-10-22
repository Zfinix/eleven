import type { ReactElement } from "react";

import { activeEngine } from "../analysis/engines";
import { Tooltip } from "../components/kit";
import { t } from "../i18n";
import { explainArch } from "../lib/explain";
import { useLoaded } from "../lib/useLoaded";
import { useTheme } from "../theme";
import { Dot, Icon, Spacer } from "../components/ui";
import { fileOffset } from "./patch";
import { HOVER, isGpuBench, isModelBench, MONO_STYLE, useBench } from "./parts";
import { currentAddr, placeIn } from "./where";

function analysis(total: number, opening: boolean): string {
  if (opening) return t("workbench.chrome.analyzing");
  return total === 1 ? t("workbench.chrome.analyzed.one") : t("workbench.chrome.analyzed.many", { count: total.toLocaleString("en-US") });
}

/** The status bar: analysis state, engine and arch, then exactly where you are and the details toggle. */
/** A model has no engine or addresses: just what was read from its headers. */
function ModelStatus(): ReactElement {
  const { p } = useTheme();
  const { gpuData } = useBench();
  const model = gpuData.kind === "ready" ? gpuData.value.models[0] : undefined;
  const read = gpuData.kind === "loading" ? t("workbench.chrome.readingHeaders") : model ? t("workbench.chrome.readHeaders", { count: model.tensors.length.toLocaleString("en-US") }) : t("workbench.chrome.cantReadModel");
  return (
    <div role="contentinfo" aria-label={t("workbench.chrome.status")} style={{ display: "flex", alignItems: "center", gap: 14, height: 28, flexShrink: 0, paddingLeft: 10, paddingRight: 10, borderTopWidth: 1, borderColor: p.fill, fontSize: 11.5, color: p.muted, whiteSpace: "nowrap", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Dot color={gpuData.kind === "loading" ? p.data : p.string} size={6} />
        <div>{read}</div>
      </div>
      {model && <div>{model.format.split(" · ")[0] ?? model.format}</div>}
      <Spacer />
      <div>{t("workbench.chrome.nothingLoaded")}</div>
    </div>
  );
}

function kernelsRead(count: number): string {
  return count === 1 ? t("workbench.chrome.readKernel") : t("workbench.chrome.readKernels", { count: count.toLocaleString("en-US") });
}

/** Shader and kernel files: how many functions were read, and from which GPU APIs. */
function GpuStatus(): ReactElement {
  const { p } = useTheme();
  const { gpuData } = useBench();
  const libraries = gpuData.kind === "ready" ? gpuData.value.libraries : [];
  const count = libraries.reduce((sum, lib) => sum + lib.functions.length, 0);
  const read = gpuData.kind === "loading" ? t("workbench.chrome.readingGpu") : libraries.length > 0 ? kernelsRead(count) : t("workbench.chrome.noGpu");
  return (
    <div role="contentinfo" aria-label={t("workbench.chrome.status")} style={{ display: "flex", alignItems: "center", gap: 14, height: 28, flexShrink: 0, paddingLeft: 10, paddingRight: 10, borderTopWidth: 1, borderColor: p.fill, fontSize: 11.5, color: p.muted, whiteSpace: "nowrap", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Dot color={gpuData.kind === "loading" ? p.data : p.string} size={6} />
        <div>{read}</div>
      </div>
      {libraries.map((lib) => <div key={lib.name}>{lib.api === "cuda" ? "CUDA" : lib.api === "hip" ? "HIP" : "Metal"}</div>)}
      <Spacer />
      <div>{t("workbench.chrome.nothingRun")}</div>
    </div>
  );
}

export function StatusBar(): ReactElement {
  const bench = useBench();
  if (isModelBench(bench)) return <ModelStatus />;
  return isGpuBench(bench) ? <GpuStatus /> : <CodeStatus />;
}

function CodeStatus(): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { wb, focusAddr, program, nameOf } = bench;
  const at = currentAddr(bench);
  const opening = program.id === "";
  const offset = useLoaded<number | null>(() => (program.dossier ? fileOffset(program.path, at) : Promise.resolve(null)), `${program.path}:${at}:offset`);
  return (
    <div role="contentinfo" aria-label={t("workbench.chrome.status")} style={{ display: "flex", alignItems: "center", gap: 14, height: 28, flexShrink: 0, paddingLeft: 10, paddingRight: 10, borderTopWidth: 1, borderColor: p.fill, fontSize: 11.5, color: p.muted, whiteSpace: "nowrap", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Dot color={opening ? p.data : p.string} size={6} />
        <div>{analysis(program.total || program.functions.length, opening)}</div>
      </div>
      <Tooltip label={t("workbench.chrome.engineHint")} side="top">
        <div>{activeEngine()?.name ?? t("workbench.chrome.noEngine")}</div>
      </Tooltip>
      <Tooltip label={explainArch(program.arch)} side="top">
        <div>{program.arch}</div>
      </Tooltip>
      <Spacer />
      <div style={MONO_STYLE}>{placeIn(nameOf(focusAddr), focusAddr, at)}</div>
      <div style={MONO_STYLE}>{at}</div>
      {offset.kind === "ready" && offset.value !== null && <div style={MONO_STYLE}>{t("workbench.chrome.fileOffset", { offset: `0x${offset.value.toString(16)}` })}</div>}
      <div onClick={() => wb.patch({ bottomOpen: !wb.s.bottomOpen })} role="button" aria-label={t("workbench.chrome.toggleDetails")} aria-selected={wb.s.bottomOpen} style={{ display: "flex", alignItems: "center", cursor: "pointer", hover: HOVER }}>
        <Icon name="panel" size={14} color={wb.s.bottomOpen ? p.text : p.faint} on={wb.s.bottomOpen} />
      </div>
    </div>
  );
}
