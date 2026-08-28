// Edición de imagen por instrucción — el NÚCLEO, extraído
// from app/api/projects/[id]/ai-edit-image/route.ts so the same call powers
// both the route (in-editor Replace modal) and the agent's editar_imagen tool.
//
// The route stays a byte-identical shell: it keeps auth / ownership / MIME
// allowlist / size cap / credit gate and maps this core's result straight to
// its HTTP responses (the failure branch carries the exact status + body the
// route used to build inline). The Gemini transport and the credit debit are
// INJECTED (ImageEditDeps) so the mapping + "debit only on success" invariant
// are unit-testable with zero network + zero DB.

import { AI_IMAGE_EDIT_CREDIT_COST } from "@/lib/credits";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// The Nano Banana image model. Overridable while the GA id settles.
export const IMAGE_EDIT_MODEL_ID =
  process.env.OPENLEN_IMAGE_EDIT_MODEL || "gemini-2.5-flash-image";

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

/** El transporte de Gemini (Nano Banana) — el camino de VUELTA.
 *
 *  Lee GEMINI_API_KEY perezosamente (para que importar no tenga efectos) y
 *  reporta cada modo de fallo como un ImageEditOutcome distinto. */
export function geminiImageEditTransport(
  fetchImpl: typeof fetch = fetch,
): (input: ImageEditInput) => Promise<ImageEditOutcome> {
  return async (input) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { kind: "unavailable" };

    const url = `${GEMINI_BASE}/${IMAGE_EDIT_MODEL_ID}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: input.mimeType, data: input.imageBase64 } },
            { text: input.prompt },
          ],
        },
      ],
      generationConfig: { responseModalities: ["IMAGE"] },
    };

    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      });
    } catch (err) {
      return { kind: "network_error", message: err instanceof Error ? err.message : String(err) };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { kind: "http_error", status: res.status, detail: text.slice(0, 400) };
    }

    const payload = (await res.json().catch(() => null)) as {
      promptFeedback?: { blockReason?: string };
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> };
        finishReason?: string;
      }>;
    } | null;

    if (payload?.promptFeedback?.blockReason) {
      return { kind: "blocked", reason: payload.promptFeedback.blockReason };
    }

    const parts = payload?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      // The model can decline an edit and reply with text instead — surface it.
      const reply = parts.map((p) => p.text ?? "").join(" ").trim();
      return { kind: "no_image", message: reply || "The model returned no image." };
    }

    return {
      kind: "image",
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType || "",
    };
  };
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
// EL PRECIO NO CAMBIA, y eso no es suerte: la salida de imagen de gpt-image-2
// cuesta $30/1M igual que Nano Banana, que es exactamente el número del que
// sale AI_IMAGE_EDIT_CREDIT_COST = 4. Por eso `quality` va fijada a "medium" y
// no a "auto": "auto" deja que el modelo elija, y en "high" un 1024² son ~4.160
// tokens de salida ($0,125 ≈ 13 créditos) — el cobro dejaría de corresponder al
// trabajo en silencio. Si algún día se quiere "high", se mueve el precio A LA
// VEZ, no después.
const OPENAI_IMAGE_EDITS_URL = "https://api.openai.com/v1/images/edits";

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

/** Una respuesta de error de OpenAI que en Gemini era `promptFeedback.blockReason`.
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
 *  OpenAI por defecto; `OPENLEN_IMAGE_EDIT_PROVIDER=gemini` vuelve a Nano
 *  Banana. Misma semántica opt-out que los otros siete interruptores de
 *  proveedor (`lib/ai/provider-switch.ts`): la ausencia enciende lo nuevo, sólo
 *  el literal devuelve lo viejo. Un interruptor que hay que acordarse de
 *  encender no es un camino, es una nota. */
export function realImageEditTransport(
  fetchImpl: typeof fetch = fetch,
  env: Readonly<Record<string, string | undefined>> = process.env,
): (input: ImageEditInput) => Promise<ImageEditOutcome> {
  return env.OPENLEN_IMAGE_EDIT_PROVIDER?.trim().toLowerCase() === "gemini"
    ? geminiImageEditTransport(fetchImpl)
    : openaiImageEditTransport(fetchImpl);
}
