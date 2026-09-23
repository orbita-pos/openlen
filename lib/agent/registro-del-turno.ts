// lib/agent/registro-del-turno.ts — la fila del turno que escribe el SERVIDOR.
//
// La ruta (`app/api/agent/route.ts`) va recogiendo lo que el bucle emite —el
// texto de Len, las tarjetas, si cambió el documento— y en su `finally` lo
// guarda con `registrarTurnoDelServidor`, pase lo que pase. Vivía en línea
// dentro de la ruta.
//
// Sale aquí para que el arnés de evals componga LA MISMA fila (X3 de
// `plans/auditoria-len-vs-claude-code-2026-09-22.md`): un turno cortado —la
// pestaña cerrada, el plazo— sólo se puede juzgar por lo que queda guardado, y
// hasta hoy ningún caso podía leerlo. Una segunda composición en el arnés
// mediría una fila que la ruta no escribe.
//
// Puro: sólo tipos del bucle y del proyecto.

import type { AgentErrorCode, AgentStreamEvent, TopeCode } from "@/lib/agent/loop";
import type { StoredChatTurn } from "@/lib/projects/types";

type Tarjetas = NonNullable<StoredChatTurn["actions"]>;

/**
 * ¿SE CORTÓ el turno después de haber cambiado algo? El plazo de la ruta, la
 * pestaña cerrada o el proveedor caído dejan el bucle en error terminal; si para
 * entonces ya escribió, la página cambió y el turno quedó A MEDIAS.
 *
 * 🔴 H05 de `plans/auditoria-len-vs-claude-code-2026-09-22.md`: esos turnos se
 * guardaban como `applied`, y el primero de producción (14/09) con 0 bytes de
 * texto — el dueño veía un turno limpio y el siguiente «¿ya quedó?» lo contestaba
 * un Len que creía haber terminado. Un tope NO es un corte: `finishOnCap`
 * redacta un cierre con los hechos delante.
 *
 * Una sola decisión para la ruta y el arnés: el arnés compone la misma fila
 * para juzgar el turno cortado.
 */
export function corteDelTurno(r: {
  readonly terminalError: boolean;
  readonly topeAlcanzado: TopeCode | null;
  readonly errorCode: AgentErrorCode | null;
  readonly mutoDurable: boolean;
}): AgentErrorCode | null {
  if (!r.terminalError || r.topeAlcanzado || !r.mutoDurable) return null;
  return r.errorCode ?? "cancelled";
}

/** El estado con el que se guarda un turno que se cortó a medias. Es texto en
 *  la base (no hace falta migración), y al leerlo vuelve como `applied` con la
 *  marca `cortado` — ver `rowToTurn` en `lib/projects/chat.ts`. */
export const ESTADO_CORTADO = "cortado";

export interface RegistroDelTurno {
  /** Deja pasar el evento y se queda con lo que hace falta para la fila. No
   *  cambia el orden, ni el contenido, ni el momento en que llega al cliente. */
  observar(ev: AgentStreamEvent): void;
  /** Todo el texto que Len emitió en el turno. */
  readonly texto: string;
  readonly tarjetas: Tarjetas;
  readonly cambioDocumento: boolean;
  /** ¿Merece fila? Un turno que no produjo nada —sin créditos, un rechazo
   *  temprano— no la merece. */
  hayAlgo(mutoDurable: boolean): boolean;
  fila(o: {
    readonly id: string;
    readonly userText: string;
    readonly page: string | null;
    readonly toolResults: { tool: string; ok?: boolean; respuesta: Record<string, unknown> }[] | null;
    /** Lo que devuelve `corteDelTurno`: con código, la fila se guarda como
     *  cortada. */
    readonly corte?: AgentErrorCode | null;
  }): Omit<StoredChatTurn, "status"> & {
    status: StoredChatTurn["status"] | typeof ESTADO_CORTADO;
    toolResults: { tool: string; ok?: boolean; respuesta: Record<string, unknown> }[] | null;
  };
}

export function crearRegistroDelTurno(): RegistroDelTurno {
  let texto = "";
  const tarjetas: Tarjetas = [];
  let cambioDocumento = false;
  return {
    observar(ev) {
      if (ev.type === "text") texto += ev.text;
      else if (ev.type === "action" && ev.status !== "running") {
        tarjetas.push({
          tool: ev.tool,
          status: ev.status,
          summary: ev.summary,
          // Se PERSISTE. Sin esto la observación se vería en vivo y no al
          // recargar — que es media avería, y la peor mitad porque sólo se nota
          // tarde.
          ...(ev.observacion ? { observacion: ev.observacion } : {}),
          // Y EL MOTIVO CON ELLA. El navegador no es el único que escribe la
          // transcripción: cuando el socket muere, la escribe la ruta. Sin esta
          // línea el turno que peor acabó sería justo el que perdiera el porqué
          // al recargar.
          ...(ev.motivo ? { motivo: ev.motivo } : {}),
          // Y LOS VALORES, que sólo lee el historial: sin ellos el turno
          // siguiente pierde el color exacto que se aplicó (H08-b).
          ...(ev.valores ? { valores: ev.valores } : {}),
          // Y EL RECUENTO DE COBERTURA, por la misma razón que los dos de
          // arriba: esta lista es BLANCA, así que un campo que no se nombre aquí
          // se ve en vivo y desaparece al recargar.
          ...(typeof ev.paginasMiradas === "number" && typeof ev.paginasTocadas === "number"
            ? { paginasMiradas: ev.paginasMiradas, paginasTocadas: ev.paginasTocadas }
            : {}),
        });
      } else if (ev.type === "html") cambioDocumento = true;
    },
    get texto() {
      return texto;
    },
    tarjetas,
    get cambioDocumento() {
      return cambioDocumento;
    },
    hayAlgo(mutoDurable) {
      return mutoDurable || tarjetas.length > 0 || texto.trim().length > 0;
    },
    fila(o) {
      return {
        id: o.id,
        userText: o.userText,
        assistantReasoning: texto,
        // CORTADO cuando el turno se quedó a medias habiendo cambiado algo: al
        // recargar, el panel lo avisa en el idioma del dueño, y el turno
        // siguiente lo lleva marcado en el historial. Lo que sí se hizo son las
        // tarjetas de `actions`; el porqué, el diario (`toolResults`).
        status: o.corte ? ESTADO_CORTADO : "applied",
        page: o.page,
        actions: tarjetas,
        noDocChange: !cambioDocumento,
        toolResults: o.toolResults,
      };
    },
  };
}
