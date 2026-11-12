export {};

if (process.argv.includes("--eleven-mcp")) {
  const { runMcp } = await import("./bridge/mcp");
  await runMcp();
} else if (process.argv.includes("--rea-mcp")) {
  const { runReaProxy } = await import("./bridge/reaProxy");
  await runReaProxy();
} else if (process.argv.includes("--eleven-highlight")) {
  const { runHighlighter } = await import("./components/highlightServer");
  await runHighlighter();
} else if (process.argv.includes("--tty")) {
  await import("./tty/main");
} else {
  await import("./window");
}
