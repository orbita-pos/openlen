// ─────────────────────────────────────────────────────────────────────────────
// Born With Imagery — photograph an AI-generated page.
//
// design-guidance tells the model to mark pure image areas with
// `data-ol-photo="<2-4 word subject>"`. This stage (called in /api/generate
// after the critic loop, before save) fills each EMPTY marked slot with a
// real, subject-matched photo from the 502-image curated library:
//
//   extract slots (Rust)
//     → deterministic ranking builds a shortlist of candidates per slot
//     → ONE model call picks the best of the pooled shortlist
//       (cheap, no image generation, no model-image latency — the curated
//        library is the source; Flash only chooses among it)
//     → deterministic top-pick is the fallback if Flash fails / is disabled
//     → apply (Rust).
//
// The deterministic ranking is the backbone (shortlist + fallback); the Flash
// pick is the quality lever for niche subjects where keyword overlap alone
// lands a so-so photo (e.g. "street tacos" → a better food shot than the raw
// top score). Slots with overlaid text are skipped in v1 (gradient kept —
// sidesteps text-contrast); a slot with no candidate keeps its gradient.
// ─────────────────────────────────────────────────────────────────────────────

import {
  applyPhotoSlots,
  extractPhotoSlots,
  type PhotoAssignment,
} from "@/lib/html-engine";
import { classifyBriefFamily } from "@/lib/templates/classify-brief-family";
import { fireworksStreamProvider, type StreamProviderLike } from "@/lib/ai/fireworks-as-stream-provider";
import {
  imageTone,
  loadCuratedImages,
  type CuratedImage,
} from "@/lib/imagery/manifest";

const STOP = new Set([
  // articles / prepositions / filler
  "a", "an", "the", "of", "in", "on", "with", "and", "or", "for", "to", "at",
  "by", "our", "your", "this", "that", "photo", "image", "picture", "shot",
  "hero", "background", "scene", "view",
  // generic colour / mood / quality adjectives — these appear across many
  // unrelated alts and create false "overlap" (e.g. "warm patio" matching a
  // "warm" landscape). Matching should be driven by SUBJECT NOUNS, not these.
  "warm", "cool", "cozy", "soft", "bright", "dark", "light", "pale", "muted",
  "vivid", "deep", "rich", "gentle", "calm", "bold", "vibrant", "modern",
  "minimal", "clean", "sleek", "smooth", "elegant", "premium", "simple",
  "natural", "fresh", "beautiful", "lovely", "stylish", "big", "small",
  "large", "tiny", "new", "old", "nice", "great", "pretty", "cozy", "airy",
]);

// Per-slot shortlist depth + the combined pool cap sent to Flash (keeps the
// prompt small and the cost trivial).
const SHORTLIST = 12;
const POOL_CAP = 24;
const PICK_TIMEOUT_MS = 20_000;

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

/** Igualdad, no prefijo.
 *
 *  El emparejador comparaba por prefijo en los dos sentidos. El producto habla
 *  español y el catálogo está etiquetado en inglés, así que una palabra corta
 *  española es prefijo de palabras inglesas sin ninguna relación: medido, "pan
 *  de masa madre" traía una maqueta de dashboard SaaS porque
 *  `"panels".startsWith("pan")`. En una panadería.
 *
 *  Y por longitud no se separa: "pan"/"panes" (la que quiero) y "pan"/"panel"
 *  (la que no) tienen exactamente la misma forma. Entre dos idiomas el prefijo
 *  no es una flexión, es una colisión — lo que funcionaba de verdad eran los
 *  cognados ("croissants", "restaurant"), y ésos coinciden exactos.
 *
 *  Llenar menos huecos es el precio, y es el correcto: un degradado neutro es
 *  mejor que una foto que miente sobre el negocio del usuario. */
function overlap(subjectToks: string[], hay: string[]): number {
  let n = 0;
  for (const s of subjectToks) {
    for (const h of hay) {
      if (h === s) {
        n++;
        break;
      }
    }
  }
  return n;
}

function detectMode(html: string): "light" | "dark" {
  const m = /--(?:ol-)?bg\s*:\s*(#[0-9a-fA-F]{3,8})/.exec(html);
  if (!m) return "light";
  const hex = m[1].replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex.slice(0, 6);
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.45 ? "dark" : "light";
}

function srcsetFor(img: CuratedImage): string {
  return `${img.src.thumb} 400w, ${img.src.tablet} 800w, ${img.src.hero} 1920w`;
}

const SKIP: PhotoAssignment = { src: "", srcset: "", alt: "" };

// ─── Flash pick (the quality lever) ─────────────────────────────────────────

export interface PickRequest {
  brief: string;
  /** Non-text slots to fill, keyed by their original document index. */
  slots: { index: number; subject: string }[];
  /** The pooled candidate shortlist. */
  pool: { id: string; alt: string; style: string }[];
}

/** index → chosen imageId. Injectable for tests; null = fall back to the
 *  deterministic top-pick. */
export type PickFn = (req: PickRequest) => Promise<Record<number, string> | null>;

const PICK_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    picks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          slot: { type: "INTEGER" },
          imageId: { type: "STRING" },
        },
        required: ["slot", "imageId"],
      },
    },
  },
  required: ["picks"],
  propertyOrdering: ["picks"],
};

async function pickPhotos(req: PickRequest): Promise<Record<number, string> | null> {
  // Elegir foto es DIRECCIÓN DE ARTE SOBRE TEXTO: se le da una lista de huecos y
  // otra de fotos, y decide el emparejamiento. No mira un solo píxel, así que
  // corre en DeepSeek. Aqui vivia `OPENLEN_IMAGERY_PICK=gemini`, retirado el
  // 2026-08-28 con el proveedor.
  //
  // `OPENLEN_IMAGERY_SMART=0` SE QUEDA: ese no elige proveedor, apaga la
  // eleccion inteligente entera y cae al emparejamiento determinista. Es una
  // puerta de la FEATURE, no del proveedor.
  if (process.env.OPENLEN_IMAGERY_SMART === "0") return null;

  const prompt = [
    "You are an art director choosing stock photos for a landing page.",
    `Brief: ${req.brief}`,
    "",
    "Photo slots to fill (each needs ONE photo):",
    ...req.slots.map((s) => `- slot ${s.index}: ${s.subject}`),
    "",
    "Available photos (id — description [style]):",
    ...req.pool.map((p) => `- ${p.id} — ${p.alt} [${p.style}]`),
    "",
    "For each slot, choose the imageId whose subject best fits the slot's subject and the brief. Rules: use each photo at most once; if NO photo reasonably fits a slot, omit that slot. Return only picks for slots you're confident about.",
  ].join("\n");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PICK_TIMEOUT_MS);
  try {
    const provider: StreamProviderLike = fireworksStreamProvider({
          requestId: "imagery-pick",
          operation: "simple_extraction",
          maxOutputTokens: 2_048,
          temperature: 0.1,
          jsonObject: true,
        });
    let raw = "";
    for await (const ev of provider.stream(
      {
        messages: [{ role: "user", content: prompt }],
        responseMimeType: "application/json",
        responseSchema: PICK_SCHEMA,
        maxOutputTokens: 2_048,
        temperature: 0.1,
      },
      { signal: ctrl.signal },
    )) {
      if (ev.type === "text_delta") raw += ev.text;
      else if (ev.type === "done" && ev.stopReason.kind === "error") return null;
    }
    // Una valla de markdown aquí no puede costar el emparejamiento entero: el
    // `catch` de abajo devolvería `null` y la página caería al reparto tonto sin
    // que nadie supiera por qué.
    const limpio = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(limpio) as { picks?: { slot?: unknown; imageId?: unknown }[] };
    if (!Array.isArray(parsed?.picks)) return null;
    const out: Record<number, string> = {};
    for (const p of parsed.picks) {
      if (typeof p?.slot === "number" && typeof p?.imageId === "string") {
        out[p.slot] = p.imageId;
      }
    }
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Orchestration ──────────────────────────────────────────────────────────

export interface PhotographResult {
  html: string;
  applied: number;
}

export async function photographHtml(params: {
  html: string;
  brief: string;
  /** Test seam — defaults to the model picker. */
  pickFn?: PickFn;
}): Promise<PhotographResult> {
  const { html, brief } = params;
  const pick = params.pickFn ?? pickPhotos;

  const slots = extractPhotoSlots(html);
  if (slots.length === 0) return { html, applied: 0 };

  const images = await loadCuratedImages();
  if (images.length === 0) return { html, applied: 0 };

  const hay = new Map<string, string[]>();
  for (const img of images) {
    hay.set(img.id, tokens(`${img.alt} ${img.style} ${img.family.join(" ")}`));
  }
  const byId = new Map(images.map((i) => [i.id, i]));
  const family = classifyBriefFamily(brief).family;
  const mode = detectMode(html);

  // 1. Deterministic shortlist per fillable slot (non-text, with real signal).
  const shortlists = new Map<number, CuratedImage[]>();
  // Reserva del gremio: el filtro se queda corto a menudo —los sujetos vienen
  // en español y el catálogo está etiquetado en inglés—, y un hueco con el
  // degradado puesto es peor que una foto imprecisa. Se ordena por familia del
  // brief y luego por tono, y sólo se usa donde no hubo nada mejor.
  //
  //  Sólo la familia EXACTA. Probé ensanchar al anillo de familias vecinas —las
  //  que conviven con ella en el catálogo— para llegar al pan de verdad, que
  //  está etiquetado `hospitality`: sí lo alcanzaba, y traía detrás una casa de
  //  los cincuenta y unas piedras apiladas. Cambiar una foto rara por otra foto
  //  rara no es progreso. El techo real es el etiquetado: `food-beverage` tiene
  //  SEIS imágenes en un catálogo de quinientas, y el pan no está entre ellas.
  const toneScore = (img: CuratedImage): number => {
    const tone = imageTone(img.alt);
    return tone === mode ? 2 : tone === "neutral" ? 1 : 0;
  };
  const fallback = family
    ? images.filter((img) => img.family.includes(family)).sort((a, b) => toneScore(b) - toneScore(a))
    : [];

  slots.forEach((slot, index) => {
    if (slot.hasText) return;
    const subjectToks = tokens(slot.subject || brief);
    const scored: { img: CuratedImage; score: number; signal: number }[] = [];
    for (const img of images) {
      const fam = family && img.family.includes(family) ? 1 : 0;
      const ov = overlap(subjectToks, hay.get(img.id) ?? []);
      // Contenido O rubro entran a la piscina; el contenido pesa mucho más al
      // ordenar. Exigir contenido dejaba fuera casi todo —los sujetos vienen en
      // español y el catálogo está etiquetado en inglés— y el elector de IA se
      // quedaba sin candidatos que mirar: medido, 1 hueco lleno de 4. La
      // etiqueta de rubro le da un fondo del gremio correcto para elegir.
      const signal = ov * 10 + fam * 4;
      if (signal < 1) continue;
      const tone = imageTone(img.alt);
      const tv = tone === mode ? 1 : tone === "neutral" ? 0.5 : 0;
      scored.push({ img, score: signal + tv, signal });
    }
    scored.sort((a, b) => b.score - a.score);
    if (scored.length > 0) shortlists.set(index, scored.slice(0, SHORTLIST).map((s) => s.img));
  });

  if (shortlists.size === 0 && fallback.length === 0) {
    // Nothing matched — still apply to strip the markers off the doc.
    return finalize(html, slots, () => SKIP);
  }

  // 2. Pool the shortlists (dedup, cap) and let Flash pick the best per slot.
  const poolImgs: CuratedImage[] = [];
  const seen = new Set<string>();
  for (const list of shortlists.values()) {
    for (const img of list) {
      if (!seen.has(img.id)) {
        seen.add(img.id);
        poolImgs.push(img);
      }
    }
  }
  const pool = poolImgs.slice(0, POOL_CAP);
  const poolIds = new Set(pool.map((p) => p.id));

  let aiPicks: Record<number, string> = {};
  try {
    aiPicks =
      (await pick({
        brief,
        slots: [...shortlists.keys()].map((index) => ({
          index,
          subject: slots[index].subject || brief,
        })),
        pool: pool.map((p) => ({ id: p.id, alt: p.alt, style: p.style })),
      })) ?? {};
  } catch {
    aiPicks = {};
  }

  // 3. Resolve each slot: Flash pick (if valid + unused) else deterministic
  //    top unused candidate. Dedup across slots.
  const used = new Set<string>();
  const chosen = new Map<number, CuratedImage>();
  for (const [index, list] of shortlists) {
    const aiId = aiPicks[index];
    let img: CuratedImage | undefined;
    if (aiId && poolIds.has(aiId) && !used.has(aiId)) {
      img = byId.get(aiId);
    }
    if (!img) img = list.find((c) => !used.has(c.id));
    if (img) {
      used.add(img.id);
      chosen.set(index, img);
    }
  }

  // Los huecos que ni siquiera entraron al filtro: mejor una foto del gremio
  // que un bloque de degradado. Medido en una página entregada — seis fotos
  // puestas y siete huecos vacíos.
  slots.forEach((slot, index) => {
    if (slot.hasText || chosen.has(index)) return;
    const img = fallback.find((candidate) => !used.has(candidate.id));
    if (img) {
      used.add(img.id);
      chosen.set(index, img);
    }
  });

  return finalize(html, slots, (index) => {
    const img = chosen.get(index);
    return img ? { src: img.src.hero, srcset: srcsetFor(img), alt: img.alt } : SKIP;
  });
}

function finalize(
  html: string,
  slots: { hasText: boolean; subject: string }[],
  assign: (index: number) => PhotoAssignment,
): PhotographResult {
  const assignments = slots.map((_, index) => assign(index));
  const r = applyPhotoSlots(html, assignments);
  return { html: r.html, applied: r.applied };
}
