// Fixed paths and service origins of open npm (spec 2026-10-13-open-npm-design).
// Light on purpose: lib/agent/ficheros/folder.ts imports it, and that file can
// be bundled for the browser. The functions read process.env only when called.

/** The app's package list, in npm's format. Saved, read by the compiler, never published. */
export const PACKAGE_JSON_PATH = "/package.json";
/** What esm.sh served for each package: exact version, module URLs and their hashes. Written only by the platform. */
export const ESM_LOCK_PATH = "/.openlen/esm-lock.json";

const withoutTrailingSlash = (url: string) => url.replace(/\/+$/, "");

export function esmOrigin(): string {
  return withoutTrailingSlash(process.env.OPENLEN_ESM_ORIGIN || "https://esm.sh");
}

export function npmRegistry(): string {
  return withoutTrailingSlash(process.env.OPENLEN_NPM_REGISTRY || "https://registry.npmjs.org");
}

export function osvApi(): string {
  return withoutTrailingSlash(process.env.OPENLEN_OSV_API || "https://api.osv.dev");
}
