import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ReactElement } from "react";

import { parseCrash, placeFrames } from "../engine/crash";
import { bundleExecutable } from "../gpu/live";
import { t } from "../i18n";
import { useLoaded } from "../lib/useLoaded";
import { scrollbar, useTheme } from "../theme";
import { ask } from "./actions";
import { imageBase } from "./frida";
import type { Program } from "./model";
import { HOVER, MONO_STYLE, TextButton, useBench } from "./parts";

const ASK_FRAMES = 20;
const ASK_CODE = 4000;

/** The name the binary has in crash reports: the executable's file name, inside the bundle for an app. */
function imageName(program: Program): string {
  return basename(program.origin.endsWith(".app") ? (bundleExecutable(program.origin) ?? program.origin) : program.origin);
}

async function readCrash(program: Program, file: string): Promise<ReturnType<typeof placed>> {
  return placed(program, await readFile(file, "utf8"));
}

function placed(program: Program, text: string): { readonly app: string; readonly exception: string; readonly frames: ReturnType<typeof placeFrames> } {
  const crash = parseCrash(text);
  return { app: crash.app, exception: crash.exception, frames: placeFrames(crash.thread, imageName(program), imageBase(program.segments), program.functions.map((fn) => fn.addr)) };
}

/** A crash report laid over the binary: the crashed thread's frames, the ones in this binary opening their function. */
export function CrashView({ file }: { readonly file: string }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { program, nameOf, openFn } = bench;
  const loaded = useLoaded(() => readCrash(program, file), `${program.id}:${file}:crash`);
  if (loaded.kind === "loading") return <div style={{ padding: 16, color: p.muted }}>{t("workbench.crash.reading")}</div>;
  if (loaded.kind === "failed") return <div role="alert" style={{ padding: 16, color: p.error }}>{t("workbench.crash.failed", { error: loaded.message })}</div>;
  const { app, exception, frames } = loaded.value;
  const ours = frames.filter((frame) => frame.fn !== null).length;
  const label = (frame: (typeof frames)[number]): string => (frame.fn ? nameOf(frame.fn) : (frame.symbol ?? `${frame.image} + ${frame.offset}`));
  const askWhy = (): void => {
    void (async (): Promise<void> => {
      const top = frames.find((frame) => frame.fn !== null);
      const code = top?.fn ? (await program.code(top.fn, "pseudo").catch(() => "")).slice(0, ASK_CODE) : "";
      const stack = frames.slice(0, ASK_FRAMES).map((frame, ix) => `${ix}  ${label(frame)}${frame.addr ? ` (${frame.addr})` : ` in ${frame.image}`}`).join("\n");
      ask(bench, t("workbench.crash.askPrompt", { app, exception, stack, code: code || t("workbench.crash.noCode") }));
    })();
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, flexGrow: 1, minHeight: 0, overflow: "scroll", ...scrollbar(p) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flexGrow: 1, minWidth: 0, color: p.text }}>{t("workbench.crash.title", { app, exception })}</div>
        <TextButton label={t("workbench.crash.ask")} tone="outline" onClick={askWhy} />
      </div>
      <div style={{ fontSize: 12.5, color: p.muted }}>{ours > 0 ? t("workbench.crash.ours", { count: ours, name: program.name }) : t("workbench.crash.none", { name: program.name })}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {frames.map((frame, ix) => {
          const fn = frame.fn;
          return (
            <div key={`${ix}`} {...(fn ? { onClick: () => openFn(fn, false), role: "link" } : {})} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 26, paddingLeft: 8, paddingRight: 8, borderRadius: 6, ...(fn ? { cursor: "pointer", hover: HOVER } : {}), ...MONO_STYLE }}>
              <div style={{ width: 22, flexShrink: 0, color: p.faint }}>{String(ix)}</div>
              <div style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: fn ? p.call : p.text3 }}>{label(frame)}</div>
              <div style={{ flexShrink: 0, color: p.faint }}>{frame.addr ?? frame.image}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
