// Curated catalog of named CSS animations + helper that emits `@keyframes`
// only for the names actually referenced by the document.
//
// Why a curated catalog: full free-form @keyframes are too much surface for
// a v1 UI (and footgun-prone). The 8 here cover ~95% of landing-page entrance
// + loop animations (fade, slide N/S/E/W, scale, bounce, pulse).
//
// Each animation's id is the CSS animation-name the document stores in styles.
// The compile pipeline (see lib/doc/compile.ts → planStyles) walks the tree,
// collects names, and appends `keyframesCss(used)` to the global <style>. Every
// rendered page (editor iframe + publish) ships only the keyframes it uses.

export interface AnimationDef {
  id: string;
  label: string;
  glyph: string;
  /** Raw CSS keyframe body (everything between `{` and `}` of the
   *  `@keyframes <id>` block). */
  keyframes: string;
}

export const ANIMATIONS: AnimationDef[] = [
  {
    id: "ol-fade-in",
    label: "Fade in",
    glyph: "◯",
    keyframes: "from{opacity:0}to{opacity:1}",
  },
  {
    id: "ol-slide-up",
    label: "Slide up",
    glyph: "↑",
    keyframes:
      "from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}",
  },
  {
    id: "ol-slide-down",
    label: "Slide down",
    glyph: "↓",
    keyframes:
      "from{opacity:0;transform:translateY(-20px)}to{opacity:1;transform:translateY(0)}",
  },
  {
    id: "ol-slide-left",
    label: "Slide left",
    glyph: "←",
    keyframes:
      "from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}",
  },
  {
    id: "ol-slide-right",
    label: "Slide right",
    glyph: "→",
    keyframes:
      "from{opacity:0;transform:translateX(-20px)}to{opacity:1;transform:translateX(0)}",
  },
  {
    id: "ol-scale-in",
    label: "Scale in",
    glyph: "⊙",
    keyframes:
      "from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}",
  },
  {
    id: "ol-bounce",
    label: "Bounce",
    glyph: "↕",
    keyframes:
      "0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}",
  },
  {
    id: "ol-pulse",
    label: "Pulse",
    glyph: "❤",
    keyframes:
      "0%,100%{transform:scale(1)}50%{transform:scale(1.05)}",
  },
];

const BY_ID = new Map(ANIMATIONS.map((a) => [a.id, a]));

/** Is the given animation-name one we know how to render? Used by compile.ts
 *  to skip unknown names rather than emit broken `@keyframes` blocks. */
export function isAnimationName(name: string): boolean {
  return BY_ID.has(name);
}

/** Emit `@keyframes` blocks for each known animation name. Unknown names in
 *  the set are silently ignored. */
export function keyframesCss(usedNames: Iterable<string>): string {
  let out = "";
  for (const name of usedNames) {
    const def = BY_ID.get(name);
    if (def) out += `@keyframes ${def.id}{${def.keyframes}}`;
  }
  return out;
}
