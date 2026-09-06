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
// 🔴 QUÉ HACE EL MODELO CON ESTO — MEDIDO, 12 corridas pagadas el 2026-09-06
// sobre las dos páginas rotas del corpus (`documentacion#3`, desborde;
// `saas#2`, contraste 1.00:1), pidiéndole un cambio AJENO al defecto:
//
//   6/6 con el puente roto  → silencio. No es que lo ignorase: el `content` no
//                             llegaba al cable (ver `fireworks-bridge.ts`).
//   6/6 con el puente sano  → SE LO DICE AL USUARIO, en frase llana, nombrando
//                             el sitio en sus palabras («la caja de "Errores
//                             comunes"», «el botón "Enviar y crear cuenta"»), y
//                             varias veces ofreciendo arreglarlo. 0/6 filtró el
//                             `data-op-id`.
//   0/6 lo arregló por su cuenta — Y ESO ES LO CORRECTO, no un fallo que
//                             perseguir: el sobre dice «si procede», y el
//                             usuario había pedido otra cosa. La regla de la
//                             casa es que corrige el USUARIO (ver la lápida de
//                             la reparación automática en `api/generate`).
//
// 🔴 Y EL CASO QUE FALTABA, MEDIDO DESPUÉS (4 corridas, configuración de
// PRODUCCIÓN con la línea base puesta, sobre dos páginas LIMPIAS y con encargos
// cuya rotura sería colateral): **0/4 rompió la página**. Dos veces se negó en
// voz alta —«el botón ahora tiene fondo blanco con borde sutil y TEXTO OSCURO»,
// «en móvil siguen apilados, que es lo correcto para que no se corten»— y las
// otras dos metió la tabla ancha en algo que scrollea, que es el patrón bueno.
//
// LO QUE ESO SIGNIFICA, y conviene tenerlo escrito antes de tocar nada: el
// cliente real de este aviso NO son las ediciones del Agente —resiste— sino las
// páginas que llegan rotas de CREAR (2 de 48 del corpus). Y a ésas la línea base
// las calla PARA EL MODELO, a propósito.
//
// No se pierde nada por el camino: al USUARIO se lo siguen diciendo los ojos al
// cerrar el turno (`loop.ts`, rama `roto`, que no tiene línea base) y Crear al
// generar (`emit("medida")`). O sea que esto dispara poco, y eso no es un
// defecto: es lo que significa «sólo se te dice lo que rompiste tú».
//
// 🔴 ¿Y DECÍRSELO UNA VEZ POR SESIÓN EN VEZ DE NUNCA? NO. La vara es Claude
// Code y su binario lo contesta sin ambigüedad — leído en 2.1.260:
//
//   · `handleQueryStart` llama a `reset()` en cada consulta del usuario, y
//     `reset()` hace `this.baseline.clear()`. La línea base se BORRA cada turno
//     y se vuelve a tomar del estado ACTUAL, defectos preexistentes incluidos.
//     No hay memoria que acumule: nunca se reportan, en ningún turno.
//   · Y no hay puerta trasera por lectura: `getNewDiagnostics` descarta todo
//     fichero que no esté en `baseline` (`if(!this.baseline.has(k)) continue`),
//     o sea SÓLO los que él tocó. Leer un fichero roto no le cuenta nada.
//
// Al modelo se le dice lo que rompió y NADA MÁS; lo demás lo trae el usuario.
// La pregunta queda cerrada: esta implementación ya es esa.
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
  //    ⚰️ Aquí había un aviso de que la sonda podía señalar a una hoja
  //    inocente, y la frase de abajo llevaba un parche —«si ese nodo cabe y lo
  //    ancho es su contenedor, sube al ancestro»— para que el modelo corrigiera
  //    a mano lo que la sonda erraba. Se arregló la sonda el 2026-09-06
  //    (`visual-quality-renderer.ts`, ahora gana el que llega MÁS LEJOS), así
  //    que el parche sobra y además miente: el nodo que llega al borde y es el
  //    más superficial de ese alcance tiene, por construcción, un padre que sí
  //    cabe. Mandar a subir era mandar a un sitio donde no hay nada roto.
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
        `En móvil (390px) el elemento que MÁS se sale de la pantalla es ` +
        `\`${m.overflowCulprit}\`${hasta}.${clase}`,
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
 * ⚰️ AQUÍ DECÍA «entre turnos no hay memoria, y es una concesión»: una página
 * que ya venía rota se lo decía una vez por cada turno que la editara, aunque
 * el modelo no la hubiera roto. Se cerró el 2026-09-06, y NO con un almacén —
 * que era lo que esta nota daba por inevitable— sino con la LÍNEA BASE, que es
 * lo que hace Claude Code: mide el fichero ANTES de editarlo y sólo reporta la
 * diferencia. El documento del principio del turno ya está en la sesión, así
 * que la memoria no hace falta; lo que hacía falta era medirlo. Ver
 * `lineaBaseIds` en `loop.ts`.
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

  /**
   * Lo NUEVO de esta medición, ya redactado. `null` si no hay nada que no se
   * haya dicho ya.
   *
   * `preexistentes` es LA LÍNEA BASE: los `id` que ya salían en el documento
   * con el que empezó el turno. Se restan porque el sobre promete «esto salió
   * NUEVO», y un defecto que el modelo se encontró hecho no lo es — decírselo
   * es mandarle a arreglar algo que no rompió, en un turno que el usuario pidió
   * para otra cosa.
   *
   * Se resta por `id`, que lleva dentro el `data-op-id`, y eso es exacto y no
   * aproximado: dentro de un turno las direcciones SOBREVIVEN a la edición
   * (`applyOps(..., keepOpIds=true)`) y un id no se reutiliza jamás —
   * `tagger.rs` acuña por encima del máximo. Así que si el modelo TOCÓ el nodo,
   * su id cambia y el defecto vuelve a contar como nuevo, que es justo lo que
   * queremos: lo que él escribió es suyo.
   */
  nuevos(m: MedicionCruda | null | undefined, preexistentes?: ReadonlySet<string>): string | null {
    const frescos = defectosConDireccion(m).filter(
      (d) => !this.#dichos.has(d.id) && !preexistentes?.has(d.id),
    );
    if (frescos.length === 0) return null;
    for (const d of frescos) this.#dichos.add(d.id);
    return redactarAviso(frescos);
  }
}
