import { z } from "zod";
import { parse, type HTMLElement } from "node-html-parser";
import { ArtifactError, type SealedArtifactInput } from "../../types";
import { checkSlideSource } from "./subset";

/**
 * A deck as Claude's Slides keeps one: `deck.json` is the index (title, the slide ids in order, an outline in
 * sections) and every slide is its own file, `slides/<id>.html`, one `<section>` in the slide format (subset.ts).
 * A slide file the order leaves out shows last. 1920×1080; a point is two pixels (36pt = 72px).
 */
export const SLIDE_WIDTH = 1920, SLIDE_HEIGHT = 1080;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const schema = z.object({
  version: z.literal(3),
  title: z.string().trim().min(1).max(200),
  order: z.array(id).min(1).max(50),
  sections: z.record(z.string().max(64), z.object({ description: z.string().max(300), start: id }).strict()).optional(),
}).strict();

/** What is wrong with a deck.json, by field, or null; a retired version says what to write instead. */
export function deckIndexIssue(raw: unknown): string | null {
  const version = (raw as { version?: unknown })?.version;
  if (version === 2) return 'version 2 (a full HTML document per slide) is retired; write version 3: {"version":3,"title":"…","order":["cover",…]} and slides/<id>.html, one <section> each';
  if (version !== 3) return null;
  const parsed = schema.safeParse(raw);
  if (parsed.success) return new Set(parsed.data.order).size === parsed.data.order.length ? null : "order: an id appears twice";
  const issue = parsed.error.issues[0]!;
  return `${issue.path.join(".") || "(root)"}: ${issue.message}`;
}
export interface DeckSlide { readonly id: string; readonly source: string; readonly notes: string | null }
export interface SlideDeckV3 { readonly title: string; readonly slides: readonly DeckSlide[]; readonly sections: Readonly<Record<string, { description: string; start: string }>>; readonly assets: readonly string[]; readonly notes: readonly string[] }

export function isSlideDeckV3(input: SealedArtifactInput): boolean {
  try { return JSON.parse(input.revision.files["deck.json"] ?? "{}")?.version === 3; } catch { return false; }
}

export function parseSlideDeckV3(input: SealedArtifactInput): SlideDeckV3 {
  let index: z.infer<typeof schema>;
  try { index = schema.parse(JSON.parse(input.revision.files["deck.json"] ?? "")); }
  catch (error) {
    const issue = error instanceof z.ZodError ? error.issues[0] : undefined;
    throw new ArtifactError("invalid_slide_deck", issue ? `deck.json ${issue.path.join(".") || "(root)"}: ${issue.message}` : "deck.json is not JSON");
  }
  if (new Set(index.order).size !== index.order.length) throw new ArtifactError("invalid_slide_deck", "deck.json order: an id appears twice");
  const files = input.revision.files, notes: string[] = [];
  const missing = index.order.filter((s) => !Object.hasOwn(files, `slides/${s}.html`));
  if (missing.length) throw new ArtifactError("invalid_slide_deck", missing.map((s) => `"${s}" is in order but slides/${s}.html does not exist`).join("\n"));
  const extra = Object.keys(files).map((p) => /^slides\/([A-Za-z0-9_-]{1,64})\.html$/.exec(p)?.[1]).filter((s): s is string => !!s && !index.order.includes(s)).sort();
  for (const s of extra) notes.push(`slides/${s}.html: not in deck.json "order"; shown last`);
  const ids = [...index.order, ...extra];
  if (ids.length > 50) throw new ArtifactError("invalid_slide_deck", `${ids.length} slides; 50 at most`);
  for (const [key, section] of Object.entries(index.sections ?? {})) if (!ids.includes(section.start)) throw new ArtifactError("invalid_slide_deck", `deck.json sections.${key}.start: "${section.start}" is not a slide`);
  const errors: string[] = [], assets = new Set<string>();
  const slides = ids.map((slide) => {
    const source = files[`slides/${slide}.html`]!;
    const check = checkSlideSource(slide, source);
    errors.push(...check.errors); notes.push(...check.notes);
    for (const a of check.assets) assets.add(a);
    return { id: slide, source, notes: check.notesText };
  });
  if (errors.length) throw new ArtifactError("slide_format_invalid", errors.slice(0, 40).join("\n"));
  return { title: index.title, slides, sections: index.sections ?? {}, assets: [...assets], notes };
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const DECK_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";
/** The canvas' defaults (Claude's tag defaults on a 1920×1080 slide); every slide's own styles override them. */
const BASE_CSS = `*{box-sizing:border-box}html,body{margin:0;padding:0;background:#ffffff}
.slide{position:relative;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;overflow:hidden;break-after:page}.slide:last-child{break-after:auto}
.slide>section{position:relative;display:block;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;margin:0;overflow:hidden;background:#ffffff;color:#111111;font-family:"Liberation Sans",sans-serif;font-size:32px;line-height:1.4}
.slide h1,.slide h2,.slide h3,.slide h4,.slide h5,.slide h6,.slide p,.slide ul,.slide ol,.slide li,.slide table,.slide figure,.slide blockquote{margin:0}
.slide h1{font-size:96px;font-weight:600;line-height:1.1}.slide h2{font-size:64px;font-weight:600;line-height:1.15}.slide h3,.slide h4,.slide h5,.slide h6{font-size:44px;font-weight:600;line-height:1.2}
.slide ul,.slide ol{padding-left:1.2em}.slide table{border-collapse:collapse}.slide th,.slide td{padding:.35em .6em;border:1px solid #d0d4d8;text-align:left;vertical-align:top}.slide th{font-weight:600}
.slide img,.slide svg{display:block}.slide aside{display:none}`;

/** One static document of every slide: no scripts, every element stamped `data-len-src="<slide>:<line>:<col>"`. */
export function compileSlideDeck(deck: SlideDeckV3, input: SealedArtifactInput): string {
  const parts: string[] = [];
  for (const slide of deck.slides) {
    const root = parse(slide.source, { comment: false, lowerCaseTagName: false });
    const starts = [0];
    for (let i = 0; i < slide.source.length; i++) if (slide.source[i] === "\n") starts.push(i + 1);
    const where = (offset: number) => { let line = 0; while (line + 1 < starts.length && starts[line + 1]! <= offset) line++; return `${slide.id}:${line + 1}:${offset - starts[line]! + 1}`; };
    const stamp = (el: HTMLElement) => {
      const tag = el.rawTagName.toLowerCase();
      el.setAttribute("data-len-src", where(el.range[0]));
      if (tag === "img") {
        const ref = (el.getAttribute("src") ?? "").replace(/^asset:/, "");
        const asset = input.assets.find((a) => a.id === ref);
        if (!asset || !["image/png", "image/jpeg", "image/webp"].includes(asset.mime) || !asset.bytes.length) throw new ArtifactError("slide_image_missing", `${where(el.range[0])}: asset:${ref} is not a ready saved image; check the id with inspect_artifact`);
        el.setAttribute("src", `data:${asset.mime};base64,${Buffer.from(asset.bytes).toString("base64")}`);
        el.setAttribute("data-len-asset", ref);
      }
      if (tag !== "svg") for (const child of el.childNodes) if (child.nodeType === 1) stamp(child as HTMLElement);
    };
    const section = root.childNodes.find((n): n is HTMLElement => n.nodeType === 1)!;
    stamp(section);
    parts.push(`<div class="slide" data-slide-id="${escape(slide.id)}">${section.toString()}</div>`);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${DECK_CSP}"><title>${escape(deck.title)}</title><style>${BASE_CSS}</style></head><body>${parts.join("\n")}</body></html>`;
  if (Buffer.byteLength(html) > 8 * 1024 * 1024) throw new ArtifactError("html_slide_deck_too_large", "the deck with its images is over 8 MB; use fewer or smaller images");
  return html;
}
