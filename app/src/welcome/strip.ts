import type { AgentStatus } from "./agentSetup";
import { t, thisDevice } from "../i18n";
import { type EngineId, engineNamed, engineNames, engineReady, type Found, type Install, rowState } from "./engines";

export type StripAction = "installEngines" | "installAgent" | "signIn" | "unqueue";

export type Strip = {
  readonly tone: "busy" | "missing" | "failed" | "signin";
  readonly blocks: boolean;
  readonly text: string;
  readonly progress: number | null | undefined;
  readonly action: { readonly label: string; readonly does: StripAction; readonly primary: boolean } | null;
  readonly engines: readonly EngineId[];
};

export type Readiness = {
  readonly found: Readonly<Record<EngineId, Found | null>>;
  readonly installs: Readonly<Record<EngineId, Install>>;
  readonly agentName: string;
  readonly agent: AgentStatus["kind"];
  readonly waiting: boolean;
};

export function ready(r: Readiness): boolean {
  return engineReady(r.found) && r.agent === "ready";
}

function chosenPath(r: Readiness): readonly EngineId[] {
  const state = (id: EngineId): string => rowState(r.found[id], r.installs[id]);
  if (state("rizin") === "ready") return ["rizin"];
  if (state("ghidra") === "ready" && state("java") === "ready") return ["ghidra", "java"];
  if (state("rizin") !== "installing" && (state("ghidra") === "installing" || state("java") === "installing")) return ["ghidra", "java"];
  return ["rizin"];
}

function average(values: readonly (number | null)[]): number | null {
  return values.some((value) => value === null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0) / values.length;
}

/** What is still missing before a question can run, or null when nothing is. */
export function stripFor(r: Readiness): Strip | null {
  const path = chosenPath(r);
  const failed = path.filter((id) => rowState(r.found[id], r.installs[id]) === "failed");
  const missing = path.filter((id) => rowState(r.found[id], r.installs[id]) === "missing");
  const busy = path.filter((id) => rowState(r.found[id], r.installs[id]) === "installing");
  if (failed.length > 0) return { tone: "failed", text: t("setup.strip.stopped", { names: engineNames(failed) }), blocks: true, progress: undefined, action: { label: t("setup.tryAgain"), does: "installEngines", primary: false }, engines: [...failed, ...missing] };
  if (missing.length > 0) {
    const size = missing.reduce((sum, id) => sum + engineNamed(id).megabytes, 0);
    return { tone: "missing", text: t("setup.strip.needs", { names: engineNames(missing), size }), blocks: true, progress: undefined, action: { label: t("setup.install"), does: "installEngines", primary: true }, engines: missing };
  }
  if (r.agent === "install" || r.agent === "failed") return { tone: "missing", text: t("setup.strip.agentMissing", { name: r.agentName }), blocks: true, progress: undefined, action: { label: t("setup.install"), does: "installAgent", primary: true }, engines: [] };
  if (r.agent === "unavailable") return { tone: "missing", text: t("setup.strip.agentUnavailable", { name: r.agentName, device: thisDevice() }), blocks: true, progress: undefined, action: null, engines: [] };
  if (r.agent === "signin") return { tone: "signin", text: t("setup.strip.signIn", { name: r.agentName }), blocks: true, progress: undefined, action: { label: t("setup.signIn"), does: "signIn", primary: true }, engines: [] };
  if (busy.length > 0 || r.agent === "installing") {
    const what = busy.length > 0 ? engineNames(busy) : r.agentName;
    const progress = busy.length > 0 ? average(busy.map((id) => { const install = r.installs[id]; return install.phase === "running" ? install.progress : null; })) : null;
    return r.waiting
      ? { tone: "busy", text: t("setup.strip.queued", { name: what }), blocks: false, progress, action: { label: t("setup.strip.dontSend"), does: "unqueue", primary: false }, engines: [] }
      : { tone: "busy", text: t("setup.strip.installing", { name: what }), blocks: false, progress, action: null, engines: [] };
  }
  return null;
}
