import { type ChildProcess, type ChildProcessWithoutNullStreams, type ExecFileOptions, type ExecFileSyncOptions, execFile, execFileSync, type SpawnOptions, type SpawnOptionsWithoutStdio, spawn } from "node:child_process";
import { promisify } from "node:util";

/** Every program Eleven starts goes through here, so on Windows none of them opens a console window of its own. */
const HIDDEN = { windowsHide: true } as const;

const exec = promisify(execFile);

type Launch = { readonly file: string; readonly args: readonly string[]; readonly shell: boolean };

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** cmd.exe quoting: Windows argv rules first, then its metacharacters escaped twice, since npm shims re-expand them through %*. */
export function quoteForCmd(arg: string): string {
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  return quoted.replace(CMD_META, "^$1").replace(CMD_META, "^$1");
}

/** Bun refuses to start .cmd and .bat files directly on Windows, so those go through cmd.exe as one escaped line. */
export function launchLine(file: string, args: readonly string[], platform: NodeJS.Platform = process.platform): Launch {
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(file)) return { file, args, shell: false };
  return { file: [file.replace(CMD_META, "^$1"), ...args.map(quoteForCmd)].join(" "), args: [], shell: true };
}

/** Runs a program to completion and returns its text output. */
export function run(file: string, args: readonly string[] = [], options: ExecFileOptions = {}): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const launch = launchLine(file, args);
  return exec(launch.file, [...launch.args], { ...options, ...HIDDEN, shell: launch.shell, encoding: "utf8" });
}

/** The same, for programs whose output is binary. */
export function runBytes(file: string, args: readonly string[] = [], options: ExecFileOptions = {}): Promise<{ readonly stdout: Buffer; readonly stderr: Buffer }> {
  const launch = launchLine(file, args);
  return exec(launch.file, [...launch.args], { ...options, ...HIDDEN, shell: launch.shell, encoding: "buffer" });
}

/** Runs a program to completion, blocking, and returns its text output. */
export function runSync(file: string, args: readonly string[] = [], options: ExecFileSyncOptions = {}): string {
  const launch = launchLine(file, args);
  return execFileSync(launch.file, [...launch.args], { ...options, ...HIDDEN, shell: launch.shell, encoding: "utf8" });
}

/** Starts a long-running program with its input and output piped to Eleven. */
export function start(command: string, args: readonly string[] = [], options: SpawnOptionsWithoutStdio = {}): ChildProcessWithoutNullStreams {
  const launch = launchLine(command, args);
  return spawn(launch.file, [...launch.args], { ...options, ...HIDDEN, shell: launch.shell });
}

/** Starts a program with its own stdio setup, like a detached helper or one whose output is ignored. */
export function startWith(command: string, args: readonly string[], options: SpawnOptions): ChildProcess {
  const launch = launchLine(command, args);
  return spawn(launch.file, [...launch.args], { ...options, ...HIDDEN, shell: launch.shell });
}

/** Stops a program and everything it started. On Windows killing the parent leaves its children running, like an agent behind an npm launcher. */
export function stop(child: ChildProcess): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    startWith("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => child.kill());
    return;
  }
  child.kill();
}
