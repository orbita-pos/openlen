// LO MEDIDO, DE VUELTA AL MODELO — en el canal que ya lee.
//
// Ésta es la pieza que faltaba del bucle. Hasta hoy los ojos medían al CERRAR
// el turno y le contaban el defecto AL USUARIO: el modelo no se enteraba nunca,
// porque cuando la crítica existía el turno ya había terminado (loop.ts, rama
// `roto`, que emite y hace `return`). El usuario se quedaba con «tu página se
// sale» y sin nadie a quien pedírselo salvo en el turno siguiente.
//
// Lo que hace esto es mover la medición ANTES: en cuanto una tanda de
// herramientas toca el documento, se mide, y lo medido viaja en el mismo
// mensaje que ya lleva las respuestas de esas herramientas. El modelo lo lee en
// su siguiente paso —que iba a dar de todas formas— y decide él.
//
// 🔴 LAS TRES COSAS QUE ESTO NO ES:
//
//  1. NO es un reparador. No hay una llamada nueva, no hay un ciclo, no hay
//     revert. Se informa; corrige quien escribió la página.
//  2. NO es un crítico. No puntúa ni opina: son hechos del navegador —se sale,
//     no se lee, lanzó— con su dirección.
//  3. NO habla de lo que no sabe. Tipografía y geometría se miden y NO entran
//     aquí: no nombran un nodo, así que mandarían al modelo a buscar a ciegas.
//     Ver `objective-breakage.ts`, que es de Crear y sí las cuenta.
//
// La forma está copiada de Claude Code, medida sobre su binario (2.1.260): los
// diagnósticos nuevos viajan como mensaje hermano del resultado de la
// herramienta —no DENTRO de él—, sólo lo que no se había dicho ya, con tope por
// fichero y tope total, y con un fusible que los apaga si el medidor falla
// varias veces seguidas.

/** La medición en crudo, tal y como sale del navegador. Se declara aquí el
 *  subconjunto que se usa —y no se importa `VisualQualityViewports`— para que
 *  este módulo no arrastre el grafo de Chromium: lo cargan las pruebas. */
export interface MedicionCruda {
  readonly mobileOverflow?: boolean;
  readonly overflowCulprit?: string;
  readonly overflowCulpritRight?: number;
  readonly overflowCulpritKind?: "caja" | "tinta";
  readonly overflowCulpritOpId?: string;
  readonly unreadableText?: readonly {
    readonly contrast: number;
    readonly texto?: string;
    readonly etiqueta?: string;
    readonly opId?: string;
  }[];
  readonly runtimeErrors?: readonly string[];
}

/** Un defecto con DIRECCIÓN. `id` es su identidad para no repetirlo; `opId` es
 *  dónde está, y es lo único que convierte el aviso en accionable con una op. */
export interface DefectoMedido {
  readonly clase: "js" | "desborde" | "contraste";
  readonly id: string;
  readonly opId?: string;
  readonly frase: string;
}

/** Cuántos defectos caben en un aviso. Claude Code corta en 10 por fichero y 30
 *  en total; aquí el «fichero» es la página entera y el presupuesto del turno es
 *  mucho más corto, así que cuatro. Más que eso deja de ser una dirección y pasa
 *  a ser un informe, y un informe no se arregla con una op. */
const MAX_DEFECTOS = 4;
/** Tope duro del sobre. El equivalente de Claude Code son 4.000 caracteres para
 *  el workspace entero; esto viaja en CADA tanda que edita, así que va más corto. */
const MAX_CARACTERES = 900;
/** Cuántos gritos del JavaScript. Tres, igual que `objectiveBreakage`: más que
 *  eso suele ser el mismo fallo rebotando. */
const MAX_GRITOS = 3;
/** Cuántos textos ilegibles. Uno solo no basta —un velo mal puesto ensucia una
 *  sección entera— pero la lista completa tampoco: el modelo arregla el fondo,
 *  no cada texto. */
const MAX_CONTRASTES = 2;

/** El orden es de SEVERIDAD, no de gusto: un script muerto deja la página
 *  entera inerte con una captura perfecta, un desborde la deja usable y fea, y
 *  un contraste malo la deja legible para casi todos. Si hay que cortar por el
 *  tope, se corta por abajo. */
export function defectosConDireccion(m: MedicionCruda | null | undefined): DefectoMedido[] {
  if (!m) return [];
  const fuera: DefectoMedido[] = [];

  // 1. EL JAVASCRIPT. El único que NO tiene nodo y entra igual, porque su
  //    mensaje literal ya es la dirección: «Assignment to constant variable»
  //    señala la línea mejor que cualquier op-id.
  for (const grito of (m.runtimeErrors ?? []).slice(0, MAX_GRITOS)) {
    const limpio = grito.trim();
    if (!limpio) continue;
    fuera.push({
      clase: "js",
      id: `js:${limpio}`,
      frase: `El JavaScript de la página falla al cargarla o al usar sus controles: ${limpio}`,
    });
  }

  // 2. EL DESBORDE. Sólo con culpable: «algo se sale» sin decir qué es
  //    exactamente el aviso que no se puede arreglar.
  //
  //    ⚠️ Y la sonda puede señalar al nodo EQUIVOCADO. Su heurística es «el más
  //    profundo que se sale», y acierta cuando un hijo revienta a su padre;
  //    cuando lo ancho es el layout entero señala una hoja inocente (medido en
  //    `documentacion#3`: culpaba a un `<code>` de 14 caracteres teniendo el
  //    documento a 585px). Por eso la frase dice «el más profundo que se sale»
  //    y no «el culpable»: es lo que la sonda sabe, y el modelo puede subir.
  if (m.mobileOverflow === true && m.overflowCulprit) {
    const hasta = m.overflowCulpritRight ? `, llega a ${Math.round(m.overflowCulpritRight)}px` : "";
    const clase =
      m.overflowCulpritKind === "tinta"
        ? " Es TEXTO que no se puede partir (una dirección, una URL): se arregla con `overflow-wrap` o `word-break`, NO con anchos — encoger la caja no parte una palabra."
        : m.overflowCulpritKind === "caja"
          ? " Es la CAJA, que mide más que la pantalla: anchos, `flex-wrap`, una columna, o meterlo en algo que scrollee."
          : "";
    fuera.push({
      clase: "desborde",
      id: `desborde:${m.overflowCulpritOpId || m.overflowCulprit}:${m.overflowCulpritKind ?? ""}`,
      ...(m.overflowCulpritOpId ? { opId: m.overflowCulpritOpId } : {}),
      frase:
        `En móvil (390px) el elemento más profundo que se sale de la pantalla es ` +
        `\`${m.overflowCulprit}\`${hasta}.${clase}` +
        // La sonda mide el más PROFUNDO. Si el ancho lo pone un ancestro, este
        // nodo es inocente y tocarlo no arregla nada — decirlo aquí es más
        // barato que un turno perdido.
        ` Si ese nodo cabe y lo ancho es su contenedor, sube al ancestro.`,
    });
  }

  // 3. EL CONTRASTE. Ya viene medido sobre el píxel, no deducido del CSS.
  const ilegibles = [...(m.unreadableText ?? [])]
    .sort((a, b) => a.contrast - b.contrast)
    .slice(0, MAX_CONTRASTES);
  for (const c of ilegibles) {
    const donde = c.texto ? `«${c.texto}»` : c.etiqueta ? `<${c.etiqueta}>` : "un texto";
    fuera.push({
      clase: "contraste",
      id: `contraste:${c.opId || donde}`,
      ...(c.opId ? { opId: c.opId } : {}),
      frase: `El navegador pinta ${donde} a ${c.contrast.toFixed(2)}:1 de contraste — nadie puede leerlo.`,
    });
  }

  return fuera;
}

/** El sobre. Vacío ⇒ `null`, y el llamador no escribe nada: una página sin
 *  defectos no debe costar ni un token, que es la mitad del diseño. */
export function redactarAviso(defectos: readonly DefectoMedido[]): string | null {
  if (defectos.length === 0) return null;
  const lineas: string[] = [];
  let usados = 0;
  for (const d of defectos.slice(0, MAX_DEFECTOS)) {
    // LA DIRECCIÓN VA AL FINAL Y APARTE, no incrustada en la frase: el modelo
    // la necesita literal para escribir la op, y una cadena entre comillas
    // dentro de una oración se copia mal.
    const linea = `- ${d.frase}${d.opId ? ` [data-op-id=${d.opId}]` : ""}`;
    if (usados + linea.length > MAX_CARACTERES) break;
    lineas.push(linea);
    usados += linea.length;
  }
  if (lineas.length === 0) return null;
  return [
    "<medido-tras-editar>",
    "El navegador midió la página que acabas de guardar. Esto es lo que salió NUEVO en esta medición:",
    ...lineas,
    // Las dos frases del final son las dos mitades de la doctrina, y ninguna
    // sobra: la primera dice que decide él (no somos un reparador), y la
    // segunda es la regla de cómo se le habla al usuario — el hecho concreto y
    // dónde, sin superlativos, y JAMÁS el `data-op-id`, que a una persona no le
    // dice nada.
    "Arréglalo con una operación sobre ese nodo si procede; si era intencional o no sabes arreglarlo, sigue.",
    "Si al cerrar el turno sigue ahí, díselo al usuario en una frase llana —qué pasa y dónde—, nunca con el data-op-id.",
    "</medido-tras-editar>",
  ].join("\n");
}

/**
 * LA MEMORIA DEL TURNO: qué se dijo ya, y cuándo dejar de medir.
 *
 * Vive en el turno, como `AgentSession`, y por el mismo motivo: describe lo que
 * ESTE turno tiene delante. Un defecto que el modelo decidió no arreglar se le
 * dice UNA vez — repetirlo en cada tanda es dar la lata con algo que ya oyó, y
 * eso es exactamente lo que hace un crítico y no una herramienta.
 *
 * ⚠️ ENTRE TURNOS NO HAY MEMORIA, y es una decisión, no un olvido: la sesión
 * del agente no se persiste. Una página que YA venía rota se lo dirá una vez
 * por cada turno que la edite. Prefiero eso a montar un almacén para callar un
 * hecho cierto; si en la práctica da la lata, se mide y se acota entonces.
 */
export class AvisosDelTurno {
  #dichos = new Set<string>();
  #fallos = 0;
  /** El fusible de Claude Code: tres fallos seguidos del medidor y se apaga
   *  para el resto del turno. Un navegador que no arranca no puede cobrarle al
   *  usuario un intento por cada edición. */
  static readonly MAX_FALLOS = 3;

  get apagado(): boolean {
    return this.#fallos >= AvisosDelTurno.MAX_FALLOS;
  }

  /** Un intento de medición que no pudo correr. Devuelve si acaba de apagarse. */
  fallo(): boolean {
    this.#fallos += 1;
    return this.#fallos === AvisosDelTurno.MAX_FALLOS;
  }

  /** Una medición que sí corrió: el contador vuelve a cero, igual que la línea
   *  base de Claude Code sólo se apaga con timeouts CONSECUTIVOS. */
  ok(): void {
    this.#fallos = 0;
  }

  /** Lo NUEVO de esta medición, ya redactado. `null` si no hay nada que no se
   *  haya dicho ya. */
  nuevos(m: MedicionCruda | null | undefined): string | null {
    const frescos = defectosConDireccion(m).filter((d) => !this.#dichos.has(d.id));
    if (frescos.length === 0) return null;
    for (const d of frescos) this.#dichos.add(d.id);
    return redactarAviso(frescos);
  }
}
