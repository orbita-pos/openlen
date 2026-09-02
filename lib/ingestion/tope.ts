// lib/ingestion/tope.ts — la puerta de las dos rutas que ingieren HTML.
//
// 🔴 POR QUÉ EXISTE, y por qué en UN sitio. `from-html` y `from-template` no
// gastan una llamada de modelo, así que no las frena ni el crédito ni la cuota
// de generación. Pero SÍ arrancan Chromium: el transform de ingestión abre un
// navegador por documento, y un clon de una plantilla de 6 páginas son SIETE
// arranques. Las dos rutas estaban sin ninguna puerta.
//
// Va en un módulo compartido y no copiado en cada `route.ts` por la lección que
// este repo lleva escrita en media docena de sitios: lo que vive duplicado en
// dos rutas deriva, y aquí derivar significa que una de las dos puertas se queda
// abierta sin que nadie se entere. Una sola función, un solo tope.

import { PLAN_LIMITS, checkAndConsume, getUserPlan, userLimitKey } from "@/lib/limits";

/**
 * Consume una unidad del tope de ingestión de este usuario.
 *
 * Devuelve `null` cuando puede pasar, o la `Response` 429 ya montada cuando no
 * — mismo cuerpo que el 429 de `/api/generate`, para que el cliente no tenga
 * que aprenderse dos formas de la misma negativa.
 */
export async function topeDeIngestion(userId: string): Promise<Response | null> {
  const plan = await getUserPlan(userId);
  const decision = await checkAndConsume(
    userLimitKey(userId, "ingest"),
    PLAN_LIMITS[plan].ingest,
  );
  if (decision.ok || !decision.blocked) return null;
  return new Response(
    JSON.stringify({
      error: "quota_exceeded",
      scope: decision.blocked.label,
      plan,
      max: decision.blocked.max,
      windowMs: decision.blocked.windowMs,
      resetAt: decision.resetAt?.toISOString(),
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(
          Math.max(
            1,
            Math.ceil(
              ((decision.resetAt?.getTime() ?? Date.now() + 60_000) - Date.now()) / 1000,
            ),
          ),
        ),
      },
    },
  );
}
