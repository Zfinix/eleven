/** The name a C declaration gives its type: the tag of a struct, union or enum, or the new name in a typedef. */
export function cTypeName(declaration: string): string | null {
  const text = declaration.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").trim();
  if (/^typedef\b/.test(text)) {
    const fnPointer = /\(\s*\*\s*([A-Za-z_]\w*)\s*\)\s*\([^)]*\)\s*;?\s*$/.exec(text);
    if (fnPointer?.[1]) return fnPointer[1];
    return /([A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)*;?\s*$/.exec(text)?.[1] ?? null;
  }
  return /^(?:struct|union|enum)\s+([A-Za-z_]\w*)/.exec(text)?.[1] ?? null;
}
