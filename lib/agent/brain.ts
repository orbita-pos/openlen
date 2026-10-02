import type { Message, StreamEvent } from "@/lib/ai-gateway";
import { createFireworksStreamClient, type FireworksStreamEvent } from "@/lib/ai/fireworks-stream-client";
import { messagesForFireworks, toolsForFireworks } from "@/lib/agent/fireworks-bridge";
import { MODEL_POLICY, esfuerzoDisponible, modelIdForRole, roleForOperation } from "@/lib/generation/model-policy";
import type { CreditRate } from "@/lib/credits";
import { esfuerzoEfectivo } from "./esfuerzo-efectivo";
import { caparEsfuerzo, capacidadDeEsfuerzo, type EsfuerzoAgente } from "./esfuerzo";

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
  // ⚰️ Aquí iba `attachedImage` (los píxeles y el mensaje al que se anclaban
  // en la PRIMERA vuelta). Con A (2026-10-01) la foto va pegada a tu mensaje
  // (`Message.images`) y viaja en todas las vueltas: la pega la ruta.
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Lo que el usuario eligió PARA ESTE TURNO (el equivalente de `/effort`). */
  readonly esfuerzoDelTurno?: EsfuerzoAgente | null;
  /** Su preferencia guardada (`users.agentEffort`). */
  readonly esfuerzoDelUsuario?: EsfuerzoAgente | null;
  /** Se llama con cada trozo de razonamiento, que NO llega al loop. Es señal de
   *  vida para el reloj de silencio de la ruta: sin ella, pensar más de 3 min
   *  seguidos parecía un cuelgue y se cancelaba el turno (E del 26/09, con H5). */
  readonly alPensar?: () => void;
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
  alPensar?: () => void,
): AsyncIterable<StreamEvent> {
  for await (const event of source) {
    if (event.type === "reasoning_delta") {
      alPensar?.();
      continue;
    }
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
  const fireworks = createFireworksStreamClient();
  const wireTools = toolsForFireworks(options.tools);
  const streamOpts = options.signal ? { signal: options.signal } : {};
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

  const viaFireworks = (messages: Message[], withTools: boolean, maxOutputTokens: number) =>
    ((): ReturnType<typeof asAgentStream> => {
      // LAS FOTOS VAN DENTRO DE SU MENSAJE (`Message.images`) y viajan en todas
      // las vueltas, como una imagen pegada en Claude Code. Quién corre la
      // vuelta lo decide la política: con un agente que ve, él mismo.
      const operation = operacionDeLaVuelta(messages.some((m) => m.images?.length));
      if (operation !== "agent_turn") mirado = true;
      return asAgentStream(
      fireworks.stream(
        {
          messages: messagesForFireworks(messages),
          ...(withTools ? { tools: wireTools } : {}),
          maxOutputTokens,
          temperature: TEMPERATURE,
          requestId: options.requestId,
          operation,
          // La POSTURA sólo tiene sentido para `agent_turn`: si una vuelta con
          // fotos va al papel con visión (agente que no ve), ese papel mantiene
          // el valor de la tabla, no el elegido por el usuario para el Agente.
          ...(operation === "agent_turn" ? { esfuerzo } : {}),
        },
        streamOpts,
      ),
      options.alPensar,
      );
    })();

  return {
    modelId: modelIdForRole(roleForOperation("agent_turn")),
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
    openStream: (messages) => viaFireworks(messages, true, LOOP_MAX_OUTPUT_TOKENS),
    closeOut: (messages) => viaFireworks(messages, false, CLOSEOUT_MAX_OUTPUT_TOKENS),
  };
}
