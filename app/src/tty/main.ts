import { tmpdir } from "node:os";
import { join } from "node:path";

/** GPUI and the tools Eleven runs write to stderr, which would scribble over the picture, so the viewer runs with stderr in a log. */
const TTY_LOG = join(tmpdir(), "eleven-tty.log");

if (process.env.ELEVEN_TTY_VIEWER) {
  await import("./viewer");
} else {
  const viewer = Bun.spawn([process.execPath, ...process.argv.slice(1)], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: Bun.file(TTY_LOG),
    env: { ...process.env, ELEVEN_TTY_VIEWER: "1" },
  });
  process.exit(await viewer.exited);
}
