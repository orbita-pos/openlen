// Edición de imagen por instrucción — el NÚCLEO, extraído
// from app/api/projects/[id]/ai-edit-image/route.ts so the same call powers
// both the route (in-editor Replace modal) and the agent's editar_imagen tool.
//
// The route stays a byte-identical shell: it keeps auth / ownership / MIME
// allowlist / size cap / credit gate and maps this core's result straight to
// its HTTP responses (the failure branch carries the exact status + body the
// route used to build inline). The image transport and the credit debit are
// INJECTED (ImageEditDeps) so the mapping + "debit only on success" invariant
// are unit-testable with zero network + zero DB.

import { AI_IMAGE_EDIT_CREDIT_COST } from "@/lib/credits";

export interface ImageEditInput {
  /** Source image, base64 (no data: prefix). */
  imageBase64: string;
  /** image/png | image/jpeg | image/webp */
  mimeType: string;
  /** The natural-language edit instruction (already trimmed by the caller). */
  prompt: string;
}

/** The raw transport outcome — the ONLY thing injected, so the mapping + debit
 *  below is pure. Each variant mirrors a distinct branch of the original route. */
export type ImageEditOutcome =
  | { kind: "image"; imageBase64: string; mimeType: string }
  | { kind: "blocked"; reason: string }
  | { kind: "no_image"; message: string }
  | { kind: "http_error"; status: number; detail: string }
  | { kind: "network_error"; message: string }
  | { kind: "unavailable" };

export interface ImageEditDeps {
  /** POST the edit to the provider and return the parsed outcome. */
  callProvider(input: ImageEditInput): Promise<ImageEditOutcome>;
  /** Debit credits — invoked ONLY on a successful edit. The caller binds the
   *  userId (route: the session user; agent: the AgentSession user). */
  debit(cost: number): Promise<void>;
}

export interface ImageEditOk {
  imageBase64: string;
  mimeType: string;
  cost: number;
}

/** Failure carries the exact HTTP status + JSON body the route emitted inline,
 *  so the route shell stays byte-identical. Consumers that only need a reason
 *  (the agent tool) read `error`. */
export interface ImageEditErr {
  error: string;
  status: number;
  body: Record<string, unknown>;
}

export type ImageEditResult = ImageEditOk | ImageEditErr;

export async function editImage(
  input: ImageEditInput,
  deps: ImageEditDeps,
): Promise<ImageEditResult> {
  const outcome = await deps.callProvider(input);
  switch (outcome.kind) {
    case "unavailable":
      return { error: "ai_unavailable", status: 503, body: { error: "ai_unavailable" } };
    case "network_error":
      return {
        error: "ai_request_failed",
        status: 502,
        body: { error: "ai_request_failed", message: outcome.message },
      };
    case "http_error":
      return {
        error: "ai_error",
        status: 502,
        body: { error: "ai_error", status: outcome.status, detail: outcome.detail },
      };
    case "blocked":
      return { error: "blocked", status: 422, body: { error: "blocked", reason: outcome.reason } };
    case "no_image":
      return { error: "no_image", status: 422, body: { error: "no_image", message: outcome.message } };
    case "image": {
      // Charge only once we have a real result — same as the original route.
      await deps.debit(AI_IMAGE_EDIT_CREDIT_COST);
      return {
        imageBase64: outcome.imageBase64,
        mimeType: outcome.mimeType || "image/png",
        cost: AI_IMAGE_EDIT_CREDIT_COST,
      };
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// OpenAI — gpt-image-2, el camino por defecto desde el 2026-08-28.
//
// POR QUÉ SE MUEVE. Es la ÚNICA superficie de OpenLen que todavía corría por
// Gemini por defecto: todas las demás (traducción, autofill, asistente, ojos de
// crear, ojos del Agente, elección de fotos, los tres escritores y el rediseño)
// ya son opt-out hacia Fireworks. Mientras esta siguiera aquí, la clave de
// Gemini no se podía quitar de la caja.
//
// `quality` FIJADA A "medium", y el precio va detrás — no al revés.
//
// ⚠️ Este comentario decía que el precio no cambiaba, y era MÍO y era FALSO:
// comprobé que `high` sería peor y no comprobé que `medium` ya se pasaba de los
// 4 créditos que estaban puestos (calibrados para Nano Banana). Miré hacia
// arriba y no hacia abajo. Corregido a 6 en `lib/credits.ts`, con las cifras.
//
// "auto" queda fuera porque deja elegir al modelo, y entonces el cobro deja de
// corresponder al trabajo EN SILENCIO. "low" se midió y no sirve: reimagina en
// vez de editar (ver el comentario de AI_IMAGE_EDIT_CREDIT_COST). Cualquier
// cambio de calidad mueve el precio A LA VEZ, no después.
const OPENAI_IMAGE_EDITS_URL = "https://api.openai.com/v1/images/edits";

/** La misma calidad con la que `lib/images.ts` sirve las imágenes de usuario.
 *  Vive aquí como constante para que se vea que es una decisión, no un 82
 *  suelto dentro de un `append`. */
const WEBP_QUALITY = 82;

export const OPENAI_IMAGE_EDIT_MODEL_ID =
  process.env.OPENLEN_IMAGE_EDIT_MODEL_OPENAI || "gpt-image-2";

/** `png` | `jpeg` | `webp` — lo que OpenAI acepta en `output_format`. Se deriva
 *  del MIME de ENTRADA para que la imagen sustituida conserve su tipo: una foto
 *  que entró como webp y sale como png pesa varias veces más en la página. */
function formatoDeSalida(mimeType: string): "png" | "jpeg" | "webp" {
  const m = mimeType.toLowerCase();
  if (m.includes("webp")) return "webp";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpeg";
  return "png";
}

/** Una respuesta de error de OpenAI por política de contenido.
 *
 *  Se mira el CUERPO, no sólo el status: un 400 por política de contenido y un
 *  400 por un campo mal formado llegan con el mismo número, y sólo el primero
 *  debe verse como "blocked" (422 + «lo rechazó por contenido») en vez de como
 *  un fallo nuestro. Se compara ancho a propósito — el código exacto de OpenAI
 *  ha cambiado de nombre antes, y equivocarse hacia "blocked" le dice al usuario
 *  algo cierto, mientras que equivocarse hacia "ai_error" le dice que fallamos
 *  nosotros. */
function esRechazoDeContenido(cuerpo: string): boolean {
  return /moderation|safety|content[_ -]?policy|content_filter|rejected/i.test(cuerpo);
}

export function openaiImageEditTransport(
  fetchImpl: typeof fetch = fetch,
): (input: ImageEditInput) => Promise<ImageEditOutcome> {
  return async (input) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { kind: "unavailable" };

    const salida = formatoDeSalida(input.mimeType);
    const form = new FormData();
    form.append("model", OPENAI_IMAGE_EDIT_MODEL_ID);
    form.append("prompt", input.prompt);
    // `size: auto` deja que el modelo conserve la proporción de la fuente. Es
    // lo que más se parece a Nano Banana, que devolvía lo que devolvía: aquí un
    // tamaño FIJO recortaría o estiraría la foto del usuario al sustituirla.
    form.append("size", "auto");
    form.append("quality", "medium");
    form.append("n", "1");
    form.append("output_format", salida);
    // MEDIDO en la primera edición real (2026-08-28): sin esto OpenAI devuelve
    // el webp casi sin comprimir — 1.129 KB para un 1672x941, de una fuente de
    // 10 KB. Re-comprimido a 82 son 29 KB, la MISMA imagen. Es un fallo que no
    // da error: el usuario sustituye una foto de su héroe y su página pasa a
    // pesar un mega, y sólo se entera por lo lenta que va.
    //
    // 82 no es un número al azar: es la calidad webp con la que este repo
    // sirve las imágenes de usuario (lib/images.ts). Sólo aplica a jpeg y webp
    // — en png la API lo ignora, así que ni se manda.
    if (salida !== "png") form.append("output_compression", String(WEBP_QUALITY));
    form.append(
      "image",
      new Blob([Uint8Array.from(atob(input.imageBase64), (c) => c.charCodeAt(0))], {
        type: input.mimeType,
      }),
      `source.${salida === "jpeg" ? "jpg" : salida}`,
    );

    let res: Response;
    try {
      // Sin `content-type`: lo pone FormData con su propio boundary. Fijarlo a
      // mano es el fallo clásico de multipart — el servidor no encuentra el
      // separador y devuelve un 400 que parece de los campos.
      res = await fetchImpl(OPENAI_IMAGE_EDITS_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } catch (err) {
      return { kind: "network_error", message: err instanceof Error ? err.message : String(err) };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (esRechazoDeContenido(text)) {
        return { kind: "blocked", reason: text.slice(0, 200) };
      }
      return { kind: "http_error", status: res.status, detail: text.slice(0, 400) };
    }

    const payload = (await res.json().catch(() => null)) as {
      data?: Array<{ b64_json?: string }>;
    } | null;

    const b64 = payload?.data?.[0]?.b64_json;
    if (!b64) {
      return { kind: "no_image", message: "OpenAI devolvió una respuesta sin imagen." };
    }
    return { kind: "image", imageBase64: b64, mimeType: `image/${salida}` };
  };
}

/** EL transporte que corre en producción.
 *
 *  Ya no elige. Aquí vivía `OPENLEN_IMAGE_EDIT_PROVIDER=gemini`, que devolvía
 *  el turno a Nano Banana; con el transporte de Gemini fuera (2026-08-28) el
 *  interruptor no tenía a dónde volver, y un interruptor que sólo apunta a sí
 *  mismo es peor que ninguno: se lee como si hubiera una alternativa.
 *
 *  Se conserva la FUNCIÓN, no el interruptor: las pruebas y el Agente inyectan
 *  `fetchImpl`, y ese es el único parámetro que aquí hacía trabajo. */
export function realImageEditTransport(
  fetchImpl: typeof fetch = fetch,
): (input: ImageEditInput) => Promise<ImageEditOutcome> {
  return openaiImageEditTransport(fetchImpl);
}