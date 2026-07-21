// Publish-time WhatsApp button — a floating tap-to-chat FAB baked onto the
// published page. Pure HTML/CSS (no JS), so it survives the static publish +
// sealed CSP. A per-page module (settings.whatsapp), distinct from the
// business-profile contact widget (lib/business-profiles/contact-widget): when
// the page already carries that widget (data-ol-contact-widget) we SUPPRESS this
// one, so a profile-seeded page never shows two FABs.

const MARKER = "data-ol-wa-button";
const WA_GREEN = "#25D366";

export interface WhatsAppButtonConfig {
  number: string;
  message?: string;
  side?: "left" | "right";
  /** Distance from the bottom edge (px). Default 18; the caller raises it so the
   *  FAB stacks ABOVE another widget that already owns the same corner (the
   *  site-assistant button on the right, the music player on the left) instead
   *  of being painted over. */
  bottomPx?: number;
}

function onlyDigits(s: string): string {
  return s.replace(/[^\d]/g, "");
}

/** A wa.me link with an optional prefilled message, or null when the number
 *  isn't usable. A 10-digit number is treated as Mexico (+52), the primary
 *  market; anything ≥8 digits is taken as already international. */
export function waHref(number: string, message?: string): string | null {
  let d = onlyDigits(number || "");
  if (d.length < 8) return null;
  if (d.length === 10) d = "52" + d;
  const base = `https://wa.me/${d}`;
  const msg = (message ?? "").trim();
  return msg ? `${base}?text=${encodeURIComponent(msg)}` : base;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const WA_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 1.67c2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.24-8.24 8.24a8.2 8.2 0 0 1-4.3-1.18l-.31-.18-3.12.82.83-3.04-.2-.32a8.2 8.2 0 0 1-1.26-4.36c0-4.54 3.7-8.24 8.24-8.24zm4.52 10.36c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.42h-.47c-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z"/></svg>';

/** Does the profile contact widget on this page already offer WhatsApp? Scans
 *  ONLY the widget's own <div> block (depth-tracked), so an email/socials-only
 *  widget — or a wa.me link elsewhere in the page content — never counts. A
 *  widget without WhatsApp used to suppress the module FAB entirely (false
 *  positive: "activé WhatsApp y no sale el botón"). */
function contactWidgetHasWhatsApp(html: string): boolean {
  const start = html.indexOf("data-ol-contact-widget");
  if (start === -1) return false;
  const openTag = html.lastIndexOf("<", start);
  if (openTag === -1) return false;
  const scan = /<div\b|<\/div>/gi;
  scan.lastIndex = openTag + 1;
  let depth = 1;
  let m: RegExpExecArray | null = null;
  while (depth > 0 && (m = scan.exec(html))) {
    depth += m[0] === "</div>" ? -1 : 1;
  }
  const end = m ? scan.lastIndex : html.length;
  return /wa\.me\//i.test(html.slice(openTag, end));
}

/** Inject the WhatsApp FAB before </body>. No-op when: the number isn't usable,
 *  the profile contact widget already offers WhatsApp (dedup — two WhatsApp
 *  entries in one corner), or this FAB is already present (idempotent). */
export function bakeWhatsAppButton(html: string, cfg: WhatsAppButtonConfig): string {
  if (!html || html.includes(MARKER)) return html;
  if (contactWidgetHasWhatsApp(html)) return html;
  const href = waHref(cfg.number, cfg.message);
  if (!href) return html;
  const side = cfg.side === "left" ? "left" : "right";
  const bottom = Number.isFinite(cfg.bottomPx) ? (cfg.bottomPx as number) : 18;
  const fab =
    `<a ${MARKER} href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" ` +
    `style="position:fixed;${side}:18px;bottom:${bottom}px;z-index:2147483000;display:flex;align-items:center;justify-content:center;` +
    `width:56px;height:56px;border-radius:9999px;background:${WA_GREEN};color:#fff;` +
    `box-shadow:0 0 0 2px rgba(255,255,255,.9),0 8px 22px rgba(0,0,0,.25);text-decoration:none;">${WA_ICON}</a>`;
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${fab}</body>`)
    : html + fab;
}
