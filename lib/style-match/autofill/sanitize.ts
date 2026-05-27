// HTML sanitizer for autofilled output. The user's autofilled HTML eventually
// gets published to <sub>.openlen.com where visitors will execute whatever
// JavaScript / event handlers it contains. If Kimi obeyed a malicious image
// or text input (prompt injection), it could emit <script> tags or
// onclick="..." handlers that compromise visitors.
//
// Strategy: strip everything that can execute JavaScript, plus dangerous
// URL schemes, but PRESERVE the design-bearing HTML (classes, inline styles,
// font links, Tailwind CDN script, normal anchor hrefs).
//
// We deliberately keep <style> blocks (templates need them) but strip
// <script> except the known-safe Tailwind CDN import we whitelist by URL.
//
// ─── Migration note (F1 S6) ────────────────────────────────────────────────
// Routed through `lib/shadow-soak` so we can soak the Rust sanitize gate
// against the legacy cheerio path. Default mode is `shadow-prefer-ts`, so
// production behaviour is unchanged — Rust runs in shadow, divergences land
// as `[shadow-soak] divergence …` warnings. Flip with OPENLEN_SHADOW_MODE
// or OPENLEN_SHADOW_SANITIZE_FILLED_HTML once soak data is clean.
//
// Known semantic divergences (logged by shadow-soak — these are *expected*
// for shadow output and validate the harness is working):
//   - Counter shape: TS bundles <meta http-equiv="refresh"> into `removed.scripts`;
//     Rust splits it into `removed.metaRefresh`. The Rust→TS adapter below
//     re-bundles for like-for-like comparison.
//   - Serialiser whitespace / attribute quoting: cheerio's serialiser and
//     lol-html's output may differ in optional whitespace. Logged but
//     behaviour-equivalent.
//   - Slot-path gate: Rust's `sanitize_for_publish` fail-fasts when it sees
//     `data-slot-path=`. Autofill HTML should never carry that marker, so
//     the gate firing here indicates an upstream bug — the Rust adapter
//     throws so shadow-soak surfaces it as `errorShapeMismatch=true`.

import * as cheerio from "cheerio";

import { sanitizeForPublish as rustSanitizeForPublish } from "@/lib/html-engine";
import { shadowCompare } from "@/lib/shadow-soak";

const ALLOWED_SCRIPT_SRCS = new Set([
  "https://cdn.tailwindcss.com",
  "https://cdn.tailwindcss.com?plugins=forms,typography,aspect-ratio,line-clamp",
]);

// Strict regex: `on` followed by 1+ letters, case insensitive.
const EVENT_HANDLER_ATTR = /^on[a-z]+$/i;

// URL schemes we reject everywhere (href, src, action, formaction, etc.).
const DANGEROUS_URL_SCHEME = /^\s*(javascript|vbscript|data:text\/html|data:image\/svg\+xml.*script)/i;

const URL_ATTRS = ["href", "src", "action", "formaction", "background", "ping"];

export interface SanitizeResult {
  html: string;
  removed: {
    scripts: number;
    eventHandlers: number;
    dangerousUrls: number;
    iframes: number;
  };
}

export function sanitizeFilledHtml(html: string): SanitizeResult {
  return shadowCompare(
    "sanitize-filled-html",
    `bytes=${html.length}`,
    () => sanitizeFilledHtmlTs(html),
    () => sanitizeFilledHtmlRust(html),
    { fallbackMode: "shadow-prefer-ts" },
  );
}

function sanitizeFilledHtmlTs(html: string): SanitizeResult {
  const $ = cheerio.load(html, { xmlMode: false });
  const removed = {
    scripts: 0,
    eventHandlers: 0,
    dangerousUrls: 0,
    iframes: 0,
  };

  // 1. Strip <script> tags unless they're a whitelisted CDN import.
  $("script").each((_, el) => {
    const $el = $(el);
    const src = ($el.attr("src") ?? "").trim();
    if (src && ALLOWED_SCRIPT_SRCS.has(src)) return;
    $el.remove();
    removed.scripts += 1;
  });

  // 2. Strip <iframe>, <object>, <embed>, <applet>, <portal> — these can
  //    execute or embed remote content we can't audit.
  $("iframe, object, embed, applet, portal").each((_, el) => {
    $(el).remove();
    removed.iframes += 1;
  });

  // 3. Remove on*= event handler attributes from every element.
  $("*").each((_, el) => {
    if (el.type !== "tag") return;
    const attribs = (el as { attribs?: Record<string, string> }).attribs;
    if (!attribs) return;
    for (const name of Object.keys(attribs)) {
      if (EVENT_HANDLER_ATTR.test(name)) {
        $(el).removeAttr(name);
        removed.eventHandlers += 1;
      }
    }
  });

  // 4. Sanitize URL-bearing attributes — strip if they use a dangerous scheme.
  for (const attr of URL_ATTRS) {
    $(`[${attr}]`).each((_, el) => {
      const value = $(el).attr(attr);
      if (!value) return;
      if (DANGEROUS_URL_SCHEME.test(value)) {
        $(el).removeAttr(attr);
        removed.dangerousUrls += 1;
      }
    });
  }

  // 5. Strip <meta http-equiv="refresh"> — redirect attacks.
  $('meta[http-equiv]').each((_, el) => {
    const httpEquiv = ($(el).attr("http-equiv") ?? "").toLowerCase();
    if (httpEquiv === "refresh" || httpEquiv === "set-cookie") {
      $(el).remove();
      removed.scripts += 1;
    }
  });

  return {
    html: $.html(),
    removed,
  };
}

/** Run the Rust `sanitize_for_publish` and adapt to the TS-shape SanitizeResult.
 *
 *  Two adapter responsibilities:
 *    1. Re-bundle Rust's `metaRefresh` counter into `scripts` so the counter
 *       totals match the TS contract one-for-one.
 *    2. Throw on the slot-path gate. Autofill HTML should never carry
 *       `data-slot-path=` (it's an editor-mode marker stripped by the
 *       caller chain). If it ever fires here, we want shadow-soak to flag
 *       the upstream bug — not silently return TS as if both impls agreed.
 */
function sanitizeFilledHtmlRust(html: string): SanitizeResult {
  const r = rustSanitizeForPublish(html);
  if (r.html === null) {
    throw new Error(
      `sanitize gate fired (unexpected for autofill): ${r.errors.join("; ")}`,
    );
  }
  return {
    html: r.html,
    removed: {
      scripts: r.removed.scripts + r.removed.metaRefresh,
      eventHandlers: r.removed.eventHandlers,
      dangerousUrls: r.removed.dangerousUrls,
      iframes: r.removed.iframes,
    },
  };
}
