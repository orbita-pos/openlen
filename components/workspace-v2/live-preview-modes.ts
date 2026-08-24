// Cuándo corre el JavaScript del modelo en el lienzo del taller.
//
// POR QUÉ ES UN FICHERO Y NO UNA LÍNEA DENTRO DEL COMPONENTE. Era una línea, y
// nació MUERTA el 2026-08-23: metí `dropEnabled` en la lista de "modos de
// edición" sin mirar de dónde salía. No es un modo que el usuario encienda —
// vale `entryMode === "editing" && !!loadedProject`, o sea SIEMPRE que haya un
// proyecto abierto. El JavaScript no se injertaba nunca, la función compilaba,
// las suites pasaban, y Jesús le daba a «Empezar» y no pasaba nada.
//
// Aquí es una función con nombre y con pruebas, que es lo que hace falta para
// que la próxima vez que alguien añada un modo tenga que decidir de qué lado
// cae.

export interface EditorModes {
  /** Edición inline + inspector: el conjunto grande de afordancias. */
  readonly editingActive: boolean;
  /** El inspector de elementos (la puerta de `editingActive`). */
  readonly inspectMode: boolean;
  /** El gesto «elige un elemento» del Chat. */
  readonly sectionSelectMode: boolean;
  /** La zona de soltar. Armada TODO el tiempo — ver abajo. */
  readonly dropEnabled: boolean;
}

/**
 * ¿Puede este turno GUARDAR serializando el DOM vivo?
 *
 * Es la pregunta que decide, porque los inyectores que guardan mandan
 * `document.documentElement.outerHTML` (`captureClean` en use-inline-edit.ts).
 * Con el script del modelo corriendo, eso persiste el estado que dejó: un
 * reloj en 24:30, un filtro que escondió media rejilla, un modal abierto.
 *
 * `dropEnabled` NO cuenta. Su propio fichero lo dice —«never mutates committed
 * DOM and never posts openlen:html-changed»—: detecta y pinta afordancias
 * transitorias, y quien aplica el resultado es otro inyector, que sí está aquí.
 */
export function editorCanSaveDom(m: EditorModes): boolean {
  return m.editingActive || m.inspectMode || m.sectionSelectMode;
}

/** El JavaScript del modelo corre cuando lo hay y el documento no se está
 *  editando. Mirando, la página está VIVA; editando, es un documento. */
export function modelJsShouldRun(m: EditorModes, hasRuntime: boolean): boolean {
  return hasRuntime && !editorCanSaveDom(m);
}
