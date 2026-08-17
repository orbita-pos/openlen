import { z } from "zod";
import { CreativeDirectionSchema, type CreativeDirection } from "./creative-contracts";
import { CREATIVE_FONT_MOODS } from "./creative-registry";
import type { IntentAnalysis } from "./contracts";
import { paletteFromAccent } from "./palette-from-accent";

/**
 * La dirección creativa, elegida leyendo el brief.
 *
 * Antes salía de `buildDeterministicCreativeDirection`, que rankea los 7 nichos
 * de la cohorte por solapamiento de palabras y devuelve la dirección del más
 * parecido. El solapamiento es estructural —secciones, audiencia, acciones— así
 * que terror, con la lista de secciones más genérica, es un atractor: medido,
 * una clínica dental, un tostador de café y una página de venta salieron los
 * tres en negro con acento rojo sangre.
 *
 * El reparto de trabajo es por lo que cada lado puede prometer:
 *
 * - El modelo elige lo ESTÉTICO y nada más: modo, un acento, pareja
 *   tipográfica, geometría. Vocabularios cerrados salvo el acento.
 * - Lo SEMÁNTICO no se le pregunta: dominios, audiencia y señales visuales ya
 *   viven en `IntentAnalysis`, y preguntarlo dos veces es invitar a que las dos
 *   respuestas discrepen.
 * - La paleta la deriva el código. Un modelo elige un color bonito; no puede
 *   prometer que ocho contrasten entre sí, y ocho que no contrastan es
 *   exactamente el fallo que esta rama pasó el día persiguiendo.
 *
 * FALLA BLANDO, y eso es del diseño, no una concesión: la dirección es gusto,
 * no corrección. Cualquier fallo devuelve `null` y el llamador se queda con la
 * dirección determinista de siempre. Una llamada caída cuesta el gusto, jamás
 * la página.
 */

const FONT_MOODS = Object.keys(CREATIVE_FONT_MOODS) as [string, ...string[]];

/** Lo único que se le pide al modelo. Cerrado salvo el acento y dos slugs.
 *  Exportado porque el transporte lo usa como esquema de respuesta: un solo
 *  contrato para la decodificación y para la validación. */
export const AestheticChoiceSchema = z.object({
  mode: z.enum(["light", "dark", "cream"]),
  accent: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/),
  display: z.enum(FONT_MOODS),
  body: z.enum(FONT_MOODS),
  scale: z.enum(["compact", "balanced", "expressive"]),
  radius: z.enum(["square", "soft", "round", "extra_round"]),
  density: z.enum(["low", "low_medium", "medium", "high"]),
  imagery: z.enum(["photo_first", "illustration_first", "mixed", "texture_first"]),
  archetype: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/).max(64),
  tone: z.array(z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/).max(64)).max(6),
}).strict();

export const DIRECTION_PROMPT_VERSION = "creative-direction-prompt/1.0" as const;

export const DIRECTION_SYSTEM_PROMPT = `You choose how a landing page should LOOK, for a real business, from its brief.

Answer with ONE JSON object and nothing else. No prose, no code fence.

{
  "mode": "light" | "dark" | "cream",
  "accent": "#RRGGBB",
  "display": one of ${FONT_MOODS.join(" | ")},
  "body": one of ${FONT_MOODS.join(" | ")},
  "scale": "compact" | "balanced" | "expressive",
  "radius": "square" | "soft" | "round" | "extra_round",
  "density": "low" | "low_medium" | "medium" | "high",
  "imagery": "photo_first" | "illustration_first" | "mixed" | "texture_first",
  "archetype": lower_snake_case, 2-4 words, what KIND of page this is,
  "tone": up to 4 lower_snake_case adjectives
}

Choose for THIS business, not for a genre you are reminded of. A dental clinic
that mentions families wants calm and light; a horror experience wants dark and
cinematic; a coffee roaster wants warm and editorial. Most real businesses —
clinics, shops, studios, schools, restaurants — are light or cream. Reach for
dark only when the subject genuinely calls for it.

"accent" is the ONE colour the page hinges on. Pick it from the business, not
from a palette you like: its trade, its material, its mood. It will be
contrast-corrected before use, so choose the colour you mean rather than a safe
one.`;

export interface ChooseCreativeDirectionDeps {
  /** Transporte inyectado: el módulo posee el prompt y el contrato, el llamador
   *  posee la red. Así se prueba sin red y no se duplica transporte. */
  readonly ask: (system: string, user: string) => Promise<string>;
}

export async function chooseCreativeDirection(
  brief: string,
  intent: IntentAnalysis,
  deps: ChooseCreativeDirectionDeps,
): Promise<CreativeDirection | null> {
  let raw: string;
  try {
    raw = await deps.ask(DIRECTION_SYSTEM_PROMPT, `BRIEF:\n${brief.trim()}`);
  } catch {
    // Sin reintento: una negativa reintentada es la misma negativa con factura.
    return null;
  }

  const parsed = AestheticChoiceSchema.safeParse(readJson(raw));
  if (!parsed.success) return null;
  const choice = parsed.data;

  const direction = {
    schemaVersion: "creative-direction/1.0" as const,
    mode: choice.mode,
    visualArchetype: choice.archetype,
    emotionalTone: choice.tone.length > 0 ? choice.tone : [...intent.emotionalGoals],
    palette: paletteFromAccent(choice.accent, choice.mode),
    typography: {
      display: choice.display,
      body: choice.body,
      mono: null,
      scale: choice.scale,
    },
    geometry: {
      radius: choice.radius,
      radiusScale: choice.radius === "square" ? 0 : choice.radius === "extra_round" ? 1.75 : 1,
      spacingScale: choice.density === "high" ? 0.85 : choice.density === "low" ? 1.15 : 1,
      density: choice.density,
    },
    imagery: {
      strategy: choice.imagery,
      artDirection: choice.archetype,
      // Los sujetos salen del intento: describen de qué trata el negocio, y eso
      // ya se analizó. Volver a preguntarlo es invitar a que discrepen.
      subjects: [...intent.domains].slice(0, 6),
      avoid: [...intent.forbiddenVisualSignals].slice(0, 6),
    },
    iconography: {
      style: choice.radius === "square" ? "geometric_outline" as const : "rounded_outline" as const,
      strokeWeight: "medium" as const,
      cornerStyle: choice.radius === "square" ? "square" as const : choice.radius === "soft" ? "soft" as const : "round" as const,
    },
    componentTreatment: {
      cards: choice.density === "low" ? "airy" : "grouped",
      buttons: choice.radius === "square" ? "sharp" : "soft",
      navigation: "simple",
      sections: choice.scale === "expressive" ? "generous" : "even",
    },
    requiredVisualSignals: [...intent.requiredVisualSignals],
    forbiddenVisualSignals: [...intent.forbiddenVisualSignals],
  };

  // La forma la decide el contrato, no yo: si algo derivado no encaja, se cae al
  // determinista en vez de entregar una dirección medio válida.
  const validated = CreativeDirectionSchema.safeParse(direction);
  return validated.success ? validated.data : null;
}

/** Los modelos encierran el JSON en un cerco pese a que se les prohíbe. */
function readJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Un objeto envuelto en prosa: se toma el primer bloque balanceado.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
