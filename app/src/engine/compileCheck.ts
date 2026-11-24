import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/** How far a check goes: types and syntax for the C family, syntax alone for Swift, whose files need their whole module to type-check. */
export type CheckDepth = "types" | "syntax";

export type CheckCommand = { readonly args: readonly string[]; readonly depth: CheckDepth };

const C_FAMILY: Readonly<Record<string, string>> = { ".c": "c", ".h": "c", ".m": "objective-c", ".cpp": "c++", ".cc": "c++", ".cxx": "c++", ".hpp": "c++", ".mm": "objective-c++" };

/** The Xcode command that checks a file like this one, or null for a language Eleven can't check. */
export function checkCommand(file: string, path: string): CheckCommand | null {
  const extension = /\.[^./]+$/.exec(file)?.[0]?.toLowerCase() ?? "";
  if (extension === ".swift") return { args: ["xcrun", "swiftc", "-parse", path], depth: "syntax" };
  const language = C_FAMILY[extension];
  if (!language) return null;
  return { args: ["xcrun", "clang", "-fsyntax-only", "-x", language, ...(language.startsWith("objective") ? ["-fobjc-arc"] : []), "-Wno-everything", path], depth: "types" };
}

export type CheckResult = { readonly depth: CheckDepth; readonly errors: readonly string[] };

/** The compiler's error lines, with the temporary path cut down to the file's own name. */
export function errorLines(output: string, path: string, file: string): readonly string[] {
  return output.split("\n").filter((line) => /\berror:/.test(line) && !/^\s*[|`]/.test(line)).map((line) => line.split(path).join(basename(file)).trim());
}

/** Checks a recreated file with Xcode's compiler. Null when the language has no check. */
export async function compileCheck(file: string, code: string): Promise<CheckResult | null> {
  const dir = await mkdtemp(join(tmpdir(), "eleven-check-"));
  const path = join(dir, basename(file));
  const command = checkCommand(file, path);
  if (!command) return null;
  try {
    await writeFile(path, code);
    const proc = Bun.spawn([...command.args], { stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { depth: command.depth, errors: errorLines(`${out}\n${err}`, path, file) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
