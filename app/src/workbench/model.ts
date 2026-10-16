import type { ApkFiles } from "../engine/apk";
import type { CodeType } from "../engine/codeTypes";
import type { ModelPage } from "../gpu/types";
import type { Tool } from "./dockOrder";
import type { Dossier } from "../engine/dossier";

export type FnKind = "function" | "thunk";

/** `file` is the decompiled source file that holds the function, when the engine knows it (jadx: com/foo/Bar.java). */
export type Fn = { readonly addr: string; readonly name: string; readonly kind: FnKind; readonly file?: string };

export type CodeMode = "pseudo" | "asm" | "graph" | "hex";

export type ListKind = "strings" | "imports" | "segments";

export { MODEL_PAGES, type ModelPage } from "../gpu/types";

export type Tab =
  | { readonly kind: "fn"; readonly id: string; readonly addr: string; readonly view: CodeMode; readonly preview: boolean }
  | { readonly kind: "thread"; readonly id: string; readonly thread: string; readonly preview: boolean }
  | { readonly kind: "list"; readonly id: string; readonly list: ListKind; readonly preview: boolean }
  | { readonly kind: "shader"; readonly id: string; readonly library: string; readonly name: string; readonly preview: boolean }
  | { readonly kind: "model"; readonly id: string; readonly name: string; readonly page: ModelPage; readonly tensor: string | null; readonly preview: boolean }
  | { readonly kind: "profile"; readonly id: string; readonly title: string; readonly preview: boolean }
  | { readonly kind: "diff"; readonly id: string; readonly preview: boolean }
  | { readonly kind: "debug"; readonly id: string; readonly preview: boolean }
  | { readonly kind: "listing"; readonly id: string; readonly preview: boolean }
  | { readonly kind: "source"; readonly id: string; readonly file: string; readonly preview: boolean }
  | { readonly kind: "resource"; readonly id: string; readonly file: string; readonly preview: boolean }
  | { readonly kind: "tool"; readonly id: string; readonly tool: Tool; readonly preview: boolean };

export type TabTarget =
  | { readonly kind: "fn"; readonly addr: string }
  | { readonly kind: "thread"; readonly thread: string }
  | { readonly kind: "list"; readonly list: ListKind }
  | { readonly kind: "shader"; readonly library: string; readonly name: string }
  | { readonly kind: "model"; readonly name: string; readonly page?: ModelPage; readonly tensor?: string | null }
  | { readonly kind: "profile"; readonly title: string }
  | { readonly kind: "diff" }
  | { readonly kind: "debug" }
  | { readonly kind: "listing" }
  | { readonly kind: "source"; readonly file: string }
  | { readonly kind: "resource"; readonly file: string }
  | { readonly kind: "tool"; readonly tool: Tool };

export type Pane = { readonly tabs: readonly Tab[]; readonly active: number };

export type TableRow = { readonly a: string; readonly b: string };

/** A whole decompiled source file, and the line where each of its functions starts. */
export type SourceText = { readonly text: string; readonly starts: readonly { readonly line: number; readonly addr: string }[] };

export type Caller = { readonly addr: string; readonly at: string };

export type Refs = { readonly callers: readonly Caller[]; readonly callees: readonly string[] };

export type HexRow = { readonly addr: string; readonly bytes: string; readonly ascii: string };

export type { Loaded } from "../lib/useLoaded";

/** Everything the workbench shows about one binary, from REA. */
export type Program = {
  /** The binary's SHA-256, which keys its project file. */
  readonly id: string;
  /** The on-disk path REA analyzes (a thinned slice for a universal binary). */
  readonly path: string;
  /** What the user opened: the .app bundle or file, for its Finder icon. */
  readonly origin: string;
  readonly name: string;
  readonly arch: string;
  readonly total: number;
  readonly functions: readonly Fn[];
  readonly strings: readonly TableRow[];
  readonly imports: readonly TableRow[];
  readonly segments: readonly TableRow[];
  readonly evidence: string;
  /** What reads the file (Ghidra, Rizin, jadx), named in loading and error messages. */
  readonly engine: string;
  /** A quick first look while the full engine is still reading the file; it is replaced when that finishes. */
  readonly preview?: boolean;
  readonly log: () => readonly string[];
  readonly code: (addr: string, view: "pseudo" | "asm") => Promise<string>;
  readonly refs: (addr: string) => Promise<Refs>;
  /** Ghidra's dossier for a function; null while the file is still opening. */
  readonly dossier: ((addr: string) => Promise<Dossier>) | null;
  readonly hex: (addr: string) => Promise<readonly HexRow[]>;
  readonly focusLine: (addr: string, view: CodeMode) => number;
  /** Reads the bytes at an address as another type, or back as code when `next` is null; null when the engine can't. */
  readonly retype: ((addr: string, next: CodeType | null, previous: CodeType | null) => Promise<void>) | null;
  /** A whole source file from `Fn.file`, for engines that decompile to files (jadx). */
  readonly source?: (file: string) => Promise<SourceText>;
  /** Source files with no functions of their own, so the file tree still lists them. */
  readonly bareFiles?: readonly string[];
  /** The app's other files (manifest, resources, assets, native libraries), for apps: jadx unpacks Android ones, iOS and macOS bundles are read in place. */
  readonly resources?: ApkFiles;
  /** The functions that use the string at an address, for engines that can follow references to data. */
  readonly codeUsing?: (addr: string) => Promise<readonly string[]>;
};

