// ─────────────────────────────────────────────────────────────────────────────
// EL DIARIO DEL TURNO — qué devolvió cada herramienta, guardado con el turno.
//
// 🔴 POR QUÉ EXISTE, y es una medición, no una corazonada.
//
// El 2026-09-10, contra producción: `cambiar_tema` falló en las DOS únicas
// veces que un usuario pidió un color («que la pagina sea blanca con azul»,
// «pon el botón principal en azul marino»). Y no se puede saber por qué,
// porque lo único que quedó guardado de esas dos llamadas es la tarjeta:
// `{tool:"cambiar_tema", status:"error", summary:"cambiar_tema"}`. El resumen
// es literalmente el nombre de la herramienta. El motivo se perdió.
//
// LA VARA (Claude Code 2.1.260). Su transcripción NO es un resumen
// pintado: cada entrada guarda `toolUseResult`, el resultado ESTRUCTURADO de la
// herramienta, junto al mensaje. Lo que se pinta (`getToolUseSummary`,
// `getActivityDescription`) es una VISTA sobre ese almacén, no el almacén.
// Nosotros teníamos sólo la vista.
//
// Y la poda de bulto la hacen igual, herramienta por herramienta:
//   Edit  → `stripForStorage(e) → {...e, originalFile: ""}`
//   Write → `stripForStorage(e) → {...e, content: "", originalFile: null}`
// Es decir: se vacía el BLOQUE GRANDE y se conserva TODO lo demás. Nunca se
// tira el desenlace.
//
// 🔴 LA ADAPTACIÓN, y es deliberada. Ellos nombran el campo porque tienen tres
// herramientas de fichero con forma conocida. Nosotros tenemos 27 y la
// `response` es libre: una lista de nombres («documento», «html», «seccion»…)
// caduca en silencio en cuanto alguien añade una clave — el modo de fallo que
// ya nos costó una sesión con las reglas de prompt que nombran la interfaz.
// Así que la regla es por TAMAÑO: toda cadena por encima del tope se vacía y se
// deja dicho cuántos bytes había. La entrada sigue diciendo «aquí venía un
// documento de 42 KB», que es lo que hace falta para leerla, y no puede
// quedarse vieja.
// ─────────────────────────────────────────────────────────────────────────────

/** Una llamada a herramienta, tal y como se guarda con el turno. */
export interface EntradaDelTurno {
  readonly tool: string;
  /** El `ok` que la herramienta le devolvió al modelo. Ausente si la respuesta
   *  no traía ninguno (no todas lo llevan). */
  readonly ok?: boolean;
  /** La respuesta al modelo, podada de bulto. Es EL MOTIVO cuando algo falló. */
  readonly respuesta: Record<string, unknown>;
}

/** Cadenas más largas que esto se vacían. 400 deja pasar un mensaje de error
 *  entero —que es justo lo que se viene a buscar— y corta un documento. */
export const TOPE_CADENA = 400;
/** Entradas por turno. Un turno sano gasta 3-6; el tope existe para que un
 *  bucle raro no escriba un megabyte en la fila. */
export const TOPE_ENTRADAS = 40;
/** Bytes del diario entero, ya serializado. Se corta por el FINAL: las
 *  primeras llamadas son las que explican cómo empezó a torcerse. */
export const TOPE_DIARIO = 20_000;

/**
 * Vacía el bulto conservando la forma. Recursivo, porque las respuestas anidan
 * (`pagina_vista.documento`, `medida.detalles[]`).
 *
 * Una cadena podada NO desaparece: se sustituye por su tamaño, así que quien
 * lea la entrada sabe que allí había algo y cuánto.
 */
export function podarBulto(valor: unknown, tope: number = TOPE_CADENA): unknown {
  if (typeof valor === "string") {
    return valor.length > tope ? `[${valor.length} bytes]` : valor;
  }
  if (Array.isArray(valor)) {
    // Los arrays largos son listas de hallazgos; interesan los primeros.
    const recortado = valor.slice(0, 12).map((v) => podarBulto(v, tope));
    return valor.length > 12
      ? [...recortado, `[+${valor.length - 12} más]`]
      : recortado;
  }
  if (valor !== null && typeof valor === "object") {
    const salida: Record<string, unknown> = {};
    for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
      salida[clave] = podarBulto(v, tope);
    }
    return salida;
  }
  return valor;
}

export interface DiarioDelTurno {
  /** Anota una llamada. Nunca lanza: un diario roto no puede costar un turno. */
  anotar(tool: string, respuesta: Record<string, unknown>): void;
  /** Lo anotado, listo para guardar. `null` si no hubo ninguna llamada — así la
   *  columna distingue «no llamó a nada» de «llamó y no se guardó». */
  entradas(): EntradaDelTurno[] | null;
}

export function crearDiarioDelTurno(): DiarioDelTurno {
  const entradas: EntradaDelTurno[] = [];
  return {
    anotar(tool, respuesta) {
      if (entradas.length >= TOPE_ENTRADAS) return;
      try {
        const podada = podarBulto(respuesta) as Record<string, unknown>;
        const ok = respuesta?.ok;
        entradas.push({
          tool,
          ...(typeof ok === "boolean" ? { ok } : {}),
          respuesta: podada,
        });
      } catch {
        // Una respuesta que no se puede recorrer (ciclo, getter que lanza) se
        // anota como lo que es: hubo llamada, no hay detalle.
        entradas.push({ tool, respuesta: { _sin_detalle: true } });
      }
    },
    entradas() {
      if (entradas.length === 0) return null;
      // El tope global se aplica quitando por el final, no truncando el JSON:
      // media entrada serializada no la puede leer nadie.
      const salida = [...entradas];
      while (salida.length > 1 && JSON.stringify(salida).length > TOPE_DIARIO) {
        salida.pop();
      }
      return salida;
    },
  };
}
