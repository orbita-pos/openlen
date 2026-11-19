// THE FLAT FIGURE (spec local 2026-11-10-figuras-del-asistente, §5.3): the same look as the live one, drawn as a
// plain SVG. It is what shows small (the rail, a message's face, the closed bubble) and whenever the engine is not
// there — no WebGL2, context lost, still loading, switched off. One layer per category, in <g data-part="…">.
//
// Pure, a string in and a string out: it serves the server, the baked widget script and React alike. `look` may
// arrive unchecked; what does not check is drawn as DEFAULT_LOOK, so nothing of it reaches the markup unvalidated.
import { eyeInk, lookOrDefault, mix, type FigureAccessory, type FigureEyes, type FigureEyewear, type FigureShape } from "./look";

interface Body {
  /** The body's markup; `c` is a checked color and `more` extra attributes for every piece of it. */
  draw: (c: string, more: string) => string;
  /** Where the eyes sit, and where the head ends (an accessory rests there). */
  eyeY: number;
  top: number;
}

const BODIES: Record<FigureShape, Body> = {
  drop: { draw: (c, more) => `<path d="M30 12c13 0 22 11 22 24 0 9-6 16-22 16S8 45 8 36c0-13 9-24 22-24z" fill="${c}"${more}></path>`, eyeY: 33, top: 12 },
  round: { draw: (c, more) => `<circle cx="30" cy="32" r="21" fill="${c}"${more}></circle>`, eyeY: 31, top: 11 },
  capsule: { draw: (c, more) => `<rect x="15" y="12" width="30" height="42" rx="15" fill="${c}"${more}></rect>`, eyeY: 29, top: 12 },
  cube: { draw: (c, more) => `<rect x="9" y="13" width="42" height="39" rx="13" fill="${c}"${more}></rect>`, eyeY: 31, top: 13 },
  ears: {
    draw: (c, more) => `<circle cx="15" cy="19" r="7.5" fill="${c}"${more}></circle><circle cx="45" cy="19" r="7.5" fill="${c}"${more}></circle><circle cx="30" cy="35" r="19" fill="${c}"${more}></circle>`,
    eyeY: 34,
    top: 16,
  },
  heart: { draw: (c, more) => `<path d="M30 54C12 42 7 32 7 25a12 12 0 0 1 23-5 12 12 0 0 1 23 5c0 7-5 17-23 29z" fill="${c}"${more}></path>`, eyeY: 29, top: 15 },
  flower: {
    draw: (c, more) =>
      [0, 1, 2, 3, 4, 5]
        .map((i) => {
          const a = (i * Math.PI) / 3 - Math.PI / 2;
          return `<circle cx="${(30 + 13 * Math.cos(a)).toFixed(1)}" cy="${(33 + 13 * Math.sin(a)).toFixed(1)}" r="9" fill="${c}"${more}></circle>`;
        })
        .join("") + `<circle cx="30" cy="33" r="14" fill="${c}"${more}></circle>`,
    eyeY: 32,
    top: 12,
  },
  triangle: { draw: (c, more) => `<path d="M30 11c3 0 5 2 7 5l15 26c3 6-1 11-7 11H15c-6 0-10-5-7-11l15-26c2-3 4-5 7-5z" fill="${c}"${more}></path>`, eyeY: 38, top: 11 },
  star: {
    draw: (c, more) =>
      `<path d="M26.25 17.25Q30 11 33.75 17.25Q37.5 23.5 44.25 24.75Q51 26 46.25 31.5Q41.5 37 42.25 44Q43 51 36.5 47.5Q30 44 23.5 47.5Q17 51 17.75 44Q18.5 37 13.75 31.5Q9 26 15.75 24.75Q22.5 23.5 26.25 17.25z" fill="${c}"${more}></path>`,
    eyeY: 33,
    top: 12,
  },
  cloud: {
    draw: (c, more) =>
      `<path d="M17 46a10 10 0 0 1-1-19.8 14 13.5 0 0 1 28 0A10 10 0 0 1 43 46Q30 47.5 17 46z" fill="${c}"${more}></path>`,
    eyeY: 33,
    top: 14,
  },
  diamond: {
    draw: (c, more) => `<path d="M25 14q5-5 10 0l13 13q5 5 0 10L35 50q-5 5-10 0L12 37q-5-5 0-10z" fill="${c}"${more}></path>`,
    eyeY: 32,
    top: 12,
  },
  teardrop: {
    draw: (c, more) => `<path d="M30 11C34 17 49 29 49 39a19 15 0 0 1-38 0C11 29 26 17 30 11z" fill="${c}"${more}></path>`,
    eyeY: 36,
    top: 12,
  },
  clover: {
    draw: (c, more) =>
      [
        [-10, -10],
        [10, -10],
        [-10, 10],
        [10, 10],
      ]
        .map(([dx, dy]) => `<circle cx="${30 + dx!}" cy="${33 + dy!}" r="10.5" fill="${c}"${more}></circle>`)
        .join("") + `<circle cx="30" cy="33" r="13" fill="${c}"${more}></circle>`,
    eyeY: 32,
    top: 13,
  },
  cat: {
    draw: (c, more) =>
      `<path d="M11 31L13 13l14 10z" fill="${c}"${more}></path><path d="M49 31L47 13L33 23z" fill="${c}"${more}></path><circle cx="30" cy="35" r="19" fill="${c}"${more}></circle>`,
    eyeY: 34,
    top: 16,
  },
  bean: {
    draw: (c, more) =>
      `<path d="M30 11c11 0 18 6 18 13 0 4-3 7-3 9s4 5 4 10c0 8-8 13-19 13S11 51 11 43c0-5 4-8 4-10s-3-5-3-9c0-7 7-13 18-13z" fill="${c}"${more}></path>`,
    eyeY: 25,
    top: 11,
  },
};

function eyes(kind: FigureEyes, y: number, ink: string): string {
  const one = (x: number, side: -1 | 1): string => {
    switch (kind) {
      case "round":
        return `<circle cx="${x}" cy="${y}" r="4.2" fill="${ink}"></circle>`;
      case "dot":
        return `<circle cx="${x}" cy="${y}" r="2.4" fill="${ink}"></circle>`;
      case "smile":
        return `<path d="M${x - 4} ${y + 1.5}q4 -6.5 8 0" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"></path>`;
      case "sleepy":
        return `<path d="M${x - 4} ${y - 0.5}q4 4.5 8 0" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"></path>`;
      case "wink":
        return side < 0
          ? `<ellipse cx="${x}" cy="${y}" rx="3.4" ry="4.8" fill="${ink}"></ellipse>`
          : `<path d="M${x - 4} ${y + 1.5}q4 -6.5 8 0" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"></path>`;
      case "sparkle":
        return `<ellipse cx="${x}" cy="${y}" rx="4.4" ry="5.2" fill="${ink}"></ellipse><circle cx="${x - 1.4}" cy="${y - 1.8}" r="1.6" fill="#ffffff"></circle><circle cx="${x + 1.5}" cy="${y + 1.6}" r="0.9" fill="#ffffff"></circle>`;
      case "cheerful":
        return side < 0
          ? `<path d="M${x - 3.5} ${y - 3.2}l6 3.2-6 3.2" fill="none" stroke="${ink}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"></path>`
          : `<path d="M${x + 3.5} ${y - 3.2}l-6 3.2 6 3.2" fill="none" stroke="${ink}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"></path>`;
      case "calm":
        return `<line x1="${x - 4.2}" y1="${y}" x2="${x + 4.2}" y2="${y}" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"></line>`;
      case "lash":
        return `<ellipse cx="${x}" cy="${y}" rx="3.5" ry="4.7" fill="${ink}"></ellipse><path d="M${x + side * 2.5} ${y - 2.5}l${side * 3.2} -2.2" stroke="${ink}" stroke-width="2" stroke-linecap="round"></path>`;
      default:
        return `<ellipse cx="${x}" cy="${y}" rx="3.4" ry="4.8" fill="${ink}"></ellipse>`;
    }
  };
  return one(23, -1) + one(37, 1);
}

function eyewear(kind: FigureEyewear, y: number, ink: string): string {
  switch (kind) {
    case "round":
      return `<circle cx="22" cy="${y}" r="7" fill="none" stroke="${ink}" stroke-width="1.8"></circle><circle cx="38" cy="${y}" r="7" fill="none" stroke="${ink}" stroke-width="1.8"></circle><line x1="29" y1="${y}" x2="31" y2="${y}" stroke="${ink}" stroke-width="1.8"></line>`;
    case "shades":
      return `<rect x="14.5" y="${y - 5}" width="14" height="10" rx="4.5" fill="${ink}"></rect><rect x="31.5" y="${y - 5}" width="14" height="10" rx="4.5" fill="${ink}"></rect><line x1="28" y1="${y - 2}" x2="32" y2="${y - 2}" stroke="${ink}" stroke-width="2"></line>`;
    case "square":
      return `<rect x="14.5" y="${y - 5.5}" width="14" height="11" rx="2.4" fill="none" stroke="${ink}" stroke-width="1.8"></rect><rect x="31.5" y="${y - 5.5}" width="14" height="11" rx="2.4" fill="none" stroke="${ink}" stroke-width="1.8"></rect><line x1="28.5" y1="${y - 1}" x2="31.5" y2="${y - 1}" stroke="${ink}" stroke-width="1.8"></line>`;
    case "heart":
      return `<path d="M21.5 ${y + 6}c-5.5-3.8-7.5-7-7.5-9.5a4 4 0 0 1 7.5-1.5 4 4 0 0 1 7.5 1.5c0 2.5-2 5.7-7.5 9.5z" fill="#881337"></path><path d="M38.5 ${y + 6}c-5.5-3.8-7.5-7-7.5-9.5a4 4 0 0 1 7.5-1.5 4 4 0 0 1 7.5 1.5c0 2.5-2 5.7-7.5 9.5z" fill="#881337"></path><line x1="28" y1="${y - 1}" x2="32" y2="${y - 1}" stroke="#881337" stroke-width="2"></line>`;
    case "star": {
      const starAt = (cx: number) =>
        `<path d="M${cx} ${y - 7}l2.2 4.4 4.8.7-3.5 3.4.8 4.8-4.3-2.3-4.3 2.3.8-4.8-3.5-3.4 4.8-.7z" fill="#f59e0b" stroke="#f59e0b" stroke-width="1.2" stroke-linejoin="round"></path>`;
      return starAt(21.5) + starAt(38.5) + `<line x1="27.5" y1="${y - 1}" x2="32.5" y2="${y - 1}" stroke="#f59e0b" stroke-width="2"></line>`;
    }
    case "visor":
      return `<rect x="11" y="${y - 5}" width="38" height="10" rx="4" fill="#1fb8eb" stroke="${ink}" stroke-width="1.6"></rect>`;
    case "catEye":
      return `<path d="M13 ${y - 5.5}c4-1 13 0 15 4.8 1 3.8-3 6.7-8 6.7s-8-3.8-7-11.5z" fill="${ink}"></path><path d="M47 ${y - 5.5}c-4-1-13 0-15 4.8-1 3.8 3 6.7 8 6.7s8-3.8 7-11.5z" fill="${ink}"></path><line x1="27" y1="${y - 1}" x2="33" y2="${y - 1}" stroke="${ink}" stroke-width="2"></line>`;
    default:
      return "";
  }
}

const NEUTRAL = "#26262b";
const GOLD = "#f2c35b";
const LEAF = "#34c759";
const PETAL = "#fff1f5";
const CHEF = "#f7f7fa";
const PARTY = "#a855f7";

function accessory(kind: FigureAccessory, top: number, eyeY: number, color: string | undefined): string {
  const c =
    color ??
    (kind === "crown" || kind === "halo"
      ? GOLD
      : kind === "sprout"
        ? LEAF
        : kind === "flower"
          ? PETAL
          : kind === "chef"
            ? CHEF
            : kind === "party"
              ? PARTY
              : NEUTRAL);
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
    case "halo":
      return `<ellipse cx="30" cy="${top - 4}" rx="13.5" ry="3.6" fill="none" stroke="${c}" stroke-width="2.6"></ellipse>`;
    case "cap":
      return `<path d="M16 ${top + 4}a14 11 0 0 1 28 0z" fill="${c}"></path><path d="M15 ${top + 2.5}h33a1.8 1.8 0 0 1 0 3.4H15z" fill="${c}"></path>`;
    case "wizard":
      return `<path d="M19 ${top + 2}L32 ${top - 10}l9 12z" fill="${c}"></path><ellipse cx="30" cy="${top + 2}" rx="17" ry="3.2" fill="${c}"></ellipse>`;
    case "flower":
      return (
        [0, 1, 2, 3, 4]
          .map((i) => {
            const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
            return `<circle cx="${(40 + 4.2 * Math.cos(a)).toFixed(1)}" cy="${(top + 2 + 4.2 * Math.sin(a)).toFixed(1)}" r="3.4" fill="${c}"></circle>`;
          })
          .join("") + `<circle cx="40" cy="${top + 2}" r="2.6" fill="${GOLD}"></circle>`
      );
    case "sprout":
      return `<path d="M30 ${top + 2}v-8" stroke="${c}" stroke-width="2.2" stroke-linecap="round"></path><ellipse cx="25" cy="${top - 6}" rx="5" ry="2.6" transform="rotate(-25 25 ${top - 6})" fill="${c}"></ellipse><ellipse cx="35" cy="${top - 6}" rx="5" ry="2.6" transform="rotate(25 35 ${top - 6})" fill="${c}"></ellipse>`;
    case "horns":
      return `<path d="M17 ${top + 3}l-4-10 9 7z" fill="${c}"></path><path d="M43 ${top + 3}l4-10-9 7z" fill="${c}"></path>`;
    case "chef":
      return `<path d="M18 ${top - 1}a6 6 0 0 1 5-8.5 8 7 0 0 1 14 0 6 6 0 0 1 5 8.5z" fill="${c}" stroke="#d4d4d8" stroke-width="1.2"></path><rect x="19" y="${top - 2}" width="22" height="5.5" rx="2" fill="${c}" stroke="#d4d4d8" stroke-width="1.2"></rect>`;
    case "antenna":
      return `<path d="M30 ${top + 2}v-9" stroke="${NEUTRAL}" stroke-width="2.2" stroke-linecap="round"></path><ellipse cx="30" cy="${top + 2}" rx="5" ry="2.2" fill="${NEUTRAL}"></ellipse><circle cx="30" cy="${top - 8}" r="3.5" fill="${color ?? "#1fc7f5"}"></circle>`;
    case "party":
      return `<path d="M21 ${top + 3}L30 ${top - 9}l9 12z" fill="${c}"></path><circle cx="30" cy="${top - 9}" r="2.8" fill="${GOLD}"></circle>`;
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
  // A body with no edge disappears on a background of its own color: white on white, black on black.
  const edge = mix(l.color, ink, 0.22);
  return (
    `<svg width="${px}" height="${px}" viewBox="0 0 60 60" aria-hidden="true">` +
    // The outline first, around every piece at once, then the body over it: no line shows where two pieces meet.
    group("body", body.draw(edge, ` stroke="${edge}" stroke-width="2.2" stroke-linejoin="round"`) + body.draw(l.color, "")) +
    group("eyes", eyes(l.eyes, body.eyeY, ink)) +
    group("eyewear", eyewear(l.eyewear, body.eyeY, ink)) +
    group("accessory", accessory(l.accessory, body.top, body.eyeY, l.accessoryColor)) +
    "</svg>"
  );
}
