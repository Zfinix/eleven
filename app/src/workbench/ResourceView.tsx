import { open, readFile, stat } from "node:fs/promises";

import type { ReactElement } from "react";

import { decompileHermes, hbcDecompiler, hermesSupported } from "../engine/hermes";
import { type ApkFiles, dartSnapshot, type DartSnapshot, hermesVersion, hexDump, il2cppMetadata, isFlutterCode, type ResourceKind, resourceKind, sizeText } from "../engine/apk";
import { plistXml } from "../engine/apple";
import { Button, ErrorCard } from "../components/kit";
import { useLoaded } from "../lib/useLoaded";
import { useTheme } from "../theme";
import { t } from "../i18n";
import { ask } from "./actions";
import { type Bench, useBench } from "./parts";
import { errorMessage } from "../lib/guards";
import { SourceLines } from "./SourceView";

const HEAD = 4096;
/** Past this a text file shows its first bytes as hex instead of every line. */
const TEXT_LIMIT = 32 << 20;

type Read = { readonly path: string; readonly size: number; readonly kind: ResourceKind; readonly text: string; readonly head: Buffer; readonly dart?: DartSnapshot | null };

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
    if (xml !== null) return { path, size, kind: "text", text: xml, head };
  }
  const kind = resourceKind(file, head);
  if (kind === "text" && size <= TEXT_LIMIT) return { path, size, kind, text: await readFile(path, "utf8"), head };
  const dart = kind === "native" && isFlutterCode(file) ? dartSnapshot(await readFile(path)) : undefined;
  return { path, size, kind: kind === "text" ? "binary" : kind, text: hexDump(head), head, ...(dart === undefined ? {} : { dart }) };
}

/** Decompiles a Hermes bundle with hermes-dec, opens the start of it, and says where the whole file is. */
function decompileBundle(bench: Bench, name: string, path: string): void {
  bench.chat.thread.note(t("workbench.view.resource.hermesWorking", { name }));
  void (async (): Promise<void> => {
    try {
      const out = await decompileHermes(path);
      bench.wb.open({ kind: "text", title: `${name}.js`, text: out.preview }, false);
      bench.chat.thread.note(t("workbench.view.resource.hermesDone", { lines: out.lines.toLocaleString("en-US"), path: out.file }));
    } catch (err) {
      bench.chat.thread.note(t("workbench.view.resource.hermesFailed", { error: errorMessage(err) }));
    }
  })();
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
  const { p } = useTheme();
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
          <Card title={name} detail={isFlutterCode(file) ? `${t("workbench.view.resource.flutter", { size: sizeText(read.size) })}${read.dart ? ` ${t("workbench.view.resource.dartSnapshot", { hash: read.dart.hash, features: read.dart.features })}` : ""}` : abiOf(file) ? t("workbench.view.resource.nativeFor", { abi: abiOf(file), size: sizeText(read.size) }) : t("workbench.view.resource.native", { size: sizeText(read.size) })}>
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
          <Card title={name} detail={hermesVersion(read.head) === null ? t("workbench.view.resource.hermes", { size: sizeText(read.size) }) : `${t("workbench.view.resource.hermes", { size: sizeText(read.size) })} ${t("workbench.view.resource.hermesVersion", { version: hermesVersion(read.head) ?? 0 })}`}>
            <>
              {hbcDecompiler() !== null && hermesSupported(hermesVersion(read.head) ?? 0) && <Button label={t("workbench.view.resource.hermesDecompile")} tone="primary" icon="pseudocode" onClick={() => decompileBundle(bench, name, read.path)} />}
              <Button label={t("workbench.view.resource.askRead", { agent })} tone="ask" onClick={() => ask(bench, `${bench.program.name} is a React Native app. Its JavaScript is compiled to Hermes bytecode at ${read.path}. Read it and tell me what the app does.`)} />
            </>
          </Card>
          {hbcDecompiler() === null && <div style={{ marginLeft: 16, marginRight: 16, fontSize: 12, color: p.muted }}>{t("workbench.view.resource.hermesInstall")}</div>}
          {hbcDecompiler() !== null && !hermesSupported(hermesVersion(read.head) ?? 0) && <div style={{ marginLeft: 16, marginRight: 16, fontSize: 12, color: p.muted }}>{t("workbench.view.resource.hermesUnsupported", { version: hermesVersion(read.head) ?? 0 })}</div>}
          <SourceLines source={{ text: read.text, starts: [] }} syntax="code" />
        </div>
      );
    case "il2cpp": {
      const meta = il2cppMetadata(read.head);
      return (
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
          <Card title={name} detail={meta.kind === "plain" ? t("workbench.view.resource.il2cpp", { version: meta.version, size: sizeText(read.size) }) : t("workbench.view.resource.il2cppEncrypted", { size: sizeText(read.size) })}>
            <Button label={t("workbench.view.resource.askRead", { agent })} tone="ask" onClick={() => ask(bench, meta.kind === "plain"
              ? `${bench.program.name} is a Unity game built with IL2CPP. Its metadata (version ${meta.version}) is at ${read.path} and the game code is in its libil2cpp library. Map the metadata's method names onto the native functions and tell me what the game does.`
              : `${bench.program.name} is a Unity game built with IL2CPP, and its metadata at ${read.path} is encrypted (no Unity header). Find where libil2cpp loads and decrypts global-metadata.dat, and explain how to get the decrypted metadata.`)} />
          </Card>
          <SourceLines source={{ text: read.text, starts: [] }} syntax="code" />
        </div>
      );
    }
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
