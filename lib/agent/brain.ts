import type { InlineImage, Message, StreamEvent } from "@/lib/ai-gateway";
import { createFireworksStreamClient, type FireworksStreamEvent } from "@/lib/ai/fireworks-stream-client";
import { messagesForFireworks, toolsForFireworks } from "@/lib/agent/fireworks-bridge";
import { MODEL_POLICY, esfuerzoDisponible, modelIdForRole, roleForOperation } from "@/lib/generation/model-policy";
import type { CreditRate } from "@/lib/credits";
import { esfuerzoEfectivo } from "./esfuerzo-efectivo";
import type { EsfuerzoAgente } from "./esfuerzo";

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
  readonly tools: Record<string, unknown>[];
  /** Identifica la corrida ante el transporte de Fireworks (presupuesto y bitácora). */
  readonly requestId: string;
  readonly signal?: AbortSignal;
  /** Píxeles adjuntos y el mensaje al que van pegados. Un turno con imagen lo
   *  lleva Qwen: al razonador nunca se le manda una. */
  readonly attachedImage?: { image: InlineImage; anchorMessage: Message };
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Lo que el usuario eligió PARA ESTE TURNO (el equivalente de `/effort`). */
  readonly esfuerzoDelTurno?: EsfuerzoAgente | null;
  /** Su preferencia guardada (`users.agentEffort`). */
  readonly esfuerzoDelUsuario?: EsfuerzoAgente | null;
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
   *  Es una función y no un campo porque un turno con imagen adjunta corre en
   *  Qwen, que cuesta ~10x la salida del razonador: decidir la tarifa al abrir
   *  cobraría ese turno a precio de DeepSeek. Vive con el cerebro y no con la
   *  ruta porque cobrar a la tarifa del proveedor que NO corrió es justo el
   *  error que este archivo hace imposible. */
  readonly creditRate: () => CreditRate;
}

/**
 * El loop conoce los eventos del gateway y nada más. DeepSeek añade
 * uno —el pensamiento por canal aparte— que aquí se DESCARTA a propósito: el
 * Agente narra lo que hace en `text`, y volcarle al usuario la cadena de
 * pensamiento cruda del modelo es ruido, no transparencia. Con `page_edit` en
 * esfuerzo `none` ese canal ni siquiera se abre; el descarte existe para que
 * encenderlo algún día no cambie lo que la gente ve.
 */
export async function* asAgentStream(
  source: AsyncIterable<FireworksStreamEvent>,
): AsyncIterable<StreamEvent> {
  for await (const event of source) {
    if (event.type === "reasoning_delta") continue;
    yield event;
  }
}

// 16k se quedaba corto y el turno moría truncado: el caso del interruptor de
// modo oscuro —que reescribe :root, :root.dark y el control— produjo 15,631
// tokens de salida contra el tope, y el bucle lo marca como error terminal.
// Al usuario le llega "intenta un pedido más corto" por una edición legítima.
// 65,536 se acepta en esta misma ruta (medido hoy en /api/generate); 32k deja
// el doble de aire sin acercarse. Sólo se paga lo que se usa.
const LOOP_MAX_OUTPUT_TOKENS = 32_768;
const CLOSEOUT_MAX_OUTPUT_TOKENS = 2_048;
// LA LÍNEA NO ES «el Agente contra el resto», es ESCRIBIR contra DECIDIR.
// Medido el 03/09 sobre todo el repo: las seis superficies por encima de 0,3
// escriben prosa o HTML (crear 0,8 · redesign 0,8 · autofill 0,5/0,5/0,4), y
// todas las que deciden o llaman herramientas están en 0,2 o menos — incluido
// nuestro propio cliente de tool-calling (`fireworks-tool-client.ts`, 0,2),
// `verify.ts` a 0,1 y `analyze-intent` a 0. Este bucle DECIDE: elige la
// herramienta y redacta sus argumentos. Estaba en el grupo equivocado.
//
// Y no le quita creatividad al Agente: su camino creativo —`redesign.ts`—
// tiene su PROPIO TEMPERATURE a 0,8 y no lo toca este cambio.
//
// OpenCode cura la temperatura modelo a modelo (1,0 glm-4.6 · 0,6 kimi-k2) y a
// DeepSeek no le manda NINGUNA (`transform.ts:527-544`, `request.ts:124`).
const TEMPERATURE = 0.2;

export function createAgentBrain(options: AgentBrainOptions): AgentBrain {
  const fireworks = createFireworksStreamClient();
  const wireTools = toolsForFireworks(options.tools);
  const streamOpts = options.signal ? { signal: options.signal } : {};
  // Qwen cuesta ~10x la salida del razonador. Sin esto, un turno con imagen
  // adjunta correría en Qwen y se cobraría a tarifa de DeepSeek — la misma
  // clase de error que el comentario de `lib/credits.ts` ya documenta al revés.
  let ranOnQwen = false;

  // LA POSTURA SE RESUELVE UNA SOLA VEZ para todo el turno — incluido su
  // cierre por tope (`closeOut`): darle una postura distinta sería tomar, sin
  // medir, una decisión nueva sobre una constante, que es exactamente el error
  // que esta capa existe para corregir. `options.env` gana aquí su primer
  // lector real: es `OPENLEN_AGENT_EFFORT`, la palanca del operador, por
  // encima del turno y de la preferencia guardada — mismo orden que
  // `CLAUDE_CODE_EFFORT_LEVEL` en Claude Code (ver `esfuerzo-efectivo.ts`).
  const env = options.env ?? process.env;
  const esfuerzoPedido = esfuerzoEfectivo({
    env: env.OPENLEN_AGENT_EFFORT,
    delTurno: options.esfuerzoDelTurno,
    delUsuario: options.esfuerzoDelUsuario,
  });
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

  const viaFireworks = (
    messages: Message[],
    withTools: boolean,
    maxOutputTokens: number,
    images?: InlineImage[],
  ) =>
    ((): ReturnType<typeof asAgentStream> => {
      if (images?.length) ranOnQwen = true;
      // Con píxeles adjuntos la operación cambia de papel: al razonador NUNCA
      // se le manda una imagen, y quien mira es Qwen.
      const operation = images?.length ? "page_write_with_reference" : "agent_turn";
      return asAgentStream(
      fireworks.stream(
        {
          messages: messagesForFireworks(messages),
          ...(withTools ? { tools: wireTools } : {}),
          ...(images?.length ? { images } : {}),
          maxOutputTokens,
          temperature: TEMPERATURE,
          requestId: options.requestId,
          operation,
          // La POSTURA sólo tiene sentido para `agent_turn`: con imagen adjunta
          // el turno corre en Qwen (papel con visión) y ese papel mantiene el
          // valor de la tabla, no el elegido por el usuario para el Agente.
          ...(operation === "agent_turn" ? { esfuerzo } : {}),
        },
        streamOpts,
      ),
      );
    })();

  return {
    modelId: modelIdForRole(roleForOperation("agent_turn")),
    // El proveedor que corrió el turno es el que lo paga. Dos papeles, dos
    // tarifas: si miró Qwen, Qwen; si no, el razonador. Aqui habia un tercero
    // —Gemini, con su propia bandera `ranOnGemini`— que salio el 2026-08-28.
    // 🔴 LA TARIFA SALE DEL PAPEL, no de un literal — 2026-09-11. Estaba escrita
    // a mano (`"deepseek-pro"`), así que cambiar el modelo del papel `agent` en
    // la política le habría cobrado al usuario 6x por turnos que costaron 1x.
    // El papel que MIRA y el que razona son dos, y cada uno trae la suya.
    creditRate: () =>
      ranOnQwen ? MODEL_POLICY.visualCritic.creditRate : MODEL_POLICY.agent.creditRate,
    openStream: (messages) => {
      // Los píxeles adjuntos van SÓLO en el turno cuyo último mensaje es el
      // prompt del usuario (el gateway los ancla ahí); mezclarlos con un mensaje
      // de functionResponses rompería el protocolo de llamadas a herramientas.
      const attached =
        options.attachedImage && messages[messages.length - 1] === options.attachedImage.anchorMessage
          ? [options.attachedImage.image]
          : undefined;
      // Con imagen adjunta va a Qwen, el papel con visión, por el mismo
      // transporte y con las mismas herramientas.
      return viaFireworks(messages, true, LOOP_MAX_OUTPUT_TOKENS, attached);
    },
    closeOut: (messages) => viaFireworks(messages, false, CLOSEOUT_MAX_OUTPUT_TOKENS),
  };
}
