import { and, eq, isNull, sql as sqlOp } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Plan } from "@/lib/limits";
// La unidad y su formateo viven en el módulo CLIENT-SAFE: los pintan
// componentes de cliente (la píldora de créditos), y este fichero importa la
// base de datos. Mismo criterio que `lib/templates/families.ts`.
import {
  CENTICREDITOS_POR_CREDITO,
  USD_PER_CREDIT,
  formatCredits,
  usdDeCenticreditos,
} from "@/lib/credits-client";
export { CENTICREDITOS_POR_CREDITO, USD_PER_CREDIT, formatCredits, usdDeCenticreditos };

// ─────────────────────────────────────────────────────────────────────────────
// Credit accounting for AI operations.
//
// Every AI call (page generation, chat edit, autofill) debits credits. One
// credit ≈ $0.01 of raw model cost — the charge is computed from the real
// token volume, so a big page costs more credits than a small one. The plan
// PRICE embeds the markup: Pro is $3.99/mo for 150 credits (≈$1.50 of raw cost
// if fully spent, ~75 pages at the rates below); a free user is capped at 20
// credits (~$0.20) — about 10 pages, the "try-it" funnel before the upgrade.
//
// 🔴 EL MARGEN YA NO ES «ANCHO», y esta línea lo decía. Bajado a $3.99 el
// 2026-08-29, con la comisión REAL de Polar (Starter: 5% + 50¢, y +1.5% si la
// tarjeta no es de EE.UU., que es el caso normal aquí) el neto es $3.23. Un
// usuario que queme sus 150 créditos deja $1.73: el 46% se lo lleva el modelo,
// no el 21% de antes. Sigue siendo positivo en el PEOR caso —que es la prueba
// que importa— pero subir el allotment sin rehacer esta cuenta es lo que lo
// rompe. Los 50¢ fijos son el 12.5% del precio: por eso el plan ANUAL, cuando
// exista, no es sólo un descuento, es la misma venta pagando el fijo una vez.
//
// Las cifras de páginas salen de las tarifas corregidas el 2026-08-28: crear
// una página son ~2 créditos. Las viejas («10 generaciones Pro», «~1 Pro» en
// el plan gratis) estaban calibradas para Gemini Pro y sobrevivieron al cambio
// de proveedor — la landing las estuvo vendiendo así hasta hoy.
//
// v1 is a monthly RESET (no rollover): the first balance read after 30 days
// sets the balance back to the plan allotment. Rollover-with-expiry would
// need a per-grant ledger — deferred to v2.
// ─────────────────────────────────────────────────────────────────────────────


/** Monthly credit allotment per plan. */
export const CREDITS_BY_PLAN: Record<Plan, number> = {
  free: 20 * CENTICREDITOS_POR_CREDITO,
  pro: 150 * CENTICREDITOS_POR_CREDITO,
};

/** Flat charge for an autofill / style-match run. Cheap + occasional, so it
 *  isn't token-metered like generate / chat. */
export const AUTOFILL_CREDIT_COST = 5 * CENTICREDITOS_POR_CREDITO;

/** Cargo PLANO por una edición de imagen con IA. Se cobra sólo si la edición
 *  sale bien.
 *
 *  Plano y no por tokens porque la salida de imagen se factura por IMAGEN, no
 *  por las tarifas de texto. Eso no ha cambiado; el número sí.
 *
 *  🔴 CORREGIDO el 2026-08-28: eran 4, calibrados para «Gemini 2.5 Flash Image»
 *  —lo decía el propio comentario— y el editor corre `gpt-image-2` desde este
 *  mismo día. Cuarta vez en la sesión que la tarifa no seguía a quien corre.
 *
 *  gpt-image-2 en calidad `medium`, 1024²: $0.053 por la tabla por imagen de
 *  OpenAI, $0.032 derivado de tokens ($30/1M × ~1.056). Las dos fuentes no
 *  cuadran, así que se toma la CARA — y encima editar factura la imagen de
 *  origen como entrada de alta fidelidad, que va sobre cualquiera de las dos.
 *  A 4 créditos ($0.040) esto perdía dinero en cada edición.
 *
 *  Y NO SE BAJA LA CALIDAD PARA ABARATARLO. Se midió `low` ($0.006, 1 crédito)
 *  con la misma foto y la misma instrucción: es 2x más rápida y no sirve.
 *  Reimagina en vez de editar — la instrucción decía «conservando las tres
 *  formas exactamente donde están» y las movió todas, deformando la esfera. En
 *  una herramienta de EDICIÓN la fidelidad al original es el trabajo entero:
 *  devolverle a alguien su producto redibujado no es haberle editado la foto.
 *  Ver `.claude/qa/calidad-low.webp` contra `calidad-media.webp`. */
export const AI_IMAGE_EDIT_CREDIT_COST = 6 * CENTICREDITOS_POR_CREDITO;

/** Flat charge for one 3D scene spec generation via Gemini. The Gemini call
 *  is a short structured-JSON output (~800 tokens total) — cost is well under
 *  1 credit, rounded up to 3 to cover variance and future model upgrades.
 *  Debited only on a successful live (gemini) generation; mock is free. */
export const SCENE_3D_CREDIT_COST = 3 * CENTICREDITOS_POR_CREDITO;

/** Quality S2 multimodal reference — upper bound on the extra cost of the
 *  reference image attached to a generate / chat-edit call. NO separate debit
 *  is applied: the image is sent as a native `inlineData` part, so its input
 *  tokens are already included in the `promptTokenCount` Gemini reports and
 *  are billed automatically by `creditsForUsage`. A 1280-wide full-page JPG
 *  costs ≈258–516 image tokens on Flash (~free) and ≈$0.002 on Pro — under
 *  one credit either way, hence this generous round-up. Gemini does NOT cache
 *  user-message images across calls (unlike Anthropic), so every request
 *  re-sends the bytes; at this token volume the cost is negligible. This
 *  constant exists for documentation / future surfacing, not for debiting. */
export const REFERENCE_IMAGE_CREDIT_OVERHEAD = 1 * CENTICREDITOS_POR_CREDITO;

/** Quality S3 vision critic — credit overhead when the critic triggers a
 *  regeneration. Like REFERENCE_IMAGE_CREDIT_OVERHEAD this is DOCUMENTATION,
 *  not a separate debit: the regen runs a full second `generateHtmlStream`
 *  pass, so its real token cost is metered + debited automatically by that
 *  pass's `usage` event via `creditsForUsage` — exactly like the first pass.
 *  The critic call itself is NOT debited (its image input is ~free on Flash
 *  and its output is a tiny JSON verdict).
 *
 *  EL PEOR CASO REAL SON TRES PASADAS, no dos — este comentario decía dos y
 *  se equivocaba. La secuencia alcanzable: pasada inicial que sale truncada o
 *  con basura → reintento automático (`initial-retry`, 1 de cada 20) → y luego
 *  UNA mejora, sea por rotura medida en el render o por el crítico. Las dos
 *  mejoras comparten presupuesto (`mejoraGastada` en /api/generate), así que
 *  nunca son dos; el reintento no entra en ese presupuesto porque sin él el
 *  usuario se queda sin página. Este `+1` sigue siendo lo que cuesta la
 *  mejora; el reintento es la excepción que faltaba escribir. */
export const REGEN_CREDIT_OVERHEAD = 1 * CENTICREDITOS_POR_CREDITO;



/** Rough chars-per-token (code/HTML is dense). Only used by the
 *  estimateCredits fallback — the real path counts exact tokens. */
const CHARS_PER_TOKEN = 3;

// Real provider pricing in USD per 1M tokens. Credits are billed from the
// EXACT token usage the provider reports (creditsForUsage), so these are
// honest per-token prices — verify them against the providers' pricing pages.
//
// 🔴 LAS TRES DE FIREWORKS SE VERIFICARON CONTRA LA TABLA CANÓNICA el
// 2026-08-28 (docs.fireworks.ai/serverless/pricing, nivel Standard), y DOS
// estaban mal en direcciones opuestas: DeepSeek Flash cobraba de menos y Qwen
// de más. Una tarifa equivocada no se ve nunca — el redondeo a crédito la tapa
// en los turnos chicos y sólo asoma en uno concreto—, así que hay una prueba
// que las fija con su fuente y su fecha. Si Fireworks mueve el precio, la
// prueba no se entera: lo que impide es que las movamos NOSOTROS sin querer.
//
// ⚠️ CADUCÓ. Este párrafo decía que la entrada CACHEADA «no entra en el cobro a
// propósito» y que eso «nos da margen». Ya no es cierto: `creditsForUsage`
// RESTA los cacheados y los cobra a su tarifa —lo hace ahí abajo, y su propio
// comentario lo explica—. Lo que queda en pie es la advertencia de al lado: los
// cacheados son un SUBCONJUNTO de la entrada, no un extra.
//
// Se corrige el 2026-08-30 porque este texto costó una tarde. Cuadrando el
// gasto del día contra la factura de Fireworks —4,35M tokens nuestros contra
// 4,7M suyos, y $2,54 reales contra $5,90 declarados— llegué a sospechar que la
// TABLA estaba al doble. No lo estaba: el error vivía en el medidor
// (`scripts/agent-eval.ts`, que cobraba la entrada entera sin descontar), y
// este comentario apuntaba en la dirección equivocada mientras tanto.
// The /generate and /ai-design routes log the real token counts per call:
// if a known-cost run doesn't line up, adjust the numbers here.
// Gemini 2.5 pricing per 1M tokens (verify against ai.google.dev/pricing).
const RATES = {
  "gemini-pro": { input: 1.25, output: 10 },
  "gemini-flash": { input: 0.3, output: 2.5 },
  // Fireworks, precio estándar (misma tarjeta que FABLE_PRODUCTION_RATES).
  // Existe porque el Chat y el Agente pasaron a DeepSeek y seguían cobrándose a
  // tarifa de Gemini, donde la salida cuesta casi NUEVE veces más. Un crédito
  // vale un centavo y el cargo se redondea hacia arriba, así que el error no se
  // ve en los turnos cortos —el de una herramienta suelta cae en 1 crédito por
  // cualquiera de las dos tarifas— y aparece justo en los que escriben HTML:
  // con ~20k de entrada, a partir de ~1,600 tokens de salida Gemini cobra 2
  // créditos donde DeepSeek cobra 1. Editar una sección pasa ese umbral.
  // El proveedor que corrió el turno es el que tiene que pagar el turno.
  //
  // 🔴 CORREGIDA el 2026-08-28. Decía 0.14/0.28 y lo real es 0.22/0.66: la
  // salida se cobraba a MENOS DE LA MITAD. El efecto no se reparte parejo —
  // el redondeo a crédito lo absorbe casi todo— y cae entero en un sitio:
  //
  //     crear una página (~22k in, ~9k out)   1 crédito  ->  2
  //     editar por Chat  (~20k in, ~3k out)   1          ->  1
  //     turno pesado     (~60k in, ~8k out)   2          ->  2
  //
  // O sea que el plan FREE de 20 créditos no daba 20 páginas al mes, daba 10.
  // La cifra de "1 crédito por página" que se midió en su día salía de esta
  // tarifa equivocada.
  "deepseek-flash": { input: 0.22, output: 0.66, cached: 0.007 },
  // El Agente, y SÓLO el Agente: es el único papel que corre en Pro (ver
  // MODEL_POLICY.agent). Tarifa estándar de docs.fireworks.ai/serverless/pricing,
  // 2026-08-28 — 6x la de Flash, parejo en entrada y salida.
  //
  // Tiene entrada propia en vez de cobrarse como `deepseek-flash` por la misma
  // razón que la tiene `qwen-vision`: el proveedor que corrió el turno es el que
  // tiene que pagar el turno. Cobrar Pro a precio de Flash escondería un 6x.
  "deepseek-pro": { input: 1.32, output: 3.96, cached: 0.044 },
  // Qwen, el papel con VISIÓN. Sólo corre en los turnos que llevan una imagen
  // adjunta (una referencia de estilo), y su salida cuesta ~10x la de DeepSeek:
  // por eso tiene tarifa propia en vez de cobrarse como si fuera el razonador.
  //
  // 🔴 CORREGIDA el 2026-08-28, y ésta iba al revés: 0.50/3.00 contra 0.40/1.60
  // reales. Se cobraba de MÁS, casi el doble en salida, justo en el turno que
  // más se nota — adjuntar una referencia pasaba de 2 créditos a 4 sin que
  // costara eso. Un turno con imagen no es 10x el del razonador, es ~2.4x.
  "qwen-vision": { input: 0.40, output: 1.60, cached: 0.08 },
} as const;

export type CreditRate = keyof typeof RATES;

/** La tarifa en dólares por millón de tokens, de la MISMA tabla con la que se
 *  cobra. La exponen `scripts/evals-pages.ts` y `scripts/agent-eval.ts` para
 *  calcular lo que cuesta una corrida: los dos tenían las cifras cableadas —y
 *  las de OTRO proveedor—, así que su tope de gasto estaba calculado sobre un
 *  precio que no era el real. Un tope con la tarifa equivocada no es un tope.
 *
 *  Devuelve la tarifa ENTERA, `cached` incluida. El tipo la recortaba, y eso
 *  no es un detalle de tipos: un llamador que calcula gasto sin la cacheada lo
 *  sobreestima entre 5x y 31x en la parte que sí se cachea. `cached?` es
 *  opcional porque las entradas de Gemini no la llevan. */
export function creditRate(
  rate: CreditRate,
): { input: number; output: number; cached?: number } {
  return RATES[rate];
}

/** Credits renew on a rolling 30-day window anchored to creditsRefreshedAt. */
export const REFILL_MS = 30 * 24 * 60 * 60 * 1000;

export function creditRefillAt(refreshedAt: Date): Date {
  return new Date(refreshedAt.getTime() + REFILL_MS);
}

export interface CreditState {
  plan: Plan;
  balance: number;
  /** The plan's monthly allotment. */
  allotment: number;
  /** Exact instant when the current rolling 30-day window renews. */
  refillsAt: Date | null;
}

export type CreditGateContext = "create" | "existing";

const CREDIT_REFILL_DATE = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** One source of truth for the three AI-surface credit gates. */
export function noCreditsMessage(
  state: Pick<CreditState, "refillsAt">,
  context: CreditGateContext,
): string {
  const savedCopy =
    context === "create"
      ? "Aún no se creó una página nueva; tus páginas existentes siguen guardadas y puedes publicarlas."
      : "Tu página está guardada y puedes publicarla ahora.";
  const refillCopy = state.refillsAt
    ? `Vuelven el ${CREDIT_REFILL_DATE.format(state.refillsAt)} (UTC)`
    : "Se renuevan cada 30 días";
  // LA SALIDA DE HOY, no sólo la fecha. Este mensaje decía cuándo vuelven los
  // créditos y nada más: un callejón, justo en el momento en que alguien
  // quiere seguir. Pro existe y su checkout está cableado
  // (`/api/billing/checkout`), así que callarlo no protegía a nadie.
  //
  // Ojo con el alcance: esto es el RESPALDO para clientes que no son el
  // nuestro. El nuestro localiza por `code: "no_credits"` + `refillsAt` y
  // compone en el idioma del usuario (`lib/credits-client.ts`), que es donde
  // vive la copia que la gente lee de verdad.
  return `Te quedaste sin créditos. ${savedCopy} ${refillCopy} — o pásate a Pro para seguir hoy.`;
}

/**
 * Read the user's credit balance, lazily resetting it to the plan allotment
 * when a month has elapsed (or on the very first read of a fresh account).
 * Returns the post-refill state.
 */
export async function getCreditState(userId: string): Promise<CreditState> {
  const rows = await db
    .select({
      plan: schema.users.plan,
      credits: schema.users.credits,
      refreshedAt: schema.users.creditsRefreshedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const row = rows[0];
  const plan: Plan = row?.plan === "pro" ? "pro" : "free";
  const allotment = CREDITS_BY_PLAN[plan];
  if (!row) return { plan, balance: 0, allotment, refillsAt: null };

  const now = new Date();
  const refreshedAt = row.refreshedAt;
  if (
    refreshedAt === null ||
    now.getTime() - refreshedAt.getTime() >= REFILL_MS
  ) {
    // Compare-and-swap the anchor. Two gates can arrive at the same expired
    // row; only one may refill it. Without this condition, the loser can run
    // after the winner's turn debits and silently restore the spent credits.
    const [refilled] = await db
      .update(schema.users)
      .set({ credits: allotment, creditsRefreshedAt: now })
      .where(
        and(
          eq(schema.users.id, userId),
          eq(schema.users.plan, row.plan),
          refreshedAt === null
            ? isNull(schema.users.creditsRefreshedAt)
            : eq(schema.users.creditsRefreshedAt, refreshedAt),
        ),
      )
      .returning({
        plan: schema.users.plan,
        credits: schema.users.credits,
        refreshedAt: schema.users.creditsRefreshedAt,
      });
    if (!refilled) {
      // A concurrent refill (or plan change) won. Read its post-change state;
      // never manufacture the allotment from our stale snapshot.
      return getCreditState(userId);
    }
    const refilledPlan: Plan = refilled.plan === "pro" ? "pro" : "free";
    return {
      plan: refilledPlan,
      balance: refilled.credits,
      allotment: CREDITS_BY_PLAN[refilledPlan],
      refillsAt: creditRefillAt(refilled.refreshedAt ?? now),
    };
  }
  return {
    plan,
    balance: row.credits,
    allotment,
    refillsAt: creditRefillAt(refreshedAt),
  };
}

/**
 * Debit credits, clamped at zero. The pre-call check only guarantees ≥1
 * credit (the real cost isn't known until the call finishes), so a single
 * operation can legitimately spend a balance down to 0.
 */
export async function debitCredits(
  userId: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  await db
    .update(schema.users)
    .set({ credits: sqlOp`GREATEST(0, ${schema.users.credits} - ${amount})` })
    .where(eq(schema.users.id, userId));
}

/**
 * DEVOLVER LO COBRADO POR ALGO QUE NO SE ENTREGÓ.
 *
 * 🔴 POR QUÉ HACE FALTA. El cargo de una generación se hace DENTRO del stream,
 * en el evento `usage`, y la puerta del documento (`preparePage`) corre DESPUÉS,
 * en la ruta. Así que una página que la puerta rechaza —marcadores de modo
 * editor, invariantes rotos— ya está cobrada cuando se decide no guardarla: el
 * usuario paga y no recibe nada. Cobrar por lo que no se entrega es la versión
 * de caja del defecto que este repo persigue en todas partes.
 *
 * SUMA, no resta con signo: `debitCredits` corta en `amount <= 0`, así que
 * pasarle un negativo no devuelve nada — se quedaría en un no-op silencioso.
 *
 * No lleva tope por arriba a propósito. Lo que se devuelve se acaba de restar
 * del mismo contador y hace un instante, así que el único escenario en el que
 * sobrepasaría el saldo del plan es una recarga concurrente en esa ventana —
 * que se corrige sola en el siguiente refill y cuyo coste medido es de céntimos
 * (una página entera vale 1 crédito). Poner un `LEAST` exigiría leer el plan
 * aquí, y un cobro indebido que no se devuelve es peor que un céntimo de más.
 */
export async function refundCredits(
  userId: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  await db
    .update(schema.users)
    .set({ credits: sqlOp`${schema.users.credits} + ${amount}` })
    .where(eq(schema.users.id, userId));
}

/** Token usage as reported by an OpenAI-compatible streaming API. */
export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

/**
 * Exact credit charge from the token usage the provider reports — no
 * chars→tokens estimation. This is the real billing path. Rounded up, min 1.
 */
export function creditsForUsage(
  promptTokens: number,
  completionTokens: number,
  model: keyof typeof RATES = "gemini-pro",
  cachedTokens = 0,
): number {
  const rate = RATES[model];
  // LOS CACHEADOS SON UN SUBCONJUNTO de la entrada, no un extra. Lo fija el
  // propio validador de `fireworks-client.ts`, que RECHAZA una respuesta con
  // `cachedTokens > inputTokens`. Restarlos mal en el otro sentido cobraría dos
  // veces la misma parte del prompt.
  //
  // Sin tarifa cacheada (Gemini) no se descuenta nada: se cobra todo a precio
  // sin cachear, que es lo que se hacía siempre. Mejor cobrar de más a un
  // proveedor que ya no corre por defecto que inventarse un descuento.
  const tarifaCacheada = tarifaCached(rate);
  const cacheados = tarifaCacheada === undefined ? 0 : clampCached(cachedTokens, promptTokens);
  const sinCachear = promptTokens - cacheados;
  const usd =
    (sinCachear * rate.input
      + cacheados * (tarifaCacheada ?? rate.input)
      + completionTokens * rate.output) / 1_000_000;
  // En CENTICRÉDITOS: se divide por lo que vale uno, no por lo que vale un
  // crédito. El suelo de 1 sigue siendo un suelo — pero de 0,01 créditos.
  return Math.max(1, Math.ceil(usd / (USD_PER_CREDIT / CENTICREDITOS_POR_CREDITO)));
}

/** La tarifa cacheada, si la hay. `"cached" in r` estrecha la unión de la
 *  tabla; las entradas de Gemini no la llevan y ahí no se descuenta nada.
 *
 */
function tarifaCached(r: (typeof RATES)[CreditRate]): number | undefined {
  return "cached" in r ? r.cached : undefined;
}

/** Un `cachedTokens` imposible (negativo, mayor que la entrada, NaN) no puede
 *  convertirse en un descuento. El validador del cliente ya lo rechaza aguas
 *  arriba, pero esta función la llaman cuatro rutas y una de ellas podría
 *  pasarle cualquier cosa el día que alguien cambie el transporte. */
function clampCached(cached: number, prompt: number): number {
  if (!Number.isFinite(cached) || cached <= 0) return 0;
  return Math.min(Math.floor(cached), Math.max(0, prompt));
}

/**
 * Fallback charge for when the provider omits a usage report — estimates
 * token counts from text length, then prices them via creditsForUsage. With
 * stream usage enabled this should rarely run.
 */
export function estimateCredits(
  inputChars: number,
  outputChars: number,
  model: keyof typeof RATES = "gemini-pro",
): number {
  return creditsForUsage(
    Math.round(inputChars / CHARS_PER_TOKEN),
    Math.round(outputChars / CHARS_PER_TOKEN),
    model,
  );
}
