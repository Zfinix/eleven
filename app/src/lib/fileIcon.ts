import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ASSETS } from "./assets";
import { cacheRoot, OS } from "./platform";
import { run } from "./process";

const ICON_DIR = join(cacheRoot(), "icons");
const SIZE = 256;

const DRAW_ICON = `ObjC.import('AppKit');
function run(argv) {
  const img = $.NSWorkspace.sharedWorkspace.iconForFile(argv[0]);
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, ${SIZE}, ${SIZE}, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep));
  img.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, ${SIZE}, ${SIZE}), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1);
  $.NSGraphicsContext.restoreGraphicsState;
  rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $()).writeToFileAtomically(argv[1], true);
}`;

/** `aspect` marks a one-color logo, drawn as a native SVG in the text color so thin shapes stay sharp. */
type LogoSpec = { readonly test: RegExp; readonly name: string; readonly label: string; readonly aspect?: number };

const LOGOS: readonly LogoSpec[] = [
  { test: /\.(apk|aab|xapk|apks|dex)$/i, name: "android", label: "Android" },
  { test: /\.(ptx|cubin|fatbin)$/i, name: "nvidia", label: "CUDA" },
  { test: /\.(hipfb|hsaco|co)$/i, name: "amd", label: "ROCm", aspect: 800 / 190.803 },
  { test: /\.spv$/i, name: "vulkan", label: "SPIR-V" },
  { test: /\.gguf$/i, name: "llama-cpp", label: "GGUF" },
  { test: /\.onnx$/i, name: "onnx", label: "ONNX" },
  { test: /\.(pt|pth|ckpt)$/i, name: "pytorch", label: "PyTorch" },
  { test: /\.safetensors$/i, name: "huggingface", label: "safetensors" },
  { test: /\.tflite$/i, name: "tensorflow", label: "TFLite" },
];

export type FormatLogo = { readonly kind: "color"; readonly src: string } | { readonly kind: "mono"; readonly svg: string; readonly aspect: number };

const monoSources = new Map<string, string>();

function monoSource(file: string): string {
  const known = monoSources.get(file);
  if (known !== undefined) return known;
  const svg = readFileSync(file, "utf8");
  monoSources.set(file, svg);
  return svg;
}

/** The maker's logo for formats Finder only shows as a blank page (Android, CUDA, ROCm, model files). */
export function formatLogo(path: string): FormatLogo | null {
  const spec = LOGOS.find(({ test }) => test.test(path));
  if (!spec) return null;
  const src = join(ASSETS, "formats", `${spec.name}.svg`);
  return spec.aspect ? { kind: "mono", svg: monoSource(src), aspect: spec.aspect } : { kind: "color", src };
}

/** A short name for those formats, for files that have no architecture to show. */
export function formatLabel(path: string): string | null {
  return LOGOS.find(({ test }) => test.test(path))?.label ?? null;
}

const pending = new Map<string, Promise<string | null>>();

function cachedPng(source: string): string {
  return join(ICON_DIR, `${createHash("sha1").update(source).digest("hex").slice(0, 16)}.png`);
}

async function render(source: string, out: string): Promise<string | null> {
  if (OS !== "mac") return null;
  try {
    mkdirSync(ICON_DIR, { recursive: true });
    if (/\.(ico|icns|png)$/i.test(source)) await run("sips", ["-s", "format", "png", "-Z", String(SIZE), source, "--out", out]);
    else await run("osascript", ["-l", "JavaScript", "-e", DRAW_ICON, source, out]);
    return existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

/** A PNG of the icon Finder shows for a path (an app's own icon, the exec icon for a tool), or of an .ico/.icns file, cached on disk. */
export function fileIcon(source: string): Promise<string | null> {
  const out = cachedPng(source);
  if (existsSync(out)) return Promise.resolve(out);
  const known = pending.get(out);
  if (known) return known;
  const made = render(source, out);
  pending.set(out, made);
  return made;
}
