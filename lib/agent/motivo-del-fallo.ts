// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ DESDE N41 (03/10) AQUÍ SÓLO QUEDA EL ÁMBAR (`avisoParaElDueno`). La tarjeta
// ROJA ya no pinta lo que leyó el modelo: dice el `ownerReason` que declara la
// herramienta (lib/agent/owner-reason.ts). Lo de abajo es la historia de la
// regla que N41 retiró — ver la lápida de `motivoDelFallo`.
//
// EL MOTIVO DE UN FALLO, sacado de la respuesta que la herramienta le dio al
// modelo — para que la tarjeta roja diga LO MISMO que el modelo leyó.
//
// 🔴 POR QUÉ EXISTE. La tarjeta pintaba «Cambiar tema · falló» y se acababa
// ahí. El motivo no faltaba: estaba en `outcome.response.error`, viajaba al
// modelo y desde el 2026-09-10 lo guarda el diario del turno. Lo único que no
// hacía era llegar a la pantalla de quien mira.
//
// LA VARA (Claude Code). Allí el texto del error es UNO: va al
// modelo envuelto en `<tool_use_error>…</tool_use_error>` y la interfaz pinta
// ESE MISMO string quitándole el envoltorio con
// `/^(?:<tool_use_error>)?(?:Error: )?/`. No hay una redacción para el usuario
// y otra para el modelo, porque dos redacciones del mismo fallo son dos
// verdades y una miente.
//
// Y NUNCA VACÍO, que es la otra mitad de esa regla: cuando un comando falla sin
// escribir nada, ellos ponen «Command failed with no output» en vez de dejar el
// hueco. Aquí eso se cumple en la tarjeta, que conserva su «falló» localizado
// cuando esto devuelve `undefined`.
//
// 🔴 TRES CLAVES Y NO UNA, a propósito. Las herramientas no se pusieron de
// acuerdo: la mayoría devuelve `error`, el viejo guardado de la memoria devolvía
// `motivo` y el guardado de notas devuelve `reason`. Exigir una sola clave
// ahora sería tocar 27 ficheros para que la tarjeta hable, y el fichero que se
// olvidara se quedaría mudo EN SILENCIO — que es el defecto que esto viene a
// cerrar, no uno nuevo que abrir.
// ─────────────────────────────────────────────────────────────────────────────

/** Tope del motivo que viaja en el evento y se pinta. Coincide con el de
 *  `summary` en la tarjeta persistida (`ActionSchema`): pasarse de ahí haría
 *  400 a TODO el turno, que desaparecería al recargar sin decir nada. El motivo
 *  ENTERO —hasta 400— sigue en el diario del turno, que es el registro. */
export const TOPE_MOTIVO = 200;

// ⚰️ AQUÍ VIVÍA `motivoDelFallo` (2026-09-18 → 03/10): sacaba de una respuesta
// FALLIDA —`detalle`, `error`, `motivo` o `reason`— el texto que leyó el modelo,
// y la tarjeta roja lo pintaba. Lo retiró N41: con Len en inglés el dueño leía
// «falló · the user has never said… you made that name up». La regla de «un
// solo canal» de arriba sólo vale cuando quien mira lee lo mismo que el modelo;
// en OpenLen no. La roja dice ahora el `ownerReason` que declara la
// herramienta (lib/agent/owner-reason.ts), y lo que leyó el modelo se queda en
// el diario del turno.

/** Se corta CON MARCA. Una frase que acaba a medias sin avisar se lee como el
 *  motivo entero, y manda a buscar por donde no es. El texto ENTERO sigue en
 *  el diario del turno, que es el registro. */
function recorta(texto: string): string {
  return texto.length > TOPE_MOTIVO ? `${texto.slice(0, TOPE_MOTIVO)}…` : texto;
}

/**
 * LO QUE EL DUEÑO TIENE QUE SABER DE UNA LLAMADA QUE FUE BIEN, para la ÁMBAR.
 *
 * No es un fallo: la llamada fue bien y la edición se guardó, pero la
 * herramienta le avisó al modelo de algo que el servidor comprobó. Hasta el
 * 2026-09-18 eso no salía del servidor — se quedaba en un `console.warn` de la
 * caja mientras la tarjeta se pintaba verde.
 *
 * El string es el MISMO que leyó el modelo, no una segunda redacción — la regla
 * de siempre.
 *
 * ⚰️ LA PRUEBA DESCARTADA, RETIRADA (2026-09-22). El ámbar nació para ella: una
 * prueba que no entraba se descartaba y la edición se guardaba igual, con
 * `prueba_descartada` en la respuesta y su frase de dueño. Desde que una prueba
 * que no valida rechaza la llamada ENTERA —no se guarda nada y el modelo la
 * reenvía—, ese estado no existe: la tarjeta es roja porque de verdad no se
 * aplicó nada, y su motivo lo da `motivoDelFallo`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 POR QUÉ MIRA `aviso_critico` (2026-09-21).
 *
 * El arreglo del 18/09 acertó en la forma y se quedó en UNA bandera. Contadas
 * sobre `tools.ts`: hay **17** claves `extra.*`, de las cuales **13 son señales
 * de avería** —`handlers_muertos`, `contenido_perdido`, `formularios_perdidos`,
 * `css_sin_efecto`, `referencias_rotas`, `enlaces_sin_origen`…— todas con su
 * guarda, o sea que sólo aparecen cuando algo se rompió de verdad. Y el bucle
 * leía de la respuesta, para pintar, exactamente cuatro: `ok`, `cambio`,
 * `error` y `prueba_descartada`. **Una de trece.**
 *
 * Las otras doce viajaban en `aviso_critico` y su ÚNICO consumidor era el
 * modelo, vía la regla «nunca cierres un turno callando un aviso»
 * (`catalog.ts`). O sea que el dueño se enteraba de un handler muerto **sólo si
 * Len se acordaba de mencionarlo en su prosa** — exactamente la clase de señal
 * que depende de la obediencia del modelo, y que ya está medido que falla.
 *
 * LA DECISIÓN, en la forma de Claude Code: **un solo canal.** Lo que el modelo
 * lee ES lo que se enseña; no hay una segunda ruta con lista blanca de la que
 * un hecho pueda caerse. Un `Edit` que dice «Found 2 matches» no necesita que
 * nadie recableé ese hecho para que se vea.
 *
 * NO INUNDA, y se midió antes de escribirlo: sobre 90 llamadas con diario en
 * producción, 15 traían `aviso_critico`; 9 eran rechazos de spec —que desde el
 * despliegue del 20/09 ya salían ámbar— y quedan **6, un 6,7%**, que hasta
 * entonces eran invisibles. Ése es el ámbar que esto añadió.
 *
 * `aviso_critico` está escrito para el modelo y a veces trae su receta dentro;
 * cuando no hay una frase mejor, una áspera y verdadera le gana al silencio.
 * Que cada aviso gane su frase de dueño es trabajo aparte.
 */
export function avisoParaElDueno(
  respuesta: Record<string, unknown> | undefined,
): string | undefined {
  // Sólo cuando la llamada NO falló: un turno que además falló ya tiene su
  // motivo rojo, y dos motivos en una fila no caben ni se leen.
  if (!respuesta || respuesta.ok === false) return undefined;

  // EL CANAL GENERAL. Cualquier aviso que la herramienta le dio al modelo es
  // un hecho que el servidor comprobó; que se vea. Ver el bloque de arriba.
  const critico = respuesta.aviso_critico;
  if (typeof critico === "string") {
    const limpio = critico.trim();
    if (limpio) return recorta(limpio);
  }

  return undefined;
}
