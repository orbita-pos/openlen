// WHAT AN APP ON THE DESKTOP DECLARES (spec local 2026-11-27-notificaciones-del-escritorio, §4.1 and §7.4): in the
// shell of the installed version —its `/index.html`— a tag
//   <script id="openlen-app-manifest" type="application/json">{"permissions":["notifications"]}</script>
// names the permissions the app may ask for, like Claude's `claude-artifacts-manifest`. Pure and client-safe — strings in,
// names out, no DOM, no Node, no OpenLen — because the SERVER reads it from the release's HTML and the window (a client
// component) shares its types.
//   · limits and shape are Claude's (its zod schema): the tag's text ≤ 16.000 characters; `permissions`, if there, a list
//     of at most 32 strings of at most 64 characters — anything else is the WHOLE manifest invalid; and ours: only the
//     first 1 MiB of the shell is scanned, so a manifest beyond it is not read;
//   · other keys are ignored; a name that does not exist is ignored in silence;
//   · JSON that does not parse (or has the wrong shape) leaves the app with NO permissions and returns an `error` for the
//     page's CONSOLE — never for the person — so whoever built the app finds out;
//   · only `notifications` can be granted (`GRANTABLE`); the other four names exist so an app can declare them, and they
//     are always «unavailable» (a PWA has no shortcuts, overlay, menu bar or full access).
// Which tag: the one Claude's `querySelector('script#…[type="application/json"]')` would find in the parsed page — the first
// `<script>` element whose id is exactly this and whose type is `application/json` in any letter case (HTML compares `type`
// that way in selectors), with no spaces around. The scan is not a parser but follows the parser where it matters: a
// script inside a comment, inside another script's text, inside a raw-text element (`<style>`, `<textarea>`, `<title>`,
// `<xmp>`, `<iframe>`, `<noembed>`, `<noframes>`, `<noscript>` — a browser running scripts reads it as text) or after
// `<plaintext>` is no element; one inside a `<template>`, at any depth, is inert content a selector does not see. What it
// still reads differently (foreign content like `<svg>`, the empty comment `<!-->`) can only make it miss a manifest.

export const DESKTOP_PERMISSIONS = ["notifications", "shortcuts", "overlay", "menu-bar", "full-access"] as const;
export type DesktopPermission = (typeof DESKTOP_PERMISSIONS)[number];

export const GRANTABLE: readonly DesktopPermission[] = ["notifications"];

export const MANIFEST_ID = "openlen-app-manifest";
export const MANIFEST_MAX_CHARS = 16_000;
export const MANIFEST_MAX_NAMES = 32;
export const PERMISSION_NAME_MAX_CHARS = 64;
export const SCANNED_SHELL_MAX_CHARS = 1_048_576;

// One token at a time, in order: an HTML comment (to the first `-->`, or the end); a `<script …>…</script>` (to the first
// `</script`, or the end); a raw-text element, swallowed whole to its own close tag (or the end); a `<template …>` open tag
// or a `</template>` close tag (the depth is counted in `manifestText`); or, last, a raw-text, script or template open tag
// that never reaches its `>` outside quotes, or a `<plaintext>`, either of which swallows the rest of the text as a browser
// does. 🔴 The scan must stay LINEAR: the author controls this HTML and the server scans it in its own process, so every
// part that can fail after reading far ahead has an alternative that ends at the end of the text instead of leaving the
// engine to backtrack and try the next occurrence — which is quadratic (128 KB took 2 s):
//   · the last alternative, for an open tag that never reaches its `>` (it has no groups, so `manifestText` skips it);
//   · `(?:>|$)` in every close tag, for a `</script ` or `</style/` that never reaches its `>`;
//   · `|$` after every lazy body, for an element never closed.
// The attribute group reads quoted values whole, so a `>` inside one does not end the tag. And only the first 1 MiB of a
// shell is scanned at all (`SCANNED_SHELL_MAX_CHARS`), whatever else lies behind.
const RAW_TEXT = "style|textarea|title|xmp|iframe|noembed|noframes|noscript";
const OPEN_TAG_REST = `(?:"[^"]*"|'[^']*'|[^>"'])*>`;
const SCAN = new RegExp(
  [
    `<!--[\\s\\S]*?(?:-->|$)`,
    `<script(?=[\\s/>])(?<attributes>(?:"[^"]*"|'[^']*'|[^>"'])*)>(?<text>[\\s\\S]*?)(?:<\\/script(?=[\\s/>])[^>]*(?:>|$)|$)`,
    `<(?<raw>${RAW_TEXT})(?=[\\s/>])${OPEN_TAG_REST}[\\s\\S]*?(?:<\\/\\k<raw>(?=[\\s/>])[^>]*(?:>|$)|$)`,
    `(?<open><template(?=[\\s/>])${OPEN_TAG_REST})`,
    `(?<close><\\/template(?=[\\s/>])[^>]*(?:>|$))`,
    `<(?:script|template|${RAW_TEXT})(?=[\\s/>])[\\s\\S]*$`,
    `<plaintext(?=[\\s/>])[\\s\\S]*$`,
  ].join("|"),
  "gi",
);
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
  let templateDepth = 0;
  for (const match of html.matchAll(SCAN)) {
    const g = match.groups ?? {};
    if (g.open !== undefined) templateDepth++;
    else if (g.close !== undefined) templateDepth = Math.max(0, templateDepth - 1);
    if (g.attributes === undefined || g.text === undefined || templateDepth > 0) continue; // not a script, or inert
    const attributes = attributesOf(g.attributes);
    if (attributes.get("id") !== MANIFEST_ID) continue;
    if ((attributes.get("type") ?? "").toLowerCase() !== "application/json") continue;
    return g.text;
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

  // Claude's schema: at most 32 entries, each a string of at most 64 characters — or the whole manifest is invalid.
  if (
    declared.length > MANIFEST_MAX_NAMES ||
    declared.some((name) => typeof name !== "string" || name.length > PERMISSION_NAME_MAX_CHARS)
  ) {
    return none(
      `${MANIFEST_ID} "permissions" must be a list of at most ${MANIFEST_MAX_NAMES} names of at most ${PERMISSION_NAME_MAX_CHARS} characters, so the app declares no permissions.`,
    );
  }
  // Of those names, the ones that exist, each once.
  const permissions: DesktopPermission[] = [];
  for (const name of declared as string[]) {
    if (isDesktopPermission(name) && !permissions.includes(name)) permissions.push(name);
  }
  return { permissions, error: null };
}
