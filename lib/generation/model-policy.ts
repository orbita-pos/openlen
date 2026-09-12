import type { ModelRole, FireworksReasoningEffort } from "../ai/fireworks-contracts";
import type { CreditRate } from "../credits";
import type { EsfuerzoAgente } from "@/lib/agent/esfuerzo";

// 🔴 EL MODELO Y SU TARIFA VIAJAN JUNTOS, y es una corrección medida el
// 2026-09-11, no una mejora de estilo. La misma decisión —«qué tarifa es este
// papel»— vivía escrita a mano en DOS sitios más: `brain.ts` (lo que declara el
// turno, y con ello lo que se le cobra al usuario) y `tarifas-eval.ts` (lo que
// frena una corrida pagada). Al cambiar el modelo del papel `agent` en esta
// rama, los dos se quedaron atrás: el arnés tarificó Flash a precio de Pro y
// reportó $0.283 donde el gasto real fue ~$0.047, 6x inflado. El fichero de
// tarifas presume en su cabecera de haber arreglado esa misma forma dos veces.
// Extraer, no copiar: a partir de aquí la tarifa se LEE del papel.
export const MODEL_POLICY = Object.freeze({
  reasoner: Object.freeze({
    modelId: "accounts/fireworks/models/deepseek-v4-flash-0731",
    creditRate: "deepseek-flash" as CreditRate,
  }),
  visualCritic: Object.freeze({
    modelId: "accounts/fireworks/models/qwen3p7-plus",
    creditRate: "qwen-vision" as CreditRate,
  }),
  // EL AGENTE TIENE PAPEL PROPIO, y no por capricho de tamaño: su trabajo es el
  // único que arrastra estado entre turnos —un bucle de herramientas donde cada
  // llamada depende de lo que devolvió la anterior—, y ahí es donde el modelo
  // chico se atasca. Medido con la batería de 55 casos el 2026-08-28: los dos
  // fallos reales que quedaban los arregla Pro, y en el caso que fallaba gastó
  // 68k tokens contra los 208k que quemaba Flash dando vueltas.
  //
  // NO comparte el papel `reasoner` a propósito. Ese lo piden ADEMÁS el Chat, el
  // rediseño y la pasada de reparación (todos por `page_edit`), y ninguno de los
  // tres tiene continuidad ni la necesita: subirlos costaría 6x sin comprar
  // nada. Un papel aparte es lo que hace que esta decisión sea de UNA línea.
  //
  // ⚠️ CUESTA 6x, parejo: $1.32/$0.044/$3.96 por millón contra $0.22/$0.007/$0.66
  // de Flash (tabla de docs.fireworks.ai/serverless/pricing, 2026-08-28). El
  // cobro lo refleja: `deepseek-pro` en lib/credits.ts. Un turno pesado del
  // Agente pasa de 2 créditos a 12, y el plan FREE son 20 al mes.
  // 🧪 EXPERIMENTO EN RAMA, 2026-09-11 — NO MERGEAR SIN EL DATO DE LA BATERÍA.
  // v4.1 Flash cuesta lo mismo que el Flash del razonador (0.22/0.007/0.66), o
  // sea 6x MENOS que Pro, y la ficha de DeepSeek lo pone por delante de Pro en
  // las cinco agénticas (Terminal-Bench 90.6 vs 87.9 · DeepSWE 74.2 vs 62.7 ·
  // AutomationBench 54.8 vs 43.2 · Agent's Last Exam 31.8 vs 25.7 · CyberGym
  // 88.1 vs 83.3). Son sus propios números y NINGUNO mide lo que nos importa:
  // si mantiene el hilo entre turnos con NUESTRO catálogo. Eso lo dice la
  // batería y nada más. Vuelta atrás: `deepseek-v4-pro-0813` y `deepseek-pro`
  // en brain.ts, las dos juntas.
  agent: Object.freeze({
    modelId: "accounts/fireworks/models/deepseek-v4p1-flash",
    creditRate: "deepseek-flash" as CreditRate,
    // `piensa` es la CAPA DE POLÍTICA, y va separada de `EsfuerzoAgente` (la
    // postura, en `lib/agent/esfuerzo.ts`) a propósito: un selector
    // `none | medium | high` mezclaba una CAPACIDAD con una MAGNITUD, y `none`
    // no era un nivel bajo, era apagar la función — la razón entera de este
    // reparto en capas. Aquí vive la pregunta que sólo puede contestar el
    // papel («¿este modelo/turno piensa, sí o no?»); el NIVEL lo elige el
    // usuario en la capa de arriba y sólo importa si esta capa dice que sí.
    piensa: true,
  }),
});

// ⚰️ AQUÍ VIVÍAN CUATRO OPERACIONES CON CERO LLAMADORES, retiradas el
// 2026-09-06: `creative_direction`, `page_planning`, `initial_section_program` y
// `visual_repair`. Las cuatro eran restos de tuberías que ya no existen —la
// biblioteca de secciones (`2db58d78`) y la pasada de reparación con crítico de
// visión (`446cd428`)— y las dos últimas eran las ÚNICAS que usaban el papel
// `designer`, así que con ellas se va también GLM 5p2 de la política.
//
// Una fila en esta tabla no es documentación: es una decisión de gasto con
// nombre de modelo al lado. Mientras estén escritas se leen como alternativas
// que existen, y la sesión que las lea razonará desde ellas.
//
// La guarda para que no vuelva a pasar está puesta:
// `model-policy-sin-huerfanas.test.ts` recorre el repo y suspende si una
// operación de esta tabla no la nombra nadie.
export type ModelOperation =
  | "copy"
  | "simple_extraction"
  | "candidate_scouting"
  | "final_scoring"
  | "page_edit"
  /** UN turno del Agente: el bucle de herramientas de `lib/agent/brain.ts`.
   *  Existe separada de `page_edit` porque aquélla la comparten el Chat, el
   *  rediseño y la reparación, y sólo ésta tiene continuidad entre turnos. */
  | "agent_turn"
  | "agent_visual_verify"
  | "template_autofill"
  /** Escribir una página MIRANDO una referencia adjunta. Papel con visión: al
   *  razonador nunca se le manda una imagen. */
  | "page_write_with_reference"
  /** JUZGAR SI UNA CONDICIÓN SE CUMPLIÓ, leyendo el transcript de un turno.
   *
   *  🔴 VA EN OTRO PAPEL QUE EL ACTOR, y eso es el punto entero. Len corre en
   *  `agent`; si el mismo papel juzgara su propio turno estaríamos pidiéndole
   *  al que ya decidió que estaba hecho que confirme que lo está. Claude Code de
   *  Claude Code lo dice de esta forma: «the agent being evaluated is the one
   *  who already decided to cross the line».
   *
   *  Y va en el papel BARATO: es una lectura corta con tres salidas, no
   *  redacción. */
  | "condition_evaluation";

const OPERATION_POLICY: Readonly<Record<ModelOperation, { role: ModelRole; effort: FireworksReasoningEffort | null }>> = {
  // Gusto, no razonamiento: elegir modo y acento desde el brief es una lectura
  // corta, y el fallo ya cae blando a la dirección determinista.
  copy: { role: "reasoner", effort: "none" },
  simple_extraction: { role: "reasoner", effort: "none" },
  candidate_scouting: { role: "visual_critic", effort: "none" },
  final_scoring: { role: "visual_critic", effort: "none" },
  // El Chat editando una página ya escrita. Entró como `high` —editar código
  // PARECE razonar— y la medición lo desmintió sobre la misma página y el mismo
  // prompt: 130.1s y 16,134 tokens de pensamiento para producir DOS ops; en
  // `none`, 5.2s y SIETE. El pensamiento no sólo costaba 25x el tiempo, hacía
  // menos trabajo. Mismo hallazgo que el presupuesto de pensamiento de Gemini
  // en esta misma superficie, y la razón por la que el esfuerzo vive en una
  // tabla: corregirlo fue esta línea.
  page_edit: { role: "reasoner", effort: "none" },
  // `effort: null`, Y NO ES UN OLVIDO: esta fila ya no decide cuánto piensa
  // el turno. Eso vive ahora en la capa de POSTURA (`lib/agent/esfuerzo.ts`),
  // elegida por el usuario y resuelta en `lib/agent/brain.ts`. El `none` que
  // había aquí era una constante HEREDADA — medida sobre `page_edit` y el
  // papel `reasoner`, nunca revisada para el papel `agent` en sí mismo — y
  // dejarla puesta mentiría: una fila de esta tabla se lee como una decisión
  // de gasto vigente, y ésta dejó de serlo. `null` explícito y no un campo
  // opcional a propósito: mismo argumento que ya hace `reasoningEffortAllowed`
  // más abajo sobre sí misma —«un papel nuevo que hereda su esfuerzo permitido
  // por accidente es una decisión que nadie tomó»— aquí una fila nueva que
  // olvide `effort` no debe compilar en silencio; con el campo obligatorio,
  // el compilador exige que quien la escriba decida, y `null` deja dicho en
  // voz alta que la decisión es "no aquí, a propósito".
  agent_turn: { role: "agent", effort: null },
  page_write_with_reference: { role: "visual_critic", effort: "none" },
  // Los ojos del Agente: mirar una captura y decir si la edición dejó rotura
  // OBJETIVA. Es el papel con visión, y su esfuerzo es el único que la política
  // le permite — juzgar píxeles no mejora pensando más.
  agent_visual_verify: { role: "visual_critic", effort: "none" },
  // Poner los datos del negocio en una plantilla: sustituir copy, no discurrir.
  // La ruta de Gemini ya lo pedía con `thinkingBudget: 0`, así que `none` no es
  // una apuesta, es la misma decisión escrita en el otro idioma.
  template_autofill: { role: "reasoner", effort: "none" },
  condition_evaluation: { role: "reasoner", effort: "none" },
};

export function reasoningEffortFor(role: ModelRole, operation: ModelOperation): FireworksReasoningEffort {
  const policy = OPERATION_POLICY[operation];
  if (policy.role !== role) throw new Error("operation is not allowed for model role");
  // FALLA RUIDOSO, no un valor colado en silencio: hoy sólo `agent_turn`
  // trae `effort: null` en la tabla, a propósito (ver su comentario arriba).
  // Un llamador que llega aquí pidiéndolo es un bug — el esfuerzo de esa
  // operación vive en la capa de POSTURA (`lib/agent/esfuerzo.ts`) y lo
  // resuelve `brain.ts` directamente, sin pasar por esta función. `null` es
  // EXPLÍCITO en el tipo (`FireworksReasoningEffort | null`, no un campo
  // opcional): así el compilador obliga a decidir en cada fila nueva, y esta
  // comprobación es lo que convierte esa decisión en un fallo ruidoso en vez
  // de un `null` que llegara al cable sin que nadie lo notara.
  if (policy.effort === null) {
    throw new Error(`«${operation}» no tiene esfuerzo en la política — vive en la capa de POSTURA, no aquí`);
  }
  return policy.effort;
}

/** Qué papel hace una operación. Quien llama nombra el TRABAJO; la política
 *  elige el modelo y el esfuerzo. Es lo que permite cambiar de proveedor
 *  editando una tabla en vez de cada superficie. */
export function roleForOperation(operation: ModelOperation): ModelRole {
  return OPERATION_POLICY[operation].role;
}

export function modelIdForRole(role: ModelRole): string {
  return role === "visual_critic" ? MODEL_POLICY.visualCritic.modelId : MODEL_POLICY[role].modelId;
}

export function reasoningEffortAllowed(role: ModelRole, effort: FireworksReasoningEffort): boolean {
  // Explícito, no por caída al `return` de abajo: un papel nuevo que hereda su
  // esfuerzo permitido por accidente es una decisión que nadie tomó.
  // `agent` no tiene NINGÚN esfuerzo permitido por ESTA función — la suya vive
  // en la capa de POSTURA (`lib/agent/esfuerzo.ts`) y llega al cable como un
  // NÚMERO (`reasoning_effort` en la escala nativa 1-100), nunca como uno de
  // los niveles con nombre de `FireworksReasoningEffort`. Decir `"none"` aquí
  // leería como que el Agente corre con el pensamiento apagado, que es
  // exactamente el despiste que este comentario existe para no repetir.
  if (role === "agent") return false;
  if (role === "reasoner") return effort === "none" || effort === "high";
  // ⚰️ Y aquí `designer`, que era el único papel que admitía `"max"`. El
  // esfuerzo sigue en el vocabulario del proveedor —`FireworksReasoningEffort`
  // describe lo que el CABLE acepta, no lo que nosotros pedimos— pero ya no hay
  // papel que lo admita, y eso lo dice la prueba en vez de un comentario.
  return effort === "none";
}

/**
 * ¿Se puede pedir este nivel hoy?
 *
 * 🔴 EL INTERRUPTOR NO ES UN NIVEL. Un selector `none | medium | high` mezcla
 * una capacidad con una magnitud y tiene una posición que invalida al propio
 * mando. Claude Code lo resuelve en dos capas: `alwaysThinkingEnabled` apaga el
 * pensamiento, y entonces el selector NO está disponible — con este mensaje:
 * «Effort 'X' isn't available with thinking turned off on this model».
 *
 * Se DICE en vez de esconderse, que es la otra mitad de su diseño.
 */
export function esfuerzoDisponible(
  nivel: EsfuerzoAgente,
  // Costura de prueba, no un parámetro para quien llama: `MODEL_POLICY` está
  // congelado y hoy `agent.piensa` es siempre `true`, así que la rama de abajo
  // es hoy INALCANZABLE por mutación — y una rama que nunca se ejecuta se
  // enviaría sin verificar, que es exactamente el mando roto que esta capa
  // vino a arreglar. El valor por defecto deja a Task 5 llamando con un solo
  // argumento; el segundo existe para que la puerta cerrada tenga prueba.
  piensa: boolean = MODEL_POLICY.agent.piensa,
): { ok: true } | { ok: false; motivo: string } {
  if (piensa) return { ok: true };
  return {
    ok: false,
    motivo: `El nivel «${nivel}» no está disponible con el pensamiento apagado para este modelo.`,
  };
}
