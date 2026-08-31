import { z } from "zod";

import { sanitizeForPublish } from "@/lib/html-engine";
import { validatePageSlug } from "@/lib/projects/site-pages";
import { TemplateVisualMetadataSchema } from "./visual-metadata";

// Shared Zod schemas + invariant helpers for the admin template endpoints.
// Both POST (create / replace) and PUT (partial update) consume these so
// validation rules live in one place. The CLI under scripts/templates-add.ts
// validates against the same shape before dispatching to upsertTemplate().

export const FAMILY = z.enum([
  "technical-minimal",
  "editorial",
  "commerce",
  "documentation",
  "saas",
  "ai-ml",
  "fintech",
  "health-tech",
  "portfolio",
  "pre-launch",
  "event",
  "agency",
  "real-estate",
  "architecture",
  "hospitality",
  "ecommerce",
  "climate",
  "mobile-app",
  "education",
  "creator",
  "open-source",
  "music",
  "gaming",
  "sports",
  "local-services",
  "nonprofit",
  "wellness",
  "web3",
  "hardware",
  "aerospace",
  "podcast",
  "wedding",
  "travel",
  "food-beverage",
  "fashion",
  "photography",
  "cinema",
]);
export const MODE = z.enum(["dark", "light", "cream"]);
export const STATUS = z.enum(["draft", "published", "archived"]);

// Slug rules: lowercase alphanumeric + hyphens, no leading/trailing hyphens,
// 1-32 chars. The slug is both the URL segment (/templates/<slug>) and the
// storage-key prefix (templates/<slug>-<hash>.html), so we keep it strict.
export const SLUG = z.string().regex(
  /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/,
  "slug must be 1-32 chars, lowercase alphanumeric/hyphens, no leading/trailing hyphens",
);

export const HEX_COLOR = z.string().regex(
  /^#[0-9a-fA-F]{6}$/,
  "accent must be #RRGGBB hex",
);

// Upper bound on the HTML body. Curated templates we've seen so far run
// 35-80KB; 500KB is generous headroom but rejects pathological payloads.
export const MAX_HTML_BYTES = 500_000;

export const HTML = z
  .string()
  .min(20, "html body looks empty")
  .max(MAX_HTML_BYTES, `html exceeds ${MAX_HTML_BYTES} bytes`);

// Extra pages for a MULTI-PAGE template. Each {slug, html}; slugs are validated
// against the SAME rules + reserved set as user site-pages (validatePageSlug —
// rejects "api", "assets", locale codes, etc.) and must be unique within the
// array, so a cloned template can never collide with a system/locale path.
export const PAGES = z
  .array(z.object({ slug: SLUG, html: HTML }))
  .max(20, "at most 20 extra pages")
  .superRefine((arr, ctx) => {
    const seen = new Set<string>();
    arr.forEach((p, i) => {
      const v = validatePageSlug(p.slug);
      if (!v.ok || v.slug !== p.slug) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `page slug "${p.slug}" is invalid or reserved`,
          path: [i, "slug"],
        });
      }
      if (seen.has(p.slug)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate page slug "${p.slug}"`,
          path: [i, "slug"],
        });
      }
      seen.add(p.slug);
    });
  });

// Full create / replace payload — every field required.
export const CreateSchema = z.object({
  id: SLUG,
  name: z.string().min(1).max(80),
  family: FAMILY,
  accent: HEX_COLOR,
  pitch: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  mode: MODE,
  html: HTML,
  visualMetadata: TemplateVisualMetadataSchema.nullable().optional(),
  // Extra pages for a multi-page template — each cloned into data.pages.
  pages: PAGES.optional(),
  status: STATUS.optional(),
});
export type CreateTemplateInput = z.infer<typeof CreateSchema>;

// Partial-update payload — every field optional. id comes from the URL,
// not the body. At least one field must be present.
export const UpdateSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    family: FAMILY.optional(),
    accent: HEX_COLOR.optional(),
    pitch: z.string().min(1).max(200).optional(),
    description: z.string().min(1).max(500).optional(),
    mode: MODE.optional(),
    html: HTML.optional(),
    visualMetadata: TemplateVisualMetadataSchema.nullable().optional(),
    pages: PAGES.optional(),
    status: STATUS.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "at least one field must be present",
  });
export type UpdateTemplateInput = z.infer<typeof UpdateSchema>;

// ── Validación de contenido al REGISTRAR una plantilla ──────────────────────
//
// Aquí se VALIDA Y RECHAZA; deliberadamente NO se sanitiza. Las plantillas se
// guardan CRUDAS en R2 a propósito y se sanitizan al CLONAR: esa copia cruda es
// la que permitió que el fix del carrier (977e325) reparara los clones futuros
// sin tocar nada. Sanitizar al registrar destruiría la única copia cruda de
// esas paletas — la misma pérdida irreversible que acabamos de arreglar. Y
// quien registra es admin por CLI: un error claro es mejor que una limpieza
// callada que nadie ve.
//
// El criterio salió de MEDIR el corpus real (178 plantillas en
// templates/starter, con el propio sanitizador como oráculo —
// scratch/template-corpus-scan.mts):
//
//   scripts inline .... 89% de las plantillas → norma establecida, se acepta
//   handlers on* ...... 13%                   → norma establecida, se acepta
//   javascript: URLs ... 0%                   → anomalía, se rechaza
//   iframes/embeds ..... 0%                   → anomalía, se rechaza
//   meta refresh ....... 0%                   → anomalía, se rechaza
//
// Los dos primeros son el pan de cada día de un artefacto de claude.ai; los tres
// últimos no tienen un solo precedente legítimo, y como el clon también los
// borraría, una plantilla que los traiga está rota de nacimiento: mejor
// enterarse al registrarla que descubrir el video ausente en cada clon.
//
// ⚠️ EL MOTIVO DE ACEPTAR LOS DOS PRIMEROS CAMBIÓ el 2026-08-31. Decía «los
// borra el sanitizador al clonar (doctrina "OpenLen borra todo el JS")» — o
// sea: se aceptaban porque daba igual. Esa doctrina murió el 2026-08-26 y
// desde hoy `from-template` RESTAURA los scripts tras el saneado
// (`conservarScripts`), así que ya no da igual: el `<script>` de una plantilla
// llega vivo a la página del usuario. Se siguen aceptando, pero ahora es una
// decisión con consecuencias — lo que se registre aquí, se ejecuta en la
// página de un visitante. Los `on*` sí se siguen perdiendo en el clon.
//
// El oráculo NO se rompe con eso: los tres que se rechazan (URLs peligrosas,
// embebidos fuera de lista, meta refresh) los sigue quitando el mismo
// `sanitizeForPublish` en el clon, y nadie los devuelve.
//
// El oráculo es el sanitizador REAL (no una lista de regexes propia): lo que él
// contaría como retirado es exactamente lo que aquí se juzga, así que las dos
// puertas no pueden driftear.

/** Dónde está el problema y por qué se rechaza. */
export interface TemplateHtmlIssue {
  /** `"html"` o `pages["<slug>"]`. */
  where: string;
  reason: string;
}

function htmlIssue(html: string): string | null {
  const r = sanitizeForPublish(html);
  if (r.html === null) {
    return "contiene el marcador data-slot-path (fuga de modo-editor)";
  }
  const bad: string[] = [];
  if (r.removed.dangerousUrls > 0) {
    bad.push(`${r.removed.dangerousUrls} URL(s) con esquema peligroso (javascript:/vbscript:)`);
  }
  if (r.removed.iframes > 0) {
    bad.push(`${r.removed.iframes} elemento(s) incrustado(s) (iframe/object/embed)`);
  }
  if (r.removed.metaRefresh > 0) {
    bad.push(`${r.removed.metaRefresh} meta refresh`);
  }
  // scripts + on* NO entran: son la norma del corpus (89% / 13%) y el clon los
  // retira. Ver la tabla de arriba antes de agregarlos.
  return bad.length > 0
    ? `${bad.join("; ")} — el clon los borraría, así que la plantilla nacería rota`
    : null;
}

/** Revisa el documento principal Y cada página extra. Devuelve el primer
 *  problema (nombrando la página culpable) o null si todo pasa. */
export function findTemplateHtmlIssue(input: {
  html?: string | null;
  pages?: { slug: string; html: string }[] | null;
}): TemplateHtmlIssue | null {
  if (typeof input.html === "string") {
    const reason = htmlIssue(input.html);
    if (reason) return { where: "html", reason };
  }
  for (const p of input.pages ?? []) {
    const reason = htmlIssue(p.html);
    if (reason) return { where: `pages["${p.slug}"]`, reason };
  }
  return null;
}

/**
 * AVISOS: lo que no impide registrar, pero el curador tiene que saber.
 *
 * Hoy uno solo, y es el que quedó abierto al restaurar los scripts en el clon
 * (2026-08-31): los atributos `on*`. `sanitizeForPublish` se los lleva y NADIE
 * los devuelve —`conservarScripts` restaura bloques `<script>`, no atributos—,
 * así que una plantilla con `onclick="abrir()"` clona con la función viva y el
 * botón muerto.
 *
 * POR QUÉ AVISA Y NO RECHAZA. Rechazar bloquearía el 13% del corpus medido
 * arriba sin arreglar ni una de las plantillas ya registradas. Restaurarlos al
 * clonar daría un botón que funciona hasta el primer guardado de documento
 * completo y luego muere en silencio, que es peor. Y convertirlos a
 * `addEventListener` —el arreglo bueno, y que hoy SÍ funcionaría porque el
 * `<script>` sobrevive— es trabajo real que nadie ha justificado todavía con
 * una medida.
 *
 * Así que este aviso ES la medida: sale en cada `templates:add`, y si sale
 * siempre, ahí está la señal para escribir el convertidor. Es la misma
 * doctrina que el rechazo de arriba — «un error claro es mejor que una
 * limpieza callada que nadie ve»— bajada un escalón de severidad.
 */
export function findTemplateHtmlWarnings(input: {
  html?: string | null;
  pages?: { slug: string; html: string }[] | null;
}): TemplateHtmlIssue[] {
  const out: TemplateHtmlIssue[] = [];
  const mira = (html: string, where: string) => {
    const n = sanitizeForPublish(html).removed.eventHandlers;
    if (n > 0) {
      out.push({
        where,
        reason:
          `${n} atributo(s) on* (onclick, onchange…). El clon los borra y nadie los ` +
          `devuelve: esos controles nacerán MUDOS. Cablea con addEventListener ` +
          `dentro del <script>, que sí sobrevive.`,
      });
    }
  };
  if (typeof input.html === "string") mira(input.html, "html");
  for (const p of input.pages ?? []) mira(p.html, `pages["${p.slug}"]`);
  return out;
}
