// QUÉ HACER CUANDO EL PROVEEDOR RECHAZA EL CAMPO `reasoning_effort`.
//
// POR QUÉ EXISTE. Hoy el papel del Agente manda un número de esfuerzo en cada
// turno. Si el modelo del papel cambiara a uno que no admite ese campo,
// Fireworks devolvería 400 y `fireworks-stream-client` lo convertiría en
// `stopReason: error` — o sea que **todos** los turnos del Agente se caerían, y
// se caerían igual hasta que alguien lo notara. El papel del Agente ha cambiado
// de modelo dos veces en tres semanas; esto no es hipotético.
//
// CLAUDE CODE DE CLAUDE CODE NO SE CAE: detecta el rechazo, marca ese modelo con
// `markEffortUnsupported` y sigue. Su propia documentación lo llama, literal,
// «after any silent downgrade for the selected model» — la petición se repite
// sin el campo y el turno se salva. Aquí se hace lo mismo.
//
// LOS MENSAJES SON REALES, sondeados contra Fireworks el 2026-09-13 con
// `deepseek-v4p1-flash` y `max_tokens: 1`:
//
//   campo desconocido   400  "Extra inputs are not permitted, field:
//                             'esfuerzo_de_pensar', value: 100"
//   valor no válido     400  "3 request validation errors: Input should be
//                             'low', 'medium', 'high', 'xhigh', 'max', 'none'
//                             or 'adaptive', field: 'reasoning_effort'"
//   valor fuera de sitio 400 "integer reasoning_effort must be positive"
//
// La primera forma —«Extra inputs are not permitted»— es exactamente una de las
// cadenas que Claude Code lleva en su propia lista de detección. Y de paso el
// segundo mensaje confirma la unión desde el lado del proveedor: nombre de una
// lista cerrada, O entero positivo. La misma forma que
// `w.union([w.enum(…), w.number().int()])`.

/**
 * Dos clases de rechazo, y NO se tratan igual a propósito.
 *
 * `capacidad` = este modelo no acepta el campo. Es una propiedad suya, no un
 * error nuestro: se marca y se deja de mandar.
 *
 * `valor` = el campo existe pero lo que mandamos no vale. Eso es un DEFECTO
 * NUESTRO. Hoy no puede pasar —`presupuestoDeEsfuerzo` devuelve siempre un
 * entero ≥ 1— así que si pasa, alguien rompió esa garantía. Se reintenta igual
 * para no tirarle el turno al usuario, pero NO se marca el modelo: marcarlo
 * escondería nuestro bug detrás de una capacidad inventada del proveedor, y el
 * turno siguiente saldría sin pensamiento para siempre por una errata.
 */
export type ClaseDeRechazo = "capacidad" | "valor";

/**
 * ¿Este 400 es por el campo de esfuerzo, y de qué clase?
 *
 * `null` = no va de esto. Se mira que el mensaje NOMBRE el campo antes de
 * concluir nada: «Extra inputs are not permitted» a secas puede ser cualquier
 * otro parámetro que alguien añada mal, y reintentar sin esfuerzo no lo
 * arreglaría — sólo escondería el error real detrás de un segundo intento
 * idéntico.
 */
export function rechazoDeEsfuerzo(cuerpo: string): ClaseDeRechazo | null {
  const t = cuerpo.toLowerCase();
  if (!t.includes("reasoning_effort")) {
    // Un «campo desconocido» que ni siquiera nombra el nuestro no es nuestro.
    return null;
  }
  if (t.includes("extra inputs are not permitted") || t.includes("not support")) {
    return "capacidad";
  }
  if (t.includes("input should be") || t.includes("must be positive")) {
    return "valor";
  }
  return null;
}

/**
 * Los modelos que ya dijeron que no admiten el campo.
 *
 * Vive en memoria y muere con el proceso, igual que las `requestLatches` de Claude
 * Code. No se persiste a propósito: la capacidad de un modelo puede cambiar
 * cuando el proveedor lo despliega otra vez, y una fila en la base diría
 * «este modelo no piensa» para siempre a partir de un 400 de una tarde.
 */
const sinEsfuerzo = new Set<string>();

export function marcarSinEsfuerzo(modelId: string): void {
  if (sinEsfuerzo.has(modelId)) return;
  sinEsfuerzo.add(modelId);
  // Se DICE. Un turno que baja de esfuerzo en silencio y para siempre es
  // justo la clase de degradación que nadie descubre — el papel con visión
  // estuvo quince días a 404 por fallar en amarillo.
  // eslint-disable-next-line no-console
  console.warn(
    `[esfuerzo] ${modelId} rechaza \`reasoning_effort\`: este proceso deja de mandarlo. ` +
      `Los turnos siguen, sin pensamiento dirigido. Si es el modelo del papel del Agente, ` +
      `revisa MODEL_POLICY.`,
  );
}

export function admiteEsfuerzo(modelId: string): boolean {
  return !sinEsfuerzo.has(modelId);
}

/** Sólo para pruebas: el registro es de módulo y se lleva estado entre casos. */
export function olvidarModelosSinEsfuerzo(): void {
  sinEsfuerzo.clear();
}
