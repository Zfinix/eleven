import { basename } from "node:path";

import { t } from "../i18n";
import { hostSlice, kindOf } from "./files";
import type { SliceChoice } from "./SliceDialog";

function isIntel(arch: string): boolean {
  return arch === "x86_64" || arch === "x86_64h" || arch === "i386";
}

export function sliceName(arch: string): string {
  if (arch === "arm64e" || arch === "arm64") return t("slice.arch.appleSilicon");
  if (arch === "i386") return t("slice.arch.intel32");
  return isIntel(arch) ? "Intel" : arch;
}

export function sliceNote(arch: string, host: string | null): string {
  if (arch === host) return t("slice.note.matches");
  if (isIntel(arch) && process.arch === "arm64") return t("slice.note.rosetta");
  if (!isIntel(arch) && process.arch === "arm64") return t("slice.note.runs");
  return t("slice.note.wontRun");
}

export function sliceTitle(choice: SliceChoice): string {
  const { name } = choice;
  switch (choice.archs.length) {
    case 2:
      return t("slice.versions.two", { name });
    case 3:
      return t("slice.versions.three", { name });
    case 4:
      return t("slice.versions.four", { name });
    default:
      return t("slice.versions.many", { name, count: choice.archs.length });
  }
}

export function universalNote(choice: SliceChoice): string {
  return choice.app ? t("slice.universal.app") : t("slice.universal.binary");
}

/** The dialog contents for a universal file, with this Mac's slice first and picked. */
export function sliceChoice(path: string, archs: readonly string[], matchThisMac: boolean): SliceChoice {
  const host = hostSlice(archs);
  const ordered = [...archs].sort((a, b) => Number(b === host) - Number(a === host));
  return {
    name: basename(path).replace(/\.app$/, ""),
    app: kindOf(path) === "app",
    archs: ordered,
    host,
    chosen: host ?? ordered[0] ?? "",
    matchThisMac,
  };
}
