import type { Syntax } from "../../components/code";
import { t } from "../../i18n";

/** The question Explain asks, in the reader's language like the other suggestions. */
export function explainQuestion(): string {
  return t("ask.q.explain");
}

const UNNAMED = /\b(?:DAT|FUN|PTR|LAB)_[0-9a-fA-F]+\b/;
const ODD_NUMBER = /(?<![\w.$%])-?(?:0x[0-9a-fA-F]{5,}|\d{6,})\b/;
const BRANCH = /\b(?:if|while|for|switch)\b/;

/** Up to three questions that fit the picked lines: what they do, a name worth giving, a number worth explaining. */
export function suggestedQuestions(lines: readonly string[], syntax: Syntax): readonly string[] {
  const text = lines.join("\n");
  const unnamed = UNNAMED.exec(text)?.[0];
  const odd = ODD_NUMBER.exec(text)?.[0];
  const lowLevel = syntax === "asm" || syntax === "ptx";
  return [
    explainQuestion(),
    ...(unnamed ? [t("ask.q.name", { name: unnamed })] : []),
    ...(odd ? [t("ask.q.why", { number: odd })] : []),
    ...(!lowLevel && BRANCH.test(text) ? [t("ask.q.branch")] : []),
    ...(lowLevel ? [t("ask.q.inC")] : []),
    t("ask.q.used"),
  ].slice(0, 3);
}
