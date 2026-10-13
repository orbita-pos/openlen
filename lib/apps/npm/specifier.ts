// Bare import specifiers: "three", "three/examples/jsm/x.js", "@scope/pkg/sub".

export interface BareSpecifier {
  readonly name: string;
  /** What comes after the package name, without the leading slash; "" for the package itself. */
  readonly subpath: string;
}

// npm names: lowercase for new packages, but old ones can have capitals.
const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

export function parseBareSpecifier(spec: string): BareSpecifier | null {
  if (!spec || spec.startsWith(".") || spec.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(spec)) return null;
  const parts = spec.split("/");
  const nameParts = spec.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1);
  const name = nameParts.join("/");
  if (!NPM_NAME.test(name)) return null;
  return { name, subpath: parts.slice(nameParts.length).join("/") };
}

export const ASSET_EXTENSIONS = [".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".woff", ".woff2", ".ttf", ".otf"] as const;

/** A package file that is imported as CSS (injected) or as a URL (images, fonts), like in Vite. */
export function isAssetSubpath(subpath: string): boolean {
  const lower = subpath.toLowerCase();
  return ASSET_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function specifierOf(name: string, subpath: string): string {
  return subpath ? `${name}/${subpath}` : name;
}
