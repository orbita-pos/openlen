// THE FLAT FIGURE (spec local 2026-11-10-figuras-del-asistente, §5.3): the same look as the live one, drawn as a
// plain SVG. It is what shows small (the rail, a message's face, the closed bubble) and whenever the engine is not
// there — no WebGL2, context lost, still loading, switched off. One layer per category, in <g data-part="…">.
//
// Pure, a string in and a string out: it serves the server, the baked widget script and React alike. `look` may
// arrive unchecked; what does not check is drawn as DEFAULT_LOOK, so nothing of it reaches the markup unvalidated.
import { eyeInk, lookOrDefault, type FigureAccessory, type FigureEyes, type FigureEyewear, type FigureShape } from "./look";

interface Body {
  /** The body's markup; `c` is the checked color. */
  draw: (c: string) => string;
  /** Where the eyes sit, and where the head ends (an accessory rests there). */
  eyeY: number;
  top: number;
}

const BODIES: Record<FigureShape, Body> = {
  drop: { draw: (c) => `<path d="M30 12c13 0 22 11 22 24 0 9-6 16-22 16S8 45 8 36c0-13 9-24 22-24z" fill="${c}"></path>`, eyeY: 33, top: 12 },
  round: { draw: (c) => `<circle cx="30" cy="32" r="21" fill="${c}"></circle>`, eyeY: 31, top: 11 },
  capsule: { draw: (c) => `<rect x="15" y="12" width="30" height="42" rx="15" fill="${c}"></rect>`, eyeY: 29, top: 12 },
  cube: { draw: (c) => `<rect x="9" y="13" width="42" height="39" rx="13" fill="${c}"></rect>`, eyeY: 31, top: 13 },
  ears: {
    draw: (c) => `<circle cx="15" cy="19" r="7.5" fill="${c}"></circle><circle cx="45" cy="19" r="7.5" fill="${c}"></circle><circle cx="30" cy="35" r="19" fill="${c}"></circle>`,
    eyeY: 34,
    top: 16,
  },
  heart: { draw: (c) => `<path d="M30 54C12 42 7 32 7 25a12 12 0 0 1 23-5 12 12 0 0 1 23 5c0 7-5 17-23 29z" fill="${c}"></path>`, eyeY: 29, top: 15 },
  flower: {
    draw: (c) =>
      [0, 1, 2, 3, 4, 5]
        .map((i) => {
          const a = (i * Math.PI) / 3 - Math.PI / 2;
          return `<circle cx="${(30 + 13 * Math.cos(a)).toFixed(1)}" cy="${(33 + 13 * Math.sin(a)).toFixed(1)}" r="9" fill="${c}"></circle>`;
        })
        .join("") + `<circle cx="30" cy="33" r="14" fill="${c}"></circle>`,
    eyeY: 32,
    top: 12,
  },
  triangle: { draw: (c) => `<path d="M30 11c3 0 5 2 7 5l15 26c3 6-1 11-7 11H15c-6 0-10-5-7-11l15-26c2-3 4-5 7-5z" fill="${c}"></path>`, eyeY: 38, top: 11 },
};

function eyes(kind: FigureEyes, y: number, ink: string): string {
  const one = (x: number): string => {
    switch (kind) {
      case "round":
        return `<circle cx="${x}" cy="${y}" r="4.2" fill="${ink}"></circle>`;
      case "dot":
        return `<circle cx="${x}" cy="${y}" r="2.4" fill="${ink}"></circle>`;
      case "smile":
        return `<path d="M${x - 4} ${y + 1.5}q4 -6.5 8 0" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"></path>`;
      case "sleepy":
        return `<path d="M${x - 4} ${y - 0.5}q4 4.5 8 0" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"></path>`;
      default:
        return `<ellipse cx="${x}" cy="${y}" rx="3.4" ry="4.8" fill="${ink}"></ellipse>`;
    }
  };
  return one(23) + one(37);
}

function eyewear(kind: FigureEyewear, y: number, ink: string): string {
  if (kind === "round")
    return `<circle cx="22" cy="${y}" r="7" fill="none" stroke="${ink}" stroke-width="1.8"></circle><circle cx="38" cy="${y}" r="7" fill="none" stroke="${ink}" stroke-width="1.8"></circle><line x1="29" y1="${y}" x2="31" y2="${y}" stroke="${ink}" stroke-width="1.8"></line>`;
  if (kind === "shades")
    return `<rect x="14.5" y="${y - 5}" width="14" height="10" rx="4.5" fill="${ink}"></rect><rect x="31.5" y="${y - 5}" width="14" height="10" rx="4.5" fill="${ink}"></rect><line x1="28" y1="${y - 2}" x2="32" y2="${y - 2}" stroke="${ink}" stroke-width="2"></line>`;
  return "";
}

const NEUTRAL = "#26262b";
const GOLD = "#f2c35b";

function accessory(kind: FigureAccessory, top: number, eyeY: number, color: string | undefined): string {
  const c = color ?? (kind === "crown" ? GOLD : NEUTRAL);
  switch (kind) {
    case "beret":
      return `<ellipse cx="32" cy="${top + 1}" rx="15" ry="5.5" transform="rotate(-10 32 ${top + 1})" fill="${c}"></ellipse><circle cx="34" cy="${top - 5}" r="1.8" fill="${c}"></circle>`;
    case "beanie":
      return `<path d="M17 ${top + 6}a13 12 0 0 1 26 0z" fill="${c}"></path><rect x="15" y="${top + 4}" width="30" height="4.5" rx="2.2" fill="${c}"></rect><circle cx="30" cy="${top - 7}" r="3" fill="${c}"></circle>`;
    case "bow":
      return `<path d="M30 ${top}l-9 -5v10z" fill="${c}"></path><path d="M30 ${top}l9 -5v10z" fill="${c}"></path><circle cx="30" cy="${top}" r="2.6" fill="${c}"></circle>`;
    case "crown":
      return `<path d="M20 ${top + 3}l-1 -11 6 5 5 -7 5 7 6 -5 -1 11z" fill="${c}"></path>`;
    case "hat":
      return `<rect x="21" y="${top - 9}" width="18" height="11" rx="3" fill="${c}"></rect><ellipse cx="30" cy="${top + 2}" rx="16" ry="3.4" fill="${c}"></ellipse>`;
    case "headphones":
      return `<path d="M10 ${eyeY}C10 ${top - 12} 50 ${top - 12} 50 ${eyeY}" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"></path><rect x="6" y="${eyeY - 6}" width="7" height="12" rx="3.2" fill="${c}"></rect><rect x="47" y="${eyeY - 6}" width="7" height="12" rx="3.2" fill="${c}"></rect>`;
    default:
      return "";
  }
}

const group = (part: string, inner: string): string => (inner ? `<g data-part="${part}">${inner}</g>` : "");

export function flatFigureSvg(look: unknown, size: number): string {
  const l = lookOrDefault(look);
  const px = typeof size === "number" && Number.isFinite(size) && size > 0 ? Math.round(size) : 32;
  const body = BODIES[l.shape] ?? BODIES.drop;
  const ink = eyeInk(l.color);
  return (
    `<svg width="${px}" height="${px}" viewBox="0 0 60 60" aria-hidden="true">` +
    group("body", body.draw(l.color)) +
    group("eyes", eyes(l.eyes, body.eyeY, ink)) +
    group("eyewear", eyewear(l.eyewear, body.eyeY, ink)) +
    group("accessory", accessory(l.accessory, body.top, body.eyeY, l.accessoryColor)) +
    "</svg>"
  );
}
