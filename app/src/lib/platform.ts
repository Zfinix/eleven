import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { run, runSync, startWith } from "./process";


export type Os = "mac" | "linux" | "windows";

export const OS: Os = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "windows" : "linux";

const HOME = homedir();

/** Where Eleven keeps your work and settings: Application Support, XDG data, or AppData. */
export function dataRoot(): string {
  switch (OS) {
    case "mac":
      return join(HOME, "Library", "Application Support", "Eleven");
    case "linux":
      return join(process.env.XDG_DATA_HOME || join(HOME, ".local", "share"), "eleven");
    case "windows":
      return join(process.env.APPDATA || join(HOME, "AppData", "Roaming"), "Eleven");
    default: {
      const unhandled: never = OS;
      return unhandled;
    }
  }
}

/** Where Eleven keeps things it can rebuild: decompiled code, downloads, agent installs. */
export function cacheRoot(): string {
  switch (OS) {
    case "mac":
      return join(HOME, "Library", "Caches", "eleven");
    case "linux":
      return join(process.env.XDG_CACHE_HOME || join(HOME, ".cache"), "eleven");
    case "windows":
      return join(process.env.LOCALAPPDATA || join(HOME, "AppData", "Local"), "Eleven", "Cache");
    default: {
      const unhandled: never = OS;
      return unhandled;
    }
  }
}

/** The file manager's name, for copy like "Show in Finder". */
export const FILE_MANAGER = OS === "mac" ? "Finder" : OS === "windows" ? "File Explorer" : "Files";

function detached(command: string, args: readonly string[]): void {
  try {
    startWith(command, [...args], { detached: true, stdio: "ignore" }).unref();
  } catch {
    return;
  }
}

/** Shows a file selected in the file manager. */
export function reveal(path: string): void {
  if (OS === "mac") detached("open", ["-R", path]);
  else if (OS === "windows") detached("explorer.exe", [`/select,${path}`]);
  else detached("xdg-open", [join(path, "..")]);
}

/** Opens a link in the browser, or a file or folder with its usual app. */
export function openExternal(target: string): void {
  if (OS === "mac") detached("open", [target]);
  else if (OS === "windows") detached("rundll32", ["url.dll,FileProtocolHandler", target]);
  else detached("xdg-open", [target]);
}

/** Moves a file or folder to the Trash or Recycle Bin, so it can be restored. */
export async function trash(path: string): Promise<boolean> {
  try {
    if (OS === "mac") await run("osascript", ["-e", `tell application "Finder" to delete POSIX file "${path.replace(/"/g, "")}"`]);
    else if (OS === "windows") await run("powershell.exe", ["-NoProfile", "-Command", `Add-Type -AssemblyName Microsoft.VisualBasic; $p='${path.replace(/'/g, "''")}'; if (Test-Path $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin') }`]);
    else await run("gio", ["trash", path]);
    return true;
  } catch {
    return false;
  }
}

function linuxCopier(): readonly string[] | null {
  if (process.env.WAYLAND_DISPLAY) return ["wl-copy"];
  return ["xclip", "-selection", "clipboard"];
}

/** Puts text on the clipboard. */
export function copyToClipboard(text: string): Promise<void> {
  const command = OS === "mac" ? ["pbcopy"] : OS === "windows" ? ["powershell.exe", "-NoProfile", "-Command", "[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())"] : linuxCopier();
  const [program, ...args] = command ?? [];
  if (!program) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const child = startWith(program, args, { stdio: ["pipe", "ignore", "ignore"] });
      child.once("error", () => resolve());
      child.once("close", () => resolve());
      child.stdin?.end(text);
    } catch {
      resolve();
    }
  });
}

/** The text on the clipboard, or "" when there is none or it can't be read. */
export function readClipboard(): string {
  const command = OS === "mac" ? ["pbpaste"] : OS === "windows" ? ["powershell.exe", "-NoProfile", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw"] : process.env.WAYLAND_DISPLAY ? ["wl-paste", "--no-newline"] : ["xclip", "-selection", "clipboard", "-o"];
  const [program, ...args] = command;
  if (!program) return "";
  try {
    const text = runSync(program, args, { stdio: ["ignore", "pipe", "ignore"] });
    return OS === "windows" ? text.replace(/\r?\n$/, "") : text;
  } catch {
    return "";
  }
}

/** Whether the system is in dark mode, where the OS will say. */
export function systemDark(): boolean {
  try {
    if (OS === "mac") return runSync("defaults", ["read", "-g", "AppleInterfaceStyle"], { stdio: "pipe" }).trim() === "Dark";
    if (OS === "windows") return runSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "/v", "AppsUseLightTheme"], { stdio: "pipe" }).includes("0x0");
    return /dark/i.test(runSync("gsettings", ["get", "org.gnome.desktop.interface", "color-scheme"], { stdio: "pipe" }));
  } catch {
    return false;
  }
}

/** A desktop notification. */
export async function notify(title: string, body: string): Promise<void> {
  const quoted = (text: string): string => `"${text.replace(/["\\]/g, "\\$&")}"`;
  try {
    if (OS === "mac") await run("osascript", ["-e", `display notification ${quoted(body)} with title ${quoted(title)}`]);
    else if (OS === "linux") await run("notify-send", [title, body]);
    else await run("powershell.exe", ["-NoProfile", "-Command", `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; $x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $t = $x.GetElementsByTagName('text'); $t.Item(0).AppendChild($x.CreateTextNode('${title.replace(/'/g, "''")}')) > $null; $t.Item(1).AppendChild($x.CreateTextNode('${body.replace(/'/g, "''")}')) > $null; [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Eleven').Show([Windows.UI.Notifications.ToastNotification]::new($x))`]);
  } catch {
    return;
  }
}

/** A short alert sound. */
export async function chime(): Promise<void> {
  try {
    if (OS === "mac") await run("afplay", ["/System/Library/Sounds/Glass.aiff"]);
    else if (OS === "linux") await run("canberra-gtk-play", ["-i", "message-new-instant"]);
    else await run("powershell.exe", ["-NoProfile", "-Command", "[System.Media.SystemSounds]::Asterisk.Play()"]);
  } catch {
    return;
  }
}

/** Whether Eleven is the app in front, so notifications only show when you're elsewhere. Unknown counts as not in front. */
export async function inFront(): Promise<boolean> {
  if (OS !== "mac") return false;
  try {
    const { stdout } = await run("osascript", ["-e", 'tell application "System Events" to get unix id of first application process whose frontmost is true']);
    return Number(stdout.trim()) === process.pid;
  } catch {
    return false;
  }
}

/** Runs a command in a new terminal window, for installs that need you to answer a prompt. */
export function runInTerminal(command: string): void {
  if (OS === "mac") {
    detached("osascript", ["-e", `tell application "Terminal" to do script "${command.replace(/["\\]/g, "\\$&")}"`, "-e", 'tell application "Terminal" to activate']);
    return;
  }
  if (OS === "windows") {
    detached("cmd.exe", ["/c", "start", "cmd.exe", "/k", command]);
    return;
  }
  detached("x-terminal-emulator", ["-e", "sh", "-c", `${command}; exec sh`]);
}

async function firstLine(command: string, args: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await run(command, [...args]);
    const chosen = stdout.trim().replace(/(.)[/\\]$/, "$1");
    return chosen === "" ? null : chosen;
  } catch {
    return null;
  }
}

function psQuote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

/** Asks for a folder or a file with the system's own dialog; null when you cancel. */
export function choosePath(kind: "folder" | "file", prompt: string): Promise<string | null> {
  const clean = prompt.replace(/"/g, "");
  if (OS === "mac") return firstLine("osascript", ["-e", `POSIX path of (choose ${kind} with prompt "${clean}")`]);
  if (OS === "windows") {
    const dialog = kind === "folder"
      ? `$d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = ${psQuote(clean)}; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }`
      : `$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = ${psQuote(clean)}; if ($d.ShowDialog() -eq 'OK') { $d.FileName }`;
    return firstLine("powershell.exe", ["-NoProfile", "-STA", "-Command", `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; ${dialog}`]);
  }
  return firstLine("zenity", ["--file-selection", ...(kind === "folder" ? ["--directory"] : []), `--title=${clean}`]);
}

function stamp(): string {
  return new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
}

async function macClipboardFile(out: string): Promise<string | null> {
  const info = (await firstLine("osascript", ["-e", "clipboard info"])) ?? "";
  if (info.includes("«class furl»")) return firstLine("osascript", ["-e", "POSIX path of (the clipboard as «class furl»)"]);
  const image = info.includes("«class PNGf»") ? "«class PNGf»" : info.includes("TIFF picture") ? "TIFF picture" : null;
  if (!image) return null;
  const file = image === "TIFF picture" ? out.replace(/\.png$/, ".tiff") : out;
  const saved = await firstLine("osascript", ["-e", `set f to open for access POSIX file "${file}" with write permission`, "-e", "set eof f to 0", "-e", `write (the clipboard as ${image}) to f`, "-e", "close access f", "-e", `"${file}"`]);
  if (!saved) return null;
  if (file === out) return out;
  try {
    await run("sips", ["-s", "format", "png", file, "--out", out]);
    return out;
  } catch {
    return null;
  }
}

async function linuxClipboardFile(out: string): Promise<string | null> {
  const wayland = Boolean(process.env.WAYLAND_DISPLAY);
  const paste = (type: string): Promise<string | null> => (wayland ? firstLine("wl-paste", ["--type", type]) : firstLine("xclip", ["-selection", "clipboard", "-t", type, "-o"]));
  const types = (await (wayland ? firstLine("wl-paste", ["--list-types"]) : paste("TARGETS"))) ?? "";
  if (types.includes("text/uri-list")) {
    const first = (await paste("text/uri-list"))?.split("\n").find((line) => line.startsWith("file://"));
    return first ? decodeURIComponent(first.slice("file://".length)) : null;
  }
  if (!types.includes("image/png")) return null;
  const read = wayland ? "wl-paste --type image/png" : "xclip -selection clipboard -t image/png -o";
  return firstLine("sh", ["-c", `${read} > "${out}" && printf '%s' "${out}"`]);
}

/** What the clipboard holds that can go into a message: a copied file's path, or an image saved as a PNG in `folder`; null for text or nothing. */
export function clipboardFile(folder: string): Promise<string | null> {
  mkdirSync(folder, { recursive: true });
  const out = join(folder, `Pasted ${stamp()}.png`);
  if (OS === "mac") return macClipboardFile(out);
  if (OS === "windows") {
    return firstLine("powershell.exe", ["-NoProfile", "-STA", "-Command", `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $c = [System.Windows.Forms.Clipboard]; if ($c::ContainsFileDropList()) { $c::GetFileDropList()[0] } elseif ($c::ContainsImage()) { $c::GetImage().Save(${psQuote(out)}); ${psQuote(out)} }`]);
  }
  return linuxClipboardFile(out);
}

/** Asks where to save a file, starting in `folder` with `name` filled in; null when you cancel. */
export function chooseSavePath(prompt: string, name: string, folder: string): Promise<string | null> {
  const clean = prompt.replace(/"/g, "");
  if (OS === "mac") return firstLine("osascript", ["-e", `POSIX path of (choose file name with prompt "${clean}" default name "${name.replace(/"/g, "")}" default location (POSIX file "${folder.replace(/"/g, "")}"))`]);
  if (OS === "windows") {
    return firstLine("powershell.exe", ["-NoProfile", "-STA", "-Command", `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.SaveFileDialog; $d.Title = ${psQuote(clean)}; $d.FileName = ${psQuote(name)}; $d.InitialDirectory = ${psQuote(folder)}; if ($d.ShowDialog() -eq 'OK') { $d.FileName }`]);
  }
  return firstLine("zenity", ["--file-selection", "--save", "--confirm-overwrite", `--title=${clean}`, `--filename=${join(folder, name)}`]);
}

/** How to list a zip's entries: unzip, or the tar.exe Windows ships, since Windows has no unzip. */
export function zipListing(path: string): readonly [string, readonly string[]] {
  return OS === "windows" ? ["tar.exe", ["-tf", path]] : ["unzip", ["-Z1", path]];
}

/** How to print one zip entry's bytes. */
export function zipEntry(path: string, entry: string): readonly [string, readonly string[]] {
  return OS === "windows" ? ["tar.exe", ["-xOf", path, entry]] : ["unzip", ["-p", path, entry]];
}

/** How to unpack one zip entry into a folder, keeping its path inside the zip. */
export function zipExtract(path: string, entry: string, into: string): readonly [string, readonly string[]] {
  return OS === "windows" ? ["tar.exe", ["-xf", path, "-C", into, entry]] : ["unzip", ["-o", "-q", path, entry, "-d", into]];
}

/** A program's file name on this OS: `java` here, `java.exe` on Windows. */
export function exe(name: string): string {
  return OS === "windows" ? `${name}.exe` : name;
}

/** Ghidra's headless launcher: a shell script, or a batch file on Windows. */
export const ANALYZE_HEADLESS = OS === "windows" ? "analyzeHeadless.bat" : "analyzeHeadless";

/** Where JDKs live on this OS, as a folder of installs and the path from each install to its home. */
export function jdkLocations(engines: string): readonly (readonly [parent: string, suffix: string])[] {
  const home = homedir();
  switch (OS) {
    case "mac":
      return [
        [engines, "Contents/Home"],
        ["/Library/Java/JavaVirtualMachines", "Contents/Home"],
        ["/opt/homebrew/Cellar/openjdk@21", "libexec/openjdk.jdk/Contents/Home"],
        ["/opt/homebrew/Cellar/openjdk", "libexec/openjdk.jdk/Contents/Home"],
        ["/usr/local/Cellar/openjdk", "libexec/openjdk.jdk/Contents/Home"],
        ["/opt/zerobrew/prefix/Cellar/openjdk", "libexec/openjdk.jdk/Contents/Home"],
        [join(home, "Library", "Java", "JavaVirtualMachines"), "Contents/Home"],
      ];
    case "linux":
      return [[engines, ""], ["/usr/lib/jvm", ""], ["/opt/java", ""], [join(home, ".jdks"), ""]];
    case "windows":
      return [[engines, ""], ["C:\\Program Files\\Eclipse Adoptium", ""], ["C:\\Program Files\\Java", ""], ["C:\\Program Files\\Microsoft", ""], [join(home, ".jdks"), ""]];
    default: {
      const unhandled: never = OS;
      return unhandled;
    }
  }
}

/** Unpacks a .zip into a folder with whatever this OS has built in. */
/** Python's zip extractor drops the executable bit, which breaks Ghidra's launch scripts; this one restores each file's mode. */
const KEEP_MODES = "import os,sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nfor i in z.infolist():\n p=z.extract(i,sys.argv[2])\n m=i.external_attr>>16\n if m: os.chmod(p,m)";

export async function unzip(file: string, into: string): Promise<void> {
  const options = { timeout: 300000, maxBuffer: 1 << 24 };
  if (OS === "mac") await run("ditto", ["-x", "-k", file, into], options);
  else if (OS === "windows") await run("tar.exe", ["-xf", file, "-C", into], options);
  else {
    try {
      await run("unzip", ["-q", "-o", file, "-d", into], options);
    } catch {
      await run("python3", ["-c", KEEP_MODES, file, into], options);
    }
  }
}

/** True when running from source under bun, false in the packaged app. */
export const FROM_SOURCE = basename(process.execPath).startsWith("bun");

/** The command key in copy: ⌘ on the Mac, Ctrl elsewhere. */
export const MOD = OS === "mac" ? "⌘" : "Ctrl+";

/** Whether the command key (⌘, or Ctrl off the Mac) is held. */
export function primaryHeld(mods: { readonly cmd?: boolean; readonly ctrl?: boolean } | undefined): boolean {
  return (OS === "mac" ? mods?.cmd : mods?.ctrl) ?? false;
}

/** How copy refers to the machine: "this Mac" on a Mac, "this computer" elsewhere. */
export const THIS_DEVICE = OS === "mac" ? "this Mac" : "this computer";

export const OS_NAME = OS === "mac" ? "macOS" : OS === "windows" ? "Windows" : "Linux";

/** A small program every machine has, for the first-run example. */
export const SAMPLE_APP: { readonly path: string; readonly name: string } =
  OS === "mac"
    ? { path: "/System/Applications/Calculator.app", name: "Calculator" }
    : OS === "windows"
      ? { path: "C:\\Windows\\System32\\notepad.exe", name: "Notepad" }
      : { path: "/usr/bin/bc", name: "bc" };

/** Programs to suggest opening on a first run, when they exist here. */
export const STARTER_FILES: readonly string[] =
  OS === "mac" ? ["/System/Applications/Notes.app", "/bin/ls", "/usr/bin/curl"] : OS === "windows" ? ["C:\\Windows\\System32\\notepad.exe", "C:\\Windows\\System32\\curl.exe", "C:\\Windows\\System32\\whoami.exe"] : ["/bin/ls", "/usr/bin/curl", "/usr/bin/bc"];
