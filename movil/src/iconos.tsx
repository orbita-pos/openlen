// Los iconos del prototipo (SVG en texto, trazo con currentColor). Copiados de
// brand/len-movil/index.html, objeto `I` y sus dos constantes, sin cambios.
const S2 = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const PHONE_P = "M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z";

export const ICONO = {
  mic: `<svg viewBox="0 0 24 24" ${S2}><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/></svg>`,
  send: `<svg viewBox="0 0 24 24" ${S2} stroke-width="2.4"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>`,
  check: `<svg viewBox="0 0 24 24" ${S2} stroke-width="3.4"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  x: `<svg viewBox="0 0 24 24" ${S2} stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="${PHONE_P}"/></svg>`,
  phoneDown: `<svg viewBox="0 0 24 24" fill="currentColor"><g transform="rotate(135 12 12)"><path d="${PHONE_P}"/></g></svg>`,
  spk: `<svg viewBox="0 0 24 24" ${S2}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>`,
  spkOff: `<svg viewBox="0 0 24 24" ${S2}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>`,
  micOff: `<svg viewBox="0 0 24 24" ${S2}><path d="M15 9.4V5.5a3 3 0 0 0-5.7-1.3M9 9v2.5a3 3 0 0 0 4.7 2.5M5 11a7 7 0 0 0 11.4 5.4M19 11a7 7 0 0 1-.7 3M12 18v3.5M3 3l18 18"/></svg>`,
  bellOff: `<svg viewBox="0 0 24 24" ${S2}><path d="M8.7 3.7A6 6 0 0 1 18 8.5c0 3 .7 4.9 1.5 6M6.3 6.6C6.1 7.2 6 7.8 6 8.5c0 5-2 6.5-2 6.5h11M10.3 19a2 2 0 0 0 3.4 0M3 3l18 18"/></svg>`,
  img: `<svg viewBox="0 0 24 24" ${S2}><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-9 9"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" ${S2}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`,
  arrowR: `<svg viewBox="0 0 24 24" ${S2}><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  back: `<svg viewBox="0 0 24 24" ${S2} stroke-width="2.4"><path d="M15 5l-7 7 7 7"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" ${S2} stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>`,
  up: `<svg viewBox="0 0 24 24" ${S2} stroke-width="3"><path d="M12 19V5M6 11l6-6 6 6"/></svg>`,
  enter: `<svg viewBox="0 0 24 24" ${S2}><path d="M10 17l5-5-5-5M15 12H3M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/></svg>`,
  shrink: `<svg viewBox="0 0 24 24" ${S2}><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/></svg>`,
  expand: `<svg viewBox="0 0 24 24" ${S2}><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>`,
  dvCel: `<svg viewBox="0 0 24 24" ${S2}><rect x="7" y="2.5" width="10" height="19" rx="2.6"/><path d="M11 18.3h2"/></svg>`,
  dvTab: `<svg viewBox="0 0 24 24" ${S2}><rect x="4" y="2.5" width="16" height="19" rx="2.6"/><path d="M11 18.3h2"/></svg>`,
  dvPc: `<svg viewBox="0 0 24 24" ${S2}><rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/></svg>`,
  torch: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M8 3h8v3l-2 4v10a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V10L8 6z"/><path d="M12 13v2"/></svg>`,
  cam: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
  wa: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3a.5.5 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.5-.3z"/></svg>`,
  mark: `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="lm-mk" x1="14" y1="11" x2="52" y2="55" gradientUnits="userSpaceOnUse"><stop stop-color="#FFB23E"/><stop offset=".52" stop-color="#FF8A1E"/><stop offset="1" stop-color="#F26A0F"/></linearGradient></defs><circle cx="32" cy="32" r="19.5" fill="none" stroke="url(#lm-mk)" stroke-width="15"/></svg>`,
  sb: `<svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.1-1.2A10.2 10.2 0 0 0 8 .6 10.2 10.2 0 0 0 .9 3.4L2 4.6a8.6 8.6 0 0 1 6-2.4zm0 3.3c1.4 0 2.7.5 3.7 1.4l1.1-1.2A7 7 0 0 0 8 3.9a7 7 0 0 0-4.8 1.8l1.1 1.2c1-.9 2.3-1.4 3.7-1.4zm0 3.3c.6 0 1.1.2 1.5.6L8 11 6.5 9.4c.4-.4.9-.6 1.5-.6z"/></svg><svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2" fill="currentColor"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill="currentColor" opacity=".45"/></svg>`,
} as const;
export type NombreDeIcono = keyof typeof ICONO;

// `display: contents`: el svg cuenta como hijo directo del botón, como en el
// prototipo (el menú de tamaños es una rejilla icono · nombre · px).
export function Icono({ nombre }: { nombre: NombreDeIcono }) {
  return <span aria-hidden style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: ICONO[nombre] }} />;
}
