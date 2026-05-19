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

import * as cheerio from "cheerio";

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
