import type { Message, StreamEvent } from "@/lib/ai-gateway";
import {
  createFireworksStreamClient,
  type FireworksStopReason,
  type FireworksStreamClient,
  type FireworksStreamEvent,
  type FireworksStreamRequest,
} from "@/lib/ai/fireworks-stream-client";
import { resolveAgentProviders, type ProviderId, type ResolvedProvider } from "@/lib/ai/providers";
import type { WireBody } from "@/lib/ai/fireworks-stream-client";
import type { CallKind } from "@/lib/agent/telemetry/cache-break";
import { messagesForFireworks, toolsForFireworks } from "@/lib/agent/fireworks-bridge";
import { MODEL_POLICY, esfuerzoDisponible, modelIdForRole, roleForOperation } from "@/lib/generation/model-policy";
import type { CreditRate } from "@/lib/credits";
import { esfuerzoEfectivo, operatorEffort } from "./esfuerzo-efectivo";
import { caparEsfuerzo, capacidadDeEsfuerzo, type EsfuerzoAgente } from "./esfuerzo";
import { coolDown, isCooling } from "./provider-health";
import { isRetryable } from "./retry-policy";
import {
  DYNAMIS_MAX_OUTPUT_TOKENS,
  DYNAMIS_REASONING_EFFORT,
  DYNAMIS_TEMPERATURE,
  type AgentMode,
} from "./dynamis";

/**
 * Quién razona por el Agente.
 *
 * Vive aquí y no dentro de la ruta porque los evals miden el Agente, y con su
 * propio cableado medirían un proveedor que el producto ya no usa: traían una
 * copia de la elección de la ruta, y cuando el cerebro pasó de Gemini a DeepSeek
 * la copia se quedó atrás sin que nada fallara. Un solo sitio elige, y la
 * deriva deja de ser posible.
 *
 * El loop ya era agnóstico —sólo conoce TIPOS del gateway y recibe `openStream`
 * inyectado—, así que cambiar de proveedor es cambiar este archivo y nada del
 * cerebro. Aqui vivia `OPENLEN_AGENT_PROVIDER=gemini`, retirado el 2026-08-28.
 */
export interface AgentBrainOptions {
  /** Las declaraciones que se le ofrecen al modelo. (Hasta Len 2.1 podía ser una
   *  función, para que la lista CRECIERA con lo que cargaba ToolSearch; se fue
   *  con las diferidas.) */
  readonly tools: Record<string, unknown>[];
  /** Identifica la corrida ante el transporte de Fireworks (presupuesto y bitácora). */
  readonly requestId: string;
  readonly signal?: AbortSignal;
  /** EL SEGUNDO PROVEEDOR (spec local 2026-10-16-second-provider): restringe los
   *  proveedores del papel a éstos, sin reordenarlos. La revisión de seguridad
   *  pasa `["fireworks"]`. Ausente = los de `OPENLEN_AGENT_PROVIDERS`. */
  readonly providers?: readonly ProviderId[];
  /** El proveedor del turno anterior de esta charla, si acabó hace menos de
   *  10 min (lo decide la ruta): su caché sigue caliente. */
  readonly preferredProvider?: ProviderId | null;
  /** Sólo para pruebas: el cliente de cada proveedor. */
  readonly streamClientFor?: (provider: ResolvedProvider) => FireworksStreamClient;
  // ⚰️ Aquí iba `attachedImage` (los píxeles y el mensaje al que se anclaban
  // en la PRIMERA vuelta). Con A (2026-10-01) la foto va pegada a tu mensaje
  // (`Message.images`) y viaja en todas las vueltas: la pega la ruta.
  /** `OPENLEN_AGENT_EFFORT`, `OPENLEN_AGENT_PROVIDERS` y las claves de los
   *  proveedores. Ausente = `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Lo que el usuario eligió PARA ESTE TURNO (el equivalente de `/effort`). */
  readonly esfuerzoDelTurno?: EsfuerzoAgente | null;
  /** Su preferencia guardada (`users.agentEffort`). */
  readonly esfuerzoDelUsuario?: EsfuerzoAgente | null;
  /** El modo del turno (`lib/agent/dynamis.ts`). En Dynamis: temperatura 1,0,
   *  la palabra `"max"` y 65.536 de salida en todas sus llamadas. Ausente = Len. */
  readonly mode?: AgentMode;
  /** Se llama con cada trozo de razonamiento, que NO llega al loop. Es señal de
   *  vida para el reloj de silencio de la ruta: sin ella, pensar más de 3 min
   *  seguidos parecía un cuelgue y se cancelaba el turno (E del 26/09, con H5). */
  readonly alPensar?: () => void;
  /** LAYER 0 OF LEN 3.1 (spec local 2026-10-24-len-3-1-layers-0-1, §4.1): one
   *  report per call to the provider, once, when it ends. Telemetry only: an
   *  `onCall` that throws never touches the turn. */
  readonly onCall?: (call: BrainCall) => void;
}

/** One call to the provider, as the step rows record it. */
export interface BrainCall {
  readonly kind: CallKind;
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string | null;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly usage: UsageTotals | null;
  readonly stop: FireworksStopReason["kind"];
  readonly wire: WireBody | null;
}

export interface AgentBrain {
  readonly openStream: (messages: Message[]) => AsyncIterable<StreamEvent>;
  /** Herramientas APAGADAS: el loop lo usa sólo para cerrar el turno con un
   *  resumen cuando se agotó el presupuesto de pasos. */
  readonly closeOut: (messages: Message[]) => AsyncIterable<StreamEvent>;
  /** Qué modelo lleva el turno. Los evals lo cobran a su tarifa real; con el
   *  identificador equivocado el tope de gasto miente. */
  readonly modelId: string;
  /** A qué tarifa se le cobra al usuario, LEÍDA DESPUÉS del turno.
   *
   *  Es una funcion y no un campo porque una vuelta con fotos PUEDE correr en
   *  OTRO PAPEL (si el agente no ve, `operacionDeLaVuelta`), con su propia tarifa: decidir la tarifa al abrir cobraria ese
   *  turno al precio del que no corrio. Vive con el cerebro y no con la
   *  ruta porque cobrar a la tarifa del proveedor que NO corrió es justo el
   *  error que este archivo hace imposible. */
  readonly creditRate: () => CreditRate;
  /** Lo que gastó cada proveedor que corrió, con su modelo: el costo real, para
   *  el libro de gasto. Normalmente una fila; dos si hubo respaldo. */
  readonly providersUsed: () => readonly ProviderUse[];
  /** Lo que el usuario NO paga de un respaldo (spec §3.4b): `minus` es el uso
   *  de los intentos fallidos del proveedor que se dejó, y `extraCached` la
   *  entrada sin caché de la primera llamada en el respaldo, que se cobra como
   *  si hubiera estado en caché. Sin respaldo, ceros. */
  readonly billingAdjustment: () => { minus: UsageTotals; extraCached: number };
  readonly fellBack: () => boolean;
  readonly firstProvider: () => ProviderId;
  readonly lastProvider: () => ProviderId;
}

/** La forma de `AgentLoopResult["usage"]`. */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thinkingTokens: number;
}

export interface ProviderUse extends UsageTotals {
  provider: ProviderId;
  model: string;
}

/** Una llamada que no da NINGÚN evento en este tiempo pasa al respaldo. Sólo
 *  con respaldo: sin él, nada corta una llamada sola, como antes. */
export const FIRST_EVENT_TIMEOUT_MS = 60_000;
/** Los reintentables pasan al respaldo en este fallo del principal (el bucle
 *  reintenta 5 veces; el respaldo tiene luego sus reintentos completos). */
export const RETRIES_BEFORE_FALLBACK = 4;

const PROVIDER_LABEL: Readonly<Record<ProviderId, string>> = { fireworks: "Fireworks", deepinfra: "DeepInfra" };

const zeroUsage = (): UsageTotals => ({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, thinkingTokens: 0 });

function addUsage(into: UsageTotals, u: UsageTotals): void {
  into.inputTokens += u.inputTokens;
  into.outputTokens += u.outputTokens;
  into.cachedTokens += u.cachedTokens;
  into.thinkingTokens += u.thinkingTokens;
}

/** El orden del turno: el preferido delante, y los que están en enfriamiento
 *  fuera, salvo que lo estén todos.
 *
 *  ⚰️ Aquí los turnos `low`/`medium` ponían delante a Fireworks, porque una
 *  medición del 16/10 (una llamada por nivel) decía que en DeepInfra la palabra
 *  no recortaba el pensamiento. Medido otra vez el 17/10 con un encargo que pide
 *  pensar (3 llamadas por nivel): `low` recorta ~40 % allí también, piensa lo
 *  mismo o menos que en Fireworks y cuesta ~3 veces menos. Jesús: a DeepInfra. */
function providerOrder(
  resolved: readonly ResolvedProvider[],
  o: { preferred: ProviderId | null; now: number },
): ResolvedProvider[] {
  let list = [...resolved];
  const preferred = o.preferred ? list.find((p) => p.id === o.preferred) : undefined;
  if (preferred) list = [preferred, ...list.filter((p) => p !== preferred)];
  const healthy = list.filter((p) => !isCooling(p.id, o.now));
  return healthy.length > 0 ? healthy : list;
}

/**
 * El loop conoce los eventos del gateway y nada más. DeepSeek manda el
 * pensamiento por un canal aparte, en trozos.
 *
 * 🔴 H15 (01/10): ya NO se descarta. Len lo tiraba, y cada paso trabajaba sin el
 * porqué de los anteriores. Aquí se juntan los trozos y salen como UN evento
 * `reasoning` con el texto entero, justo antes del `done`, como el `translate.ts`
 * del arnés de DeepSeek junta el canal en un bloque. El loop lo devuelve al
 * modelo en el paso siguiente. Al dueño sigue sin llegarle: el Agente narra en
 * `text`, y la cadena cruda de pensamiento es ruido, no transparencia.
 *
 * Cada trozo sigue avisando a `alPensar`, que es la señal de vida del reloj de
 * silencio: el evento junto llega al final, y pensar 3 minutos seguidos no puede
 * parecer un cuelgue.
 */
export async function* asAgentStream(
  source: AsyncIterable<FireworksStreamEvent>,
  alPensar?: () => void,
): AsyncIterable<StreamEvent> {
  let pensado = "";
  for await (const event of source) {
    if (event.type === "reasoning_delta") {
      alPensar?.();
      pensado += event.text;
      continue;
    }
    if (event.type === "done" && pensado) {
      yield { type: "reasoning", text: pensado };
      pensado = "";
    }
    yield event;
  }
  if (pensado) yield { type: "reasoning", text: pensado };
}

// 16k se quedaba corto y el turno moría truncado: el caso del interruptor de
// modo oscuro —que reescribe :root, :root.dark y el control— produjo 15,631
// tokens de salida contra el tope, y el bucle lo marca como error terminal.
// Al usuario le llega "intenta un pedido más corto" por una edición legítima.
// 65,536 se acepta en esta misma ruta (medido hoy en /api/generate); 32k deja
// el doble de aire sin acercarse. Sólo se paga lo que se usa.
const LOOP_MAX_OUTPUT_TOKENS = 32_768;
const CLOSEOUT_MAX_OUTPUT_TOKENS = 2_048;
// 1,0, LA DEL MODELO (2026-10-21). La ficha de V4.1 mide todo a 1,0 y la de la
// 1017 lo recomienda; la API de DeepSeek ignora la temperatura cuando piensa
// (su arnés, `llm-deepseek/README.md`), así que su producto corre a la suya; y
// OpenCode a DeepSeek no le manda NINGUNA (`transform.ts:527-544`,
// `request.ts:124`). DeepInfra y Fireworks SÍ aplican la nuestra: a 0,2 Len
// corría lejos de donde se midió el modelo.
//
// Un turno real de cada (`texto-sobre-la-foto`, 1017 en DeepInfra, n=1, SIN
// más medición a propósito: arreglo pequeño copiado de DeepSeek): 0,2 → 15
// vueltas, $0,011, 288 s, reforzando el velo tres veces; 1,0 → 6 vueltas,
// $0,002, 71 s. Los dos al 1,00 (`plans/len-2/corridas/2026-10-21-temp-*`).
//
// ⚰️ AQUÍ DECÍA que la línea era ESCRIBIR contra DECIDIR —todo lo que llama
// herramientas en el repo estaba a 0,2 o menos (03/09)— y que este bucle, por
// decidir, iba en ese grupo. Era una regla de nuestras superficies, no del
// modelo. El camino creativo —`redesign.ts`, 0,8— no cambia.
//
// Len Dynamis ya corría a 1,0 (`lib/agent/dynamis.ts`).
const TEMPERATURE = 1.0;

// TOP_P 1,0, el otro valor de la ficha de la 1017 (2026-10-22), EXPLÍCITO y en
// todos los modos. DeepInfra ya usa 1,0 si no se manda (su documentación);
// Fireworks, el respaldo, no documenta el suyo, y un turno que cae al respaldo
// no debe muestrear distinto del que se midió.
const TOP_P = 1.0;

/** Qué operación corre una vuelta: la del agente, salvo que la conversación
 *  traiga fotos y el modelo del agente NO las vea — entonces, el papel con
 *  visión (sin esfuerzo, como era antes de A). Con un agente que ve, la foto
 *  no le quita el razonamiento: Claude Code razona con la imagen delante. */
export function operacionDeLaVuelta(
  conFotos: boolean,
  agenteVe: boolean = MODEL_POLICY.agent.veImagenes,
): "agent_turn" | "page_write_with_reference" {
  return conFotos && !agenteVe ? "page_write_with_reference" : "agent_turn";
}

export function createAgentBrain(options: AgentBrainOptions): AgentBrain {
  const wireTools = toolsForFireworks(options.tools);
  // Una vuelta con fotos y un agente que NO ve la corre el PAPEL CON VISION
  // (`operacionDeLaVuelta`), y cada papel trae su tarifa. Sin esta bandera se
  // cobraria al precio del que no corrio — la misma clase de error que
  // `lib/credits.ts` documenta. Hoy el agente ve, así que no se enciende.
  //
  // ⚠️ HOY LOS DOS CUESTAN LO MISMO (desde el 2026-09-12 comparten modelo), asi
  // que este reparto no cambia ni un centimo. Se queda porque la pregunta que
  // contesta —quien corrio— sigue siendo real, y el dia que los papeles se
  // separen tiene que estar ya puesta: ponerla DESPUES es como se cobran seis
  // veces de mas durante semanas.
  //
  // ⚰️ Se llamaba `ranOnQwen`. El nombre afirmaba un proveedor en el
  // compilador, y ese proveedor salio del repo el 2026-09-13.
  let mirado = false;

  // LA POSTURA SE RESUELVE UNA SOLA VEZ para todo el turno — incluido su
  // cierre por tope (`closeOut`): darle una postura distinta sería tomar, sin
  // medir, una decisión nueva sobre una constante, que es exactamente el error
  // que esta capa existe para corregir. `options.env` gana aquí su primer
  // lector real: es `OPENLEN_AGENT_EFFORT`, la palanca del operador, por
  // encima del turno y de la preferencia guardada — mismo orden que
  // `CLAUDE_CODE_EFFORT_LEVEL` en Claude Code (ver `esfuerzo-efectivo.ts`).
  const env = options.env ?? process.env;
  // 🔴 Y SE RECORTA A LO QUE ESTE MODELO OFRECE, que es el último paso de
  // Claude Code al resolver el nivel. Sin esto la tabla por modelo sería
  // decorativa: la postura se GUARDA en `users.agentEffort`, así que quien
  // eligió `max` con un modelo medido lo seguiría mandando el día que el papel
  // cambie a uno sin medir —225 a un dial que nadie ha comprobado— y encima con
  // el mando sin enseñar siquiera esa opción. El papel del Agente ha cambiado
  // de modelo dos veces en tres semanas; esto no es hipotético.
  //
  // Va DESPUÉS de la precedencia y no dentro: el recorte es del MODELO, y las
  // capas son de QUIÉN MANDA. Mezclarlos haría que la palanca del operador
  // pudiera saltarse el techo medido, que es justo lo que no debe poder hacer.
  const esfuerzoPedido = caparEsfuerzo(
    esfuerzoEfectivo({
      env: env.OPENLEN_AGENT_EFFORT,
      delTurno: options.esfuerzoDelTurno,
      delUsuario: options.esfuerzoDelUsuario,
    }),
    capacidadDeEsfuerzo(MODEL_POLICY.agent.modelId),
  );
  // ÚNICO LLAMADOR de `esfuerzoDisponible` (Task 2 la dejó sin uno, a la
  // espera de este cable). Si el modelo del papel `agent` no pensara, el nivel
  // pedido no valdría; hoy es inalcanzable porque `MODEL_POLICY.agent.piensa`
  // es siempre `true`, pero la puerta se comprueba de todas formas y, si algún
  // día se cierra, SE DICE en vez de esconderse — la otra mitad de su diseño —
  // porque el log del servidor es hoy el único canal que existe para eso.
  const disponibilidad = esfuerzoDisponible(esfuerzoPedido);
  // 🔴 CON LA PUERTA CERRADA SE MANDA `null`, NO `"auto"`. Hasta el 2026-09-11
  // esta línea caía a `"auto"` y era correcta, porque entonces `auto` OMITÍA el
  // campo. Ya no: `auto` resuelve al nivel por defecto y manda su número, así
  // que caer ahí le encendería el pensamiento precisamente al papel que acaba
  // de declarar que no piensa. `null` es «este turno no tiene postura», y el
  // cable lo traduce a `"none"` — apagarlo a propósito, no por omisión.
  const esfuerzo: EsfuerzoAgente | null = disponibilidad.ok ? esfuerzoPedido : null;
  if (!disponibilidad.ok) {
    console.warn(`[agent/brain] ${disponibilidad.motivo} — este turno va sin pensamiento.`);
  }

  // LEN DYNAMIS (`lib/agent/dynamis.ts`): la receta del modo Minimal de
  // DeepSeek en el cable. Temperatura 1,0, un solo techo de salida para todas
  // las llamadas del turno —el cierre también: con el razonamiento al máximo,
  // sus 2.048 se irían en pensar— y la PALABRA `"max"`, que no pasa por el dial
  // de números ni por su recorte a `high`. Dos capas siguen por encima, como
  // con el mando: el operador (`OPENLEN_AGENT_EFFORT`) y la puerta de un papel
  // que no piensa (`esfuerzo === null`). Sin el modo, todo como antes.
  const isDynamis = options.mode === "dynamis";
  const temperature = isDynamis ? DYNAMIS_TEMPERATURE : TEMPERATURE;
  const loopCeiling = isDynamis ? DYNAMIS_MAX_OUTPUT_TOKENS : LOOP_MAX_OUTPUT_TOKENS;
  const closeOutCeiling = isDynamis ? DYNAMIS_MAX_OUTPUT_TOKENS : CLOSEOUT_MAX_OUTPUT_TOKENS;
  const effortWord =
    isDynamis && esfuerzo !== null && operatorEffort(env.OPENLEN_AGENT_EFFORT) === null
      ? DYNAMIS_REASONING_EFFORT
      : undefined;

  // ─── QUIÉN ATIENDE EL TURNO (spec local 2026-10-16-second-provider §3.4) ───
  //
  // El orden se decide UNA vez, al empezar, y el turno se queda en su
  // proveedor —también el cierre— salvo que tenga que pasar al respaldo. Cada
  // proveedor, una sola vez por turno: no hay vaivén. Sin ningún proveedor con
  // clave, el cliente de siempre, que lo dice con `missing_key`.
  const order = providerOrder(resolveAgentProviders(env, options.providers), {
    preferred: options.preferredProvider ?? null,
    now: Date.now(),
  });
  const legacy = order.length === 0;
  const clients = new Map<ProviderId, FireworksStreamClient>();
  const clientFor = (provider: ResolvedProvider | null): FireworksStreamClient => {
    if (!provider) return (clients.get("fireworks") ?? clients.set("fireworks", createFireworksStreamClient()).get("fireworks"))!;
    const made =
      clients.get(provider.id) ??
      options.streamClientFor?.(provider) ??
      createFireworksStreamClient({
        apiKey: provider.apiKey,
        endpoint: provider.dialect.endpoint,
        modelId: provider.modelId,
        affinityField: provider.dialect.affinityField,
        effortStyle: provider.dialect.effortStyle,
      });
    clients.set(provider.id, made);
    return made;
  };
  let current = 0;
  /** Los reintentables seguidos del proveedor actual, desde su último éxito. */
  let failuresOnCurrent = 0;
  /** El uso que llegó en esos intentos fallidos: no se cobra si se cambia. */
  let failedUsageOnCurrent = zeroUsage();
  let awaitingFirstUsageAfterSwitch = false;
  const uses = new Map<ProviderId, ProviderUse>();
  const forgiven = zeroUsage();
  let extraCached = 0;

  const noteUsage = (provider: ResolvedProvider | null, u: UsageTotals): void => {
    const id = provider?.id ?? "fireworks";
    const row = uses.get(id) ?? { provider: id, model: provider?.modelId ?? modelIdForRole("agent"), ...zeroUsage() };
    addUsage(row, u);
    uses.set(id, row);
    if (awaitingFirstUsageAfterSwitch) {
      awaitingFirstUsageAfterSwitch = false;
      extraCached += Math.max(0, u.inputTokens - u.cachedTokens);
    }
  };

  /** El `done` de una llamada, ya decidido: tal cual, o un cambio de proveedor. */
  function settle(
    provider: ResolvedProvider | null,
    stop: FireworksStopReason,
    timedOut: boolean,
    callUsage: UsageTotals | null,
  ): FireworksStreamEvent {
    const next = legacy ? undefined : order[current + 1];
    const ownerStopped = options.signal?.aborted === true;
    if (stop.kind !== "error" && !(timedOut && !ownerStopped)) {
      if (stop.kind === "end_turn" || stop.kind === "max_tokens") {
        failuresOnCurrent = 0;
        failedUsageOnCurrent = zeroUsage();
      }
      return { type: "done", stopReason: stop };
    }
    if (callUsage) addUsage(failedUsageOnCurrent, callUsage);
    let reason: Extract<FireworksStopReason, { kind: "error" }>;
    let switching: boolean;
    if (stop.kind !== "error") {
      // Llegó al reloj de 60 s sin ningún evento (sólo se arma con respaldo).
      reason = { kind: "error", error: `sin ningún evento en ${FIRST_EVENT_TIMEOUT_MS / 1000} s`, code: "transport" };
      switching = next !== undefined;
    } else {
      reason = stop;
      if (stop.httpStatus === 402 && provider && coolDown(provider.id, Date.now())) {
        console.error(`[agent] ${provider.id} sin saldo (402): ${next ? `turnos a ${PROVIDER_LABEL[next.id]}` : "sin respaldo"}`);
      }
      const trigger = stop.code === "context_window_exceeded" ? "never" : isRetryable(stop.code) ? "retryable" : "now";
      if (trigger === "retryable") failuresOnCurrent += 1;
      switching =
        next !== undefined &&
        !ownerStopped &&
        (trigger === "now" || (trigger === "retryable" && failuresOnCurrent >= RETRIES_BEFORE_FALLBACK));
    }
    if (!switching || !next || !provider) return { type: "done", stopReason: reason };

    addUsage(forgiven, failedUsageOnCurrent);
    failedUsageOnCurrent = zeroUsage();
    failuresOnCurrent = 0;
    current += 1;
    awaitingFirstUsageAfterSwitch = true;
    console.warn(`[agent] ${provider.id} falló (${reason.error.slice(0, 120)}): el turno sigue en ${next.id}`);
    return {
      type: "done",
      stopReason: {
        kind: "error",
        error: reason.error,
        code: "server",
        ...(reason.httpStatus !== undefined ? { httpStatus: reason.httpStatus } : {}),
        switchedProvider: true,
      },
    };
  }

  /** Una llamada en el proveedor actual, con su propio corte (el ■ del dueño,
   *  o el reloj del primer evento cuando hay respaldo). */
  async function* routed(request: FireworksStreamRequest, kind: CallKind): AsyncIterable<FireworksStreamEvent> {
    const provider = legacy ? null : order[current]!;
    const startedAt = Date.now();
    let wire: WireBody | null = null;
    let stopKind: FireworksStopReason["kind"] = "cancelled";
    let servedModel: string | undefined;
    const hasNext = !legacy && current + 1 < order.length;
    const callAbort = new AbortController();
    const outer = options.signal;
    const onOuterAbort = () => callAbort.abort();
    if (outer?.aborted) callAbort.abort();
    else outer?.addEventListener("abort", onOuterAbort, { once: true });
    let sawEvent = false;
    let timedOut = false;
    const timer = hasNext
      ? setTimeout(() => {
          if (sawEvent) return;
          timedOut = true;
          callAbort.abort();
        }, FIRST_EVENT_TIMEOUT_MS)
      : undefined;
    let callUsage: UsageTotals | null = null;
    /** Llegó texto, pensamiento o una llamada (lo que DeepSeek llama «bloques»). */
    let said = false;
    try {
      for await (const event of clientFor(provider).stream(request, {
        signal: callAbort.signal,
        ...(options.onCall ? { onWireBody: (body: WireBody) => { wire = body; } } : {}),
      })) {
        if (!sawEvent) {
          sawEvent = true;
          clearTimeout(timer);
        }
        if (event.type === "usage") {
          callUsage = callUsage ?? zeroUsage();
          addUsage(callUsage, event);
          noteUsage(provider, event);
        }
        if (event.type === "done") {
          // UNA RESPUESTA VACÍA ES UN FALLO REINTENTABLE, no un éxito vacío (A4 de
          // Len 3.1, DeepSeek `empty-model-response-is-retryable`, MIT): un final
          // limpio sin texto, sin pensamiento y sin llamadas cerraba el turno sin
          // decir nada y sin reintentar. Se decide aquí, en la frontera con el
          // proveedor, como ellos en el adaptador: el cliente lo comparte `/ai/v1`,
          // donde una respuesta vacía de OpenAI se devuelve tal cual. `max_tokens`
          // vacío conserva su significado.
          const stop: FireworksStopReason =
            event.stopReason.kind === "end_turn" && !said
              ? { kind: "error", error: "empty response: the model finished with no text, reasoning or tool calls", code: "empty_response" }
              : event.stopReason;
          stopKind = stop.kind;
          servedModel = event.servedModel;
          yield settle(provider, stop, timedOut, callUsage);
          return;
        }
        if (event.type === "text_delta" || event.type === "reasoning_delta" || event.type === "function_call" || event.type === "function_call_cut") said = true;
        yield event;
      }
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuterAbort);
      if (options.onCall) {
        const sent = wire as WireBody | null;
        try {
          options.onCall({
            kind,
            provider: provider?.id ?? "fireworks",
            model: servedModel ?? provider?.modelId ?? modelIdForRole("agent"),
            effort: sent?.reasoningEffort == null ? null : String(sent.reasoningEffort),
            startedAt,
            durationMs: Date.now() - startedAt,
            usage: callUsage,
            stop: stopKind,
            wire: sent,
          });
        } catch {
          // Telemetry never touches the turn.
        }
      }
    }
  }

  const viaFireworks = (messages: Message[], withTools: boolean, maxOutputTokens: number) =>
    ((): ReturnType<typeof asAgentStream> => {
      // LAS FOTOS VAN DENTRO DE SU MENSAJE (`Message.images`) y viajan en todas
      // las vueltas, como una imagen pegada en Claude Code. Quién corre la
      // vuelta lo decide la política: con un agente que ve, él mismo.
      const operation = operacionDeLaVuelta(messages.some((m) => m.images?.length));
      if (operation !== "agent_turn") mirado = true;
      return asAgentStream(
      routed(
        {
          messages: messagesForFireworks(messages),
          // 🔴 A7 · EL CIERRE LLEVA LAS MISMAS HERRAMIENTAS, con `tool_choice:
          // "none"`: no puede llamar ninguna, y su prefijo es el del bucle (la
          // plantilla del modelo pone las herramientas en el prompt de sistema).
          // Sin ellas, la llamada del cierre se pagaba entera sin caché
          // (auditoría de los sospechosos, `cache-suspects.test.ts`).
          tools: wireTools,
          ...(withTools ? {} : { toolChoice: "none" as const }),
          // LOS TROZOS DE LOS ARGUMENTOS, para pintar un Write mientras se
          // escribe. Sólo en el bucle: el cierre no llama a nada.
          ...(withTools ? { streamToolArgs: true } : {}),
          maxOutputTokens,
          temperature,
          topP: TOP_P,
          requestId: options.requestId,
          operation,
          // La POSTURA sólo tiene sentido para `agent_turn`: si una vuelta con
          // fotos va al papel con visión (agente que no ve), ese papel mantiene
          // el valor de la tabla, no el elegido por el usuario para el Agente.
          ...(operation === "agent_turn"
            ? { esfuerzo, ...(effortWord ? { reasoningEffortWord: effortWord } : {}) }
            : {}),
        },
        withTools ? "loop" : "closeOut",
      ),
      options.alPensar,
      );
    })();

  return {
    // El del PRIMER proveedor elegido: la línea del diario y el libro lo leen.
    modelId: legacy ? modelIdForRole(roleForOperation("agent_turn")) : order[0]!.modelId,
    // El proveedor que corrió el turno es el que lo paga. Dos papeles, dos
    // tarifas: si MIRO, la del papel con vision; si no, la del Agente. Aqui
    // habia un tercero —Gemini, con `ranOnGemini`— que salio el 2026-08-28.
    // 🔴 LA TARIFA SALE DEL PAPEL, no de un literal — 2026-09-11. Estaba escrita
    // a mano (`"deepseek-pro"`), así que cambiar el modelo del papel `agent` en
    // la política le habría cobrado al usuario 6x por turnos que costaron 1x.
    // El papel que MIRA y el que razona son dos, y cada uno trae la suya.
    creditRate: () =>
      mirado ? MODEL_POLICY.visualCritic.creditRate : MODEL_POLICY.agent.creditRate,
    // ⚰️ Aquí la foto se anclaba SÓLO a la vuelta cuyo último mensaje era el
    // prompt (por el canal de `request.images`, que la pega al último mensaje
    // de usuario y no puede ir junto a resultados de herramientas). Con A va
    // dentro de tu mensaje y ese problema no existe.
    openStream: (messages) => viaFireworks(messages, true, loopCeiling),
    closeOut: (messages) => viaFireworks(messages, false, closeOutCeiling),
    providersUsed: () => [...uses.values()].map((row) => ({ ...row })),
    billingAdjustment: () => ({ minus: { ...forgiven }, extraCached }),
    fellBack: () => current > 0,
    firstProvider: () => (legacy ? "fireworks" : order[0]!.id),
    lastProvider: () => (legacy ? "fireworks" : order[current]!.id),
  };
}
