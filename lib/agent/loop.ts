// lib/agent/loop.ts — provider-agnostic agentic loop (F1 Task 8).
//
// Pure orchestration: no network, no DB, no native bindings. Both
// `openStream` (real GeminiProvider in the route) and `runTool` (Task 7's
// runAgentTool) are injected, which is what makes this unit-testable with
// scripted async iterables and zero I/O.
//
// IMPORTANT: only `import type` from @/lib/ai-gateway and @/lib/agent/tools.
// A runtime (value) import of either would transitively load the native
// @openlen/ai-gateway / @/lib/html-engine .node bindings, which vite/vitest
// cannot load — see loop.test.ts's header comment for the same constraint.
import type { Message, StreamEvent } from "@/lib/ai-gateway";
import type { OpDescrita } from "@/lib/agent/ops-descritas";
import type { ToolOutcome } from "@/lib/agent/tools";
// Import de VALOR a propósito, y no viola la regla de arriba: `aviso-medido` no
// importa nada — ni la pasarela, ni las herramientas, ni Chromium. Es texto y
// un `Set`.
import { AvisosDelTurno, type MedicionCruda } from "@/lib/agent/aviso-medido";

// F2 Task 10: a coded error lets the panel show a localized message instead
// of the raw Spanish `message` (which stays as the server-side/fallback
// string — never removed, just no longer the only source of truth). Only
// `no_credits` is never emitted from this file (route.ts's credit gate owns
// it) — it lives in the shared union so the route can type its own error
// payload against the same contract the panel switches on. F4 Task 7:
// `agent_off` is the same story — the route's OPENLEN_AGENT=0 kill-switch
// emits it before this loop ever runs. Unlike the others it's never shown
// to the user: the panel intercepts it and falls back to classic ai-design
// silently, so it has no `wsPage.agent.errors.agent_off` translation.
/** Los dos códigos que significan «se acabó la cuerda», no «se rompió algo».
 *  Subconjunto de AgentErrorCode a propósito: `AgentLoopResult.topeAlcanzado`
 *  no puede llevar `upstream` ni `cancelled`, que sí son fallos. */
export type TopeCode = Extract<AgentErrorCode, "turn_limit" | "tool_limit">;

export type AgentErrorCode =
  | "turn_limit"
  | "tool_limit"
  | "cancelled"
  | "truncated"
  | "upstream"
  | "no_credits"
  | "agent_off";

export type AgentStreamEvent =
  | { type: "text"; text: string }
  // LO QUE EL USUARIO ESCRIBIÓ A MEDIA FAENA. Se emite en cuanto el bucle lo
  // recoge, para que el panel pueda pintarlo en su sitio de la conversación:
  // sin esto, la corrección desaparecería y el usuario vería al Agente cambiar
  // de rumbo sin saber por qué.
  | { type: "direccion"; texto: string }
  // EL ID DEL TURNO, primero de todo. Es la direccion a la que el taller manda
  // las correcciones mientras el turno corre (POST /api/agent/dirigir). Lo
  // genera el SERVIDOR: si lo eligiera el cliente, dos pestañas podrian chocar
  // y un id ajeno seria trivial de fabricar.
  | { type: "turno"; turnoId: string }
  // `cambio`/`edits`: EL HECHO QUE YA SE CONOCÍA Y NO SALÍA. El servidor compara
  // el documento por hash antes y después de cada `editar_pagina` y sólo se lo
  // contaba al modelo; el cliente no podía distinguir «editó» de «no movió un
  // byte» salvo comparando dos cadenas de ~100 KB. Los dos son OPCIONALES: un
  // evento sin ellos se pinta exactamente como antes.
  | {
      type: "action";
      tool: string;
      /** `warning` desde el 2026-09-04 — ver la cabecera de `AgentAction` en
       *  `components/workspace-v2/agent-action-card.tsx` para por qué NO es un
       *  `error` reciclado. */
      status: "running" | "done" | "warning" | "error";
      summary: string;
      cambio?: "cambio" | "sin_cambio" | "no_se";
      edits?: number;
      /** QUÉ se cambió, ya resuelto a algo que sobrevive al turno. Sólo lo
       *  pone `editar_pagina`; el resto de herramientas no mueven ops. */
      ops?: readonly OpDescrita[];
    }
  // F4 Task 4 — the ONLY SSE protocol change this task makes: `html` gains
  // `page` (the slot this document belongs to — null for home). Needed
  // because `trabajar_en_pagina` can move the active document mid-turn, so a
  // later `html` event in the same turn may target a different page than the
  // one the turn started on; the panel paints whichever slot `page` names,
  // never assuming it's still the page the canvas is showing.
  //
  // 2026-09-04 — gana `versionPrevia`: el id de la versión que guarda el
  // documento de ANTES de esta escritura (`persistPage` ya la archivaba con
  // la etiqueta «Before AI edit»; lo único que faltaba era llevar su id hasta
  // el botón). Es LA DIRECCIÓN DEL DESHACER — con ella el Chat pide
  // «servidor, vuelve a esta fila» en vez de mandarle el documento, que se
  // sanea y le quitaba el JavaScript del modelo. Ausente en las escrituras
  // que no archivan nada previo (crear_pagina, restaurar): ahí no hay turno
  // anterior al que volver. Ver components/workspace-v2/panels/undo-turn.ts.
  //
  // El turno puede emitir VARIOS `html` (varias llamadas a editar_pagina) y
  // sólo el PRIMER id es «antes del turno»; quien lo consuma se queda con
  // ése, no con el último.
  | { type: "html"; html: string; page: string | null; versionPrevia?: string | null }
  // The publish gate (Task 7): the model prepared a publish but MUST NOT
  // publish itself. The panel renders a confirm card whose button hits the
  // real publish endpoint — the user's tap is the only thing that publishes.
  | { type: "confirm"; action: "publicar"; subdominio: string; idiomas: string[]; republicar: boolean }
  | { type: "done"; turns: number; toolCalls: number }
  | { type: "error"; message: string; code?: AgentErrorCode };

/**
 * Resultado del hook de verificación visual (F5 — "los ojos"). TRES variantes,
 * y la tercera es la que faltaba.
 *
 * 🔴 «NO PUDE MIRAR» NO ES «ESTÁ BIEN». Los ojos fallan ABIERTOS por diseño
 * —Chrome caído, sin key, timeout, JSON malformado devuelven un veredicto
 * benigno con `fallback: true`— y eso está bien: una verificación que no
 * arranca no puede tumbar el turno del usuario. Lo que estaba mal es que la
 * ruta convertía ese fallback en `ok: true`, así que dentro del producto no
 * quedaba NADA que distinguiera «miré y está bien» de «no pude mirar». Con
 * Chromium caído en el box, la verificación aprobaba todo en silencio y sólo el
 * diario lo sabía.
 *
 * `no_mirado` no dispara ciclo de arreglo —no hay nada que arreglar, no hay
 * crítica— pero SÍ se ve: la tarjeta lo dice, en vez de enseñar el visto bueno
 * de una comprobación que no ocurrió.
 */
export type VerifyOutcome =
  | { estado: "bien" }
  | {
      estado: "roto";
      /** Los problemas encontrados, una línea por problema, EN EL IDIOMA DEL
       *  USUARIO. Se le emiten tal cual al cerrar el turno: son lo único que le
       *  dice qué se midió, y sin ellos no puede pedir que se arregle.
       *
       *  ⚰️ Aquí había un `problemas?: number` para comparar la cuenta entre la
       *  primera pasada y la segunda. No hay segunda pasada desde el
       *  2026-09-04, así que esa cuenta no se comparaba con nada. */
      critique: string;
    }
  /**
   * SE MIRÓ, y lo que se vio NO es un defecto que se pueda AFIRMAR desde la
   * captura.
   *
   * 🔴 Es la paridad que le faltaba al Agente con Crear. Allí el crítico
   * informa y no gasta desde que se midió que puntuaba bajo por las FOTOS
   * —«Bolillo muestra un océano»— y pedía regenerar, y cada regeneración
   * costaba una página entera de tokens y un crédito del usuario sin arreglar
   * nada (app/api/generate/route.ts). Aquí el juicio del crítico seguía
   * abriendo ciclo igual que un TypeError: el 2026-09-02 eso costó ocho
   * búsquedas de foto para un rubro que el catálogo no cubre.
   *
   * La regla que sale de ahí, y que este estado hace cumplir: un veredicto
   * sobre el que el bucle NO PUEDE ACTUAR jamás debe abrir un bucle.
   *
   * Las notas viajan al modelo como contexto del cierre — callárselas sería
   * peor que la orden, porque el usuario merece saber por qué esas tarjetas no
   * tienen foto. Lo que cambia es que se DICE, no que se GASTA.
   */
  | { estado: "observado"; notas: string[] }
  | { estado: "no_mirado"; motivo: string };

// El nombre de "herramienta" bajo el que la verificación visual aparece en el
// panel (una action card normal — el panel la localiza via agent.tool.*).
export const VERIFY_TOOL = "verificar_diseno";

export interface AgentLoopArgs {
  messages: Message[]; // system + contexto + history + user prompt (ya armados)
  tools: Record<string, unknown>[];
  /** Abre un stream de modelo para un set de mensajes. El route inyecta el
   *  GeminiProvider real; los tests inyectan streams guionados. */
  openStream(messages: Message[]): AsyncIterable<StreamEvent>;
  /** F5 — los ojos del agente. Cuando está presente y el turno MUTÓ el
   *  documento, se llama UNA vez justo antes de cerrar (con el último HTML
   *  emitido); si devuelve !ok, la crítica se inyecta como mensaje de sistema
   *  y el modelo recibe UN ciclo de arreglo dentro de los mismos topes. Debe
   *  ser fail-open: cualquier throw se trata como ok. */
  verifyTurn?(info: {
    html: string;
    page: string | null;
    /** El gemelo etiquetado de `html`, si la herramienta lo trajo. Los ojos
     *  miden ÉSTE: es el mismo documento con `data-op-id`, así que cada sonda
     *  lee la dirección del nodo que acaba de medir en vez de describirlo.
     *  Ausente ⇒ se mide `html` y las sondas salen sin dirección, como antes. */
    taggedHtml?: string;
  }): Promise<VerifyOutcome>;
  /**
   * EL MOMENTO `tsc`: mide la página que la tanda acaba de guardar, para que lo
   * medido vuelva al MODELO y no sólo al usuario.
   *
   * Se llama tras cada tanda de herramientas que TOCÓ el documento, con el
   * gemelo etiquetado (donde viven los `data-op-id`), y lo que devuelve viaja
   * en el mismo mensaje que las respuestas de esas herramientas — no dentro de
   * ellas. Es la forma de Claude Code, medida sobre su binario: los
   * diagnósticos nuevos son un mensaje HERMANO del resultado, nunca parte de
   * su payload.
   *
   * Cero llamadas nuevas al modelo: el paso siguiente lo iba a dar igual.
   *
   * Debe ser fail-soft — devolver `null` si no pudo medir. Ausente ⇒ el bucle
   * se comporta exactamente como antes de que esto existiera.
   */
  medirParaElModelo?(taggedHtml: string): Promise<MedicionCruda | null>;
  // ⚰️ Aquí vivía `restaurarHtml` (KEEP-BEST): devolver el documento al
  // estado previo cuando el ciclo de arreglo no bajaba el número de
  // problemas. `12f6a11e` retiró ese revert —«el usuario le pidió un cambio
  // a Len, Len lo hizo, y se lo deshacíamos sin preguntar»— y la dependencia
  // se quedó declarada, implementada en la ruta y llamada por NADIE.
  // Barrida el 2026-09-04. Para deshacer está el Undo, que es del usuario, y
  // `loop.test.ts` sigue vigilando que el bucle no revierta solo.
  /** Stream con herramientas DESACTIVADAS (toolMode "none"), usado SOLO para
   *  redactar un cierre cuando se agota un tope de presupuesto — así el turno
   *  termina con un resumen útil ("hice X, faltó Y", en el idioma del usuario)
   *  en vez de un error rojo. Si se omite (o no produce texto), agotar un tope
   *  emite el error codificado como antes. El route lo enlaza al mismo provider. */
  closeOut?(messages: Message[]): AsyncIterable<StreamEvent>;
  runTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  emit(ev: AgentStreamEvent): void;
  /** Lo que el usuario haya escrito mientras el turno corría, o `null`.
   *
   *  Se llama UNA vez por vuelta, arriba del bucle, y CONSUME lo que devuelve
   *  (ver `lib/agent/direcciones.ts`): si se quedara, el modelo leería la misma
   *  corrección en cada vuelta como si fuera nueva. Ausente ⇒ el bucle se
   *  comporta exactamente como antes de que esto existiera. */
  leerDireccion?(): string | null;
  /** Se llama UNA vez, en cuanto una herramienta escribe en la base. El route
   *  lo usa para saber que el turno ya mutó incluso si el bucle revienta
   *  después y nunca llega a devolver un resultado. */
  onMutacion?(): void;
  maxTurns?: number; // default 6
  maxToolCalls?: number; // default 10
}

export interface AgentLoopResult {
  finalText: string;
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number };
  turns: number;
  toolCalls: number;
  /** F2-T9 billing ruling: true when the turn ended via stopReason error/
   *  cancelled/max_tokens, or the maxTurns/maxToolCalls caps — the route
   *  debits 0 credits in that case. False for a clean end_turn finish,
   *  INCLUDING a turn where a tool returned {ok:false} as data (the turn
   *  still completed) and a turn that ended waiting on a confirm card. */
  terminalError: boolean;
  /** CUÁL de los dos finales fue, porque `terminalError` los confunde.
   *
   *  `terminalError` es true tanto si el turno REVENTÓ (503, cancelado,
   *  max_tokens) como si AGOTÓ UN TOPE — y son cosas distintas: lo primero es
   *  un fallo, lo segundo es el agente quedándose sin cuerda a media faena.
   *  Peor aún, el caso del tope suele ser el MENOS visible: cuando `closeOut`
   *  redacta el cierre elegante no se emite ningún evento `error`, así que
   *  quien mire los eventos ve un turno que terminó mal y ni siquiera un
   *  código que lo explique.
   *
   *  MEDIDO el 2026-08-30 en la batería del Agente: tres de los ocho fallos
   *  decían «terminó en error terminal» y nada más. Distinguirlos aquí es lo
   *  que convierte «falló» en «se quedó sin pasos», que es un arreglo
   *  distinto. Null = no fue un tope. */
  topeAlcanzado: TopeCode | null;
  /** POR QUÉ reventó, cuando reventó. `null` si no reventó.
   *
   *  El código ya existía —el bucle lo emite al cliente en el evento `error`—
   *  pero no volvía al llamador, así que la ruta escribía LA MISMA línea en el
   *  diario para «el dueño pulsó ■» y para «Fireworks se cayó». Son cosas
   *  opuestas: una es el producto funcionando y la otra una avería.
   *
   *  MEDIDO el 2026-09-03, y en carne propia: un turno abortado porque el panel
   *  se remontó se persiguió como un fallo del proveedor —incluida una
   *  re-corrida de un documento de 206 KB para descartar el tamaño— porque el
   *  único rastro era `terminal-error turn — 0 credits`. Distinto de
   *  `topeAlcanzado`, que es quedarse sin cuerda, no reventar. */
  errorCode: AgentErrorCode | null;
  /** Documentos caducados que la poda retiró del historial en este turno.
   *  La poda es la única etapa que quita bytes del turno y era la única sin
   *  ninguna traza: el contador se calculaba y el llamador lo descartaba. */
  documentosPodados: number;
  /** Alguna herramienta ESCRIBIÓ en la base durante este request.
   *
   *  Va junto a `terminalError` a propósito: la combinación de los dos es el
   *  caso que hacía daño. Un turno que guardó y luego se cortó (503, cancelado,
   *  max_tokens) se pintaba ROJO, no se persistía en la transcripción y no
   *  dejaba Undo — mientras el cambio vivía ya en la base. El usuario pulsaba
   *  «Reintentar» y aplicaba el mismo cambio DOS veces. */
  mutoDurable: boolean;
}

/** Lo que queda en el historial en lugar del documento retirado. Dice POR QUÉ
 *  se fue y qué hacer, porque un hueco sin explicación invita al modelo a
 *  inventarse los ids que ya no ve. */
export const DOCUMENTO_PODADO =
  "[documento retirado del historial: sus data-op-id ya no son válidos porque hubo ediciones después. Si necesitas editar, pide leer_estado con incluir_documento=true para obtener el documento fresco.]";

/**
 * El corte entre el documento y todo lo demás dentro del bloque de contexto.
 *
 * Es texto que el modelo LEE —dice la verdad sobre lo que acaba y lo que
 * empieza— y a la vez el ancla que permite retirar el documento sin adivinar
 * dónde termina. Un marcador invisible sería más limpio de mirar y menos
 * honesto: aquí no hay nada escondido en el prompt.
 *
 * Vive AQUÍ y no en `context.ts`, que es quien lo escribe, por la regla de la
 * cabecera de este fichero: `loop.ts` no puede importar valores de módulos que
 * arrastren los bindings nativos, y `context.ts` sí los arrastra por su cadena.
 * Así que el bucle es el dueño del par —el marcador y lo que va en su lugar— y
 * el contexto lo importa de aquí. La flecha va en el único sentido que puede.
 */
export const FIN_DEL_DOCUMENTO = "\n\n=== FIN DEL DOCUMENTO ===\n\n";

/**
 * PODA LOS DOCUMENTOS VIEJOS DEL HISTORIAL — deja SÓLO el último.
 *
 * El bucle reenvía todo lo acumulado en cada vuelta, y `editar_pagina` NO
 * devuelve el documento: el modelo tiene que volver a pedirlo con
 * `leer_estado incluir_documento=true`. La propia instrucción de corrección
 * visual se lo ordena. Así que un turno que edita y luego recibe crítica lleva
 * DOS documentos completos en contexto, y en una página mediana eso son ~22k
 * tokens cada uno.
 *
 * El viejo no es sólo caro, es ENGAÑOSO: tras una edición los data-op-id
 * cambian —lo dice la ficha de la propia herramienta— así que el documento
 * anterior describe un mapa que ya no existe. Retirarlo sale más barato Y más
 * correcto.
 *
 * Medido el 2026-08-28 sobre las páginas reales: el prefijo fijo (prompt de
 * sistema + herramientas) son 13.036 tokens que se repiten en cada vuelta; el
 * documento va de 17k a 308k. El documento es lo que domina, y duplicarlo es
 * lo único de todo esto que no compra nada.
 *
 * Pura a propósito: muta los objetos que recibe y no devuelve nada, igual que
 * el resto del bucle, pero no toca red ni estado — se puede comprobar sola.
 */
export function podarDocumentosViejos(messages: Message[]): number {
  // POR RANURA, y ésa es la diferencia con «deja sólo el último de todos».
  //
  // El documento ACTIVO —el bloque de contexto y cada `response.documento`— es
  // una sola ranura: todos describen la misma página con data-op-id, así que
  // el último manda y los anteriores son mapas caducados.
  //
  // 🔴 PERO `pagina_vista.documento` NO ES ESA RANURA. Es «mirar otra página
  // sin mudarse», y viaja SIN data-op-id a propósito (es para leer, no para
  // editar). Meterlo en el mismo saco borraría la página B en cuanto llegara un
  // documento de la página A — dentro del MISMO turno, y justo después de que
  // el modelo pidiera verla. Así que cada página mirada tiene su propia ranura
  // y compite sólo consigo misma.
  const vistas = new Set<string>();
  const ACTIVO = "\u0000activo";
  let podados = 0;
  // De atrás hacia delante: el PRIMERO que encuentra de cada ranura es el
  // vigente y se queda.
  for (let i = messages.length - 1; i >= 0; i--) {
    const mensaje = messages[i];
    const respuestas = mensaje.functionResponses;
    if (respuestas) {
      for (let j = respuestas.length - 1; j >= 0; j--) {
        const r = respuestas[j].response;
        const vista = r.pagina_vista;
        if (vista && typeof vista === "object") {
          const v = vista as { pagina?: unknown; documento?: unknown };
          if (typeof v.documento === "string") {
            const ranura = `mirada:${typeof v.pagina === "string" ? v.pagina : ""}`;
            if (vistas.has(ranura)) {
              v.documento = DOCUMENTO_PODADO;
              podados += 1;
            } else {
              vistas.add(ranura);
            }
          }
        }
        if (typeof r.documento === "string") {
          if (vistas.has(ACTIVO)) {
            r.documento = DOCUMENTO_PODADO;
            podados += 1;
          } else {
            vistas.add(ACTIVO);
          }
        }
      }
    }
    // EL BLOQUE DE CONTEXTO, que es el documento MÁS VIEJO de todos y el que
    // más pesa. Se construye una vez al abrir el turno y se reenviaba entero en
    // cada vuelta del bucle — con sus data-op-id ya caducados en cuanto el
    // modelo edita algo. Es la misma ranura que `response.documento`: la página
    // activa, con ids.
    if (typeof mensaje.content === "string") {
      const corte = mensaje.content.indexOf(FIN_DEL_DOCUMENTO);
      if (corte !== -1) {
        if (vistas.has(ACTIVO)) {
          mensaje.content = DOCUMENTO_PODADO + mensaje.content.slice(corte);
          podados += 1;
        } else {
          vistas.add(ACTIVO);
        }
      }
    }
  }
  return podados;
}

const DEFAULT_MAX_TURNS = 6;
const DEFAULT_MAX_TOOL_CALLS = 10;

// No-progress guard: the SAME tool call (name + identical args) that has already
// returned ok:false this many times is refused the next time instead of run
// again — the model gets a nudge to change approach rather than looping on a
// dead action (e.g. retrying editar_pagina against a stale op-id). Only FAILING
// repeats are guarded; a call that succeeds is never blocked.
const FAIL_REPEAT_LIMIT = 2;

// Injected as a final user turn when a cap is hit and a closeOut stream exists —
// asks the (tools-disabled) model to close gracefully in the user's language.
// Lo que se le dice cuando cierra el turno sin haber llamado a ninguna
// herramienta y sin haber tocado nada. Mismo contenido que el aviso de
// `turnoAnteriorMudo` en context.ts —que es el que ya se sabe que funciona—
// pero entregado DENTRO del turno en vez de en el siguiente.
const INSISTE_SIN_HERRAMIENTAS =
  "SISTEMA (el usuario NO escribió esto): cerraste el turno SIN llamar a ninguna herramienta, así que la página NO ha cambiado. Si tu respuesta anunciaba un cambio —«agrego», «hago», «listo»— ese cambio NO existe: aplícalo AHORA con la herramienta que corresponda, y no vuelvas a decir que lo hiciste hasta haberla llamado. Si en cambio tu respuesta era una explicación, una pregunta o una negativa honesta, estaba bien: repítela tal cual y cierra.";

const WRAP_UP_INSTRUCTION =
  "SISTEMA: Alcanzaste el límite de pasos para este turno y ya no puedes usar herramientas. Cierra hablándole al usuario en SU idioma: resume brevemente qué alcanzaste a hacer y qué quedó pendiente, y dile que te lo pida de nuevo para continuar. No afirmes haber hecho lo que no se aplicó.";

// ⚰️ Aquí vivía `buildVisualFixInstruction`, que redactaba «SISTEMA
// (verificación visual automática — el usuario NO escribió esto)» y le mandaba
// al modelo arreglar lo que nuestros ojos habían juzgado. `12f6a11e` retiró ese
// ciclo el 2026-09-04 y la función se quedó SIN UNA SOLA LLAMADA: `tsc` no la
// caza porque `tsconfig.json` no pone `noUnusedLocals`, y `lint` tampoco.
// Barrida el mismo día. Que corrige el usuario y no la tubería lo sujeta
// `loop.test.ts` («le inyectamos un arreglo que el usuario no pidió»).

/**
 * LA LISTA DE TAREAS, PASADA POR LA EVIDENCIA.
 *
 * 🔴 QUÉ PROBLEMA RESUELVE. Un turno de varios pasos —«cámbiame el titular, pon
 * el teléfono nuevo y publícala»— acababa con el modelo enumerando las tres
 * cosas como hechas. Que las tres se hicieran no lo comprobaba nadie: bastaba
 * con que UNA llamada saliera bien para que el texto final hablara en plural.
 * Es la misma familia que las cuatro auditorías del 2026-09-01 —reportar éxito
 * sin haberlo hecho—, y aquí el modelo ni siquiera está mintiendo: pierde el
 * hilo a la tercera herramienta.
 *
 * QUÉ CUENTA COMO EVIDENCIA, y es lo único que cuenta: una llamada que de
 * verdad movió algo. `cambio === "cambio"` (hash antes ≠ hash después, la
 * evidencia que `declararCambio` ya estampaba y que nadie leía) o una escritura
 * durable. NO cuenta `sin_cambio`, ni `no_se`, ni una lectura, ni un `ok:true`
 * a secas — que es justo lo que hacía pasar por buenos los turnos a medias.
 */
function tareasSinEvidencia(tareas: readonly string[], evidencias: number): string[] {
  // Se asignan EN ORDEN, que es el orden en el que el modelo dijo que las iba a
  // hacer. No se pretende saber qué llamada fue cada tarea —no hay forma— y por
  // eso el aviso habla de cuántas quedan sin evidencia, no de cuál es cuál.
  return tareas.slice(Math.min(evidencias, tareas.length));
}

function buildEvidenceInstruction(pendientes: readonly string[], hechas: number, total: number): string {
  return (
    `SISTEMA (el usuario NO escribió esto): declaraste ${total} tarea(s) y sólo tengo evidencia de ${hechas} cambio(s) real(es) — ` +
    `una llamada que movió bytes de la página o escribió en la base. Sin evidencia se quedan: ${pendientes.map((t) => `«${t}»`).join(", ")}. ` +
    "Puede que las hicieras y no lo parezca, o puede que se te quedaran por el camino. Haz AHORA las que falten con la herramienta que corresponda. " +
    "Si alguna no se puede hacer, o ya estaba hecha, dile al usuario EXACTAMENTE eso al cerrar — lo que no vale es enumerarlas todas como hechas."
  );
}

/** Order-stable JSON of a tool call's args, so a repeat with the same values
 *  keys identically regardless of property order (the no-progress guard's key). */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

// Product finding: photo hunts (elegir_foto) and mid-chain state re-reads
// (leer_estado) are read-only — they never mutate the project — but a photo
// search that takes a few tries was eating the same maxToolCalls budget as
// real edits. These two are exempt from that counter. They still count
// toward ABSOLUTE_MAX_TOOL_CALLS below, so a runaway loop can't spin forever
// just because it's calling exempt tools.
//
// 🔴 `buscar_en_pagina` entra el 2026-09-01, y no es un detalle: la petición
// que la justifica —«cambia el teléfono», y está en cuatro sitios de tres
// páginas— gasta buscar + (mudarse + editar) × 3. Si la búsqueda descontara del
// mismo presupuesto que las ediciones, la herramienta que existe para no dejar
// el dato viejo a medias sería justo la que hace que el turno se quede sin
// cuerda antes de terminar. Es el mismo fallo que ya se midió con las fotos
// (el bug del hero de terror).
//
// `preguntar` entra por lo mismo y por una razón de más: cierra el turno, así
// que descontarla del presupuesto sería cobrarle al usuario por la vuelta en la
// que el Agente decide callarse y esperarle. `revertir_ultimo_cambio` NO entra
// — escribe en la base.
// `declarar_tareas` tampoco: escribir la lista no hace nada, y cobrarle al
// usuario una acción por planificar sería cobrarle por el paso que existe para
// que el turno salga bien.
/**
 * LA LLAMADA MAL ESCRITA.
 *
 * Una errata en el nombre costaba tres cosas: la plaza de presupuesto —que se
 * cobra ANTES de ejecutar—, una firma fallida, y una tarjeta roja en el taller
 * con un nombre que no existe. El turno seguía, pero más pobre, y por un fallo
 * de tecleo.
 *
 * OpenCode tiene dos redes que aquí no había: `experimental_repairToolCall`
 * (`llm.ts:296-312`) arregla el nombre cuando sólo difiere en mayúsculas y lo
 * reintenta, y la herramienta `invalid` (`tool/invalid.ts:9-21`) devuelve una
 * corrección legible en vez de romper el turno.
 *
 * Con las cuatro puertas de edición —`editar_texto`, `editar_html`,
 * `editar_atributos`— los nombres se parecen entre sí, así que esto pasó de
 * conveniente a necesario.
 *
 * La distancia se calcula sobre minúsculas, y con tope 1: a partir de ahí ya no
 * es una errata, es otra herramienta, y adivinar cuál es peor que preguntar.
 */
function distanciaUno(a: string, b: string): boolean {
  if (a === b) return true;
  const [corta, larga] = a.length <= b.length ? [a, b] : [b, a];
  if (larga.length - corta.length > 1) return false;
  let i = 0;
  let j = 0;
  let visto = false;
  while (i < corta.length && j < larga.length) {
    if (corta[i] === larga[j]) { i += 1; j += 1; continue; }
    if (visto) return false;
    visto = true;
    if (corta.length === larga.length) { i += 1; j += 1; } else { j += 1; }
  }
  return true;
}

/** La más parecida de las declaradas, para sugerirla cuando no se puede
 *  arreglar sola. Sin tope: si no hay ninguna cerca, el nombre igual ayuda
 *  —le recuerda al modelo qué existe— y es lo único que se le puede ofrecer. */
function masParecida(nombre: string, declaradas: readonly string[]): string | null {
  const bajo = nombre.toLowerCase();
  let mejor: string | null = null;
  let mejorComun = 0;
  for (const d of declaradas) {
    const otro = d.toLowerCase();
    let comun = 0;
    while (comun < bajo.length && comun < otro.length && bajo[comun] === otro[comun]) comun += 1;
    if (comun > mejorComun) { mejorComun = comun; mejor = d; }
  }
  return mejorComun >= 4 ? mejor : null;
}

/** `{ arreglado }` cuando es una errata reparable; `{ sugerido }` cuando no.
 *  Exportada para la prueba: el bucle la usa una vez por llamada. */
export function repararNombre(
  nombre: string,
  declaradas: readonly string[],
): { arreglado: string } | { sugerido: string | null } {
  if (declaradas.includes(nombre)) return { arreglado: nombre };
  const bajo = nombre.toLowerCase();
  for (const d of declaradas) {
    if (d.toLowerCase() === bajo) return { arreglado: d };
  }
  for (const d of declaradas) {
    if (distanciaUno(bajo, d.toLowerCase())) return { arreglado: d };
  }
  return { sugerido: masParecida(nombre, declaradas) };
}

const READ_ONLY_TOOLS = new Set([
  "leer_estado",
  "elegir_foto",
  // Preguntar qué se ve no cambia la página. Como `elegir_foto`, no descuenta
  // presupuesto de acciones: su propio tope por turno es lo que la contiene, y
  // cobrarle una acción al Agente por COMPROBAR antes de editar sería cobrarle
  // justo por el paso que evita la edición equivocada.
  "mirar_pagina",
  "buscar_en_pagina",
  "preguntar",
  "declarar_tareas",
]);
// Hard safety net independent of maxToolCalls: counts every tool call,
// exempt or not. A model stuck in a loop must still die eventually.
const ABSOLUTE_MAX_TOOL_CALLS = 20;
/** Cuántas vueltas gana el turno cuando el usuario corrige el rumbo.
 *
 *  POR QUÉ SE LE DA MÁS: corregir a media faena es la señal más barata y más
 *  fiable que vamos a tener nunca — el dueño acaba de gastar su atención en
 *  decirnos por dónde. Si la corrección llega en la vuelta 5 de 6 y no hay
 *  presupuesto para actuar, la hemos leído para nada y le hemos hecho perder
 *  el tiempo dos veces. */
const VUELTAS_POR_DIRECCION = 2;
/** Y el techo, para que corregir en bucle no sea barra libre. */
const ABSOLUTE_MAX_TURNS = 12;

interface PendingCall {
  name: string;
  args: Record<string, unknown>;
  /** Gemini 3 thought signature, echoed verbatim into the replayed
   *  assistant turn's `functionCalls` entry — see lib/ai-gateway.ts's
   *  `FunctionCall.thoughtSignature` doc comment. */
  thoughtSignature?: string;
}

export async function runAgentLoop(args: AgentLoopArgs): Promise<AgentLoopResult> {
  let maxTurns = args.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxToolCalls = args.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;

  const messages = [...args.messages];
  let finalText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let turns = 0;
  // Only turns that MUTATE count toward maxTurns. A turn whose calls were all
  // read-only (elegir_foto photo hunts, leer_estado re-reads) is exempt —
  // otherwise the turn cap silently defeats the same read-only exemption
  // maxToolCalls already grants (READ_ONLY_TOOLS), and a photo hunt for a genre
  // the curated catalog lacks dies on turn_limit before the model ever edits
  // (the terror-hero bug). ABSOLUTE_MAX_TOOL_CALLS still bounds a read-only
  // chain so it can't spin forever.
  let mutatingTurns = 0;
  let toolCalls = 0; // total across the loop (read-only + budgeted) — what the result/done event reports
  let budgetedToolCalls = 0; // excludes READ_ONLY_TOOLS — checked against maxToolCalls
  // No-progress guard state (spans turns within this request): signature -> how
  // many times that exact call has returned ok:false.
  const failedSignatures = new Map<string, number>();
  // F5 — verificación visual: el último documento emitido por un tool este
  // request (lo que el usuario está viendo en el canvas) y si el ciclo de
  // verificación ya corrió (corre a lo sumo UNA vez por request — un segundo
  // ciclo podría oscilar entre dos arreglos y quemar presupuesto sin fin).
  let lastMutation: { html: string; page: string | null; taggedHtml?: string } | null = null;
  // ⚰️ Aquí vivían `verificaciones`, `problemasPrevios` y `mejorCandidato`
  // (KEEP-BEST), las tres del ciclo de arreglo que se retiró en `12f6a11e`.
  // `mejorCandidato` ya no se leía en ninguna parte; las otras dos sólo
  // alimentaban una segunda pasada que era inalcanzable. Ver el bloque de los
  // ojos, más abajo, para el porqué entero.
  /** Qué defectos medidos se le han dicho YA al modelo este turno, y el fusible
   *  del medidor. Vive aquí —y no en la ruta— porque su vida es exactamente la
   *  de este bucle: una tanda no debe repetirle a la siguiente lo que ya oyó. */
  const avisos = new AvisosDelTurno();
  /** El último documento que se midió. Sin esto, una tanda que sólo lee o que
   *  cambia AJUSTES volvería a arrancar Chromium sobre la misma página. */
  let ultimoMedido: string | null = null;
  /**
   * Mide la página recién guardada y devuelve LO NUEVO, listo para viajar.
   *
   * Devuelve `""` —no `null`— porque su destino es el `content` del mensaje que
   * lleva las respuestas de las herramientas, y ese campo era `""` antes de que
   * esto existiera: una página sana tiene que dejar el mensaje byte a byte
   * igual que ayer.
   *
   * 🔴 SE MIDE EL GEMELO ETIQUETADO. Sin `taggedHtml` las sondas salen sin
   * `data-op-id` y el aviso deja de ser accionable: se convierte en «algo se
   * sale», que es justo el aviso que el modelo no puede arreglar. Por eso se
   * pide y no se cae al documento visible.
   */
  const medirYRedactar = async (): Promise<string> => {
    if (!args.medirParaElModelo || !lastMutation?.taggedHtml) return "";
    // El fusible: tres fallos seguidos y no se vuelve a intentar este turno.
    if (avisos.apagado) return "";
    // Ya medido: una tanda que no tocó el documento (ajustes, módulos) no paga
    // un arranque de navegador por nada.
    if (lastMutation.taggedHtml === ultimoMedido) return "";
    ultimoMedido = lastMutation.taggedHtml;
    let medicion: MedicionCruda | null = null;
    try {
      medicion = await args.medirParaElModelo(lastMutation.taggedHtml);
    } catch {
      medicion = null;
    }
    if (!medicion) {
      // FAIL-SOFT, y CONTADO. No medir no es medir bien, pero tampoco puede
      // tumbar un turno: el usuario pidió un cambio y el cambio está hecho.
      if (avisos.fallo()) {
        // eslint-disable-next-line no-console
        console.warn(
          `[agent] la medición tras editar se apaga este turno tras ${AvisosDelTurno.MAX_FALLOS} fallos seguidos`,
        );
      }
      return "";
    }
    avisos.ok();
    return avisos.nuevos(medicion) ?? "";
  };

  /** Las tareas que el modelo declaró con `declarar_tareas`, en su orden. */
  let tareas: string[] = [];
  /** Llamadas que de verdad movieron algo. Ver `tareasSinEvidencia`. */
  let evidencias = 0;
  /** La lista se reclama UNA vez: si el modelo cierra otra vez sin completarla,
   *  se le deja cerrar y que lo diga él. Insistir dos veces es quemarle el
   *  presupuesto al usuario en una discusión. */
  let yaSeExigioEvidencia = false;
  // ¿Ya se le insistió una vez por cerrar sin llamar a nada? Ver el bloque de
  // `calls.length === 0`.
  let yaSeInsistio = false;

  /** ¿Escribió algo en la base este request? Ver `AgentLoopResult.mutoDurable`. */
  let mutoDurable = false;
  /** Cuántos documentos caducados retiró la poda en todo el turno. Ver el
   *  comentario en la llamada a `podarDocumentosViejos`. */
  let documentosPodados = 0;

  const buildResult = (
    terminalError: boolean,
    topeAlcanzado: TopeCode | null = null,
    errorCode: AgentErrorCode | null = null,
  ): AgentLoopResult => ({
    finalText,
    usage: { inputTokens, outputTokens, cachedTokens },
    turns,
    toolCalls,
    terminalError,
    topeAlcanzado,
    errorCode,
    mutoDurable,
    documentosPodados,
  });

  // A budget cap was hit. If a tools-disabled closeOut stream is available, let
  // the model compose a graceful closing message — emitted as normal `text`, so
  // the panel renders a normal assistant turn, NOT a red error card (chat-panel
  // shows the red card only when an `error` event arrives). Ends as a 0-credit
  // terminal either way. If closeOut is absent or yields no text, emit the coded
  // error as before so the user is never left with nothing.
  // `TopeCode` y no `AgentErrorCode`: sus dos únicos llamadores pasan
  // turn_limit/tool_limit, y estrecharlo aquí es lo que deja que el código
  // viaje al resultado sin un cast.
  const finishOnCap = async (code: TopeCode): Promise<AgentLoopResult> => {
    if (args.closeOut) {
      let wrapText = "";
      for await (const ev of args.closeOut([
        ...messages,
        { role: "user", content: WRAP_UP_INSTRUCTION },
      ])) {
        if (ev.type === "text_delta") {
          wrapText += ev.text;
          args.emit({ type: "text", text: ev.text });
        } else if (ev.type === "usage") {
          inputTokens += ev.inputTokens;
          outputTokens += ev.outputTokens;
          cachedTokens += ev.cachedTokens;
        }
        // function_call / done ignored — tools are off on this stream.
      }
      if (wrapText.trim().length > 0) {
        finalText = wrapText;
        return buildResult(true, code);
      }
    }
    args.emit({ type: "error", message: "El agente alcanzó su límite de pasos", code });
    return buildResult(true, code);
  };

  while (true) {
    // ─── ¿EL USUARIO HA CORREGIDO EL RUMBO? ──────────────────────────────
    //
    // Entre vueltas y ANTES de llamar al modelo, que es el único momento
    // seguro. A mitad de una herramienta, jamás: una edición a medio aplicar
    // es peor que una vuelta perdida.
    //
    // Y ANTES del tope, no después: si la corrección llega justo cuando se
    // acaba el presupuesto, leerla y salir sería lo peor de los dos mundos.
    const direccion = args.leerDireccion?.() ?? null;
    if (direccion) {
      messages.push({
        role: "user",
        // El texto del usuario VERBATIM. El marco de alrededor es del servidor
        // y dice sólo lo que el modelo no puede saber por su cuenta: que esto
        // llegó mientras trabajaba, no al principio.
        content: `[El usuario te ha escrito mientras trabajabas. Léelo y ajusta antes de tu siguiente paso.]\n${direccion}`,
      });
      args.emit({ type: "direccion", texto: direccion });
      maxTurns = Math.min(ABSOLUTE_MAX_TURNS, maxTurns + VUELTAS_POR_DIRECCION);
    }
    if (mutatingTurns >= maxTurns) {
      return await finishOnCap("turn_limit");
    }
    turns += 1;

    let turnText = "";
    const calls: PendingCall[] = [];
    let sawError = false;
    /** El MISMO código que se le manda al cliente, para que vuelva también al
     *  llamador. Se pone junto a cada `emit`, no después, para que no puedan
     *  discrepar. */
    let errorCode: AgentErrorCode | null = null;

    for await (const ev of args.openStream(messages)) {
      if (ev.type === "text_delta") {
        turnText += ev.text;
        args.emit({ type: "text", text: ev.text });
      } else if (ev.type === "function_call") {
        calls.push({
          name: ev.name,
          args: ev.args,
          ...(ev.thoughtSignature ? { thoughtSignature: ev.thoughtSignature } : {}),
        });
      } else if (ev.type === "usage") {
        inputTokens += ev.inputTokens;
        outputTokens += ev.outputTokens;
        cachedTokens += ev.cachedTokens;
      } else if (ev.type === "done") {
        // A stream that ends on anything but a clean end_turn must NOT read
        // as success: error (SAFETY/RECITATION/5xx), cancelled (abort), and
        // max_tokens (truncated response) all surface as an error event and
        // stop the loop — a truncated turn's partial text is not a real answer.
        if (ev.stopReason.kind === "error") {
          args.emit({ type: "error", message: ev.stopReason.error, code: "upstream" });
          errorCode = "upstream";
          sawError = true;
        } else if (ev.stopReason.kind === "cancelled") {
          args.emit({ type: "error", message: "El agente fue cancelado.", code: "cancelled" });
          errorCode = "cancelled";
          sawError = true;
        } else if (ev.stopReason.kind === "max_tokens") {
          args.emit({
            type: "error",
            message: "El agente se quedó sin espacio de respuesta — intenta un pedido más corto.",
            code: "truncated",
          });
          errorCode = "truncated";
          sawError = true;
        }
      }
    }

    if (sawError) {
      // `buildResult`, no un objeto a mano: esta rama era una copia literal del
      // constructor y por eso se quedó sin `mutoDurable` al añadirlo — que es
      // justo la rama donde más falta hace.
      return buildResult(true, null, errorCode);
    }

    if (calls.length === 0) {
      // 🔴 ANUNCIÓ LA EDICIÓN Y NO LA HIZO. Se le pide UNA vez, aquí mismo.
      //
      // MEDIDO en producción el 2026-08-31, dos veces en tres minutos: a
      // «agregame en el menu un link para ir a la page de nosotros» el modelo
      // contestó «¡Claro! Agrego un enlace "Nosotros"… El nav está en
      // data-op-id="9"… Listo, agregué el enlace» —con el id CORRECTO— y no
      // llamó a nada. 203 tokens de salida: sólo la prosa. El usuario vio
      // «Listo» junto a «Nothing on the page changed», tuvo que escribir «no
      // agregaste el nosotros», y el reintento funcionó a la primera.
      //
      // El aviso que lo arregla YA EXISTE (`turnoAnteriorMudo`, en
      // context.ts): dice «tu turno anterior NO llamó a ninguna herramienta…
      // aplícalo AHORA». Lo único que le faltaba era llegar a tiempo — sólo se
      // monta en el turno SIGUIENTE, o sea después de que el usuario se queje.
      //
      // POR QUÉ ES BARATO, que es lo que lo hace viable: esta segunda vuelta
      // reusa el prefijo entero (sistema + herramientas + contexto + el mensaje
      // del usuario), así que es un acierto de caché. Medido sobre los turnos
      // reales: ~40k de entrada casi toda cacheada ≈ 0,4 créditos, contra los
      // ~4 que costó el turno fantasma y los ~30 del reintento que el usuario
      // acabó pagando al quejarse.
      //
      // UNA sola vez por petición, y sólo si NADA se tocó: un turno que ya mutó
      // y cierra está bien cerrado, y una pregunta legítima («¿qué modelo
      // uso?») se contesta igual en la segunda vuelta — el modelo repite su
      // respuesta y se acabó. No se intenta adivinar si el texto «promete» algo:
      // eso sería una heurística sobre prosa en diez idiomas.
      // `toolCalls === 0` —ninguna llamada en TODO el request—, no
      // `!mutoDurable`: son cosas distintas y la diferencia la cazó una prueba
      // que ya existía. Un turno que llamó a una herramienta ACTUÓ, aunque esa
      // herramienta no marque mutación durable (activar_modulo, publicar…);
      // empujarlo sería pagar una vuelta de más por un turno que hizo su
      // trabajo. Lo que se corrige es cerrar sin haber llamado a NADA.
      if (toolCalls === 0 && !yaSeInsistio && turnText.trim().length > 0) {
        yaSeInsistio = true;
        messages.push({ role: "assistant", content: turnText });
        messages.push({ role: "user", content: INSISTE_SIN_HERRAMIENTAS });
        continue;
      }

      // LA LISTA DE TAREAS, ANTES QUE LOS OJOS. No tiene sentido juzgar cómo
      // quedó la página si media petición no se ha hecho todavía: primero se
      // completa el trabajo, y lo que se verifica es el resultado final.
      //
      // Se reclama UNA vez y sólo con presupuesto para actuar — pedirle que
      // termine algo que ya no puede hacer sería gastarle una vuelta al usuario
      // para llegar al mismo sitio, que es la misma regla que la de los ojos.
      const pendientes = tareasSinEvidencia(tareas, evidencias);
      if (
        pendientes.length > 0 &&
        !yaSeExigioEvidencia &&
        mutatingTurns < maxTurns &&
        budgetedToolCalls < maxToolCalls &&
        toolCalls < ABSOLUTE_MAX_TOOL_CALLS
      ) {
        yaSeExigioEvidencia = true;
        messages.push({ role: "assistant", content: turnText });
        messages.push({
          role: "user",
          content: buildEvidenceInstruction(pendientes, evidencias, tareas.length),
        });
        continue;
      }

      // F5 — los ojos: el modelo quiere cerrar y este request mutó el
      // documento. Antes de dejarlo ir, se mira UNA vez y se dice lo que se ve.
      //
      // ⚰️ AQUÍ VIVÍA UNA SEGUNDA PASADA, la que comprobaba «si el arreglo
      // ARREGLÓ» — sólo la capa determinista, sin visión. Retirada en el
      // barrido del 2026-09-04: `12f6a11e` se había llevado el ciclo de arreglo
      // esa misma mañana, y sin ciclo no hay arreglo que re-comprobar. Estaba
      // INALCANZABLE desde entonces, no sólo inútil: su guarda pedía
      // `problemasPrevios > 0`, y el único sitio que ponía esa cuenta por
      // encima de cero era la rama `roto`, que hace `return` dos líneas
      // después. O sea que `segunda` no podía ser cierto nunca — y el fichero
      // seguía describiendo con detalle un comportamiento que el código no
      // podía ejecutar, que es la forma más cara de mentir que tiene un repo.
      //
      // Con ella se van `verificaciones`, `problemasPrevios`, el campo
      // `problemas` de `VerifyOutcome` y `soloDeterminista` en toda la cadena.
      //
      // EL PRESUPUESTO SÍ SE QUEDA, con otro motivo. Antes era «sin presupuesto,
      // encontrar un problema que ya no se puede arreglar no sirve»; ya no
      // arreglamos, así que decirlo serviría igual. Pero mirar cuesta un
      // arranque de Chrome y una llamada con visión, y cobrárselos a un turno
      // que ya agotó su cuerda es lo que este bloque nunca ha querido hacer.
      if (
        args.verifyTurn &&
        lastMutation &&
        mutatingTurns < maxTurns &&
        budgetedToolCalls < maxToolCalls &&
        toolCalls < ABSOLUTE_MAX_TOOL_CALLS
      ) {
        args.emit({ type: "action", tool: VERIFY_TOOL, status: "running", summary: "" });
        let verdict: VerifyOutcome;
        try {
          verdict = await args.verifyTurn({ ...lastMutation });
        } catch (e) {
          // Fail-open: los ojos jamás rompen un turno. Pero el turno sigue
          // sabiendo que NADIE MIRÓ — antes esto devolvía `ok: true` y el visto
          // bueno era indistinguible de una verificación de verdad.
          verdict = {
            estado: "no_mirado",
            motivo: e instanceof Error ? e.message : "la verificación lanzó",
          };
        }
        if (verdict.estado === "roto") {
          // ⚰️ EL CICLO DE ARREGLO Y EL REVERT, RETIRADOS (Jesús, 2026-09-04).
          //
          // Aquí pasaban dos cosas que el usuario no pidió:
          //
          //  1. Se le inyectaba al modelo un mensaje de sistema —literalmente
          //     «el usuario NO escribió esto»— mandándole arreglar lo que
          //     nuestros ojos habían juzgado, dentro del mismo turno.
          //  2. Si ese ciclo no bajaba el número de problemas, se DESHACÍA su
          //     edición y se restauraba el documento anterior (`restaurarHtml`).
          //
          // Lo segundo es exactamente lo que se retiró de Crear esta misma
          // mañana, en la otra superficie: tirar el trabajo del modelo porque
          // nuestro medidor no lo aprueba. El usuario le pidió un cambio a Len,
          // Len lo hizo, y se lo deshacíamos sin preguntar. Para deshacer ya
          // está el Undo, que es suyo.
          //
          // La regla es que corrige el USUARIO. Los ojos siguen mirando y siguen
          // DICIÉNDOLO —la tarjeta sale con `issues` y el texto del turno lo
          // cuenta—, pero el turno cierra con lo que el modelo hizo.
          //
          // 🔴 «Y EL TEXTO DEL TURNO LO CUENTA» NO ERA CIERTO (2026-09-04, la
          // misma tarde). La línea de abajo era `finalText = turnText`, y
          // `turnText` lo escribió el modelo ANTES de que los ojos miraran: sin
          // ciclo de arreglo el modelo nunca se entera de la crítica, así que no
          // había forma de que la contara. Lo medido llegaba a una tarjeta de
          // cuatro palabras y a ningún sitio más.
          //
          // Es la doctrina entera puesta del revés: se MIDE y se DICE, y quien
          // corrige es el usuario — que no puede pedir que se arregle algo que
          // nadie le ha dicho. Y era ASIMÉTRICO al revés: la rama `observado`,
          // que trae lo que NO se puede afirmar, sí se emitía; ésta, que trae
          // los defectos afirmables, no.
          //
          // Se emite igual que `observado` —verbatim, sin envoltorio nuestro— y
          // por su misma razón: `issues` viene en el idioma del usuario, y un
          // prefijo en español rompería los otros nueve. Va también a
          // `finalText` o desaparecería al recargar la conversación.
          // `warning`, no `done`: la etiqueta dice «con problemas» y hasta hoy
          // salía con el mismo tick verde que «sin problemas». Tampoco `error`
          // —la verificación no falló, encontró cosas— y ese matiz no es de
          // gusto: `status` lo leen el historial que se le manda al modelo y
          // los veredictos de los evals. Ver `agent-action-card.tsx`.
          args.emit({ type: "action", tool: VERIFY_TOOL, status: "warning", summary: "issues" });
          // SIN GUARDA DE DUPLICADO, y a diferencia de `observado` no hace
          // falta: allí la nota la escribe el mismo modelo que redactó el
          // turno, así que puede repetirla; aquí `critique` es la lista que
          // arma el SERVIDOR con los issues del revisor («- …\n- …»), y el
          // modelo no la ha visto nunca. Un `turnText.includes()` sobre varias
          // líneas con viñetas no puede dar cierto jamás: sería una condición
          // que se lee como un caso contemplado y no lo es.
          // Lo que SÍ se comprueba es que haya algo que decir: un `critique`
          // vacío emitiría una burbuja en blanco en la conversación. Hoy no
          // puede pasar —`parseVisualVerdict` convierte un `broken:true` sin
          // issues en `broken:false`— pero `verifyTurn` es una dependencia
          // inyectada, y esta rama no puede fiarse de quién la implemente.
          const critica = verdict.critique.trim();
          if (critica) {
            args.emit({ type: "text", text: critica });
            finalText = turnText.trim() ? `${turnText.trim()}\n\n${critica}` : critica;
          } else {
            finalText = turnText;
          }
          return buildResult(false);
        }
        // OBSERVADO: se vio algo, y no es un defecto afirmable. Contexto para
        // el cierre, no una orden — y NUNCA un ciclo de arreglo. Ver el
        // comentario de `VerifyOutcome`.
        if (verdict.estado === "observado") {
          // LA OBSERVACIÓN SE EMITE. No se empuja a `messages`.
          //
          // 🔴 La primera versión de esto hacía `messages.push(...)` «para que
          // el modelo se las cuente al usuario». Era una escritura MUERTA: el
          // turno cierra dos líneas más abajo, nadie vuelve a leer ese array, y
          // el turno siguiente reconstruye `messages` desde la base con
          // `buildAgentMessages`. Habría aparentado funcionar para siempre.
          //
          // Se emite como TEXTO, igual que hace la rama de `pregunta` más
          // abajo, y por su misma doctrina: el texto lo escribió el modelo con
          // visión, EN EL IDIOMA DEL USUARIO — el servidor decide CUÁNDO se
          // dice, no QUÉ se dice. Por eso va verbatim y sin envoltorio nuestro:
          // un prefijo en español rompería los otros nueve idiomas.
          //
          // Y va también a `finalText`, o al recargar la conversación
          // desaparecería — la misma avería con otro disfraz. De paso, así
          // entra en el historial y el turno siguiente ya lo sabe.
          //
          // ⚠️ COSTE CONOCIDO: en una página con marcadores intencionales, el
          // crítico los observa CADA turno, así que esto puede repetirse. La
          // guarda de abajo sólo caza la repetición literal. Reducirlo de
          // verdad pide recordar qué se dijo ya, y eso es otro trabajo.
          if (verdict.notas.length > 0) {
            const nota = verdict.notas.join(" ");
            if (!turnText.includes(nota)) {
              args.emit({ type: "text", text: nota });
              finalText = turnText.trim() ? `${turnText.trim()}\n\n${nota}` : nota;
            } else {
              finalText = turnText;
            }
            // eslint-disable-next-line no-console
            console.log(`[agent-verify] observado (no gasta): ${verdict.notas.join("; ")}`);
          } else {
            finalText = turnText;
          }
          args.emit({ type: "action", tool: VERIFY_TOOL, status: "done", summary: "ok" });
          return buildResult(false);
        }
        // Se miró y está bien.
        // `no_mirado` NO dispara ciclo de arreglo: no hay crítica que dar y
        // cobrarle al usuario una vuelta por una comprobación que no ocurrió
        // sería peor que no comprobar. Pero se DICE.
        // `no_mirado` también deja de salir con tick verde. La etiqueta se
        // arregló el 2026-09-04 por la mañana («sin comprobar») pero el icono
        // seguía diciendo lo contrario, que es justo el caso que el comentario
        // de `summaryLabel` describe: los ojos fallan ABIERTOS y eso enseñaba
        // el mismo visto bueno que una verificación de verdad.
        const noMiro = verdict.estado === "no_mirado";
        args.emit({
          type: "action",
          tool: VERIFY_TOOL,
          status: noMiro ? "warning" : "done",
          summary: noMiro ? "no-mirado" : "ok",
        });
      }
      finalText = turnText;
      // Igual que la rama de error: por el constructor, no a mano.
      return buildResult(false);
    }

    // A turn counts toward maxTurns only if it did something other than
    // read-only lookups — a hunt/read-only-only turn is "free" (see mutatingTurns).
    if (calls.some((c) => !READ_ONLY_TOOLS.has(c.name))) {
      mutatingTurns += 1;
    }

    const functionResponses: { name: string; response: Record<string, unknown> }[] = [];
    /** La pregunta con la que este turno se cierra, si alguna herramienta la
     *  produjo. Ver el bloque que la consume al salir del bucle de llamadas. */
    let pregunta = "";
    // Los nombres que el modelo puede llamar en ESTE turno. Salen de las
    // declaraciones que se le mandaron, no de una lista escrita a mano: una
    // lista a mano no avisa de lo que falta, y aquí faltarían justo las
    // herramientas nuevas — que son las que más se teclean mal.
    const declaradas = args.tools.map((t) => String((t as { name?: unknown }).name ?? ""));

    /**
     * LO QUE YA SE EJECUTÓ, AL HISTORIAL, ANTES DE CERRAR.
     *
     * `finishOnCap` se llama desde DENTRO de este bucle, y el push del par
     * assistant+functionResponses está después de él. Así que al agotar el tope
     * a mitad de tanda, las herramientas ya ejecutadas —con sus escrituras YA
     * en la base— no llegaban a `messages`, y el modelo que redacta el cierre
     * no las veía: cerraba contando un turno en el que no había hecho nada,
     * sobre una página que sí había cambiado. Y el cierre por tope es
     * justamente donde el usuario más necesita saber qué se hizo y qué no.
     *
     * Se anuncian SÓLO las llamadas que tienen respuesta. La que hizo saltar el
     * tope no llegó a ejecutarse, y anunciar una llamada sin su respuesta
     * desequilibra el protocolo de function-calling. Las respuestas se empujan
     * una por llamada y en orden, así que emparejarlas por índice es exacto.
     */
    const empujarLoEjecutado = () => {
      if (functionResponses.length === 0) return;
      messages.push({
        role: "assistant",
        content: turnText,
        functionCalls: calls.slice(0, functionResponses.length),
      });
      messages.push({ role: "user", content: "", functionResponses });
    };

    for (const original of calls) {
      // LA ERRATA SE ARREGLA ANTES DE COBRAR. El presupuesto se descuenta más
      // abajo, así que reparar aquí es lo que hace que un fallo de tecleo no
      // cueste una plaza.
      const reparo = declaradas.length ? repararNombre(original.name, declaradas) : { arreglado: original.name };
      if (!("arreglado" in reparo)) {
        // No hay herramienta que ejecutar, así que NO se emite tarjeta: pintar
        // una en rojo con un nombre inexistente le cuenta al usuario una avería
        // que no es suya. Se le devuelve al modelo una corrección legible y el
        // turno sigue, sin tocar presupuesto ni firmas fallidas.
        functionResponses.push({
          name: original.name,
          response: {
            ok: false,
            error_de_uso:
              `No existe ninguna herramienta llamada "${original.name}".` +
              (reparo.sugerido ? ` La más parecida es "${reparo.sugerido}".` : "") +
              " Llama a una de las que tienes declaradas, con su nombre exacto.",
          },
        });
        continue;
      }
      const call = reparo.arreglado === original.name
        ? original
        : { ...original, name: reparo.arreglado };

      // No-progress guard: this exact call already failed FAIL_REPEAT_LIMIT
      // times — don't run it again. Feed the model a nudge (as a functionResponse
      // so the FC protocol stays balanced) to change approach. A refused call
      // doesn't run, so it doesn't touch the caps; termination is still
      // guaranteed because a mutating turn advances maxTurns → finishOnCap.
      const sig = `${call.name}\u0000${stableStringify(call.args)}`;
      if ((failedSignatures.get(sig) ?? 0) >= FAIL_REPEAT_LIMIT) {
        functionResponses.push({
          name: call.name,
          response: {
            ok: false,
            error:
              "Ya intentaste esta misma acción con los mismos parámetros y falló varias veces. NO la repitas: cambia de enfoque (otra herramienta o parámetros distintos), o dile al usuario qué pudiste hacer y qué no.",
          },
        });
        continue;
      }

      // The absolute cap counts every call, exempt or not — a runaway loop
      // must still die even if it's only calling read-only tools.
      if (toolCalls >= ABSOLUTE_MAX_TOOL_CALLS) {
        empujarLoEjecutado();
        return await finishOnCap("tool_limit");
      }
      const readOnly = READ_ONLY_TOOLS.has(call.name);
      if (!readOnly) {
        if (budgetedToolCalls >= maxToolCalls) {
          empujarLoEjecutado();
          return await finishOnCap("tool_limit");
        }
        budgetedToolCalls += 1;
      }
      toolCalls += 1;

      const summary = typeof call.args.resumen === "string" ? call.args.resumen : call.name;
      args.emit({ type: "action", tool: call.name, status: "running", summary });

      const outcome = await args.runTool(call.name, call.args);
      const ok = outcome.response.ok !== false;
      if (!ok) failedSignatures.set(sig, (failedSignatures.get(sig) ?? 0) + 1);
      args.emit({
        type: "action",
        tool: call.name,
        status: ok ? "done" : "error",
        summary: outcome.action?.summary ?? summary,
        // Se reenvían sólo si la herramienta los puso, para que el evento de
        // las que no los conocen salga byte-idéntico al de antes.
        ...(outcome.action?.cambio ? { cambio: outcome.action.cambio } : {}),
        ...(outcome.action?.edits !== undefined ? { edits: outcome.action.edits } : {}),
        ...(outcome.action?.ops?.length ? { ops: outcome.action.ops } : {}),
      });

      if (outcome.updatedHtml) {
        args.emit({
          type: "html",
          html: outcome.updatedHtml,
          page: outcome.page ?? null,
          // Sólo si la herramienta lo puso, para que el evento de las que no
          // archivan nada salga byte-idéntico al de antes.
          ...(outcome.versionPrevia ? { versionPrevia: outcome.versionPrevia } : {}),
        });
        // 🔴 EL GEMELO VIAJA CON LA MUTACIÓN. Leerlo de la sesión al verificar
        // sería leer la página equivocada: `trabajar_en_pagina` mueve la sesión
        // a otra página a mitad de turno y `lastMutation` sigue siendo ésta.
        lastMutation = {
          html: outcome.updatedHtml,
          page: outcome.page ?? null,
          ...(outcome.taggedHtml ? { taggedHtml: outcome.taggedHtml } : {}),
        };
      }
      // Lo durable incluye los cambios de AJUSTES, que no emiten html: módulos,
      // tema, motion, música, 3D, datos vivos. `runAgentTool` los cuenta.
      if (!mutoDurable && (outcome.mutoDurable || outcome.updatedHtml)) {
        mutoDurable = true;
        args.onMutacion?.();
      }

      // A confirm outcome (publicar) NEVER carries out its action. Surface the
      // confirm card to the user and hand the model a fixed "waiting" state so
      // it closes the turn asking for the tap — never a payload it could read
      // as "already published".
      if (outcome.confirm) {
        args.emit({ type: "confirm", ...outcome.confirm });
        functionResponses.push({
          name: call.name,
          response: {
            ok: true,
            estado: "esperando_confirmacion_del_usuario",
            subdominio: outcome.confirm.subdominio,
          },
        });
        continue;
      }

      if (outcome.pregunta) pregunta = outcome.pregunta;
      if (outcome.tareas) tareas = outcome.tareas;
      // LA EVIDENCIA, contada aquí y no fiada del texto del modelo. `cambio`
      // viene de `declararCambio` (hash antes ≠ hash después); lo durable cubre
      // las que no tocan el documento — módulos, páginas, almacenes.
      if (outcome.response.cambio === "cambio" || outcome.mutoDurable || outcome.updatedHtml) {
        evidencias += 1;
      }

      functionResponses.push({ name: call.name, response: outcome.response });
    }

    // 🔴 UNA PREGUNTA CIERRA EL TURNO, y la cierra el SERVIDOR.
    //
    // Hasta hoy «esto lo decide el usuario» viajaba como un `ok:false` con una
    // orden dentro —«NO vuelvas a llamar en este turno; termina preguntándole»—
    // más un flag de sesión para cazar al modelo que la desobedecía. Está
    // MEDIDO que la desobedecía: con un ejemplo en el texto reclamaba
    // «mi-negocio» 3 de 3 veces, y sin ejemplo se inventaba el nombre del
    // contexto. Pedirle a un modelo que se pare y luego vigilar si se paró son
    // las dos mitades del mismo parche.
    //
    // Se sale DESPUÉS de recorrer la tanda entera: si el modelo mandó una
    // edición y una pregunta en la misma vuelta, la edición se aplica y se
    // emite igual. Cortar en seco perdería trabajo que el usuario ya tiene
    // delante en el lienzo.
    if (pregunta) {
      // El texto lo escribió el modelo, en el idioma del usuario — el servidor
      // decide CUÁNDO se para, no QUÉ se dice. Se emite salvo que ya lo haya
      // dicho en su prosa, para no leerlo dos veces.
      if (!turnText.includes(pregunta)) args.emit({ type: "text", text: pregunta });
      finalText = turnText.trim() ? `${turnText.trim()}\n\n${pregunta}` : pregunta;
      return buildResult(false);
    }

    messages.push({ role: "assistant", content: turnText, functionCalls: calls });
    // 🔴 LO MEDIDO VIAJA AQUÍ, no dentro del resultado de `editar_pagina`.
    //
    // El resultado de la herramienta es SUYO: dice si guardó y qué guardó. Lo
    // que el navegador opine de la página es otro hecho, lo produce otra cosa y
    // llega más tarde — meterlo dentro sería que «guardado» dependiera de que
    // Chromium arrancara. Va de hermano, en el mismo mensaje, que es como lo
    // hace Claude Code con los diagnósticos del LSP (medido sobre su binario:
    // el bloque `<new-diagnostics>` es un mensaje aparte, nunca el `tool_result`).
    //
    // Y va DESPUÉS del `assistant`, así que el modelo lo lee en su siguiente
    // paso —el que iba a dar de todas formas—: cero llamadas nuevas.
    messages.push({ role: "user", content: await medirYRedactar(), functionResponses });
    // Con el documento nuevo ya en el historial, los anteriores sobran: sus
    // data-op-id murieron en cuanto se aplicó una edición. Se poda DESPUÉS de
    // empujar, para que el vigente sea siempre el que acaba de entrar.
    // El contador se calculaba y se TIRABA, así que la poda —lo único que
    // retira bytes del turno— era la única etapa sin ninguna traza. Se acumula
    // y la ruta lo saca en la línea de log que ya emite: cero coste, y
    // `grep "podados"` sobre el diario dice cuánto está ahorrando de verdad.
    documentosPodados += podarDocumentosViejos(messages);
  }
}
