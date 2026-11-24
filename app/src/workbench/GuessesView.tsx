import type { ReactElement } from "react";

import { authorName, describeEdit, type Edit } from "../engine/edits";
import { standingGuesses, undo } from "../engine/history";
import { t } from "../i18n";
import { scrollbar, useTheme } from "../theme";
import { ask, goTo } from "./actions";
import { HOVER, MONO_STYLE, TextButton, useBench } from "./parts";
import { useProject } from "./useProject";

const ASK_ALL = 40;

/** Every agent claim still standing with no evidence behind it, each to check, keep or take back. */
export function GuessesView(): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { program, nameOf } = bench;
  const guesses = standingGuesses(useProject(program.id));
  const describe = (edit: Edit): string => describeEdit(edit, nameOf);
  const check = (edits: readonly Edit[]): void =>
    ask(bench, t("workbench.guesses.askPrompt", { list: edits.slice(0, ASK_ALL).map((edit) => `- ${describe(edit)} (${edit.key}), by ${authorName(edit.by)}`).join("\n") }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, flexGrow: 1, minHeight: 0, overflow: "scroll", ...scrollbar(p) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flexGrow: 1, minWidth: 0, color: p.text }}>{t("workbench.guesses.title", { count: guesses.length })}</div>
        {guesses.length > 0 && <TextButton label={t("workbench.guesses.checkAll")} tone="outline" onClick={() => check(guesses)} />}
      </div>
      <div style={{ fontSize: 12.5, color: p.muted, maxWidth: 560 }}>{guesses.length > 0 ? t("workbench.guesses.intro") : t("workbench.guesses.none")}</div>
      {guesses.map((edit) => (
        <div key={edit.id} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 32, paddingLeft: 8, paddingRight: 8, borderRadius: 8, backgroundColor: p.fill }}>
          <div onClick={() => goTo(bench, edit.key)} role="link" style={{ flexShrink: 0, fontSize: 11.5, color: p.call, cursor: "pointer", hover: HOVER, ...MONO_STYLE }}>{edit.key}</div>
          <div style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, color: p.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{describe(edit)}</div>
          <div style={{ flexShrink: 0, fontSize: 11.5, color: p.faint }}>{authorName(edit.by)}</div>
          <TextButton label={t("workbench.guesses.check")} tone="ghost" onClick={() => check([edit])} />
          <TextButton label={t("workbench.undo")} tone="ghost" onClick={() => undo(program.id, edit.id)} />
        </div>
      ))}
    </div>
  );
}
