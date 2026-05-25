// Born-canonical color normalization — the page's semantic palette.
//
// Hoists background / surface / text / border colors behind --ol-bg /
// --ol-surface / --ol-fg / --ol-border so the inspector's Theme section can
// drive them, the way --ol-accent works. Identification: the :root token
// named for each role (every /api/generate page emits these per the design
// prompt); bg + fg also fall back to the `body` rule. The token itself is
// chained to the var, so everything already referencing it follows — no
// chasing hardcoded colors, so a near-white used elsewhere as inverted
// button text is never disturbed. No-op when no role resolves. The accent
// is handled separately (normalize-accent.ts).

interface Role {
  varName: string;
  names: string[];
}

const ROLES: Role[] = [
  { varName: "--ol-bg", names: ["bg", "background", "page", "canvas"] },
  { varName: "--ol-surface", names: ["surface", "card", "panel", "elevated"] },
  { varName: "--ol-fg", names: ["fg", "foreground", "text", "ink"] },
  {
    varName: "--ol-border",
    names: ["border", "line", "hairline", "rule", "divider", "stroke"],
  },
];

/** A CSS color value → normalized #rrggbb; null for gradients/keywords/var(). */
function toHex(value: string): string | null {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/(.)/g, "$1$1") : hex[1];
    return "#" + h.toLowerCase();
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(v);
  if (rgb) {
    const c = (n: string) =>
      Math.min(255, parseInt(n, 10)).toString(16).padStart(2, "0");
    return "#" + c(rgb[1]) + c(rgb[2]) + c(rgb[3]);
  }
  return null;
}

/** Hoist the page's semantic palette onto the --ol-* color tokens.
 *  Idempotent; a no-op when no role resolves to a color. */
export function normalizeColor(html: string): string {
  if (!html) return html;
  if (html.includes("data-ol-color")) return html;

  let out = html;
  const found: Record<string, string> = {};

  // Named :root tokens — the /api/generate path. `;?` so the last
  // declaration in the block (no trailing `;`) still counts.
  const rootMatch = /:root\s*\{([^}]*)\}/i.exec(html);
  const rootBody = rootMatch ? rootMatch[1] : "";
  for (const d of rootBody.matchAll(/--([a-z0-9-]+)\s*:\s*([^;}]+);?/gi)) {
    const name = d[1].toLowerCase();
    const hex = toHex(d[2]);
    if (!hex) continue;
    for (const role of ROLES) {
      if (!found[role.varName] && role.names.includes(name)) {
        found[role.varName] = hex;
        out = out.replace(d[0], `--${d[1]}: var(${role.varName});`);
        break;
      }
    }
  }

  // Fallback for bg / fg — the `body` rule's own background-color / color.
  // (surface / border have no body-rule equivalent; they degrade to no
  // control on a template that doesn't name them.)
  if (!found["--ol-bg"] || !found["--ol-fg"]) {
    const bodyM = /(?:^|[\s,{}>])(body\s*\{[^}]*\})/i.exec(out);
    if (bodyM) {
      let block = bodyM[1];
      if (!found["--ol-bg"]) {
        const m = /(background-color|background)\s*:\s*([^;}]+)/i.exec(block);
        const hex = m ? toHex(m[2]) : null;
        if (m && hex) {
          found["--ol-bg"] = hex;
          block = block.replace(m[0], `${m[1]}: var(--ol-bg)`);
        }
      }
      if (!found["--ol-fg"]) {
        const m = /(?<!-)color\s*:\s*([^;}]+)/i.exec(block);
        const hex = m ? toHex(m[1]) : null;
        if (m && hex) {
          found["--ol-fg"] = hex;
          block = block.replace(m[0], "color: var(--ol-fg)");
        }
      }
      out = out.replace(bodyM[1], block);
    }
  }

  const entries = ROLES.map((r) =>
    found[r.varName] ? `${r.varName}:${found[r.varName]};` : "",
  ).join("");
  if (!entries) return html;

  const style = `<style data-ol-color>:root{${entries}}</style>`;
  const idx = out.search(/<\/head>/i);
  return idx === -1 ? out + style : out.slice(0, idx) + style + out.slice(idx);
}

/** CSS variables the color controls set. */
export const BG_VAR = "--ol-bg";
export const SURFACE_VAR = "--ol-surface";
export const FG_VAR = "--ol-fg";
export const BORDER_VAR = "--ol-border";
