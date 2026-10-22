import { open, readFile, stat } from "node:fs/promises";

import type { ReactElement } from "react";

import { type ApkFiles, hexDump, type ResourceKind, resourceKind, sizeText } from "../engine/apk";
import { plistXml } from "../engine/apple";
import { Button, ErrorCard } from "../components/kit";
import { useLoaded } from "../lib/useLoaded";
import { useTheme } from "../theme";
import { t } from "../i18n";
import { ask } from "./actions";
import { useBench } from "./parts";
import { SourceLines } from "./SourceView";

const HEAD = 4096;
/** Past this a text file shows its first bytes as hex instead of every line. */
const TEXT_LIMIT = 32 << 20;

type Read = { readonly path: string; readonly size: number; readonly kind: ResourceKind; readonly text: string };

async function readResource(files: ApkFiles, file: string): Promise<Read> {
  const path = await files.local(file);
  const { size } = await stat(path);
  const handle = await open(path, "r");
  const head = Buffer.alloc(Math.min(HEAD, size));
  try {
    await handle.read(head, 0, head.length, 0);
  } finally {
    await handle.close();
  }
  if (head.subarray(0, 8).toString("latin1") === "bplist00") {
    const xml = await plistXml(path);
    if (xml !== null) return { path, size, kind: "text", text: xml };
  }
  const kind = resourceKind(file, head);
  if (kind === "text" && size <= TEXT_LIMIT) return { path, size, kind, text: await readFile(path, "utf8") };
  return { path, size, kind: kind === "text" ? "binary" : kind, text: hexDump(head) };
}

function Card({ title, detail, children }: { readonly title: string; readonly detail: string; readonly children?: ReactElement }): ReactElement {
  const { p } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, margin: 16, padding: 16, borderRadius: 10, backgroundColor: p.fill }}>
      <div style={{ fontWeight: 500, color: p.text }}>{title}</div>
      <div style={{ fontSize: 12.5, color: p.muted }}>{detail}</div>
      {children && <div style={{ display: "flex", gap: 8, marginTop: 6 }}>{children}</div>}
    </div>
  );
}

function abiOf(file: string): string {
  return /^lib\/([^/]+)\//.exec(file)?.[1] ?? "";
}

function Loaded({ file, read }: { readonly file: string; readonly read: Read }): ReactElement {
  const bench = useBench();
  const name = file.split("/").pop() ?? file;
  const agent = bench.chat.agents.selected.name;
  switch (read.kind) {
    case "text":
      return <SourceLines source={{ text: read.text, starts: [] }} syntax="code" />;
    case "image":
      return (
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
          <Card title={name} detail={t("workbench.view.resource.image", { size: sizeText(read.size) })} />
          <div style={{ display: "flex", flexGrow: 1, minHeight: 0, alignItems: "center", justifyContent: "center", padding: 24 }}>
            <img src={read.path} objectFit="contain" style={{ width: "100%", height: "100%" }} />
          </div>
        </div>
      );
    case "native":
      return (
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
          <Card title={name} detail={abiOf(file) ? t("workbench.view.resource.nativeFor", { abi: abiOf(file), size: sizeText(read.size) }) : t("workbench.view.resource.native", { size: sizeText(read.size) })}>
            <>
              <Button label={t("workbench.view.resource.openLibrary")} tone="primary" icon="library" onClick={() => void bench.chat.choose(read.path)} />
              <Button label={t("workbench.view.resource.ask", { agent })} tone="ask" onClick={() => ask(bench, `What does ${name}, a native library in ${bench.program.name}, do? It's unpacked at ${read.path}.`)} />
            </>
          </Card>
          <SourceLines source={{ text: read.text, starts: [] }} syntax="code" />
        </div>
      );
    case "hermes":
      return (
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
          <Card title={name} detail={t("workbench.view.resource.hermes", { size: sizeText(read.size) })}>
            <Button label={t("workbench.view.resource.askRead", { agent })} tone="ask" onClick={() => ask(bench, `${bench.program.name} is a React Native app. Its JavaScript is compiled to Hermes bytecode at ${read.path}. Read it and tell me what the app does.`)} />
          </Card>
          <SourceLines source={{ text: read.text, starts: [] }} syntax="code" />
        </div>
      );
    case "binary":
      return (
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
          <Card title={name} detail={t("workbench.view.resource.binary", { size: sizeText(read.size), head: sizeText(Math.min(HEAD, read.size)) })} />
          <SourceLines source={{ text: read.text, starts: [] }} syntax="code" />
        </div>
      );
    default: {
      const unhandled: never = read.kind;
      return unhandled;
    }
  }
}

/** One file from inside an app: text as code, images as images, native libraries ready to open. */
export function ResourceView({ file }: { readonly file: string }): ReactElement {
  const { p } = useTheme();
  const { program } = useBench();
  const files = program.resources;
  const read = useLoaded(() => (files ? readResource(files, file) : Promise.reject(new Error("This file has no app resources."))), `${program.id}:res:${file}`);
  switch (read.kind) {
    case "loading":
      return <div style={{ padding: 16, color: p.muted }}>{t("workbench.view.reading", { file })}</div>;
    case "failed":
      return <div style={{ padding: 16 }}><ErrorCard title={t("workbench.view.openFailed", { file })} detail={t("workbench.view.openFailed.file")} raw={read.message} /></div>;
    case "ready":
      return <Loaded file={file} read={read.value} />;
    default: {
      const unhandled: never = read;
      return unhandled;
    }
  }
}
