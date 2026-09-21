import { TARIFAS_POR_MILLON } from "../ai/tarifas";
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
    // Ver `capturaRuntimeDelPapel` abajo: la capacidad se DECLARA aquí, no se
    // deduce de quién es este papel.
    capturaRuntime: true,
    // EL NOMBRE QUE VE EL USUARIO VIAJA CON EL ID, por la misma razón que la
    // tarifa: es el `display_name` que el catálogo de Claude Code
    // lleva en la misma entrada que `id`. Escrito aparte, caducaría en silencio
    // el día que cambie el modelo; `model-policy.test.ts` exige que se
    // correspondan.
    displayName: "DeepSeek V4 Flash",
  }),
  // EL PAPEL CON VISIÓN. Lo piden cuatro operaciones: `agent_visual_verify`
  // (los ojos de Len), `page_write_with_reference` (escribir mirando una
  // referencia adjunta), `candidate_scouting` y `final_scoring`.
  //
  // ⚰️ AQUÍ ESTABA `qwen3p7-plus`, Y LLEVABA MUERTO DESDE EL 2026-08-27
  // (`e50b8cb9`). Devuelve **404 NOT_FOUND** —«Model not found, inaccessible,
  // and/or not deployed»— con la clave real, desde local Y desde la caja.
  //
  // NADIE SE ENTERÓ EN QUINCE DÍAS, y ése es el hallazgo que importa más que el
  // modelo: `verify.ts` es fail-open a propósito, así que el 404 salía como un
  // aviso amarillo (`verificar_diseno · warning · "no-mirado"`) y el turno
  // cerraba normal. Lo destapó un brazo de evals que murió en el caso 49 — los
  // tres casos con imagen de referencia—, no una alerta.
  //
  // MEDIDO el 2026-09-12 con captura real (`scripts/medir-ojos.ts`, plantilla
  // `mirror.html` renderizada por el renderizador de verdad, camino real):
  //
  //   · describir ×3 — qwen: 3/3 `null`. v4.1 Flash: **3/3 exactas**, y no de
  //     las que se adivinan: leyó el titular literal y describió el panel de
  //     logs con métricas que hay bajo el hero.
  //   · titular ENCIMADO sobre sí mismo ×3 — `broken:false` las tres, y ESO
  //     ESTÁ BIEN. Las tres lo reportaron en `observaciones`, nombrando las
  //     palabras afectadas: «un efecto de desenfoque/degradado en 'breaking the
  //     rules'… parece un tratamiento tipográfico intencional y no un defecto
  //     objetivo». Que es la respuesta correcta: desde los píxeles, un
  //     tratamiento de tipografía y un bug son indistinguibles.
  //
  //     ⚰️ AQUÍ DECÍA «percepción sí, veredicto no… es afinable». Era un ERROR
  //     MÍO DE MEDICIÓN, no una limitación: `scripts/medir-ojos.ts` sólo
  //     imprimía `issues` y nunca `observaciones`, así que se leyó un
  //     `broken:false` como «no lo vio». Ya imprime los dos. Los dos canales
  //     —`issues` confirma y pone `broken:true`; `observaciones` es lo que se
  //     VE y no se puede calificar— son el `CONFIRMED`/`PLAUSIBLE` de Claude Code
  //     de Claude Code, con mejor nombre. No hay nada que afinar.
  //
  // ⚠️ Y una corrección sobre cómo se mide esto: el caso de blanco-sobre-blanco
  // NO discrimina. Sale `broken:true` idéntico con los ojos a 404, porque lo
  // caza la pasada DETERMINISTA (el contraste leído del píxel, sin modelo y sin
  // crédito). Un arma que da el mismo resultado con y sin el sujeto no mide al
  // sujeto — quien vuelva a probar unos ojos, que plante un defecto que las
  // tres sondas deterministas no puedan ver.
  //
  // Es el MISMO modelo que el papel `agent`, y por eso la tarifa es la suya.
  //
  // ⚰️ AQUÍ DECÍA «la tarifa es la suya: 0.22/0.66 contra los 0.4/1.6 de
  // `qwen-vision`. Más barato Y con ojos». La comparación con Qwen era cierta;
  // la CIFRA no. V4.1 Flash nunca costó 0.22/0.66 —eso es V4 Flash— y aquí se
  // le puso `deepseek-flash` por creerlo. Corregido el 2026-09-20 contra la
  // tabla en vivo del proveedor: **0.30/0.006/1.20**, o sea 1,82x la salida.
  // Sigue siendo más barato que `qwen-vision` en salida (1.20 contra 1.60) y
  // sigue teniendo ojos; lo que no es, es gratis.
  visualCritic: Object.freeze({
    modelId: "accounts/fireworks/models/deepseek-v4p1-flash",
    creditRate: "deepseek-flash-4p1" as CreditRate,
    displayName: "DeepSeek V4.1 Flash",
    capturaRuntime: true,
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
  // ⚰️ Aquí decía «🧪 EXPERIMENTO EN RAMA, 2026-09-11 — NO MERGEAR SIN EL DATO DE
  // LA BATERÍA». EL DATO SE TOMÓ el 2026-09-12 y el veto se levanta con él
  // escrito, no de palabra: **60 de 62 casos, $0.381 de gasto real**, en el
  // commit `e2ab6bab`. De los dos fallos, uno era RUIDO y el otro un defecto
  // REAL — separados con n=5 por caso, no supuestos:
  //   · `contador-se-construye` falla 2 de 6 por `turn_limit`; aletea desde
  //     antes de este cambio y no dice nada del modelo.
  //   · `honesto-blog-backend` fallaba 5 de 6, se diagnosticó (una cláusula del
  //     prompt que empezaba dando permiso) y quedó en 5 de 5.
  // O sea: **61/62 con el único fallo real identificado y arreglado.** No hay
  // derrumbe — v4.1 Flash mantiene el hilo con nuestro catálogo, que es
  // exactamente lo que este bloque pedía saber y lo que sus benchmarks no
  // contestaban.
  //
  // ⚠️ Dos advertencias que van con el dato, para que nadie lo lea de más:
  //   · La batería corre en `auto` (R14: ni el arnés ni `agent-multiturno`
  //     pasan `env`), así que NO ejercita el selector de esfuerzo. Eso se
  //     verificó aparte, con dos turnos reales — ver el Apéndice M del informe.
  //   · Son TRES regímenes no comparables entre sí: antes de `9c3c9c9e` corría
  //     en `"none"`; entre ése y `a7b314f0`, en `auto`-omitido (~237 tokens de
  //     razonamiento, rango 495); desde `a7b314f0`, en `auto`-resuelto (100,
  //     rango 13). Este 60/62 es del TERCERO, que es el primero reproducible.
  //
  // ⚰️ AQUÍ DECÍA «v4.1 Flash cuesta lo mismo que el Flash del razonador
  // (0.22/0.007/0.66)». FALSO, y la falsedad se cobró: con esa frase se le puso
  // la tarifa `deepseek-flash` y cada turno del Agente desde el 2026-09-12 se
  // midió y se cobró con la salida un 45% por debajo de lo real. Lo real, de la
  // tabla en vivo del proveedor el 2026-09-20: **0.30/0.006/1.20**.
  //
  // Lo que SÍ sobrevive del argumento, recalculado: sigue siendo unas 3,3x más
  // barato que Pro en salida (1.20 contra 3.96), no 6x. La decisión de bajar de
  // Pro a Flash no se mueve —el 60/62 de la batería es el dato, y el ahorro
  // sigue siendo grande—, pero el múltiplo con el que se defendió estaba
  // inflado. La ficha de DeepSeek lo pone por delante de Pro en
  // las cinco agénticas (Terminal-Bench 90.6 vs 87.9 · DeepSWE 74.2 vs 62.7 ·
  // AutomationBench 54.8 vs 43.2 · Agent's Last Exam 31.8 vs 25.7 · CyberGym
  // 88.1 vs 83.3). Son sus propios números y NINGUNO mide lo que nos importa:
  // si mantiene el hilo entre turnos con NUESTRO catálogo. Eso lo dice la
  // batería y nada más. Vuelta atrás: `deepseek-v4-pro-0813` y `deepseek-pro`
  // en brain.ts, las dos juntas.
  agent: Object.freeze({
    modelId: "accounts/fireworks/models/deepseek-v4p1-flash",
    creditRate: "deepseek-flash-4p1" as CreditRate,
    displayName: "DeepSeek V4.1 Flash",
    capturaRuntime: true,
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
   *  Claude Code lo dice de esta forma: «…».
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
  //
  // 🔴 PASÓ A `visual_critic` EL 2026-09-20, por decisión de Jesús. Crear ya
  // corría en V4.1 desde el 2026-09-14 (`ESCRITOR_POR_DEFECTO_DE_CREAR`) y el
  // Chat se dejó atrás a propósito porque editar no se había comparado. Se
  // mueve igualmente: la razón es la misma que allí —la belleza es el norte— y
  // el dato que FALTA es el mismo, dicho en voz alta. Lo que sí está medido y
  // se acepta: la salida de V4.1 cuesta 1,82x, o sea ~+50% por edición
  // (64 → 96 centicréditos en un turno de ~20k/~3k).
  //
  // El `effort: "none"` se queda, y no por inercia: `reasoningEffortAllowed`
  // sólo admite `none` para este papel, y la medición que lo puso (130,1s y
  // 16.134 tokens de pensamiento para producir DOS ops, contra 5,2s y SIETE en
  // `none`) era sobre el trabajo, no sobre el modelo.
  //
  // ARRASTRA AL REDISEÑO a propósito (`lib/agent/redesign.ts` pide esta misma
  // operación): su comentario dice «reescribir una página entera es el mismo
  // trabajo que edita el Chat», así que seguirlo es lo que ese fichero pide.
  page_edit: { role: "visual_critic", effort: "none" },
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

/**
 * La tarifa del papel. EL GEMELO DE `modelIdForRole`, y existe por lo que dice
 * la cabecera de este fichero: el modelo y su tarifa viajan juntos.
 *
 * 🔴 LO QUE CIERRA. La misma decisión estaba escrita a mano en DOS superficies
 * más —`lib/ai-stream/generate.ts` y `app/api/templates/ai-design/route.ts`,
 * las dos con la forma `writer === «el razonador» ? "deepseek-flash" :
 * "qwen-vision"`—, y las dos se quedaron atrás el 2026-09-12 al cambiar el
 * modelo del papel con visión: habrían seguido cobrando 0.4/1.6 por un turno
 * que corre a 0.22/0.66. Es la TERCERA vez que esta forma muerde (la primera,
 * el arnés de la batería inflando el gasto 6x). El emisor es uno.
 */
export function creditRateForRole(role: ModelRole): CreditRate {
  return role === "visual_critic"
    ? MODEL_POLICY.visualCritic.creditRate
    : MODEL_POLICY[role].creditRate;
}

/**
 * El nombre visible del modelo del papel. El tercer gemelo, y existe por lo que
 * pinta la bienvenida de Claude Code: `…` —«…»—, el nombre sacado del mismo registro que el id. Allí no hay
 * forma de ocultar el modelo (hay `…`, no `…`), y
 * un proveedor ajeno también se nombra («Amazon Bedrock», «Cloud gateway»).
 */
export function displayNameForRole(role: ModelRole): string {
  return role === "visual_critic"
    ? MODEL_POLICY.visualCritic.displayName
    : MODEL_POLICY[role].displayName;
}

/** La entrada de la política de un papel, resolviendo el guión bajo del
 *  vocabulario del cable (`visual_critic`) contra la clave camel de la tabla. */
function entradaDelPapel(role: ModelRole) {
  return role === "visual_critic" ? MODEL_POLICY.visualCritic : MODEL_POLICY[role];
}

/**
 * CUÁNTAS VECES MÁS CARA ES LA SALIDA DE ESTE PAPEL que la del más barato de
 * los que se ofrecen juntos. 1 = es el más barato.
 *
 * 🔴 EXISTE PARA QUE EL SELECTOR NO VUELVA A MENTIR. Su comentario decía «los
 * dos papeles comparten tarifa exacta, así que el sufijo equivalente para "no
 * hay diferencia" es ninguno», y añadía que ESE HECHO era lo que permitía que
 * el selector existiera. El hecho era falso desde el 2026-09-12 y nadie se
 * enteró hasta el 2026-09-20, porque estaba escrito en prosa: un comentario no
 * se entera de que cambió una tabla. Calculado, sí.
 *
 * SE MIDE SOBRE LA SALIDA, no sobre una mezcla. Escribir una página es
 * abrumadoramente salida (del orden de 12k contra 4k de entrada), así que el
 * eje de salida ES el coste a esta escala, y un múltiplo ponderado necesitaría
 * fijar una mezcla de tokens — que es un supuesto, no un dato. Un número que
 * sale de una sola columna de la tabla no puede envejecer mal.
 *
 * La forma es la de Claude Code: sus filas llevan sufijo sólo cuando marcan una
 * DIFERENCIA (`· ~2× usage vs Sonnet`), y el precio nunca se escribe en la
 * fila — se deriva del modelo.
 */
/**
 * ¿SE LE PUEDE CAPTURAR EL JAVASCRIPT A LO QUE ESCRIBE ESTE PAPEL?
 *
 * 🔴 ES UNA CAPACIDAD DECLARADA, NO UNA IDENTIDAD DEDUCIDA, y eso es todo el
 * arreglo. En `ai-design` la puerta era `esElRazonador && …`, con este
 * comentario al lado: «El razonador. Es además el ÚNICO que puede capturar
 * JavaScript del modelo: la cápsula se llama "deepseek-generate-v1"».
 *
 * Dos cosas mal a la vez:
 *
 *   · `RUNTIME_CAPSULE_VERSION` **no existe en el código**. Buscado el
 *     2026-09-20: la cadena "deepseek-generate-v1" sale en TRES comentarios y
 *     en ningún sitio más. La puerta se justificaba con una constante
 *     imaginaria.
 *   · Y el «ÚNICO» dejó de ser cierto el 2026-09-12, cuando el papel con
 *     visión pasó de Qwen a DeepSeek. `writer === "reasoner"` era un proxy de
 *     «lo escribió DeepSeek» que se quedó viejo sin que nada se pusiera rojo —
 *     el mismo defecto, el mismo día, que la tarifa de V4.1.
 *
 * LA PUERTA DE VERDAD ES `validateRuntimeCode`, y valida por CONTENIDO: que
 * compile, el tamaño, el marcador de editor. Nunca por autor. Su propio
 * comentario exige que las reglas sean iguales por los dos caminos —«un código
 * que se rechaza al crear y se acepta al editar es una puerta trasera con dos
 * llaves»—. Un segundo filtro por identidad de papel contradecía eso.
 *
 * LA FORMA ES LA DE Claude Code: sus predicados son
 * `function f(e){ return lookup(e).propiedad }` —resuelven la entrada y leen un
 * campo DECLARADO—, nunca `modelo === "X"`. Aquí ya había precedente propio:
 * `piensa` en el papel `agent`, con la misma razón escrita al lado («un papel
 * nuevo que hereda su capacidad por accidente es una decisión que nadie tomó»).
 *
 * Un papel que no sea DeepSeek entra con `capturaRuntime: false` EXPLÍCITO, y
 * el compilador obliga a decidirlo.
 */
export function capturaRuntimeDelPapel(role: ModelRole): boolean {
  return entradaDelPapel(role).capturaRuntime;
}

export function multiploDeSalida(role: ModelRole, entre: readonly ModelRole[]): number {
  const salida = (r: ModelRole): number => TARIFAS_POR_MILLON[entradaDelPapel(r).creditRate].output;
  const barata = Math.min(...entre.map(salida));
  if (!Number.isFinite(barata) || barata <= 0) return 1;
  return salida(role) / barata;
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
