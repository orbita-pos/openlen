// HTML sanitizer for autofilled output. The user's autofilled HTML eventually
// gets published to <sub>.openlen.com where visitors will execute whatever
// JavaScript / event handlers it contains. If the model obeyed a malicious image
// or text input (prompt injection), it could emit <script> tags or
// onclick="..." handlers that compromise visitors.
//
// Strategy: strip everything that can execute JavaScript, plus dangerous
// URL schemes, but PRESERVE the design-bearing HTML (classes, inline styles,
// font links, Tailwind CDN script, normal anchor hrefs).
//
// Backed by the Rust `sanitize_for_publish` gate (S3 consolidated sanitizer,
// covers script strip / iframe-object-embed / on*= handlers / dangerous URL
// schemes / meta-refresh / set-cookie). The Rust gate also fails-fast on
// `data-slot-path=` — autofill HTML should never carry that marker, so a
// throw here surfaces an upstream bug rather than letting it leak downstream.
//
// Counter shape: Rust splits meta-refresh into its own counter; the TS
// contract callers depend on bundles it into `scripts`. The wrapper here
// re-bundles to keep the public counters one-for-one with prior behaviour.

import { sanitizeForPublish as rustSanitizeForPublish } from "@/lib/html-engine";

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
