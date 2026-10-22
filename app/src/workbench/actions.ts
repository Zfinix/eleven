import type { EventPayload } from "@gpuix/react";

import { groups, type MenuAction, type MenuEntry, menuOn, type MenuSubmenu } from "../components/ContextMenu";
import { type Tool, zoneOf } from "./dockOrder";
import { copyText } from "../chat/useThread";
import { errorMessage } from "../lib/guards";
import type { CommandId } from "../keys/commands";
import { comboFor, comboText } from "../keys/keymaps";
import { currentSettings } from "../settings/store";
import { loadSkills, skillPrompt } from "../skills/load";
import { codeForString, containingFunction } from "./layout";
import { type BlockGroup, updateProject } from "../engine/project";
import { type CodeType, isCodeType, resolveType, type TypeChoice } from "../engine/codeTypes";
import { setValue, YOU } from "../engine/edits";
import { lastImmediate, type OperandFormat } from "../engine/operands";
import { type PlainId, t } from "../i18n";
import type { CodeMode, TabTarget } from "./model";
import type { Bench } from "./parts";
import { patchBytes } from "./patch";
import type { Subject } from "./subject";

type TypeCommand = Extract<CommandId, "markCode" | "markProcedure" | "markData" | "markString" | "markUndefined">;

type FormatCommand = Extract<CommandId, "showHex" | "showDecimal" | "showCharacter" | "showOffset" | "showAddress">;

export type KeyedCommand = Extract<CommandId, "rename" | "xrefs" | "comment" | "bookmark"> | TypeCommand | FormatCommand;

/** The shortcut a command has in the keymap you chose, as keycaps. */
export function hint(id: KeyedCommand): string {
  const settings = currentSettings();
  return comboText(comboFor(id, settings.keymap ?? "eleven", settings.shortcuts));
}

export const BLOCK_COLORS: readonly { readonly label: PlainId; readonly color: string }[] = [
  { label: "workbench.color.red", color: "#e06c75" },
  { label: "workbench.color.orange", color: "#d19a66" },
  { label: "workbench.color.yellow", color: "#e5c07b" },
  { label: "workbench.color.green", color: "#98c379" },
  { label: "workbench.color.blue", color: "#61afef" },
  { label: "workbench.color.purple", color: "#c678dd" },
];

function action(label: string, icon: string, run: () => void, keys = ""): MenuAction {
  return { kind: "action", label, icon, keys, run };
}

function later(label: string, keys = ""): MenuAction {
  return { kind: "action", label, keys, unavailable: t("workbench.menu.soon"), run: () => {} };
}

function submenu(label: string, icon: string, items: readonly MenuEntry[]): MenuSubmenu {
  return { kind: "submenu", label, icon, items };
}

export function isFunction(b: Bench, addr: string): boolean {
  return b.program.functions.some((fn) => fn.addr === addr);
}

function arm64(b: Bench): boolean {
  return /arm64|aarch64/i.test(b.program.arch);
}

export function copy(b: Bench, text: string, what: string): void {
  copyText(text);
  b.wb.notify(t("workbench.menu.copied", { what }), null);
}

export function ask(b: Bench, text: string): void {
  b.wb.reveal("agent");
  b.chat.thread.send(text);
}

function run(b: Bench, work: () => Promise<void>): void {
  void (async (): Promise<void> => {
    try {
      await work();
    } catch (err) {
      b.wb.notify(t("workbench.couldNotDo", { message: errorMessage(err) }), null);
    }
  })();
}

/** Shows any address: a function opens, anything else opens its function's assembly with that line picked. */
export function goTo(b: Bench, addr: string, view: CodeMode = "asm"): void {
  if (isFunction(b, addr)) {
    b.wb.show(addr, view === "asm" ? "pseudo" : view);
    return;
  }
  run(b, async () => {
    const fn = await containingFunction(b.program.path, addr);
    if (!fn) {
      b.wb.show(addr, "hex");
      return;
    }
    b.wb.show(fn, view);
    b.wb.select({ kind: "line", fn, view: "asm", number: -1, text: "", addr, token: null });
  });
}

export function startRename(b: Bench, addr: string): void {
  b.wb.patch({ renaming: addr, renameDraft: b.nameOf(addr) });
}

export function startComment(b: Bench, addr: string): void {
  b.wb.patch({ commenting: addr, commentDraft: b.wb.s.comments.get(addr) ?? "" });
}

export function showReferences(b: Bench, addr: string): void {
  b.wb.reveal("refs");
  b.wb.patch({ refsOf: isFunction(b, addr) && addr === b.focusAddr ? null : addr });
}

export function showCallers(b: Bench, fn: string): void {
  if (fn !== b.focusAddr) b.openFn(fn, false);
  b.wb.reveal("refs");
  b.wb.patch({ refsOf: null });
}

export function toggleBookmark(b: Bench, addr: string): void {
  const had = b.wb.s.bookmarks.some((mark) => mark.addr === addr);
  const mark = { addr, label: b.nameOf(addr) };
  b.wb.toggleBookmark(mark);
  b.wb.notify(had ? t("workbench.menu.unbookmarked", { name: mark.label }) : t("workbench.menu.bookmarked", { name: mark.label }), () => b.wb.toggleBookmark(mark));
}

function explain(b: Bench, addr: string): void {
  const skill = loadSkills().find((s) => s.name === "explain-function");
  const name = b.nameOf(addr);
  ask(b, skill ? skillPrompt(skill, `${name} at ${addr}`) : t("workbench.menu.explainPrompt", { name, address: addr }));
}

function targetOf(b: Bench, subject: Subject): TabTarget | null {
  switch (subject.kind) {
    case "function":
      return { kind: "fn", addr: subject.addr };
    case "tab": {
      const tab = b.wb.s.panes[subject.pane]?.tabs[subject.index];
      if (!tab) return null;
      switch (tab.kind) {
        case "fn":
          return { kind: "fn", addr: tab.addr };
        case "thread":
          return { kind: "thread", thread: tab.thread };
        case "list":
          return { kind: "list", list: tab.list };
        case "shader":
          return { kind: "shader", library: tab.library, name: tab.name };
        case "model":
          return { kind: "model", name: tab.name, page: tab.page, tensor: tab.tensor };
        case "profile":
          return { kind: "profile", title: tab.title };
        case "diff":
          return { kind: "diff" };
        case "debug":
          return { kind: "debug" };
        case "listing":
          return { kind: "listing" };
        case "source":
          return { kind: "source", file: tab.file };
        case "resource":
          return { kind: "resource", file: tab.file };
        case "text":
          return { kind: "text", title: tab.title, text: tab.text };
        case "tool":
          return null;
        default: {
          const unhandled: never = tab;
          return unhandled;
        }
      }
    }
    default:
      return null;
  }
}

function viewMenu(b: Bench, addr: string): MenuSubmenu {
  return submenu(t("workbench.menu.openAs"), "pseudocode", [
    action(t("workbench.view.pseudocode"), "pseudocode", () => b.wb.show(addr, "pseudo")),
    action(t("workbench.view.assembly"), "assembly", () => b.wb.show(addr, "asm")),
    action(t("workbench.view.graph"), "graph", () => b.wb.show(addr, "graph")),
    action(t("workbench.view.hex"), "hex", () => b.wb.show(addr, "hex")),
  ]);
}

const TYPES: readonly { readonly choice: TypeChoice; readonly label: PlainId; readonly command: TypeCommand }[] = [
  { choice: "code", label: "workbench.type.code", command: "markCode" },
  { choice: "procedure", label: "workbench.type.procedure", command: "markProcedure" },
  { choice: "data", label: "workbench.type.data", command: "markData" },
  { choice: "cstring", label: "workbench.type.cstring", command: "markString" },
  { choice: "undefined", label: "workbench.type.undefined", command: "markUndefined" },
];

const FORMATS: readonly { readonly format: OperandFormat; readonly label: PlainId; readonly command: FormatCommand }[] = [
  { format: "hex", label: "workbench.format.hex", command: "showHex" },
  { format: "decimal", label: "workbench.format.decimal", command: "showDecimal" },
  { format: "char", label: "workbench.format.char", command: "showCharacter" },
  { format: "offset", label: "workbench.format.offset", command: "showOffset" },
  { format: "address", label: "workbench.format.address", command: "showAddress" },
];

const TYPE_WORDS: Readonly<Record<CodeType, PlainId>> = {
  code: "workbench.typeWord.code",
  procedure: "workbench.typeWord.procedure",
  byte: "workbench.typeWord.byte",
  word: "workbench.typeWord.word",
  dword: "workbench.typeWord.dword",
  qword: "workbench.typeWord.qword",
  cstring: "workbench.typeWord.cstring",
  undefined: "workbench.typeWord.undefined",
};

const FORMAT_WORDS: Readonly<Record<OperandFormat, PlainId>> = {
  hex: "workbench.formatWord.hex",
  decimal: "workbench.formatWord.decimal",
  char: "workbench.formatWord.char",
  offset: "workbench.formatWord.offset",
  address: "workbench.formatWord.address",
};

/** Marks the bytes at an address as code, a function, data, a string or undefined; Ghidra re-reads them once the project changes. */
export function setType(b: Bench, addr: string, choice: TypeChoice): void {
  const before = b.wb.s.types.get(addr) ?? null;
  const next = resolveType(choice, before);
  if (next === before) {
    b.wb.notify(t("workbench.menu.alreadyType", { address: addr, type: t(TYPE_WORDS[next]) }), null);
    return;
  }
  const restore = isCodeType(before) ? before : null;
  updateProject(b.program.id, (project) => setValue(project, "types", addr, next), YOU);
  b.wb.notify(t("workbench.menu.markedType", { address: addr, type: t(TYPE_WORDS[next]) }), () => updateProject(b.program.id, (project) => setValue(project, "types", addr, restore), YOU));
}

/** Shows the number in the instruction at an address as hex, decimal, a character, an offset or an address. */
export function setFormat(b: Bench, addr: string, format: OperandFormat): void {
  const before = b.wb.s.formats.get(addr) ?? null;
  if (before === format) return;
  updateProject(b.program.id, (project) => setValue(project, "formats", addr, format), YOU);
  b.wb.notify(t("workbench.menu.showingFormat", { address: addr, format: t(FORMAT_WORDS[format]) }), () => updateProject(b.program.id, (project) => setValue(project, "formats", addr, before), YOU));
}

/** Hopper's Modify menu: what the bytes at a line are, and how its number reads. */
function changeMenu(b: Bench, addr: string, line: string): MenuSubmenu {
  const typed = b.wb.s.types.get(addr);
  const shown = b.wb.s.formats.get(addr);
  const noTypes = b.program.retype ? null : t("workbench.menu.notThisEngine");
  const noNumber = lastImmediate(line) ? null : t("workbench.menu.noNumber");
  return submenu(t("workbench.menu.changeType"), "tag", [
    ...TYPES.map((type): MenuAction => ({ ...action(t(type.label), typed === type.choice || (type.choice === "data" && /word|byte/.test(typed ?? "")) ? "check" : "tag", () => setType(b, addr, type.choice), hint(type.command)), unavailable: noTypes })),
    { kind: "separator" },
    ...FORMATS.map((f): MenuAction => ({ ...action(t(f.label), shown === f.format ? "check" : "hex", () => setFormat(b, addr, f.format), hint(f.command)), unavailable: noNumber })),
  ]);
}

function functionGroups(b: Bench, addr: string): readonly (readonly MenuEntry[])[] {
  const name = b.nameOf(addr);
  const marked = b.wb.s.bookmarks.some((mark) => mark.addr === addr);
  return [
    [
      action(t("workbench.menu.open", { name }), "function", () => b.openFn(addr, false)),
      action(t("workbench.action.openInSplit"), "split", () => b.wb.openSplit({ kind: "fn", addr })),
      viewMenu(b, addr),
    ],
    [
      action(t("workbench.action.referencesTo", { name }), "references", () => showReferences(b, addr), hint("xrefs")),
      action(t("workbench.menu.callersAndCallees"), "graph", () => showCallers(b, addr)),
    ],
    [
      action(t("workbench.menu.rename", { name }), "rename", () => startRename(b, addr), hint("rename")),
      action(marked ? t("workbench.action.removeBookmark") : t("workbench.action.bookmark"), "bookmark", () => toggleBookmark(b, addr), hint("bookmark")),
      action(t("workbench.menu.writeNote"), "note", () => {
        if (addr !== b.focusAddr) b.openFn(addr, false);
        b.wb.reveal("inspector");
      }, hint("comment")),
      later(t("workbench.menu.editSignature"), "Y"),
    ],
    [
      submenu(t("workbench.action.copy"), "copy", [
        action(t("workbench.menu.name"), "copy", () => copy(b, name, name)),
        action(t("workbench.action.address"), "copy", () => copy(b, addr, addr)),
        action(t("workbench.view.pseudocode"), "pseudocode", () => run(b, async () => copy(b, await b.program.code(addr, "pseudo"), t("workbench.menu.thePseudocodeOf", { name })))),
        action(t("workbench.view.assembly"), "assembly", () => run(b, async () => copy(b, await b.program.code(addr, "asm"), t("workbench.menu.theAssemblyOf", { name })))),
      ]),
    ],
    [
      action(t("workbench.menu.explain", { name }), "spark", () => explain(b, addr)),
      action(t("workbench.menu.suggestName"), "spark", () => ask(b, t("workbench.menu.suggestNamePrompt", { name, address: addr }))),
    ],
  ];
}

function lineGroups(b: Bench, subject: Extract<Subject, { readonly kind: "line" }>): readonly (readonly MenuEntry[])[] {
  const { token } = subject;
  const target = token?.addr ?? null;
  const fnTarget = target && isFunction(b, target) ? target : null;
  const here = subject.addr;
  const commented = here ? b.wb.s.comments.has(here) : false;
  const marked = here ? b.wb.s.bookmarks.some((mark) => mark.addr === here) : false;
  const word = token ? (fnTarget ? b.nameOf(fnTarget) : token.text) : null;
  const go: MenuEntry[] = [];
  if (fnTarget) {
    go.push(action(t("workbench.menu.jumpTo", { name: b.nameOf(fnTarget) }), "forward", () => b.openFn(fnTarget, false)));
    go.push(action(t("workbench.action.openInSplit"), "split", () => b.wb.openSplit({ kind: "fn", addr: fnTarget })));
  } else if (target) {
    go.push(action(t("workbench.action.goTo", { address: target }), "forward", () => goTo(b, target)));
    go.push(action(t("workbench.action.showInHex"), "hex", () => b.wb.show(target, "hex")));
  }
  if (here) go.push(action(t("workbench.menu.showLineInHex"), "hex", () => b.wb.show(here, "hex")));
  const refsTo = target ?? here;
  const refs: MenuEntry[] = [
    ...(refsTo ? [action(t("workbench.action.referencesTo", { name: word ?? refsTo }), "references", () => showReferences(b, refsTo), hint("xrefs"))] : []),
    action(t("workbench.menu.callersOf", { name: b.nameOf(subject.fn) }), "graph", () => showCallers(b, subject.fn)),
  ];
  const edit: MenuEntry[] = [
    ...(target ? [action(t("workbench.menu.rename", { name: word ?? target }), "rename", () => startRename(b, target), hint("rename"))] : []),
    here
      ? action(commented ? t("workbench.menu.editComment") : t("workbench.menu.commentLine"), "note", () => startComment(b, here), hint("comment"))
      : action(t("workbench.menu.writeNoteOn", { name: b.nameOf(subject.fn) }), "note", () => b.wb.reveal("inspector"), hint("comment")),
    ...(here ? [action(marked ? t("workbench.action.removeBookmark") : t("workbench.menu.bookmarkLine"), "bookmark", () => toggleBookmark(b, here), hint("bookmark"))] : []),
  ];
  const patch: MenuEntry[] = here
    ? [
        submenu(t("workbench.menu.patch"), "bolt", [
          action(t("workbench.menu.changeBytes"), "hex", () => b.wb.patch({ patching: here, patchDraft: "" })),
          arm64(b)
            ? action(t("workbench.menu.nop"), "bolt", () => run(b, async () => b.wb.notify(t("workbench.patched", { path: await patchBytes(b.program, [{ addr: here, bytes: "1f2003d5" }]) }), null)))
            : later(t("workbench.menu.nop")),
          later(t("workbench.menu.assemble")),
        ]),
        changeMenu(b, here, subject.text),
      ]
    : [];
  const copies: MenuEntry[] = [
    submenu(t("workbench.action.copy"), "copy", [
      action(t("workbench.menu.line"), "copy", () => copy(b, subject.text.trim(), t("workbench.menu.theLine"))),
      ...(word ? [action(`"${word}"`, "copy", () => copy(b, word, word))] : []),
      ...(here ? [action(t("workbench.action.address"), "copy", () => copy(b, here, here))] : []),
      action(t("workbench.menu.functionName"), "copy", () => copy(b, b.nameOf(subject.fn), b.nameOf(subject.fn))),
    ]),
  ];
  const agent: MenuEntry[] = [
    action(t("workbench.menu.explainLine"), "spark", () => ask(b, t(subject.view === "asm" ? "workbench.menu.explainInstructionPrompt" : "workbench.menu.explainLinePrompt", { name: b.nameOf(subject.fn), address: subject.fn, line: subject.text.trim() }))),
    ...(word ? [action(t("workbench.menu.whereFrom", { word }), "spark", () => ask(b, t("workbench.menu.whereFromPrompt", { name: b.nameOf(subject.fn), address: subject.fn, word })))] : []),
  ];
  return [go, refs, edit, patch, copies, agent];
}

/** Folds the picked blocks (and any groups among them) into one graph node, then asks for its name. */
export function groupBlocks(b: Bench, fn: string, starts: readonly string[]): void {
  const before = b.wb.s.groups;
  const touched = before.filter((g) => g.fn === fn && g.blocks.some((block) => starts.includes(block)));
  const blocks = [...new Set([...starts, ...touched.flatMap((g) => g.blocks)])];
  if (blocks.length < 2) return;
  const first = [...blocks].sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1))[0] ?? blocks[0] ?? "";
  const label = `${blocks.length} blocks`;
  b.wb.patch({ groups: [...before.filter((g) => !touched.includes(g)), { fn, blocks, label }], blockPicks: [], labelling: { fn, start: first }, labelDraft: label });
  b.wb.notify(t("workbench.menu.grouped", { count: blocks.length }), () => b.wb.patch({ groups: before }));
}

function groupAt(b: Bench, fn: string, start: string): BlockGroup | null {
  return b.wb.s.groups.find((g) => g.fn === fn && g.blocks.includes(start)) ?? null;
}

function blockGroups(b: Bench, subject: Extract<Subject, { readonly kind: "block" }>): readonly (readonly MenuEntry[])[] {
  const { start, end, fn } = subject;
  const group = groupAt(b, fn, start);
  const picks = b.wb.s.blockPicks;
  const gathering = picks.includes(start) ? picks : [...picks, start];
  const grouping: MenuEntry[] = [
    ...(gathering.length > 1 ? [action(t("workbench.groupBlocks", { count: gathering.length }), "graph", () => groupBlocks(b, fn, gathering))] : [action(t("workbench.menu.pickForGroup"), "graph", () => b.wb.patch({ blockPicks: gathering }))]),
    ...(group ? [
      action(t("workbench.menu.renameGroup"), "rename", () => b.wb.patch({ labelling: { fn, start }, labelDraft: group.label })),
      action(t("workbench.menu.ungroup"), "graph", () => {
        const before = b.wb.s.groups;
        b.wb.patch({ groups: before.filter((g) => g !== group) });
        b.wb.notify(t("workbench.menu.ungrouped", { name: group.label }), () => b.wb.patch({ groups: before }));
      }),
    ] : []),
  ];
  const colored = b.wb.s.colors.has(start);
  const blockText = async (): Promise<string> => {
    const lines = (await b.program.code(fn, "asm")).split("\n");
    return lines.filter((line) => {
      const at = /^(0x[0-9a-f]+):/i.exec(line)?.[1];
      return at !== undefined && BigInt(at) >= BigInt(start) && BigInt(at) < BigInt(end);
    }).join("\n");
  };
  return [
    [
      action(t("workbench.menu.showInAssembly"), "assembly", () => goTo(b, start)),
      action(t("workbench.action.showInHex"), "hex", () => b.wb.show(start, "hex")),
    ],
    [
      action(t("workbench.action.referencesTo", { name: start }), "references", () => showReferences(b, start), hint("xrefs")),
      action(t("workbench.menu.commentBlock"), "note", () => startComment(b, start), hint("comment")),
      submenu(t("workbench.menu.color"), "circle", [
        ...BLOCK_COLORS.map((c) => action(t(c.label), "circle-on", () => {
          const before = b.wb.s.colors.get(start) ?? "";
          b.wb.setColor(start, c.color);
          b.wb.notify(t("workbench.menu.colored", { address: start, color: t(c.label).toLowerCase() }), () => b.wb.setColor(start, before));
        })),
        ...(colored ? [{ kind: "separator" } as const, action(t("workbench.menu.noColor"), "circle", () => b.wb.setColor(start, ""))] : []),
      ]),
    ],
    [
      submenu(t("workbench.action.copy"), "copy", [
        action(t("workbench.menu.block"), "copy", () => run(b, async () => copy(b, await blockText(), t("workbench.menu.theBlock")))),
        action(t("workbench.menu.startAddress"), "copy", () => copy(b, start, start)),
      ]),
    ],
    grouping,
    [action(t("workbench.menu.blockDecide"), "spark", () => run(b, async () => ask(b, t("workbench.menu.blockDecidePrompt", { name: b.nameOf(fn), address: fn, start, code: await blockText() }))))],
  ];
}

function hex(bytes: readonly number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

function readAs(bytes: readonly number[]): readonly MenuEntry[] {
  const view = new DataView(Uint8Array.from(bytes).buffer);
  const reads: { readonly label: string; readonly size: number; readonly read: () => string }[] = [
    { label: "UInt8", size: 1, read: () => String(view.getUint8(0)) },
    { label: "Int16", size: 2, read: () => String(view.getInt16(0, true)) },
    { label: "UInt32", size: 4, read: () => String(view.getUint32(0, true)) },
    { label: "Int32", size: 4, read: () => String(view.getInt32(0, true)) },
    { label: "UInt64", size: 8, read: () => view.getBigUint64(0, true).toString() },
    { label: t("workbench.menu.pointer"), size: 8, read: () => `0x${view.getBigUint64(0, true).toString(16)}` },
    { label: "Float", size: 4, read: () => String(view.getFloat32(0, true)) },
    { label: "Double", size: 8, read: () => String(view.getFloat64(0, true)) },
    { label: t("workbench.menu.text"), size: 1, read: () => JSON.stringify(String.fromCharCode(...bytes.filter((byte) => byte >= 0x20 && byte < 0x7f))) },
  ];
  return reads.filter((r) => bytes.length >= r.size).map((r) => {
    const value = r.read();
    return { kind: "action", label: r.label, keys: value, run: () => copyText(value) };
  });
}

function bytesGroups(b: Bench, subject: Extract<Subject, { readonly kind: "bytes" }>): readonly (readonly MenuEntry[])[] {
  const { addr, bytes } = subject;
  const count = bytes.length === 1 ? t("workbench.menu.oneByte") : t("workbench.menu.bytes", { count: bytes.length });
  return [
    [
      action(t("workbench.menu.showInAssembly"), "assembly", () => goTo(b, addr)),
      action(`References to ${addr}`, "references", () => showReferences(b, addr), hint("xrefs")),
    ],
    bytes.length === 0 ? [] : [
      submenu(t("workbench.action.copy"), "copy", [
        action(t("workbench.view.hex"), "copy", () => copy(b, hex(bytes), count)),
        action(t("workbench.menu.cArray"), "copy", () => copy(b, `{ ${bytes.map((byte) => `0x${byte.toString(16).padStart(2, "0")}`).join(", ")} }`, t("workbench.menu.asCArray", { bytes: count }))),
        action(t("workbench.menu.swiftArray"), "copy", () => copy(b, `[${bytes.map((byte) => `0x${byte.toString(16).padStart(2, "0")}`).join(", ")}]`, t("workbench.menu.asSwiftArray", { bytes: count }))),
        action(t("workbench.menu.pythonBytes"), "copy", () => copy(b, `b"${bytes.map((byte) => `\\x${byte.toString(16).padStart(2, "0")}`).join("")}"`, t("workbench.menu.asPythonBytes", { bytes: count }))),
        action(t("workbench.action.address"), "copy", () => copy(b, addr, addr)),
      ]),
      submenu(t("workbench.menu.readAs"), "hex", readAs(bytes)),
    ],
    [
      changeMenu(b, addr, ""),
      action(t("workbench.menu.changeTheseBytes"), "bolt", () => b.wb.patch({ patching: addr, patchDraft: hex(bytes) })),
      action(b.wb.s.bookmarks.some((mark) => mark.addr === addr) ? t("workbench.action.removeBookmark") : t("workbench.action.bookmark"), "bookmark", () => toggleBookmark(b, addr), hint("bookmark")),
      action(t("workbench.menu.comment"), "note", () => startComment(b, addr), hint("comment")),
    ],
    [action(t("workbench.menu.whatData"), "spark", () => ask(b, t("workbench.menu.whatDataPrompt", { address: addr, bytes: hex(bytes) })))],
  ];
}

function stringGroups(b: Bench, subject: Extract<Subject, { readonly kind: "string" }>): readonly (readonly MenuEntry[])[] {
  const { addr, value } = subject;
  return [
    [
      action(t("workbench.menu.whereUsed"), "forward", () => run(b, async () => {
        const fn = await codeForString(b.program.path, addr);
        if (fn) b.openFn(fn, false);
        else b.wb.notify(t("workbench.menu.stringUnused"), null);
      })),
      action(t("workbench.menu.references"), "references", () => showReferences(b, addr), hint("xrefs")),
      action(t("workbench.action.showInHex"), "hex", () => b.wb.show(addr, "hex")),
    ],
    [
      submenu(t("workbench.action.copy"), "copy", [
        action(t("workbench.menu.string"), "copy", () => copy(b, value, t("workbench.menu.theString"))),
        action(t("workbench.action.address"), "copy", () => copy(b, addr, addr)),
      ]),
      action(b.wb.s.bookmarks.some((mark) => mark.addr === addr) ? t("workbench.action.removeBookmark") : t("workbench.action.bookmark"), "bookmark", () => toggleBookmark(b, addr), hint("bookmark")),
    ],
    [action(t("workbench.menu.howUsed"), "spark", () => ask(b, t("workbench.menu.howUsedPrompt", { value: JSON.stringify(value), address: addr })))],
  ];
}

function importGroups(b: Bench, subject: Extract<Subject, { readonly kind: "import" }>): readonly (readonly MenuEntry[])[] {
  const stub = b.addrOf(subject.symbol) ?? b.addrOf(`_${subject.symbol}`);
  return [
    stub ? [action(t("workbench.menu.openStub", { symbol: subject.symbol }), "function", () => b.openFn(stub, false)), action(t("workbench.menu.callers"), "references", () => showCallers(b, stub))] : [],
    [
      submenu(t("workbench.action.copy"), "copy", [
        action(t("workbench.menu.symbol"), "copy", () => copy(b, subject.symbol, subject.symbol)),
        action(t("workbench.menu.library"), "copy", () => copy(b, subject.library, subject.library)),
      ]),
    ],
    [action(t("workbench.menu.importUse", { symbol: subject.symbol }), "spark", () => ask(b, t("workbench.menu.importUsePrompt", { symbol: subject.symbol, library: subject.library })))],
  ];
}

function segmentGroups(b: Bench, subject: Extract<Subject, { readonly kind: "segment" }>): readonly (readonly MenuEntry[])[] {
  const start = subject.range.split(" ")[0] ?? "";
  return [
    start ? [action(t("workbench.menu.startInHex"), "hex", () => b.wb.show(start, "hex"))] : [],
    [
      submenu(t("workbench.action.copy"), "copy", [
        action(t("workbench.menu.name"), "copy", () => copy(b, subject.name, subject.name)),
        action(t("workbench.menu.range"), "copy", () => copy(b, subject.range, t("workbench.menu.theRange"))),
      ]),
    ],
    [action(t("workbench.menu.segmentHolds", { name: subject.name }), "spark", () => ask(b, t("workbench.menu.segmentHoldsPrompt", { name: subject.name, range: subject.range })))],
  ];
}

/** Where a tool can go from where it is: either dock, or an editor tab. */
export function toolMenu(b: Bench, tool: Tool): readonly MenuEntry[] {
  const zone = zoneOf(b.wb.s.docks, tool);
  return [
    ...(zone !== "right" ? [action(t("workbench.menu.toRightPanel"), "forward", () => b.wb.moveTool(tool, "right"))] : []),
    ...(zone !== "bottom" ? [action(t("workbench.menu.toBottomPanel"), "arrow-down", () => b.wb.moveTool(tool, "bottom"))] : []),
    ...(zone !== null ? [action(t("workbench.menu.asEditorTab"), "open-tab", () => b.wb.moveTool(tool, null))] : []),
  ];
}

function tabGroups(b: Bench, subject: Extract<Subject, { readonly kind: "tab" }>): readonly (readonly MenuEntry[])[] {
  const { pane, index } = subject;
  const tabs = b.wb.s.panes[pane]?.tabs ?? [];
  const tab = tabs[index];
  const target = targetOf(b, subject);
  const panes = b.wb.s.panes.length;
  return [
    [
      action(t("workbench.menu.close"), "close", () => b.wb.closeTab(pane, index)),
      ...(tab?.kind === "tool" ? toolMenu(b, tab.tool) : []),
      ...(tabs.length > 1 ? [action(t("workbench.menu.closeOthers"), "close", () => b.wb.closeOthers(pane, index))] : []),
      ...(index < tabs.length - 1 ? [action(t("workbench.menu.closeRight"), "close", () => b.wb.closeRight(pane, index))] : []),
    ],
    [
      ...(tab?.preview ? [action(t("workbench.menu.keepOpen"), "open-tab", () => b.wb.selectTab(pane, index))] : []),
      ...(target && panes === 1 ? [action(t("workbench.action.openInSplit"), "split", () => b.wb.openSplit(target))] : []),
      ...(pane > 0 ? [action(t("workbench.menu.toLeftPane"), "back", () => b.wb.moveTab(pane, index, -1))] : []),
      ...(pane < panes - 1 ? [action(t("workbench.menu.toRightPane"), "forward", () => b.wb.moveTab(pane, index, 1))] : []),
      ...(pane === panes - 1 && tabs.length > 1 ? [action(t("workbench.menu.toNewPane"), "split", () => b.wb.moveTab(pane, index, 1))] : []),
    ],
    [
      action(t("workbench.action.splitRight"), "split", () => b.wb.split(pane)),
      action(t("workbench.action.splitDown"), "split", () => b.wb.split(pane, "bottom")),
      ...(panes > 1 ? [action(t("workbench.action.closeSplit"), "close", () => b.wb.closePane(pane)), action(t("workbench.action.equalSplits"), "split", b.wb.equalizePanes)] : []),
    ],
    tab?.kind === "fn" ? [action(t("workbench.menu.copyName"), "copy", () => copy(b, b.nameOf(tab.addr), b.nameOf(tab.addr))), action(t("workbench.action.copyAddress"), "copy", () => copy(b, tab.addr, tab.addr))] : [],
  ];
}

/** Everything that applies to a subject, in groups; the menu and the keys both come from here. */
export function menuGroups(b: Bench, subject: Subject): readonly (readonly MenuEntry[])[] {
  switch (subject.kind) {
    case "function":
      return functionGroups(b, subject.addr);
    case "line":
      return lineGroups(b, subject);
    case "block":
      return blockGroups(b, subject);
    case "bytes":
      return bytesGroups(b, subject);
    case "string":
      return stringGroups(b, subject);
    case "import":
      return importGroups(b, subject);
    case "segment":
      return segmentGroups(b, subject);
    case "tab":
      return tabGroups(b, subject);
    default: {
      const unhandled: never = subject;
      return unhandled;
    }
  }
}

function selectable(subject: Subject): boolean {
  return subject.kind === "line" || subject.kind === "block" || subject.kind === "bytes";
}

/** Handlers for anything that has a menu: right-click picks it and shows what can be done with it. */
export function subjectMenu(b: Bench, subject: Subject, onClick?: (event: EventPayload) => void): ReturnType<typeof menuOn> {
  return menuOn(() => {
    if (selectable(subject)) b.wb.select(subject);
    return groups(...menuGroups(b, subject));
  }, onClick);
}

function flat(entries: readonly MenuEntry[]): readonly MenuAction[] {
  return entries.flatMap((entry) => (entry.kind === "action" ? [entry] : entry.kind === "submenu" ? flat(entry.items) : []));
}

/** Runs a keymap command on what you last clicked, or on the open function: N renames the word under it, X lists its references. */
export function runCommand(b: Bench, id: KeyedCommand): void {
  const keys = hint(id);
  const picked = b.wb.s.selected;
  const current = picked && "fn" in picked && picked.fn === b.focusAddr;
  const subject: Subject = current ? picked : { kind: "function", addr: b.focusAddr };
  const hit = keys ? flat(menuGroups(b, subject).flat()).find((entry) => entry.keys === keys && !entry.unavailable) : undefined;
  hit?.run();
}
