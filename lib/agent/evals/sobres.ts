/**
 * LOS DOS SOBRES — el experimento que la pregunta de Jesús pedía (2026-09-04).
 *
 * LA PREGUNTA. «Cuando uso la API de DeepSeek en la terminal me trabaja a un
 * nivel altísimo; en OpenLen fallaba hasta para poner un móvil.» O sea: ¿el
 * sobre de OpenLen —9.355 tokens de prompt + 9.530 de declaraciones, 26
 * herramientas— le estorba al MISMO modelo que en una terminal escribe bien?
 *
 * LO QUE SE MANTIENE IGUAL, porque si no esto no mide nada:
 *   · el modelo (el papel `agent`), su temperatura y su tope de salida;
 *   · el PROTOCOLO de salida — los dos brazos emiten las MISMAS ops sobre
 *     `data-op-id`. Esto NO es «ops contra documento entero»: esa pregunta ya
 *     se investigó y se cerró (los verbos por nodo GANAN, ver la memoria
 *     `el-verbo-que-faltaba-op-text`). Cambiar las dos cosas a la vez daría un
 *     número que no se puede atribuir a ninguna.
 *   · la página de partida, la instrucción, y el motor que guarda.
 *
 * LO QUE CAMBIA, y es lo único: el SOBRE.
 *
 * 🔴 DÓNDE ESTÁ EL CORTE, y es la decisión que decide qué puede concluir el
 * experimento. El sobre mínimo lleva los HECHOS DEL MOTOR —que los `on*` se
 * borran, que el `<script>` sobrevive, qué `<iframe>` se permiten— porque son
 * propiedades del sitio donde corre el código, no consejo. En una terminal esas
 * restricciones no existen; aquí sí, y no decírselas sería castigar al brazo
 * mínimo por una regla que nadie le contó, que es hacer trampa a favor de la
 * hipótesis. Lo que NO lleva es todo lo demás: el contrato de publicación, el
 * tono, el vocabulario de tokens, el catálogo de módulos, y 22 de las 26
 * herramientas.
 *
 * Así que lo que se compara es: **los hechos del motor a secas, contra los
 * hechos del motor MÁS todo lo que OpenLen añade.**
 */

export type Sobre = "openlen" | "minimo";

/** Los cuatro verbos de edición. El brazo mínimo no lleva más, y las tareas del
 *  experimento están elegidas para no necesitar ninguna otra: si a un brazo le
 *  faltara una herramienta que la tarea pide, fallaría por eso y no por su
 *  sobre. */
export const HERRAMIENTAS_MINIMAS = [
  "editar_texto",
  "editar_atributos",
  "editar_html",
  "editar_runtime",
] as const;

/**
 * El sobre de una terminal: quién eres, cómo se dirige una edición, y los tres
 * hechos del motor. Nada más.
 *
 * No se le dice CÓMO debe quedar la página —ni una palabra de diseño, de tono o
 * de vocabulario— porque eso es justo lo que el otro brazo tiene y éste no.
 */
export const PROMPT_MINIMO = [
  "Eres un programador. Editas el HTML de una página web con las herramientas que tienes.",
  "",
  "El documento actual está en tu contexto y lleva un `data-op-id` en cada elemento: cada edición se dirige por ese id. Después de editar, los ids que ya tienes siguen valiendo.",
  "",
  "TRES HECHOS DEL SITIO DONDE CORRE ESTE CÓDIGO (no son consejos, es cómo funciona):",
  "- Tu `<script>` SOBREVIVE al guardado. Ponlo todo en uno, el último del `<body>`.",
  "- Los atributos `on*` (`onclick=`…) se BORRAN al guardar. Cablea con `addEventListener` dentro del script o el control nace mudo.",
  "- Los `<iframe>` sólo sobreviven desde Google Maps, YouTube y Vimeo. Cualquier otro se borra.",
  "",
  "Haz lo que te pidan y nada más. Al terminar, di en una línea qué hiciste.",
].join("\n");

/** Las declaraciones que ve cada brazo. */
export function herramientasDelSobre(
  todas: Record<string, unknown>[],
  sobre: Sobre,
): Record<string, unknown>[] {
  if (sobre === "openlen") return todas;
  const permitidas = new Set<string>(HERRAMIENTAS_MINIMAS);
  const filtradas = todas.filter((t) => permitidas.has(String(t.name)));
  // LANZA si el catálogo se renombra: un brazo mínimo con CERO herramientas
  // saldría «peor» por un motivo que no es su sobre, y en silencio.
  if (filtradas.length !== HERRAMIENTAS_MINIMAS.length) {
    throw new Error(
      `sobre mínimo: esperaba ${HERRAMIENTAS_MINIMAS.length} herramientas y encontré ${filtradas.length} — ` +
        "el catálogo cambió de nombres. Actualiza HERRAMIENTAS_MINIMAS.",
    );
  }
  return filtradas;
}
