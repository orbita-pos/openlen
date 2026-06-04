// Inject a self-contained, brand-coloured contact widget (a floating action
// stack) into a curated page so the profile's contact + links actually show up
// on the PUBLISHED page — regardless of the template. Deterministic, no JS, all
// inline styles (works on the static published HTML), never collides with the
// template's own footer. Only emitted when the profile has something to show.

import type { BusinessProfileData } from "./types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function digits(s: string): string {
  return s.replace(/[^\d]/g, "");
}

function waHref(num: string): string {
  let d = digits(num);
  if (d.length === 10) d = "52" + d; // MX local → international (primary market)
  return `https://wa.me/${d}`;
}

function urlHref(raw: string): string {
  const v = raw.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (/^@/.test(v)) return v; // handled by the social builders
  return `https://${v.replace(/^\/+/, "")}`;
}

function handle(v: string): string {
  return v.trim().replace(/^@/, "").replace(/\/+$/, "");
}

const ICONS: Record<string, string> = {
  whatsapp: '<path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"/><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  instagram: '<rect width="20" height="20" x="2" y="2" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  tiktok: '<path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/>',
  youtube: '<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  link: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
};

function svg(icon: string, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon] ?? ICONS.link}</svg>`;
}

interface Action {
  href: string;
  icon: string;
  label: string;
  primary?: boolean;
}

function buildActions(data: BusinessProfileData): Action[] {
  const a: Action[] = [];
  const c = data.contact;
  const s = c?.socials;
  if (c?.whatsapp?.trim()) a.push({ href: waHref(c.whatsapp), icon: "whatsapp", label: "WhatsApp", primary: true });
  if (s?.instagram?.trim()) a.push({ href: `https://instagram.com/${handle(s.instagram)}`, icon: "instagram", label: "Instagram" });
  if (s?.facebook?.trim()) a.push({ href: /^https?:/i.test(s.facebook) ? s.facebook : `https://facebook.com/${handle(s.facebook)}`, icon: "facebook", label: "Facebook" });
  if (s?.tiktok?.trim()) a.push({ href: `https://tiktok.com/@${handle(s.tiktok)}`, icon: "tiktok", label: "TikTok" });
  for (const l of data.links ?? []) {
    if (!l.url?.trim()) continue;
    const icon = l.type === "youtube" ? "youtube" : l.type === "tiktok" ? "tiktok" : l.type === "website" ? "globe" : "link";
    a.push({ href: urlHref(l.url), icon, label: l.type });
  }
  if (c?.phone?.trim()) a.push({ href: `tel:${digits(c.phone)}`, icon: "phone", label: "Teléfono" });
  if (c?.email?.trim()) a.push({ href: `mailto:${c.email.trim()}`, icon: "mail", label: "Email" });
  if (c?.address?.trim()) a.push({ href: `https://maps.google.com/?q=${encodeURIComponent(c.address)}`, icon: "pin", label: "Dirección" });
  return a;
}

/** Append a fixed contact stack to <body>. No-op if there's nothing to show. */
export function injectContactWidget(
  html: string,
  data: BusinessProfileData,
  accent: string,
): string {
  const actions = buildActions(data);
  if (actions.length === 0) return html;
  const ac = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#FF5A36";

  const btns = actions
    .map((act) => {
      const big = act.primary;
      const dim = big ? 54 : 40;
      const bg = big ? ac : "#ffffff";
      const fg = big ? "#ffffff" : "#1A1A1A";
      const ring = big ? "transparent" : "rgba(0,0,0,0.08)";
      return `<a href="${esc(act.href)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(act.label)}" style="display:flex;align-items:center;justify-content:center;width:${dim}px;height:${dim}px;border-radius:9999px;background:${bg};color:${fg};box-shadow:0 4px 14px rgba(0,0,0,0.18);border:1px solid ${ring};text-decoration:none;">${svg(act.icon, big ? 26 : 19)}</a>`;
    })
    .reverse() // primary (WhatsApp) ends up at the bottom of the stack
    .join("");

  const widget = `<div data-ol-contact-widget style="position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;flex-direction:column;align-items:center;gap:10px;font-family:Inter,ui-sans-serif,system-ui,sans-serif;">${btns}</div>`;

  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${widget}</body>`)
    : html + widget;
}
