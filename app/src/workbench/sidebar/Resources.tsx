import { type ReactElement, useMemo, useState } from "react";

import { t } from "../../i18n";
import { useBench } from "../parts";
import { lazyRows } from "./lazyRows";
import { useFolders } from "./memory";
import { SideSection, useSectionOpen } from "./parts";
import { indexResources, visibleResources } from "./resourceTree";
import { TreeFile, TreeFolder, TreeMore } from "./SourceRows";

/** res/ can hold thousands of files; past this the tree waits for "more". */
const SHOWN = 400;

const NO_PATHS: readonly string[] = [];

/** The app's files (manifest, plists, res, assets, native libraries and frameworks), each opening in a resource tab. Lone binaries have none. */
export function Resources(): ReactElement | null {
  const { program, wb } = useBench();
  const folders = useFolders();
  const { open: sectionOpen } = useSectionOpen("resources");
  const [all, setAll] = useState(false);
  const paths = program.resources?.files ?? NO_PATHS;
  const index = useMemo(() => lazyRows(() => indexResources(paths)), [paths]);
  const tree = useMemo(() => (sectionOpen ? visibleResources(index(), folders.isOpen) : []), [index, sectionOpen, folders.isOpen]);
  if (paths.length === 0) return null;
  const pane = wb.s.panes[wb.s.focus];
  const tab = pane?.tabs[pane.active];
  const shown = all ? tree : tree.slice(0, SHOWN);
  return (
    <SideSection id="resources" title={t("workbench.side.resources")} count={paths.length === 1 ? t("workbench.side.oneFile") : t("workbench.side.files", { count: paths.length.toLocaleString() })}>
      {shown.map(({ node, open }) => node.folder
        ? <TreeFolder key={node.path} name={node.name} open={open} depth={node.depth} onClick={() => folders.toggle(`res:${node.path}`)} />
        : <TreeFile key={node.full} name={node.name} ext={node.ext} depth={node.depth} count="" on={tab?.kind === "resource" && tab.file === node.full}
          onClick={() => wb.open({ kind: "resource", file: node.full }, true)}
          menu={() => [
            { kind: "action", label: t("workbench.side.open"), icon: "source", run: () => wb.open({ kind: "resource", file: node.full }, false) },
            { kind: "action", label: t("workbench.side.openInSplit"), icon: "split", run: () => wb.openSplit({ kind: "resource", file: node.full }) },
          ]} />)}
      {tree.length > SHOWN && <TreeMore label={all ? t("workbench.side.showFewer") : t("workbench.side.more", { count: (tree.length - SHOWN).toLocaleString() })} onClick={() => setAll(!all)} />}
    </SideSection>
  );
}
