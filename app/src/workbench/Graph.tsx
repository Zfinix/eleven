import { type EventPayload, type PublicInstance, useGpuix } from "@gpuix/react";
import { type ReactElement, type RefObject, useEffect, useMemo, useRef, useState } from "react";

import type { Dossier } from "../engine/dossier";
import { DALVIK } from "../engine/jadx";
import { useLoaded } from "../lib/useLoaded";
import { Button, ErrorCard, Tooltip } from "../components/kit";
import { errorMessage } from "../lib/guards";
import type { BlockGroup } from "../engine/project";
import { showAddress, useCodeLook } from "../settings/look";
import { type Settings, useSettings } from "../settings/store";
import { MONO, useTheme } from "../theme";
import { BLOCK_WIDTH, edgeImages, foldGroups, type Layout, layoutGraph, LINE_HEIGHT, type Placed } from "./cfg";
import { groupBlocks, subjectMenu } from "./actions";
import { exportGraphPdf } from "./export";
import { graphPdf, type PdfBlock } from "./graphPdf";
import { HOVER, IconButton, useBench } from "./parts";
import { type Camera, centerOn, fitCamera, panBy, type Size, visibleRect, zoomAt } from "./camera";
import { highlightedWord } from "./CodeLines";
import { splitWords, type Subject, type Token, wordAddress } from "./subject";
import { MOD } from "../lib/platform";
import { t } from "../i18n";
import { edgeKey, visitText, type Walker, WalkBar, walkMarks, useWalk } from "./WalkBar";

const PADDING = 24;
const FONT_SIZE = 11.5;
const ZOOM_STEP = 1.25;
const ZOOM_PER_PIXEL = 0.01;
const WHEEL_LINE = 20;

type Text = { readonly family: string; readonly size: number; readonly lineHeight: number };

const SMALL: Text = { family: MONO, size: FONT_SIZE, lineHeight: LINE_HEIGHT };

function blockCap(lines: Settings["blockLines"]): number {
  return lines === "All" ? Number.POSITIVE_INFINITY : Number(lines);
}

function Instruction({ fn, addr, text }: { readonly fn: string; readonly addr: string; readonly text: string }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { addrOf, nameOf, openFn, wb } = bench;
  const subject = (token: Token | null): Subject => ({ kind: "line", fn, view: "asm", number: -1, text: `${addr}: ${text}`, addr, token });
  const picked = wb.s.selected?.kind === "line" && wb.s.selected.addr === addr;
  const lit = highlightedWord(wb.s.selected, fn);
  const comment = wb.s.comments.get(addr);
  return (
    <div {...subjectMenu(bench, subject(null), () => wb.select(subject(null)))} style={{ display: "flex", whiteSpace: "nowrap", overflow: "hidden", ...(picked ? { backgroundColor: p.raised2, borderRadius: 4 } : {}) }}>
      {splitWords(text).map(({ text: piece, word }, ix) => {
        if (!word) return <div key={ix} style={{ color: p.text3 }}>{piece}</div>;
        const target = addrOf(piece);
        const token = { text: piece, addr: target ?? wordAddress(piece) };
        const glow = lit === piece ? { backgroundColor: p.sel2, borderRadius: 3 } : {};
        if (target) return <div key={ix} {...subjectMenu(bench, subject(token), () => openFn(target, false))} role="link" aria-label={t("workbench.graph.open", { name: nameOf(target) })} style={{ color: p.link, textDecoration: "underline", cursor: "pointer", ...glow }}>{nameOf(target)}</div>;
        return <div key={ix} {...subjectMenu(bench, subject(token), () => wb.select(subject(token)))} style={{ color: p.text3, ...glow }}>{piece}</div>;
      })}
      {comment && <div style={{ color: p.comment }}>{`  ; ${comment}`}</div>}
    </div>
  );
}

type Visit = { readonly steps: readonly number[]; readonly current: boolean };

function StepBadge({ visit, zoom }: { readonly visit: Visit; readonly zoom: number }): ReactElement {
  const { p } = useTheme();
  const label = visit.steps.length === 1 ? t("workbench.walk.visit", { steps: String(visit.steps[0]) }) : t("workbench.walk.visits", { steps: visit.steps.join(", ") });
  return (
    <div aria-label={label} style={{ flexShrink: 0, paddingLeft: 6 * zoom, paddingRight: 6 * zoom, borderRadius: 8 * zoom, backgroundColor: visit.current ? p.link : p.sel2, color: visit.current ? p.card : p.link, fontSize: 10.5 * zoom, lineHeight: 15 * zoom, whiteSpace: "nowrap" }}>
      {visitText(visit.steps)}
    </div>
  );
}

function BlockBox({ fn, placed, entry, group, visit, zoom, text, onPinch }: { readonly fn: string; readonly placed: Placed; readonly entry: boolean; readonly group: BlockGroup | null; readonly visit: Visit | null; readonly zoom: number; readonly text: Text; readonly onPinch: (event: EventPayload) => void }): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { wb } = bench;
  const { settings } = useSettings();
  const { start, end } = placed.block;
  const shownStart = showAddress(start, settings);
  const subject: Subject = { kind: "block", fn, start, end };
  const color = wb.s.colors.get(start);
  const picked = wb.s.selected?.kind === "block" && wb.s.selected.start === start;
  const gathered = wb.s.blockPicks.includes(start);
  const edge = gathered || visit ? p.link : picked ? p.text3 : (color ?? (entry ? p.line3 : p.sel));
  const click = (event: EventPayload): void => {
    if (event.modifiers?.shift) wb.patch({ blockPicks: gathered ? wb.s.blockPicks.filter((b) => b !== start) : [...wb.s.blockPicks, start] });
    else wb.patch({ selected: subject, blockPicks: [] });
  };
  return (
    <div {...subjectMenu(bench, subject, click)} onPinch={onPinch} aria-label={group ? t("workbench.graph.group", { name: group.label }) : t("workbench.graph.block", { address: start })} style={{ userSelect: "text", position: "absolute", left: (placed.x + PADDING) * zoom, top: (placed.y + PADDING) * zoom, width: BLOCK_WIDTH * zoom, height: placed.height * zoom, display: "flex", flexDirection: "column", overflow: "hidden", paddingTop: 8 * zoom, paddingBottom: 8 * zoom, paddingLeft: 10 * zoom, paddingRight: 10 * zoom, borderWidth: color || gathered || visit?.current ? 2 : 1, borderColor: edge, borderRadius: 9 * zoom, backgroundColor: visit?.current ? p.sel : group ? p.raised2 : p.raised, fontSize: text.size * zoom, lineHeight: text.lineHeight * zoom }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 * zoom, marginBottom: 2 * zoom }}>
        <div style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, color: color ?? p.link, overflow: "hidden", whiteSpace: "nowrap" }}>{group ? group.label : shownStart}</div>
        {visit && <StepBadge visit={visit} zoom={zoom} />}
      </div>
      {group && <div style={{ color: p.faint }}>{t("workbench.graph.folded", { count: group.blocks.length, address: shownStart })}</div>}
      {placed.lines.map((line, ix) => <Instruction key={ix} fn={fn} addr={placed.addrs[ix] ?? start} text={line} />)}
      {placed.hidden > 0 && <div style={{ color: p.faint }}>{placed.hidden === 1 ? t("workbench.graph.oneMoreLine") : t("workbench.graph.moreLines", { count: placed.hidden })}</div>}
    </div>
  );
}

/** Edges coloured by kind; during a walk the ones it took turn blue and the rest dim. */
function Edges({ layout, walked, zoom }: { readonly layout: Layout; readonly walked: ReadonlySet<string> | null; readonly zoom: number }): ReactElement {
  const { p } = useTheme();
  const colors = { taken: p.string, fallthrough: p.error, always: p.gutter, back: p.link } as const;
  const images = useMemo(() => edgeImages(layout), [layout]);
  return (
    <>
      {images.map((edge, ix) => {
        const at = layout.edges[ix];
        const taken = walked !== null && at !== undefined && walked.has(edgeKey(at.from.block.start, at.to.block.start));
        return <svg key={ix} source={edge.source} style={{ position: "absolute", left: (PADDING + edge.x) * zoom, top: (PADDING + edge.y) * zoom, width: edge.width * zoom, height: edge.height * zoom, color: taken ? p.link : colors[edge.kind], opacity: walked === null || taken ? 1 : 0.45, pointerEvents: "none" }} />;
      })}
    </>
  );
}

type View = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

const MAP_WIDTH = 180;
const MAP_HEIGHT = 140;

function mapSvg(layout: Layout, scale: number, width: number, height: number): string {
  const rects = layout.blocks.map((b) => `<rect x="${((b.x + PADDING) * scale).toFixed(1)}" y="${((b.y + PADDING) * scale).toFixed(1)}" width="${(BLOCK_WIDTH * scale).toFixed(1)}" height="${Math.max(2, b.height * scale).toFixed(1)}" rx="1.5"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="black">${rects.join("")}</svg>`;
}

/** A small map of the whole graph in the corner: the blocks, the part on screen, and a click to go anywhere. */
function Minimap({ layout, view, onJump, onPinch }: { readonly layout: Layout; readonly view: View; readonly onJump: (x: number, y: number) => void; readonly onPinch: (event: EventPayload) => void }): ReactElement | null {
  const { p } = useTheme();
  const { renderer } = useGpuix();
  const box = useRef<PublicInstance | null>(null);
  const [dragging, setDragging] = useState(false);
  const full = { width: layout.width + BLOCK_WIDTH + PADDING * 2, height: layout.height + PADDING * 2 };
  const scale = Math.min(MAP_WIDTH / full.width, MAP_HEIGHT / full.height);
  const width = Math.max(40, full.width * scale);
  const height = Math.max(30, full.height * scale);
  if (view.width === 0 || (view.width >= full.width && view.height >= full.height)) return null;
  const click = (event: EventPayload): void => {
    const id = box.current?.id;
    const at = id === undefined ? null : renderer?.getElementBounds?.(id);
    if (!at) return;
    onJump(((event.x ?? 0) - at.x) / scale, ((event.y ?? 0) - at.y) / scale);
  };
  const shadow = { offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: 0, color: "rgba(0,0,0,0.3)" };
  return (
    <div
      ref={box}
      onMouseDown={(event) => {
        setDragging(true);
        click(event);
      }}
      onMouseMove={(event) => {
        if (!dragging) return;
        if (event.pressedButton === undefined || event.pressedButton === null) setDragging(false);
        else click(event);
      }}
      onMouseUp={() => setDragging(false)}
      onPinch={onPinch}
      role="img" aria-label={t("workbench.graph.overview")} style={{ position: "absolute", right: 14, bottom: 14, width, height, borderWidth: 1, borderColor: p.sel2, borderRadius: 8, backgroundColor: p.raised2, overflow: "hidden", cursor: dragging ? "grabbing" : "grab", boxShadow: shadow }}>
      <svg source={mapSvg(layout, scale, width, height)} style={{ position: "absolute", top: 0, left: 0, width, height, color: p.line3, pointerEvents: "none" }} />
      <div style={{ position: "absolute", left: Math.max(0, view.x * scale), top: Math.max(0, view.y * scale), width: Math.min(width, view.width * scale), height: Math.min(height, view.height * scale), borderWidth: 1, borderColor: p.link, borderRadius: 3, pointerEvents: "none" }} />
    </div>
  );
}

function GraphTools({ fn, layout, blocks, zoom, walking, onWalk, onZoom, onFit, onPinch }: {
  readonly fn: string;
  readonly walking: boolean;
  readonly onWalk: () => void;
  readonly layout: Layout;
  readonly blocks: ReadonlyMap<string, PdfBlock>;
  readonly zoom: number;
  readonly onZoom: (factor: number) => void;
  readonly onFit: () => void;
  readonly onPinch: (event: EventPayload) => void;
}): ReactElement {
  const { p } = useTheme();
  const bench = useBench();
  const { wb, program, nameOf } = bench;
  const picks = wb.s.blockPicks;
  const exportPdf = (): void => {
    void (async (): Promise<void> => {
      try {
        const path = await exportGraphPdf(program, nameOf(fn), graphPdf(layout, blocks, `${nameOf(fn)} · ${fn}`));
        wb.notify(t("workbench.graph.saved", { path }), null);
      } catch (err) {
        wb.notify(t("workbench.graph.saveFailed", { message: errorMessage(err) }), null);
      }
    })();
  };
  return (
    <div onPinch={onPinch} style={{ position: "absolute", top: 10, right: 14, display: "flex", alignItems: "center", gap: 6 }}>
      {picks.length > 0 && <div style={{ fontSize: 12, color: p.muted }}>{t("workbench.graph.picked", { count: picks.length })}</div>}
      {picks.length > 1 && <Button label={t("workbench.groupBlocks", { count: picks.length })} tone="primary" size="small" onClick={() => groupBlocks(bench, fn, picks)} />}
      <div role="group" aria-label={t("workbench.graph.zoom")} style={{ display: "flex", alignItems: "center", gap: 2, padding: 2, borderWidth: 1, borderColor: p.line2, borderRadius: 8, backgroundColor: p.raised }}>
        <IconButton icon="zoom-out" label={t("workbench.graph.zoomOut", { key: MOD.replace("+", "") })} size={24} iconSize={13} radius={6} onClick={() => onZoom(1 / ZOOM_STEP)} />
        <Tooltip label={t("workbench.graph.fit")}>
          <div onClick={onFit} role="button" aria-label={t("workbench.graph.fit")} style={{ minWidth: 40, textAlign: "center", fontSize: 12, color: p.text3, cursor: "pointer", hover: HOVER }}>{`${Math.round(zoom * 100)}%`}</div>
        </Tooltip>
        <IconButton icon="zoom-in" label={t("workbench.graph.zoomIn", { key: MOD.replace("+", "") })} size={24} iconSize={13} radius={6} onClick={() => onZoom(ZOOM_STEP)} />
      </div>
      {!walking && <Button label={t("workbench.walk.open")} tone="outline" size="small" icon="spark" onClick={onWalk} />}
      <Button label={t("workbench.graph.exportPdf")} tone="outline" size="small" icon="external" onClick={exportPdf} />
    </div>
  );
}

type Drag = { readonly x: number; readonly y: number; readonly from: Camera };

/** A pan-and-zoom surface: drag or scroll to move, ⌘-scroll to zoom around the pointer. */
function useCanvas(content: Size): {
  readonly box: RefObject<PublicInstance | null>;
  readonly size: Size;
  readonly camera: Camera;
  readonly zoomBy: (factor: number) => void;
  readonly fit: () => void;
  readonly jump: (gx: number, gy: number) => void;
  readonly handlers: {
    readonly onScroll: (event: EventPayload) => void;
    readonly onPinch: (event: EventPayload) => void;
    readonly onMouseDown: (event: EventPayload) => void;
    readonly onMouseMove: (event: EventPayload) => void;
    readonly onMouseUp: () => void;
  };
  readonly dragging: boolean;
} {
  const { renderer } = useGpuix();
  const box = useRef<PublicInstance | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [camera, setCamera] = useState<Camera | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const bounds = (): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null => {
    const id = box.current?.id;
    return id === undefined ? null : (renderer?.getElementBounds?.(id) ?? null);
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      const at = bounds();
      if (at && (at.width !== size.width || at.height !== size.height)) setSize({ width: at.width, height: at.height });
    }, 32);
    return () => clearTimeout(timer);
  });
  useEffect(() => {
    if (camera === null && size.width > 0) setCamera(fitCamera(content, size));
  }, [size.width, size.height, camera]);
  const current = camera ?? { x: 0, y: 0, zoom: 1 };
  const zoomAround = (factor: number, x: number, y: number): void => setCamera((last) => zoomAt(last ?? current, factor, x, y));
  return {
    box,
    size,
    camera: current,
    zoomBy: (factor) => zoomAround(factor, size.width / 2, size.height / 2),
    fit: () => setCamera(fitCamera(content, size)),
    jump: (gx, gy) => setCamera(centerOn(current, gx, gy, size)),
    dragging: drag !== null,
    handlers: {
      onScroll: (event) => {
        const dx = event.deltaX ?? 0;
        const dy = event.deltaY ?? 0;
        const lines = event.precise ? 1 : WHEEL_LINE;
        if (event.modifiers?.cmd || event.modifiers?.ctrl) {
          const at = bounds();
          zoomAround(Math.exp(dy * lines * ZOOM_PER_PIXEL), (event.x ?? 0) - (at?.x ?? 0), (event.y ?? 0) - (at?.y ?? 0));
          return;
        }
        setCamera((last) => panBy(last ?? current, dx * lines, dy * lines));
      },
      onPinch: (event) => {
        const at = bounds();
        zoomAround(1 + (event.zoomDelta ?? 0), (event.x ?? 0) - (at?.x ?? 0), (event.y ?? 0) - (at?.y ?? 0));
      },
      onMouseDown: (event) => setDrag({ x: event.x ?? 0, y: event.y ?? 0, from: current }),
      onMouseMove: (event) => {
        if (!drag) return;
        if (event.pressedButton === undefined || event.pressedButton === null) {
          setDrag(null);
          return;
        }
        setCamera(panBy(drag.from, (event.x ?? 0) - drag.x, (event.y ?? 0) - drag.y));
      },
      onMouseUp: () => setDrag(null),
    },
  };
}

function FlowGraph({ fn, dossier, assembly, walker }: { readonly fn: string; readonly dossier: Dossier; readonly assembly: string; readonly walker: Walker }): ReactElement {
  const { p } = useTheme();
  const { wb, nameOf } = useBench();
  const mine = wb.s.groups.filter((g) => g.fn === fn);
  const { settings } = useSettings();
  const look = useCodeLook();
  const text = settings.graphUsesCodeSize ? look : SMALL;
  const maxLines = blockCap(settings.blockLines);
  const lines = useMemo(() => assembly.split("\n"), [assembly]);
  const layout = useMemo(() => layoutGraph(foldGroups(dossier.blocks, mine.map((g) => g.blocks)), lines, maxLines, text.lineHeight), [dossier, lines, JSON.stringify(mine), maxLines, text.lineHeight]);
  const entry = dossier.blocks[0]?.start;
  const content = { width: layout.width + BLOCK_WIDTH + PADDING * 2, height: layout.height + PADDING * 2 };
  const canvas = useCanvas(content);
  const { zoom } = canvas.camera;
  const groupAt = (start: string): BlockGroup | null => mine.find((g) => g.blocks.includes(start)) ?? null;
  const homeOf = (start: string): string => {
    const group = groupAt(start);
    return group ? (layout.blocks.find((placed) => group.blocks.includes(placed.block.start))?.block.start ?? start) : start;
  };
  const marks = walker.open && walker.run.kind === "ready" ? walkMarks(walker.run.walk, walker.at, homeOf) : null;
  const here = marks?.current ? layout.blocks.find((placed) => placed.block.start === marks.current) : undefined;
  useEffect(() => {
    if (here && canvas.size.width > 0) canvas.jump(here.x + PADDING + BLOCK_WIDTH / 2, here.y + PADDING + here.height / 2);
  }, [here?.block.start, walker.at, walker.run]);
  const pdfBlocks = new Map(layout.blocks.map((placed) => {
    const group = groupAt(placed.block.start);
    return [placed.block.start, { start: placed.block.start, title: group ? group.label : placed.block.start === entry ? `${nameOf(fn)} · ${placed.block.start}` : placed.block.start, lines: placed.lines, color: wb.s.colors.get(placed.block.start) ?? null }] as const;
  }));
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      {walker.open && <WalkBar walker={walker} onWalk={() => walker.start(dossier.blocks, assembly)} />}
      <div style={{ position: "relative", display: "flex", flexGrow: 1, minHeight: 0 }}>
        <div ref={canvas.box} {...canvas.handlers} role="application" aria-label={t("workbench.graph.label")} style={{ position: "relative", flexGrow: 1, minWidth: 0, overflow: "hidden", backgroundColor: p.deep, cursor: canvas.dragging ? "grabbing" : "grab" }}>
          <div style={{ position: "absolute", left: canvas.camera.x, top: canvas.camera.y, width: content.width * zoom, height: content.height * zoom, fontFamily: text.family, fontSize: text.size * zoom, pointerEvents: "none" }}>
            <Edges layout={layout} walked={marks?.edges ?? null} zoom={zoom} />
            {layout.blocks.map((placed) => {
              const steps = marks?.visits.get(placed.block.start);
              const visit = steps ? { steps, current: marks?.current === placed.block.start } : null;
              return <BlockBox key={placed.block.start} fn={fn} placed={placed} entry={placed.block.start === entry} group={groupAt(placed.block.start)} visit={visit} zoom={zoom} text={text} onPinch={canvas.handlers.onPinch} />;
            })}
          </div>
        </div>
        <GraphTools fn={fn} layout={layout} blocks={pdfBlocks} zoom={zoom} walking={walker.open} onWalk={walker.show} onZoom={canvas.zoomBy} onFit={canvas.fit} onPinch={canvas.handlers.onPinch} />
        {settings.minimap && <Minimap layout={layout} view={visibleRect(canvas.camera, canvas.size)} onJump={canvas.jump} onPinch={canvas.handlers.onPinch} />}
      </div>
    </div>
  );
}

/** The function's control flow from Ghidra's basic blocks: green when a branch is taken, red when it falls through. */
export function Graph({ addr }: { readonly addr: string }): ReactElement {
  const { p } = useTheme();
  const { program, wb } = useBench();
  const walker = useWalk(addr);
  const load = async (): Promise<{ readonly dossier: Dossier; readonly assembly: string } | null> => {
    if (!program.dossier) return null;
    const [dossier, assembly] = await Promise.all([program.dossier(addr), program.code(addr, "asm")]);
    return { dossier, assembly };
  };
  const graph = useLoaded(load, `${program.name}:${addr}:graph:${wb.s.revision}`);
  if (graph.kind === "loading") return <div style={{ padding: 16, color: p.muted }}>{t("workbench.graph.drawing")}</div>;
  if (graph.kind === "failed") return <div style={{ padding: 16 }}><ErrorCard title={t("workbench.graph.failed")} detail={t("workbench.graph.failedDetail", { engine: program.engine })} raw={graph.message} /></div>;
  if (!graph.value) return <div style={{ padding: 16, color: p.muted }}>{program.arch === DALVIK ? t("workbench.graph.android") : t("workbench.graph.waiting")}</div>;
  return <FlowGraph fn={addr} dossier={graph.value.dossier} assembly={graph.value.assembly} walker={walker} />;
}
