import { auth } from "@/auth";
import { createFireworksJsonClient } from "@/lib/ai/fireworks-client";
import {
  createPageGenerationBudget,
  parseFablePageBudgetConfigFromEnv,
} from "@/lib/generation/page-generation-budget";
import { consumeToken, RATE_LIMITS, rateLimitedResponse } from "@/lib/rate-limit";
import { directionToBriefBlock } from "@/lib/style-match/direction";
import { referenceFromUrl } from "@/lib/style-match/reference";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/style-reference — "hazme una como esta".
//
// De una URL sale la DIRECCIÓN visual de esa página: paleta medida del render,
// tipografía, radios, y el carácter que Qwen vio en la captura. **Nunca su
// HTML** — eso es la línea entre inspirarse y calcar, y el bloque que se
// devuelve le dice al modelo explícitamente que escriba una página propia.
//
// Esta ruta es sólo auth + límite de tasa + JSON: la tubería vive en
// `lib/style-match/reference.ts` y se prueba sin levantar Next.
//
// DOS COSAS QUE NO SE RELAJAN:
//   · La defensa SSRF está en `fetch-puppeteer` → `validateUrl`, y revalida
//     CADA redirección. Nuestro servidor sale a internet a una dirección que
//     escribe un visitante; sin eso es un proxy abierto con nuestra IP.
//   · El motivo del bloqueo NO se detalla. Decirle "resuelve a 10.0.0.5" le
//     confirma qué hay vivo en la red interna.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Chrome tarda 4-10 s en una web real, y la visión suma. Es la operación más
 *  lenta del producto por petición, y por eso tiene su propio cubo de tasa. */
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return new Response("unauthorized", { status: 401 });

  let url: unknown;
  try {
    url = (await req.json())?.url;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (typeof url !== "string" || url.trim() === "") {
    return Response.json({ error: "missing_url" }, { status: 400 });
  }

  // ANTES de lanzar Chrome: es lo caro, y un token quemado por una URL basura
  // sería castigar al usuario por un error de tecleo. Pero va antes del trabajo,
  // no después, o el límite no limitaría nada.
  const rate = consumeToken(`style-ref:${userId}`, RATE_LIMITS.styleReference);
  if (!rate.allowed) return rateLimitedResponse(rate, "referencias");

  // El presupuesto de página es obligatorio en el cliente y es lo que impide
  // que una referencia cara se lleve por delante el crédito de la generación.
  // Si no se puede construir (config ausente), se sigue SIN visión: la
  // dirección medida no cuesta nada y vale por sí sola.
  let client;
  try {
    client = createFireworksJsonClient({
      budget: createPageGenerationBudget(parseFablePageBudgetConfigFromEnv()),
    });
  } catch {
    client = undefined;
  }

  const requestId = `styleref.${Math.random().toString(36).slice(2, 12)}`;
  const result = await referenceFromUrl(url.trim(), { requestId, ...(client ? { client } : {}) });

  if (!result.ok) {
    const status = result.error.code === "blocked" ? 400 : 502;
    return Response.json({ error: result.error.code }, { status });
  }

  return Response.json({
    direction: result.direction,
    /** Ya listo para anteponer al brief — para que quien lo consuma no tenga
     *  que reconstruir el bloque y arriesgarse a saltarse el techo. */
    briefBlock: directionToBriefBlock(result.direction),
  });
}
