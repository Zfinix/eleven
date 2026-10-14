import { coerce, compare, gt, type SemVer } from "semver";

/** The version in text like "12.1.4", "ghidra_12.1.4_PUBLIC", "jadx-1.5.6" or "1.8.0_402"; null when it has none. */
export function versionIn(text: string | null): SemVer | null {
  return text ? coerce(text) : null;
}

/** True when `candidate` is a later version than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  const [a, b] = [versionIn(candidate), versionIn(current)];
  return a !== null && b !== null && gt(a, b);
}

/** A sort() comparator that puts the newest version first and anything without one last. */
export function newestFirst<T>(versionOf: (item: T) => string | null): (a: T, b: T) => number {
  return (a, b) => {
    const [x, y] = [versionIn(versionOf(a)), versionIn(versionOf(b))];
    if (x === null || y === null) return (x === null ? 1 : 0) - (y === null ? 1 : 0);
    return compare(y, x);
  };
}
