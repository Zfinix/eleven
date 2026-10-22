import { useMenuAction } from "../keys/menuActions";
import { loadProject } from "../engine/project";
import { exportAllPseudocode, exportFunction, exportObjcInventory } from "./export";
import { patchBytes } from "./patch";
import { useBench } from "./parts";
import { t } from "../i18n";

/** Offers the workbench's File, Export and View items to the menu bar while it is open. */
export function MenuActions(): null {
  const { wb, program, nameOf, focusAddr, chat, openCompare } = useBench();
  const code = program.functions.length > 0;
  const focused = code && focusAddr !== "";
  const exported = (work: Promise<string>): void => {
    void (async (): Promise<void> => {
      try {
        chat.thread.note(t("workbench.export.saved", { path: await work }));
      } catch (err) {
        chat.thread.note(t("workbench.export.failed", { message: err instanceof Error ? err.message : String(err) }));
      }
    })();
  };
  useMenuAction("exportPseudocode", focused ? () => exported(exportFunction(program, focusAddr, "pseudo", nameOf(focusAddr))) : null);
  useMenuAction("exportAssembly", focused ? () => exported(exportFunction(program, focusAddr, "asm", nameOf(focusAddr))) : null);
  useMenuAction("exportAllPseudocode", code ? () => exported(exportAllPseudocode(program)) : null);
  useMenuAction("exportObjc", code ? () => exported(exportObjcInventory(program)) : null);
  useMenuAction("compare", code ? openCompare : null);
  useMenuAction("writePatched", code && loadProject(program.id).patches.length > 0 ? () => exported(patchBytes(program, [])) : null);
  useMenuAction("sidebar", () => wb.patch({ sidebarOpen: !wb.s.sidebarOpen }));
  return null;
}
