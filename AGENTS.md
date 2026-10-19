# Eleven

Agent-first reverse-engineering app (a READE): the 2026 successor to Hopper.
Any ACP agent works through REA (Ghidra headless) and Eleven's own tools.

## Layout

- `app/` is the app: React + TypeScript rendered natively by GPUIX (React on GPUI).
- `app/src/`
  - `App.tsx`: screen routing (home, setup, settings, workbench). Home stays mounted underneath.
  - `Shell.tsx`: every screen renders inside it (frosted window, side column, solid card).
  - `home/`: the landing screen (Home, Landing, Sidebar, Canvas, What's new).
  - `chat/`: the conversation shared by home and the workbench (useChat, useThread, Composer, MessageView, palette, agent picker). `useChat` is the one shared conversation.
  - `workbench/`: the full workbench (Main board), wired to the same chat.
  - `welcome/`, `settings/`; `gpu/` holds the shader/model/profile readers (metal-objdump, model parsers, xctrace) behind `GpuSource`, surfaced inside `workbench/`.
  - `keys/`: shortcut commands and keymaps (logic only).
  - `agents/`: ACP client, registry, native agent detection.
  - `components/`: shared UI (kit, ui, code, ContextMenu, MenuRows, Toast, ErrorBoundary, KeymapIcon). Feature-only components stay in their feature folder.
  - `engine/`: `rea.ts`, `procedures.ts`, `dossier.ts`, `toolchain.ts`, `project.ts`, `target.ts`: one shared REA client, function lists, per-function dossiers (blocks/refs), Ghidra/Java/REA discovery, project file, opened target.
  - `bridge/`: Eleven's own MCP server (the `eleven` tools: open_function, set_view, rename_function, add_note, set_code_type, set_number_format, gpu_profile), served to every agent so it can drive the window.
  - `skills/` (and src/skills/load.ts): Eleven's built-in reverse-engineering playbooks, shown in the composer / palette; they are sent to any agent.

## Commands (run in `app/`)

- `bun run dev [file]`: the app with hot reload. One window only.
- `bunx tsc --noEmit --noUnusedLocals`: typecheck (covers src, tests, scripts).
- `./script/test`: runs the deterministic test files one at a time (parallel Ghidra JVMs thrash the machine). `bun test <file>` for one file while iterating. `*.live.test.tsx` call a real agent and are excluded.
- `bun scripts/gate-m1.ts <file...>`: engine-level open and read timing.
- `./script/bundle-macos`: builds `build/Eleven.app` (bundle id app.chizi.eleven).
- `./script/package`: builds, ad-hoc signs (or ELEVEN_SIGN_IDENTITY) and zips the app to build/Eleven-<version>-<arch>.zip.
- `install.sh` (repo root): curl installer; downloads the release zip for the arch and installs to /Applications.

## Environment

- REA must be 6.x. Eleven finds a checkout next to this repo (`../rea`), the copy bundled in Eleven.app, or `ELEVEN_REA`. Older `rea` builds on PATH refuse Ghidra on Apple Silicon.
- Ghidra 12.x, found in `~/.local/share`, `~/Applications` or `GHIDRA_INSTALL_DIR`. The JDK is found automatically.
- Android apps read through jadx (never Ghidra); apktool, when installed, gives smali. `.xapk`/`.apks`/`.zip` split bundles open their base APK with the splits beside it.
- Pinned npx agent versions can fail behind an npm `before` quarantine, so Eleven unpins them.

## Rules

- Never open extra preview windows. Verify with `bun test` or the single dev window.
- No title strips with an underline; headers live inside the card. Popovers use `<anchored deferred>`.
- GPUIX: inline styles only; `gridTemplateColumns` is a number; `boxShadow` is an object; mixed text must be one template string; hover dims with `opacity: 0.72`.
- GPUIX: a child with a background swallows clicks meant for its parent; give decorative fills inside clickables `pointerEvents: "none"` (it does not inherit).
- Shortcuts are commands (`src/keys/`, `useCommand`), never raw combos. Every `<input>`/`<textarea>` spreads `{...TYPING}` or calls `noteTyping`, so one-key shortcuts don't fire while typing.
- TypeScript: no `any`, no `as` casts (except `as const`), no `.then`, readonly props, explicit return types, exhaustive switches.
- Fonts: UI = system font, code = JetBrains Mono (small default), both set only via SANS/MONO in src/theme.tsx; bundle new fonts into assets/fonts.
- User-facing copy is plain language; no harness jargon. No em dashes anywhere.
- No useless comments. Conventional Commits. Never add Claude co-author trailers.
- New UI matches the existing screens and `src/components/` before inventing new patterns.

## Open work

- Debugger: breakpoint gutter in the code view, attach to a running process.
- Release: notarization, a release host, a Linux build.
- Agent-first layout: the agent panel never folds and suggestions show inline in chat.
