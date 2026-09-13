import {
  calculateImageUsageMicromxn,
  calculateModelUsageMicromxn,
  type ImageUsage,
  type ModelTokenUsage,
  type ProductionImageRate,
  type ProductionModelRate,
} from "./model-cost";

// PRECIOS DE LISTA de Fireworks, en USD por millón de tokens.
//
// 🔴 DOS FILAS ESTABAN CON LAS CIFRAS PRE-CORRECCIÓN, y llevaban así desde el
// 2026-08-28. Ese día `lib/credits.ts` cuadró su tabla contra la factura real
// (docs.fireworks.ai/serverless/pricing · Standard) y corrigió las dos; ESTA
// tarjeta no se movió, mientras el comentario de allá seguía afirmando «misma
// tarjeta que FABLE_PRODUCTION_RATES». Dos verdades duplicadas y una se quedó
// atrás — la forma que este repo lleva tres correcciones persiguiendo.
//
//   deepseek-v4-flash-0731   .14/.028/.28  ->  .22/.007/.66   (salida 2,36x)
//   qwen3p7-plus             .50/.10/3.00  ->  .40/.08/1.60   (salida 0,53x)
//
// Van en direcciones OPUESTAS, así que no era un factor mal aplicado: eran los
// números viejos, tal cual. El de qwen es literalmente el que `credits.ts`
// señala como equivocado en su propio comentario («iba al revés: 0.50/3.00
// contra 0.40/1.60 reales»).
//
// ⚠️ ESTO APRIETA EL GUARDIA. Con la salida de DeepSeek a 2,36x, una corrida
// que antes cabía en su tope puede dejar de caber. Es lo correcto: el tope
// estaba midiendo con una regla corta, y un tope calculado sobre el precio
// equivocado no es un tope. Confirmado por Jesús el 2026-09-13: son precios de
// LISTA, no contratados.
//
// La guarda contra que vuelva a pasar está en la prueba de este fichero: ata
// cada fila a `lib/credits.ts`, que es la tabla con la que de verdad se cobra.
export const FABLE_PRODUCTION_RATES = Object.freeze({
  "accounts/fireworks/models/deepseek-v4-flash-0731": Object.freeze({ input: .22, cached: .007, output: .66 }),
  // ⚠️ SIN AUTORIDAD CON QUE CUADRARLO: el papel `designer` se retiró el
  // 2026-09-06 y con él este modelo, así que no tiene fila en `credits.ts`. Se
  // deja como estaba —nadie lo corre— y lo sigue nombrando el contrato del
  // runbook de paridad. Si algún día vuelve a correr, hay que verificarlo.
  "accounts/fireworks/models/glm-5p2": Object.freeze({ input: 1.40, cached: .26, output: 4.40 }),
  // Ya no lo corre ningún papel (la visión pasó a v4.1 Flash el 2026-09-12),
  // pero el precio se corrige igual: una cifra que se queda es una cifra que
  // alguien va a creerse.
  "accounts/fireworks/models/qwen3p7-plus": Object.freeze({ input: .40, cached: .08, output: 1.60 }),
  // El papel con VISIÓN desde el 2026-09-12 (`qwen3p7-plus` devolvía 404). Sin
  // esta fila el guardia de presupuesto tira «unknown text model» en cuanto un
  // turno lleva una imagen: la tarjeta se consulta por modelId.
  //
  // Al precio de lista, el mismo que `deepseek-flash` en `lib/credits.ts`.
  "accounts/fireworks/models/deepseek-v4p1-flash": Object.freeze({ input: .22, cached: .007, output: .66 }),
  "gemini-2.5-flash-image": Object.freeze({ image: .039 }),
});

/**
 * Precios PRIORITY de Fireworks, en USD por millón de tokens.
 *
 * Es la tarjeta estándar por 1,25 — la vía Priority cuesta un 25% más (ver el
 * aviso de `serviceTier` en `fireworks-stream-client.ts`, donde está medido qué
 * compra y qué no). La fila anterior también era exactamente 1,25x, sólo que
 * sobre la base EQUIVOCADA: .14x1.25=.175, .028x1.25=.035, .28x1.25=.35. Al
 * corregir el estándar había que recalcularla o habría quedado siendo un 25%
 * más que un precio que ya no existe.
 */
export const FABLE_PRIORITY_RATES = Object.freeze({
  "accounts/fireworks/models/deepseek-v4-flash-0731": Object.freeze({ input: .275, cached: .00875, output: .825 }),
});

export type ModelServiceTier = "standard" | "priority";

export type PlannedPaidCall =
  | { kind: "model"; modelId: string; serviceTier?: ModelServiceTier; maxInputTokens: number; maxOutputTokens: number }
  | { kind: "image"; modelId: string; imageCount: number };

export interface RedactedPageCost {
  rateCardVersion: string;
  targetMicromxn: number;
  capMicromxn: number;
  actualMicromxn: number;
  reservedMicromxn: number;
  modelUsage: readonly (ModelTokenUsage & { modelId: string; serviceTier?: ModelServiceTier; costMicromxn: number })[];
  imageUsage: readonly (ImageUsage & { modelId: string; costMicromxn: number })[];
}

export interface PageBudget {
  reserve(call: PlannedPaidCall): { ok: true; leaseId: string } | { ok: false; code: "budget_exceeded" };
  complete(leaseId: string, usage: ModelTokenUsage | ImageUsage): void;
  snapshot(): RedactedPageCost;
}

export interface PageBudgetConfig {
  rateCardVersion: string;
  mxnPerUsd: number;
  targetMicromxn: number;
  capMicromxn: number;
}

type Environment = Readonly<Record<string, string | undefined>>;
type Lease = PlannedPaidCall & { reservedMicromxn: number };

function positiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a safe positive integer`);
}

function positiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a finite positive number`);
}

function textRate(modelId: string, serviceTier: ModelServiceTier = "standard"): ProductionModelRate {
  const rates = serviceTier === "priority" ? FABLE_PRIORITY_RATES : FABLE_PRODUCTION_RATES;
  const rate = rates[modelId as keyof typeof rates];
  if (!rate || !("input" in rate) || !("cached" in rate) || !("output" in rate)) throw new Error("unknown text model");
  positiveFinite(rate.input, "input rate");
  positiveFinite(rate.cached, "cached rate");
  positiveFinite(rate.output, "output rate");
  return rate;
}

function imageRate(modelId: string): ProductionImageRate {
  const rate = FABLE_PRODUCTION_RATES[modelId as keyof typeof FABLE_PRODUCTION_RATES];
  if (!rate || !("image" in rate)) throw new Error("unknown image model");
  positiveFinite(rate.image, "image rate");
  return rate;
}

function reservationCost(call: PlannedPaidCall, config: PageBudgetConfig): number {
  if (call.kind === "image") {
    positiveSafeInteger(call.imageCount, "imageCount");
    return calculateImageUsageMicromxn({ imageCount: call.imageCount }, imageRate(call.modelId), config.mxnPerUsd);
  }
  positiveSafeInteger(call.maxInputTokens, "maxInputTokens");
  positiveSafeInteger(call.maxOutputTokens, "maxOutputTokens");
  return calculateModelUsageMicromxn({
    inputTokens: call.maxInputTokens,
    cachedTokens: 0,
    outputTokens: call.maxOutputTokens,
    thinkingTokens: 0,
  }, textRate(call.modelId, call.serviceTier), config.mxnPerUsd);
}

function validateConfig(config: PageBudgetConfig): void {
  if ("rates" in config) throw new Error("production rates are fixed");
  if (!config.rateCardVersion.trim()) throw new Error("rateCardVersion is required");
  positiveFinite(config.mxnPerUsd, "mxnPerUsd");
  positiveSafeInteger(config.targetMicromxn, "targetMicromxn");
  positiveSafeInteger(config.capMicromxn, "capMicromxn");
  if (config.targetMicromxn !== 5_000_000 || config.capMicromxn !== 10_000_000) {
    throw new Error("page target/cap must be exactly 5000000/10000000 micromxn");
  }
  for (const modelId of Object.keys(FABLE_PRODUCTION_RATES)) {
    if (modelId === "gemini-2.5-flash-image") imageRate(modelId);
    else textRate(modelId);
  }
  for (const modelId of Object.keys(FABLE_PRIORITY_RATES)) textRate(modelId, "priority");
}

export function createPageGenerationBudget(config: PageBudgetConfig): PageBudget {
  validateConfig(config);
  const leases = new Map<string, Lease>();
  const modelUsage: Array<ModelTokenUsage & { modelId: string; serviceTier?: ModelServiceTier; costMicromxn: number }> = [];
  const imageUsage: Array<ImageUsage & { modelId: string; costMicromxn: number }> = [];
  let actualMicromxn = 0;
  let reservedMicromxn = 0;
  let nextLease = 1;

  return {
    reserve(call) {
      const cost = reservationCost(call, config);
      if (cost > config.capMicromxn - actualMicromxn - reservedMicromxn) return { ok: false, code: "budget_exceeded" };
      const leaseId = `page-cost-${nextLease++}`;
      leases.set(leaseId, { ...call, reservedMicromxn: cost });
      reservedMicromxn += cost;
      return { ok: true, leaseId };
    },
    complete(leaseId, usage) {
      const lease = leases.get(leaseId);
      if (!lease) throw new Error("unknown or completed budget lease");
      leases.delete(leaseId);
      reservedMicromxn -= lease.reservedMicromxn;
      try {
        if (lease.kind === "model") {
          const cost = calculateModelUsageMicromxn(usage as ModelTokenUsage, textRate(lease.modelId, lease.serviceTier), config.mxnPerUsd);
          if (cost > lease.reservedMicromxn) throw new Error("reported usage exceeds reservation");
          actualMicromxn += cost;
          modelUsage.push({
            ...(usage as ModelTokenUsage),
            modelId: lease.modelId,
            ...(lease.serviceTier === "priority" ? { serviceTier: "priority" as const } : {}),
            costMicromxn: cost,
          });
        } else {
          const image = usage as ImageUsage;
          if (!Number.isSafeInteger(image?.imageCount) || image.imageCount < 0 || image.imageCount > lease.imageCount) throw new Error("complete image usage is required");
          const cost = image.imageCount === 0 ? 0 : calculateImageUsageMicromxn(image, imageRate(lease.modelId), config.mxnPerUsd);
          actualMicromxn += cost;
          imageUsage.push({ imageCount: image.imageCount, modelId: lease.modelId, costMicromxn: cost });
        }
      } catch (error) {
        actualMicromxn += lease.reservedMicromxn;
        throw error;
      }
    },
    snapshot() {
      return {
        rateCardVersion: config.rateCardVersion,
        targetMicromxn: config.targetMicromxn,
        capMicromxn: config.capMicromxn,
        actualMicromxn,
        reservedMicromxn,
        modelUsage: modelUsage.map((usage) => ({ ...usage })),
        imageUsage: imageUsage.map((usage) => ({ ...usage })),
      };
    },
  };
}

/**
 * Los nombres NUEVOS, y el viejo como respaldo.
 *
 * Esto se llamaba `OPENLEN_FABLE_*` y el nombre mentía: el presupuesto es de
 * una PÁGINA, no de un proveedor — la tarifa se aplica igual escriba DeepSeek,
 * GLM o Qwen. Jesús, 2026-08-27: «esa política nomás molesta para hacer las
 * cosas».
 *
 * Se lee primero el nombre nuevo y se cae al viejo, EN VEZ de cambiarlo a secas:
 * las viejas están puestas en el box de producción, y un despliegue que las
 * renombrara dejaría la ruta que las lee lanzando en el primer request — un
 * fallo que no se ve en local, sólo en producción y sólo al usarla.
 *
 * El respaldo se retira cuando el box tenga los nombres nuevos; hasta entonces
 * su presencia es lo que hace que renombrar sea seguro y no una apuesta.
 */
const CLAVES = {
  rateCard: ["OPENLEN_PAGE_RATE_CARD_VERSION", "OPENLEN_FABLE_RATE_CARD_VERSION"],
  mxnPerUsd: ["OPENLEN_PAGE_MXN_PER_USD", "OPENLEN_FABLE_MXN_PER_USD"],
  target: ["OPENLEN_PAGE_TARGET_MICROMXN", "OPENLEN_FABLE_PAGE_TARGET_MICROMXN"],
  cap: ["OPENLEN_PAGE_CAP_MICROMXN", "OPENLEN_FABLE_PAGE_CAP_MICROMXN"],
} as const;

/** El primer nombre que tenga valor, y el nombre que se usó — para que el error
 *  hable del que el operador tiene que poner, no del que ya no existe. */
function leer(env: Environment, claves: readonly string[]): { clave: string; valor: string } | null {
  for (const clave of claves) {
    const valor = env[clave];
    if (valor?.trim()) return { clave, valor };
  }
  return null;
}

export function parsePageBudgetConfigFromEnv(env: Environment = process.env): PageBudgetConfig {
  const tarjeta = leer(env, CLAVES.rateCard);
  if (!tarjeta) throw new Error(`${CLAVES.rateCard[0]} is required`);
  const config = {
    rateCardVersion: tarjeta.valor.trim(),
    mxnPerUsd: numeroRequerido(env, CLAVES.mxnPerUsd),
    targetMicromxn: numeroRequerido(env, CLAVES.target),
    capMicromxn: numeroRequerido(env, CLAVES.cap),
  };
  validateConfig(config);
  return config;
}

function numeroRequerido(env: Environment, claves: readonly string[]): number {
  const encontrado = leer(env, claves);
  if (!encontrado) throw new Error(`${claves[0]} is required`);
  const value = Number(encontrado.valor);
  if (!Number.isFinite(value)) throw new Error(`${encontrado.clave} must be finite`);
  return value;
}
