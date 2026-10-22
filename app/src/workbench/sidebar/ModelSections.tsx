import { type ReactElement, useState } from "react";

import { pageCount, pageIcon, pageLabel, pagesOf, tensorGroups } from "../../gpu/models/facts";
import type { ModelInfo } from "../../gpu/types";
import { t } from "../../i18n";
import { GpuSection } from "../GpuTabs";
import { useBench } from "../parts";
import { Faint, SideRow, SideSection } from "./parts";

const NEST = 18;

/** The model this workbench is showing: the opened file itself, or the one in the focused tab. */
function useModel(): ModelInfo | null {
  const { gpuData, wb } = useBench();
  if (gpuData.kind !== "ready") return null;
  const pane = wb.s.panes[wb.s.focus];
  const tab = pane?.tabs[pane.active];
  const named = tab?.kind === "model" ? gpuData.value.models.find((m) => m.name === tab.name) : undefined;
  return named ?? gpuData.value.models[0] ?? null;
}

function useModelTab(): { readonly page: string | null; readonly tensor: string | null } {
  const { wb } = useBench();
  const pane = wb.s.panes[wb.s.focus];
  const tab = pane?.tabs[pane.active];
  return tab?.kind === "model" ? { page: tab.page, tensor: tab.tensor } : { page: null, tensor: null };
}

/** A kernel or shader file's functions, in place of a binary's sections; a big library gets a filter. */
export function Kernels(): ReactElement {
  return (
    <GpuSection frame={(count, body) => (
      <SideSection id="gpu" title={t("workbench.side.kernels")} count={count > 0 ? `${count}` : ""}>{body}</SideSection>
    )} />
  );
}

/** The model's pages, in place of a binary's listing, strings and segments. */
export function InThisModel(): ReactElement {
  const { wb, gpuData } = useBench();
  const model = useModel();
  const here = useModelTab();
  return (
    <SideSection id="model" title={t("workbench.side.inThisModel")} count="">
      {!model && <Faint text={gpuData.kind === "loading" ? t("workbench.side.readingModel") : t("workbench.side.cantReadModel")} />}
      {model && pagesOf(model).map((page) => (
        <SideRow key={page} lead={{ kind: "icon", name: pageIcon(page) }} label={pageLabel(page)} side={pageCount(model, page)} on={here.page === page} onClick={() => wb.open({ kind: "model", name: model.name, page }, false)} />
      ))}
    </SideSection>
  );
}

/** The model's tensors gathered into their numbered blocks; a block opens to its tensors. */
export function Blocks(): ReactElement | null {
  const { wb } = useBench();
  const model = useModel();
  const here = useModelTab();
  const [open, setOpen] = useState<string | null>(null);
  if (!model || model.tensors.length === 0) return null;
  const groups = tensorGroups(model.tensors);
  const blocks = groups.filter((g) => /\d$/.test(g.key)).length;
  const pick = (name: string): void => {
    wb.open({ kind: "model", name: model.name, page: "tensors", tensor: name }, false);
    wb.reveal("inspector");
  };
  return (
    <SideSection id="blocks" title={t("workbench.side.blocks")} count={blocks > 0 ? `${blocks}` : ""}>
      {groups.map((g, ix) => {
        const only = g.tensors.length === 1 ? g.tensors[0] : undefined;
        if (only) return <SideRow key={`${g.key}:${ix}`} lead={{ kind: "none" }} label={only.name} side={only.type} mono height={28} on={here.tensor === only.name} onClick={() => pick(only.name)} />;
        const expanded = open === g.key;
        return (
          <div key={`${g.key}:${ix}`} style={{ display: "flex", flexDirection: "column" }}>
            <SideRow lead={{ kind: "icon", name: "segments" }} label={g.label} side={`${g.tensors.length}`} mono height={28} on={expanded} onClick={() => setOpen(expanded ? null : g.key)} />
            {expanded && g.tensors.map((tensor) => (
              <SideRow key={tensor.name} lead={{ kind: "none" }} label={tensor.name.slice(g.key.length + 1)} side={tensor.type} mono indent={NEST} height={28} on={here.tensor === tensor.name} onClick={() => pick(tensor.name)} />
            ))}
          </div>
        );
      })}
    </SideSection>
  );
}
