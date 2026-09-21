import { tarifaDe, type TarifaPorMillon } from "@/lib/ai/tarifas";

import { MODEL_POLICY } from "./model-policy";
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
// 🔴 YA NO HAY NÚMEROS ESCRITOS AQUÍ, y ése es el arreglo entero (2026-09-20).
// Esta tarjeta tenía las cifras a mano y `lib/credits.ts` las tenía a mano
// otra vez; las ataba una prueba que las comparaba ENTRE SÍ. Historial del
// defecto, tres veces en este mismo fichero:
//
//   · 2026-08-28 → 2026-09-13: `credits.ts` se cuadró contra la factura y esta
//     tarjeta no se movió. Dieciséis días midiendo con la tabla vieja.
//   · 2026-09-12 → 2026-09-20: los papeles `agent` y `visualCritic` pasaron a
//     `deepseek-v4p1-flash` y se les puso la tarifa de V4 Flash «porque cuesta
//     lo mismo». No cuesta lo mismo (0.30/0.006/1.20 contra 0.22/0.007/0.66:
//     la salida es 1,82x). **Y LA PRUEBA ESTABA VERDE**, porque las dos copias
//     decían el mismo número equivocado.
//
// Comparar dos copias no comprueba ninguna. Ahora la tarifa sale de
// `lib/ai/tarifas.ts` a través de `MODEL_POLICY`, así que no hay dos cosas que
// puedan separarse — y la prueba que las comparaba se retira por vacía.
//
// LA CLAVE SALE DE LA POLÍTICA, no de literales: es lo que ya hace
// `lib/ai/tarifas-eval.ts` desde el 2026-09-11, y por lo mismo. Con el id
// escrito a mano, cambiar el modelo de un papel dejaba esta fila tarificando
// el modelo nuevo al precio del viejo. Un papel nuevo entra en la tabla solo.
//
// ⚠️ ESTE MÓDULO NO PUEDE IMPORTAR `lib/credits.ts`: arrastraría `lib/db`
// dentro de un cálculo puro. Por eso las cifras se extrajeron a un módulo sin
// dependencias en vez de importarse de una tabla a la otra — era la razón real
// por la que estaban duplicadas.
//
// Lo que ESTE fichero no puede saber es si los números siguen siendo los de
// Fireworks. Eso lo pregunta `npm run modelos:comprobar`.
const DE_LA_POLITICA: Readonly<Record<string, ProductionModelRate>> = Object.freeze(
  Object.fromEntries(
    Object.values(MODEL_POLICY).map((papel) => {
      // `tarifaDe` y no un índice a pelo: un papel cuya `creditRate` no esté en
      // la tabla reventaba aquí como `undefined` y el fallo salía después, en
      // el cálculo del coste. Ahora dice qué papel y qué clave, al construir la
      // tarjeta, que es cuando se puede arreglar.
      const t: TarifaPorMillon = tarifaDe(papel.creditRate);
      return [papel.modelId, Object.freeze({ input: t.input, cached: t.cached ?? 0, output: t.output })];
    }),
  ),
);

export const FABLE_PRODUCTION_RATES = Object.freeze({
  ...DE_LA_POLITICA,
  // ⚠️ SIN AUTORIDAD CON QUE CUADRARLO: el papel `designer` se retiró el
  // 2026-09-06 y con él este modelo, así que no lo nombra ningún papel y no
  // tiene fila en `lib/ai/tarifas.ts`. Se queda a mano —nadie lo corre— y lo
  // sigue nombrando el contrato del runbook de paridad. Si algún día vuelve a
  // correr, hay que verificarlo contra el proveedor antes.
  "accounts/fireworks/models/glm-5p2": Object.freeze({ input: 1.40, cached: .26, output: 4.40 }),
  // ⚰️ Y aquí `qwen3p7-plus` (.40/.08/1.60), retirado el 2026-09-13 con el
  // resto de Qwen: no lo corre ningún papel desde que la visión pasó a v4.1
  // Flash, y una fila en una tarjeta se lee como un modelo que se puede usar.
  "gemini-2.5-flash-image": Object.freeze({ image: .039 }),
});

/**
 * Precios PRIORITY de Fireworks, en USD por millón de tokens.
 *
 * Es la tarjeta estándar por 1,25 — la vía Priority cuesta un 25% más (ver el
 * aviso de `serviceTier` en `fireworks-stream-client.ts`, donde está medido qué
 * compra y qué no).
 *
 * 🔴 SE CALCULA, ya no se escribe. Antes era un literal, y ya se quedó viejo
 * una vez: estuvo siendo exactamente 1,25x de una base EQUIVOCADA
 * (.14x1.25=.175, .028x1.25=.035, .28x1.25=.35), o sea un 25% más que un
 * precio que ya no existía. Había una prueba comprobando la RELACIÓN para que
 * eso no se repitiera; con la relación calculada, la prueba sobra: no hay
 * forma de mover la estándar sin mover ésta.
 *
 * La LISTA de quién tiene vía Priority sí es una decisión, no un cálculo, y
 * por eso sigue escrita.
 */
const CON_VIA_PRIORITY: readonly string[] = ["accounts/fireworks/models/deepseek-v4-flash-0731"];
const FACTOR_PRIORITY = 1.25;

/** .66 x 1.25 da 0.8250000000000001 en coma flotante, y una tarifa con cola de
 *  basura se propaga a cada coste calculado. Se redondea a la millonésima de
 *  dólar por millón de tokens, que es mucho más fino que cualquier precio que
 *  publique el proveedor. */
const redondea = (n: number): number => Math.round(n * 1e6) / 1e6;

export const FABLE_PRIORITY_RATES: Readonly<Record<string, ProductionModelRate>> = Object.freeze(
  Object.fromEntries(
    CON_VIA_PRIORITY.map((modelId) => {
      const base = DE_LA_POLITICA[modelId];
      if (!base) {
        // Un modelo con vía Priority que ningún papel nombra es una fila
        // huérfana: se rompe fuerte en vez de tarificar a cero.
        throw new Error(`${modelId} tiene vía Priority pero no lo nombra ningún papel de MODEL_POLICY`);
      }
      return [
        modelId,
        Object.freeze({
          input: redondea(base.input * FACTOR_PRIORITY),
          cached: redondea(base.cached * FACTOR_PRIORITY),
          output: redondea(base.output * FACTOR_PRIORITY),
        }),
      ];
    }),
  ),
);

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
