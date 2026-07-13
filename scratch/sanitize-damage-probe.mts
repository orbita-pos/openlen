// Refined damage probe. The reveal-animation loss is COSMETIC (templates gate
// opacity:0 behind a .js class their own script adds — strip it and content
// stays visible). What actually breaks is narrower and worse:
//   1. JS-GENERATED GEOMETRY — <path>/<polyline> with no d=/points=, <canvas>:
//      the script drew them. Strip it and the box is genuinely empty.
//   2. JS-WIRED CONTROLS — a <button> outside a <form> with no href is inert
//      once its addEventListener is gone. Tabs, accordions, hamburger menus.
//   3. JS-GENERATED CONTENT (Task 18 review, F4) — a container whose ONLY
//      content comes from innerHTML=/appendChild/etc inside the very
//      <script> the sanitizer deletes. Worse than #2: not a dead control,
//      a missing SECTION. See the "JS-GENERATED container" block below.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { sanitizeForPublish } from "@/lib/html-engine";

const DIR = path.resolve("templates/starter");
const files = readdirSync(DIR).filter((f) => f.endsWith(".html") && !f.includes(".preview."));

let emptyGeometry = 0;
let deadButtons = 0;
let deadHamburger = 0;
let totalDeadButtons = 0;
const geomHits: string[] = [];
const burgerHits: string[] = [];

// Matches an assignment/call that WRITES markup into a DOM node:
//   ident.innerHTML = …   ident.outerHTML = …   ident.insertAdjacentHTML(…)
//   ident.appendChild(…)  ident.append(…)  ident.prepend(…)
//   ident.replaceChildren(…)  ident.insertBefore(…)
// Three alternatives so the capture group tells us which ident wrote.
const CONTENT_GEN_RE =
  /([A-Za-z_$][\w$.]*)\s*\.\s*(?:innerHTML|outerHTML)\s*=(?!=)|([A-Za-z_$][\w$.]*)\s*\.\s*insertAdjacentHTML\s*\(|([A-Za-z_$][\w$.]*)\s*\.\s*(?:appendChild|append|prepend|replaceChildren|insertBefore)\s*\(/g;
// `var/let/const ident = document.getElementById("x")` or `.querySelector("#x")`
// — resolves the identifier CONTENT_GEN_RE catches back to a DOM id, all
// within the SAME stripped <script> block (good enough for the vanilla,
// unbundled JS every curated template uses).
const BINDING_RE =
  /([A-Za-z_$][\w$]*)\s*=\s*document\.(?:getElementById\(\s*['"]([^'"]+)['"]\s*\)|querySelector\(\s*['"]#([^'"]+)['"]\s*\))/g;

let jsGeneratedEmpty = 0;
const contentHits: string[] = [];

// Task 20 (F4 close-out): the "INERT <button>s" count above lumps together
// two very different bugs. (a) a control the sanitizer actually broke — a
// stripped <script> (or a stripped inline on*=) wired it, so it worked in
// the gallery and dies on clone. That's OUR bug. (b) a button nobody ever
// wired, gallery included — author decoration (a nav "Search"/"Language"
// icon, a static product-screenshot mockup). Not our bug, and "fixing" it
// means redesigning a template that was never broken.
//
// Same discipline as the JS-GENERATED CONTENT diff below: don't
// re-implement what the sanitizer strips, look at what it ACTUALLY struck.
// A button is (a) if some piece of code the sanitizer deletes — a
// <script>'s getElementById/querySelector(All)/getElementsByClassName/
// matches/closest, OR the button's own inline on*= attribute — references
// it by id, by class, or by a data-* attribute name. If nothing deleted
// ever touches it, it's (b). Conservative on purpose: matching by class/
// attr NAME only (not exact value, not proof of an addEventListener call)
// means a maybe-related reference still counts as (a) — per the brief,
// "es peor dejar un control muerto que revisar uno de más".
const SELECTOR_CALL_RE =
  /\b(getElementById|querySelectorAll|querySelector|getElementsByClassName|matches|closest)\(\s*(['"])((?:(?!\2)[^\\]|\\.)*)\2/g;
const HASH_TOKEN_RE = /#([A-Za-z_][\w-]*)/g;
const DOT_TOKEN_RE = /\.([A-Za-z_][\w-]*)/g;
const ATTR_NAME_RE = /\[\s*([\w-]+)/g;
const ON_ATTR_RE = /\bon[a-zA-Z]+\s*=/;
const ID_ATTR_RE = /\bid=["']([^"']+)["']/;
const CLASS_ATTR_RE = /\bclass=["']([^"']+)["']/;
const DATA_ATTR_NAME_RE = /\bdata-[\w-]+(?=\s*=)/g;

function addSelectorTokens(sel: string, ids: Set<string>, classes: Set<string>, attrs: Set<string>) {
  for (const hm of sel.matchAll(HASH_TOKEN_RE)) ids.add(hm[1]);
  for (const cm of sel.matchAll(DOT_TOKEN_RE)) classes.add(cm[1]);
  for (const am of sel.matchAll(ATTR_NAME_RE)) attrs.add(am[1]);
}

let realDeadButtonTemplates = 0; // (a) templates
let realDeadButtonCount = 0; // (a) buttons
let decorativeButtonTemplates = 0; // (b) templates
let decorativeButtonCount = 0; // (b) buttons
const realDeadHits: string[] = [];
const decorativeHits: string[] = [];

for (const f of files) {
  const html = readFileSync(path.join(DIR, f), "utf8");
  const out = sanitizeForPublish(html).html;
  if (!out) continue;

  // 1. SVG geometry with no coordinates + canvas that nothing draws into.
  const pathNoD = /<path\b(?![^>]*\sd=)[^>]*>/i.test(out);
  const polyNoPoints = /<(?:polyline|polygon)\b(?![^>]*\spoints=)[^>]*>/i.test(out);
  const canvas = /<canvas\b/i.test(out);
  if (pathNoD || polyNoPoints || canvas) {
    emptyGeometry++;
    geomHits.push(`${f}${canvas ? " (canvas)" : ""}`);
  }

  // <script> blocks the sanitizer deletes — computed once, reused by the
  // button triage (2) below AND the JS-GENERATED CONTENT diff (3) below.
  const rawScripts = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)].map((m) => m[0]);
  const strippedScripts = rawScripts.filter((s) => !out.includes(s));

  // 2. Inert controls: <button> that isn't a form submit and has no href.
  //    (Every on* handler is already gone; the wiring lived in the script.)
  //    A `data-ol-*` marker (any CONDUCTA, or the CAROUSEL's data-ol-scroll)
  //    is excluded: OpenLen bakes a real runtime onto that button at publish
  //    time, so it is NOT inert even though no <script> in the source wires
  //    it — the whole point of the marker contract.
  const formless = out.replace(/<form[\s\S]*?<\/form>/gi, "");
  const buttons = (formless.match(/<button\b[^>]*>/gi) ?? []).filter((b) => !/\sdata-ol-/.test(b));
  if (buttons.length > 0) {
    deadButtons++;
    totalDeadButtons += buttons.length;
  }
  // The one that actually hurts: the mobile nav toggle.
  if (/<button[^>]*(?:menu|nav|burger|hamburg)/i.test(formless)) {
    deadHamburger++;
    burgerHits.push(f);
  }

  // 2b. (a)/(b) triage for this template's dead buttons.
  if (buttons.length > 0) {
    const scriptIds = new Set<string>();
    const scriptClasses = new Set<string>();
    const scriptAttrs = new Set<string>();
    for (const script of strippedScripts) {
      for (const m of script.matchAll(SELECTOR_CALL_RE)) {
        const callName = m[1];
        const arg = m[3];
        if (callName === "getElementById") scriptIds.add(arg);
        else if (callName === "getElementsByClassName") arg.split(/\s+/).forEach((c) => c && scriptClasses.add(c));
        else addSelectorTokens(arg, scriptIds, scriptClasses, scriptAttrs);
      }
    }
    // Inline on*= handlers survive nowhere in `out` by construction — they
    // only show up diffing the RAW html directly (a <button onclick=...>
    // isn't inside a <script> tag, so the diff above never sees it). Seed
    // the SAME reference sets with any raw button's own id/class/data-*:
    // "this button carries a handler" is "this button references itself".
    const handlerIds = new Set<string>();
    const handlerClasses = new Set<string>();
    const handlerAttrs = new Set<string>();
    const rawButtonTags = html.match(/<button\b[^>]*>/gi) ?? [];
    for (const tag of rawButtonTags) {
      if (!ON_ATTR_RE.test(tag)) continue;
      const idm = ID_ATTR_RE.exec(tag);
      if (idm) handlerIds.add(idm[1]);
      const clsm = CLASS_ATTR_RE.exec(tag);
      if (clsm) clsm[1].split(/\s+/).forEach((c) => c && handlerClasses.add(c));
      for (const dm of tag.matchAll(DATA_ATTR_NAME_RE)) handlerAttrs.add(dm[0]);
    }

    let templateHasReal = false;
    let templateHasDecorative = false;
    for (const tag of buttons) {
      const idm = ID_ATTR_RE.exec(tag);
      const id = idm?.[1];
      const clsm = CLASS_ATTR_RE.exec(tag);
      const classes = clsm ? clsm[1].split(/\s+/).filter(Boolean) : [];
      const dataAttrs = [...tag.matchAll(DATA_ATTR_NAME_RE)].map((m) => m[0]);
      const shortTag = tag.replace(/\s+/g, " ").slice(0, 100);

      let why = "";
      if (id && handlerIds.has(id)) why = `its own stripped inline handler (id="${id}")`;
      else if (classes.some((c) => handlerClasses.has(c))) why = `its own stripped inline handler (class="${classes.find((c) => handlerClasses.has(c))}")`;
      else if (dataAttrs.some((a) => handlerAttrs.has(a))) why = `its own stripped inline handler (${dataAttrs.find((a) => handlerAttrs.has(a))})`;
      else if (id && scriptIds.has(id)) why = `a stripped <script> references #${id}`;
      else if (classes.some((c) => scriptClasses.has(c))) why = `a stripped <script> references .${classes.find((c) => scriptClasses.has(c))}`;
      else if (dataAttrs.some((a) => scriptAttrs.has(a))) why = `a stripped <script> references ${dataAttrs.find((a) => scriptAttrs.has(a))}`;

      if (why) {
        realDeadButtonCount++;
        templateHasReal = true;
        realDeadHits.push(`${f} — ${shortTag} — killed by ${why}`);
      } else {
        decorativeButtonCount++;
        templateHasDecorative = true;
        decorativeHits.push(`${f} — ${shortTag}`);
      }
    }
    if (templateHasReal) realDeadButtonTemplates++;
    if (templateHasDecorative) decorativeButtonTemplates++;
  }

  // 3. JS-GENERATED CONTENT. Diff raw <script> blocks against the sanitized
  //    output — whatever DIDN'T survive verbatim is what the sanitizer
  //    deleted (mirrors the real allowlist instead of re-implementing it;
  //    only the Tailwind CDN <script src> tag matches in both).
  if (strippedScripts.length > 0) {
    const rawDoc = new JSDOM(html).window.document;
    const outDoc = new JSDOM(out).window.document;
    const isEmpty = (el: Element) => el.children.length === 0 && (el.textContent ?? "").trim() === "";

    for (const script of strippedScripts) {
      const bindings = new Map<string, string>();
      for (const bm of script.matchAll(BINDING_RE)) {
        bindings.set(bm[1], bm[2] ?? bm[3]);
      }
      for (const cm of script.matchAll(CONTENT_GEN_RE)) {
        const rawIdent = (cm[1] ?? cm[2] ?? cm[3] ?? "").split(".")[0];
        const targetId = bindings.get(rawIdent);
        if (!targetId) continue; // can't resolve to a DOM id — don't guess
        const rawEl = rawDoc.getElementById(targetId);
        const outEl = outDoc.getElementById(targetId);
        if (!rawEl || !outEl) continue;
        // Empty in the AUTHORED source (before any script ever ran) AND
        // still empty post-sanitize == the sanitizer didn't cause this by
        // itself, but it DID permanently seal it empty: nothing else will
        // ever populate it once the page is cloned/published.
        if (isEmpty(rawEl) && isEmpty(outEl)) {
          const key = `${f} #${targetId}`;
          if (!contentHits.includes(key)) {
            contentHits.push(key);
            jsGeneratedEmpty++;
          }
        }
      }
    }
  }
}

console.log(`\n=== ${files.length} curated starters, after the real sanitizer ===`);
console.log(`templates left with EMPTY SVG/canvas geometry: ${emptyGeometry}`);
for (const h of geomHits.slice(0, 8)) console.log(`   - ${h}`);
console.log(`\ntemplates left with INERT <button>s (no form, no href): ${deadButtons}`);
console.log(`   total dead buttons across the pack: ${totalDeadButtons}`);
console.log(
  `\n   (a) REAL dead controls -- a stripped <script>/inline handler wired them, OUR bug: ${realDeadButtonTemplates} templates, ${realDeadButtonCount} buttons`,
);
for (const h of realDeadHits) console.log(`      - ${h}`);
console.log(
  `\n   (b) decorative -- never wired, gallery included, NOT our bug: ${decorativeButtonTemplates} templates, ${decorativeButtonCount} buttons`,
);
for (const h of decorativeHits) console.log(`      - ${h}`);
console.log(`\ntemplates whose MOBILE NAV toggle is now dead: ${deadHamburger}`);
for (const h of burgerHits.slice(0, 8)) console.log(`   - ${h}`);

console.log(
  `\ntemplates with a JS-GENERATED container left EMPTY after sanitize: ${new Set(contentHits.map((h) => h.split(" #")[0])).size}`,
);
for (const h of contentHits) console.log(`   - ${h}`);
