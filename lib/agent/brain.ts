import { GeminiProvider, type InlineImage, type Message, type StreamEvent } from "@/lib/ai-gateway";
import { createFireworksStreamClient, type FireworksStreamEvent } from "@/lib/ai/fireworks-stream-client";
import { resolveAIProvider } from "@/lib/ai-provider";
import { usesDeepSeek as deepSeekEnabled } from "@/lib/ai/provider-switch";
import { messagesForFireworks, toolsForFireworks } from "@/lib/agent/fireworks-bridge";
import { modelIdForRole, roleForOperation } from "@/lib/generation/fable-model-policy";
import type { CreditRate } from "@/lib/credits";

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
 * cerebro. `OPENLEN_AGENT_PROVIDER=gemini` vuelve atrás.
 */
export interface AgentBrainOptions {
  readonly tools: Record<string, unknown>[];
  /** Identifica la corrida ante el transporte de Fireworks (presupuesto y bitácora). */
  readonly requestId: string;
  readonly signal?: AbortSignal;
  /** Píxeles adjuntos y el mensaje al que van pegados. Un turno con imagen se
   *  queda en Gemini: al razonador nunca se le ha mandado una, y adivinar aquí
   *  costaría la acción del usuario. */
  readonly attachedImage?: { image: InlineImage; anchorMessage: Message };
  readonly env?: Readonly<Record<string, string | undefined>>;
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
   *  Es una función y no un campo porque un turno con imagen adjunta cae a
   *  Gemini aunque DeepSeek esté encendido: decidir la tarifa al abrir cobraría
   *  ese turno a precio de DeepSeek, que es una novena parte. Se cobra el
   *  proveedor más caro que llegó a correr, así que la mezcla nunca cobra de
   *  menos. Vive con el cerebro y no con la ruta porque cobrar a la tarifa del
   *  proveedor que NO corrió es justo el error que este archivo hace imposible. */
  readonly creditRate: () => CreditRate;
  readonly usesDeepSeek: boolean;
}

/**
 * El loop conoce los eventos del gateway de Gemini y nada más. DeepSeek añade
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
const TEMPERATURE = 0.7;

export function createAgentBrain(options: AgentBrainOptions): AgentBrain {
  const env = options.env ?? process.env;
  const usesDeepSeek = deepSeekEnabled("OPENLEN_AGENT_PROVIDER", env);
  const gemini = resolveAIProvider("gemini-flash");
  const provider = new GeminiProvider(gemini.key as string);
  const fireworks = createFireworksStreamClient();
  const wireTools = toolsForFireworks(options.tools);
  const streamOpts = options.signal ? { signal: options.signal } : {};
  let ranOnGemini = false;
  // Qwen cuesta ~10x la salida del razonador. Sin esto, un turno con imagen
  // adjunta correría en Qwen y se cobraría a tarifa de DeepSeek — la misma
  // clase de error que el comentario de `lib/credits.ts` ya documenta al revés.
  let ranOnQwen = false;

  const viaGemini = (
    messages: Message[],
    withTools: boolean,
    maxOutputTokens: number,
    images?: InlineImage[],
  ) => {
    ranOnGemini = true;
    return provider.stream(
      {
        model: gemini.model,
        messages,
        tools: withTools ? options.tools : [],
        toolMode: withTools ? "auto" : "none",
        maxOutputTokens,
        temperature: TEMPERATURE,
        ...(images ? { images } : {}),
      },
      streamOpts,
    );
  };

  const viaFireworks = (
    messages: Message[],
    withTools: boolean,
    maxOutputTokens: number,
    images?: InlineImage[],
  ) =>
    ((): ReturnType<typeof asAgentStream> => {
      if (images?.length) ranOnQwen = true;
      return asAgentStream(
      fireworks.stream(
        {
          messages: messagesForFireworks(messages),
          ...(withTools ? { tools: wireTools } : {}),
          // Con píxeles adjuntos la operación cambia de papel: al razonador NUNCA
          // se le manda una imagen, y quien mira es Qwen.
          ...(images?.length ? { images } : {}),
          maxOutputTokens,
          temperature: TEMPERATURE,
          requestId: options.requestId,
          operation: images?.length ? "page_write_with_reference" : "page_edit",
        },
        streamOpts,
      ),
      );
    })();

  return {
    usesDeepSeek,
    modelId: usesDeepSeek ? modelIdForRole(roleForOperation("page_edit")) : gemini.model,
    // El proveedor que corrió el turno es el que lo paga. Tres papeles, tres
    // tarifas: si en algún momento se cayó a Gemini manda Gemini; si miró Qwen,
    // Qwen; si no, el razonador.
    creditRate: () =>
      !usesDeepSeek || ranOnGemini ? gemini.rate : ranOnQwen ? "qwen-vision" : "deepseek-flash",
    openStream: (messages) => {
      // Los píxeles adjuntos van SÓLO en el turno cuyo último mensaje es el
      // prompt del usuario (el gateway los ancla ahí); mezclarlos con un mensaje
      // de functionResponses rompería el protocolo de llamadas de Gemini.
      const attached =
        options.attachedImage && messages[messages.length - 1] === options.attachedImage.anchorMessage
          ? [options.attachedImage.image]
          : undefined;
      // Con imagen adjunta ya NO se cae a Gemini: va a Qwen, el papel con visión,
      // por el mismo transporte y con las mismas herramientas.
      // `OPENLEN_AGENT_PROVIDER=gemini` sigue devolviendo el camino de antes.
      if (usesDeepSeek) return viaFireworks(messages, true, LOOP_MAX_OUTPUT_TOKENS, attached);
      return viaGemini(messages, true, LOOP_MAX_OUTPUT_TOKENS, attached);
    },
    closeOut: (messages) =>
      usesDeepSeek
        ? viaFireworks(messages, false, CLOSEOUT_MAX_OUTPUT_TOKENS)
        : viaGemini(messages, false, CLOSEOUT_MAX_OUTPUT_TOKENS),
  };
}
