// WHAT AN APP ON THE DESKTOP DECLARES (spec local 2026-11-27-notificaciones-del-escritorio, §4.1 and §7.4): in the
// shell of the installed version —its `/index.html`— a tag
//   <script id="openlen-app-manifest" type="application/json">{"permissions":["notifications"]}</script>
// names the permissions the app may ask for, like Claude's `claude-artifacts-manifest`. Pure and client-safe — strings in,
// names out, no DOM, no Node, no OpenLen — because the SERVER reads it from the release's HTML and the window (a client
// component) shares its types.
//   · limits are Claude's: the tag's text ≤ 16.000 characters, ≤ 32 names of ≤ 64 characters; and ours: only the first
//     1 MiB of the shell is scanned, so a manifest beyond it is not read;
//   · other keys are ignored; a name that does not exist is ignored in silence;
//   · JSON that does not parse (or has the wrong shape) leaves the app with NO permissions and returns an `error` for the
//     page's CONSOLE — never for the person — so whoever built the app finds out;
//   · only `notifications` can be granted (`GRANTABLE`); the other four names exist so an app can declare them, and they
//     are always «unavailable» (a PWA has no shortcuts, overlay, menu bar or full access).
// The scan is tolerant, not a parser: it walks the `<script>` elements and the comments in order, so a manifest inside a
// comment or inside another script's text is not one. The first tag that matches id AND type wins. It does not track the
// other raw-text elements (`<style>`, `<textarea>`, `<title>`…), `<template>` or the empty comments `<!-->`: every mis-read
// there fails closed (a manifest swallowed is a manifest not read) except a manifest inside an element whose content a
// browser does not run as script (`<template>`, `<textarea>`, `<style>`, `<title>`…), which is read; that grants nothing by
// itself — the person still answers.

export const DESKTOP_PERMISSIONS = ["notifications", "shortcuts", "overlay", "menu-bar", "full-access"] as const;
export type DesktopPermission = (typeof DESKTOP_PERMISSIONS)[number];

export const GRANTABLE: readonly DesktopPermission[] = ["notifications"];

export const MANIFEST_ID = "openlen-app-manifest";
export const MANIFEST_MAX_CHARS = 16_000;
export const MANIFEST_MAX_NAMES = 32;
export const PERMISSION_NAME_MAX_CHARS = 64;
export const SCANNED_SHELL_MAX_CHARS = 1_048_576;

// An HTML comment (to the first `-->`, or the end), a `<script …>…</script>` (to the first `</script`, or the end) or, last,
// a `<script` open tag that never reaches its `>` outside quotes, which swallows the rest of the text as a browser does at
// the end of the input inside a tag. 🔴 The scan must stay LINEAR: the author controls this HTML and the server scans it in
// its own process, so every part that can fail after reading far ahead has an alternative that ends at the end of the text
// instead of leaving the engine to backtrack and try the next occurrence — which is quadratic (128 KB took 2 s):
//   · the last alternative, for an open tag that never reaches its `>` (it has no groups, so `manifestText` skips it);
//   · `(?:>|$)` in the close tag, for a `</script ` or `</script/` that never reaches its `>`.
// The attribute group reads quoted values whole, so a `>` inside one does not end the tag. And only the first 1 MiB of a
// shell is scanned at all (`SCANNED_SHELL_MAX_CHARS`), whatever else lies behind.
const SCAN =
  /<!--[\s\S]*?(?:-->|$)|<script(?=[\s/>])((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)(?:<\/script(?=[\s/>])[^>]*(?:>|$)|$)|<script(?=[\s/>])[\s\S]*$/gi;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attributesOf(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase();
    // As in HTML: the first of a repeated attribute is the one that counts.
    if (!attributes.has(name)) attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function manifestText(html: string): string | null {
  for (const match of html.matchAll(SCAN)) {
    const [, attributeSource, text] = match;
    if (attributeSource === undefined || text === undefined) continue; // a comment
    const attributes = attributesOf(attributeSource);
    if (attributes.get("id") !== MANIFEST_ID) continue;
    if ((attributes.get("type") ?? "").trim().toLowerCase() !== "application/json") continue;
    return text;
  }
  return null;
}

function isDesktopPermission(name: string): name is DesktopPermission {
  return (DESKTOP_PERMISSIONS as readonly string[]).includes(name);
}

const none = (error: string | null): { permissions: DesktopPermission[]; error: string | null } => ({ permissions: [], error });

export function readDeclaredPermissions(html: string): { permissions: DesktopPermission[]; error: string | null } {
  // Defense in depth: a manifest beyond the first 1 MiB is not read (fails closed); one the limit cuts in the middle of its
  // text reads as invalid JSON, one it cuts in the middle of its open tag as no manifest.
  const text = manifestText(html.length > SCANNED_SHELL_MAX_CHARS ? html.slice(0, SCANNED_SHELL_MAX_CHARS) : html);
  if (text === null) return none(null);
  if (text.length > MANIFEST_MAX_CHARS) {
    return none(`${MANIFEST_ID} is over ${MANIFEST_MAX_CHARS} characters, so the app declares no permissions.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return none(`${MANIFEST_ID} is not valid JSON (${reason}), so the app declares no permissions.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return none(`${MANIFEST_ID} must be a JSON object like {"permissions":["notifications"]}, so the app declares no permissions.`);
  }

  const declared = (parsed as { permissions?: unknown }).permissions;
  if (declared === undefined) return none(null);
  if (!Array.isArray(declared)) {
    return none(`${MANIFEST_ID} "permissions" must be an array of names, so the app declares no permissions.`);
  }

  // The first 32 names that are names (a string of ≤ 64 characters) are the ones read; of those, the ones that exist.
  const names = declared
    .filter((name): name is string => typeof name === "string" && name.length <= PERMISSION_NAME_MAX_CHARS)
    .slice(0, MANIFEST_MAX_NAMES);
  const permissions: DesktopPermission[] = [];
  for (const name of names) {
    if (isDesktopPermission(name) && !permissions.includes(name)) permissions.push(name);
  }
  return { permissions, error: null };
}
