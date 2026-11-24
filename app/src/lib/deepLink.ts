/** A place in a project that a link can open: the binary by its SHA-256, and optionally an address in it. */
export type DeepLink = { readonly project: string; readonly address: string | null; readonly name: string | null };

const SCHEME = "eleven:";

/** A link like eleven://open/<sha256>?at=0x100000c78&name=PhotoFilter.app, which opens the project there when clicked. */
export function linkTo(project: string, address: string | null, name: string | null = null): string {
  const query = new URLSearchParams();
  if (address) query.set("at", address);
  if (name) query.set("name", name);
  const rest = query.toString();
  return `eleven://open/${project}${rest ? `?${rest}` : ""}`;
}

export function parseLink(text: string): DeepLink | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== SCHEME || url.hostname !== "open") return null;
  const project = url.pathname.replace(/^\/+/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(project)) return null;
  const at = url.searchParams.get("at");
  const address = at && /^0x[0-9a-f]+$/i.test(at) ? at.toLowerCase() : null;
  return { project, address, name: url.searchParams.get("name") };
}

let opener: ((link: DeepLink) => void) | null = null;

/** The app claims this so anything can open a project at an address the way a clicked link does. */
export function claimLinkOpener(next: ((link: DeepLink) => void) | null): void {
  opener = next;
}

export function openLink(link: DeepLink): void {
  opener?.(link);
}
