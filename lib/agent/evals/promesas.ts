/**
 * LA MEMORIA DE LAS PROMESAS DE UNA CORRIDA, y la costura que la llena.
 *
 * 🔴 POR QUÉ ESTO VIVE FUERA DE `harness.ts` (2026-09-21). No es gusto por los
 * ficheros pequeños: `harness.ts` importa `@/lib/db` en su primera línea útil,
 * y en esta máquina `DATABASE_URL` apunta a PRODUCCIÓN. Una prueba determinista
 * que importara el arnés para comprobar este cableado abriría una conexión
 * contra la base real al cargar el módulo. Con el anotador aquí —sin una sola
 * importación de valor fuera de tipos— la prueba compone el bucle DE VERDAD con
 * este envoltorio DE VERDAD y no toca nada.
 *
 * 🔴 Y POR QUÉ HACÍA FALTA LA COSTURA. El eslabón «el bucle llama al envoltorio
 * y el envoltorio llena `declaradas`» no lo cubría NADA: `tools.test.ts` prueba
 * que `runAgentTool` pone `session.behaviorSpec`, `loop.test.ts` prueba que el
 * bucle llama a `runTool`, y `arnes-multiturno-como-la-ruta.test.ts` compara
 * TEXTO, no ejecución. En medio quedaba justo el tramo del que se sospechaba.
 * Con el instrumento ciego una corrida de pago no contesta nada — le costó tres
 * a la sesión del 2026-09-21.
 */
import type { FalloSpec } from "@/lib/agent/behavior-spec";
import type { AgentSession, ToolOutcome } from "@/lib/agent/tools";
import type { PruebaGuardada } from "@/lib/agent/pruebas-de-la-pagina";
import type { PruebaEnEval, EvalCumplimiento } from "./cases";

/** LO QUE LA RUTA SABE Y EL ARNÉS NO SABÍA: la promesa que el modelo declaró
 *  este turno, y las promesas que la página ya cumplió.
 *
 *  Viaja como `medidas`, `avisos` y `tropiezos` —un objeto que el bucle escribe
 *  y el de fuera lee— porque la sesión del agente vive dentro de
 *  `runLoopWithRetry` y los ojos se arman fuera. */
export interface PromesasDelArnes {
  /** La promesa por la ranura `prueba_js`, o `null`. Ver `PruebaEnEval.js`. */
  js: string | null;
  suite: PruebaGuardada[];
  /** UNA ENTRADA POR LLAMADA QUE PUDO DECLARAR PRUEBA. Ver `PruebaEnEval`.
   *
   *  🔴 POR QUÉ NO BASTA `js`. `js` es la ÚLTIMA que entró, y sólo eso. Una
   *  prueba RECHAZADA nunca llega a la sesión, así que desde `js` una prueba
   *  que no entró y ninguna prueba **son indistinguibles**: el motivo tiene
   *  que viajar al lado. */
  declaradas: PruebaEnEval[];
}

/** Las puertas que pueden llevar `prueba_js`. Son las cuatro de edición: el
 *  prompt sólo la exige con `editar_runtime`, pero un `<script>` colado por
 *  `editar_html` es justo el hueco que hay que poder medir — anotarlas todas
 *  deja que un caso futuro lo afirme sin tocar el arnés. */
export const PUERTAS_CON_PRUEBA = new Set([
  "editar_runtime",
  "editar_html",
  "editar_texto",
  "editar_atributos",
]);

/** Lo que hace falta de los argumentos para entender un rechazo: con qué op,
 *  contra qué y el principio de lo que mandó. No el documento entero. */
export function resumenDeArgs(args: Record<string, unknown>): string {
  if (Array.isArray(args.ediciones)) {
    return args.ediciones
      .map((e: Record<string, unknown>) =>
        `[${String(e.op ?? "?")} ${String(e.target ?? "?")} ${String(e.new_html ?? "").slice(0, 90)}]`,
      )
      .join(" ");
  }
  return JSON.stringify(args).slice(0, 160);
}

/**
 * LOS RECHAZOS POR LA PRUEBA DE UNA CORRIDA, CONTADOS POR MOTIVO.
 *
 * Es el número que decide si merece la pena CONVERTIR una entrada en vez de
 * rechazarla —p. ej. traducir el `prueba` retirado a `prueba_js` con
 * `pasosAJs`—. Una conversión se escribe cuando ese error es frecuente, no por
 * si acaso: hasta entonces se rechaza, y esto dice cuántas veces pasó.
 */
export function rechazosPorMotivo(
  casos: readonly { readonly declaradas?: readonly PruebaEnEval[] }[],
): Map<string, number> {
  const cuenta = new Map<string, number>();
  for (const caso of casos) {
    for (const d of caso.declaradas ?? []) {
      if (d.rechazo) cuenta.set(d.rechazo, (cuenta.get(d.rechazo) ?? 0) + 1);
    }
  }
  return cuenta;
}

/**
 * ¿CON QUÉ SALIÓ LA PROMESA DEL TURNO? — la decisión, en un sitio y puro.
 *
 * Una sola ruta desde el 2026-09-22: la promesa es el programa de `prueba_js`.
 * Sale por `cumplimiento`, el mismo canal que lee el juez, para que no existan
 * dos definiciones de «se cumplió» que puedan separarse con el tiempo.
 *
 * `corrio: false` ⇒ no se pudo medir (el render reventó), y eso NO acusa a
 * nadie: `promesaIncumplida` exige `corrio`. Fail-open, la regla de siempre.
 *
 * Devuelve `null` cuando no había nada que juzgar.
 */
export function cumplimientoDelTurno(opts: {
  js: string | null;
  fallos: readonly FalloSpec[];
  vacuas: readonly FalloSpec[];
  corrio: boolean;
  /** Por qué no se pudo comprobar. Obligatorio de hecho cuando `corrio:false`:
   *  ver `EvalCumplimiento.motivo` — el motivo va DENTRO en vez de dejar un
   *  hueco mudo que manda a buscar a ciegas. */
  motivo?: string;
}): EvalCumplimiento | null {
  const { js, fallos, vacuas, corrio, motivo } = opts;
  if (!js) return null;
  // `corrio:false` ⇒ no se midió: ni fallos ni vacuas, y el motivo al lado.
  return corrio
    ? { corrio: true, fallos, vacuas }
    : { corrio: false, fallos: [], vacuas: [], ...(motivo ? { motivo } : {}) };
}

/**
 * EL `runTool` DEL ARNÉS: ejecuta la herramienta y ANOTA lo que la sesión sabe.
 *
 * `ejecutar` viene inyectado —en el arnés es `runAgentTool(session, deps, …)`—
 * por la misma razón que `verifyTurn` y `medirParaElModelo` en el bucle: así el
 * cableado entero se prueba sin base de datos y sin gastar una llamada.
 *
 * ⚠️ LA ANOTACIÓN VA DESPUÉS DE EJECUTAR, y no es un detalle: `behaviorJs` y
 * `rechazoPrueba` los pone la herramienta al correr. Leerlos antes anotaría
 * siempre el turno anterior.
 *
 * ⚠️ Y SE ANOTA AUNQUE NO HAYA PRUEBA. Una entrada con `js: null` y
 * `rechazo: null` es el dato que dice «llamó a la puerta y no prometió nada».
 * Si sólo se anotaran las llamadas CON prueba, `declaradas` vacío significaría
 * dos cosas opuestas —no editó, o editó sin prometer— y ningún caso podría
 * distinguirlas.
 */
export function anotarPromesas(opts: {
  session: AgentSession;
  ejecutar: (name: string, args: Record<string, unknown>) => Promise<ToolOutcome>;
  promesas?: PromesasDelArnes;
  tropiezos?: string[];
}): (name: string, args: Record<string, unknown>) => Promise<ToolOutcome> {
  const { session, ejecutar, promesas, tropiezos } = opts;
  return async (name, args) => {
    const r = await ejecutar(name, args);
    // LA PROMESA QUE EL MODELO ACABA DE DECLARAR. La ruta se la pasa a los
    // ojos; el arnés no lo hacía, así que aquí las pruebas de comportamiento NO
    // se comprobaban y una corrida aprobaba por no haber mirado — la misma
    // ceguera que `harness.ts` ya documentó para `medirParaElModelo`.
    if (promesas) {
      promesas.js = session.behaviorJs ?? null;
      // Y LA ENTRADA DEL HECHO, con el rechazo al lado. Sólo de las puertas que
      // pueden llevar prueba: anotar un `leer_estado` aquí metería ruido que
      // ningún caso puede querer. Las dos mitades ya viven en la sesión
      // (`behaviorJs` y `rechazoPrueba`); lo único que faltaba era que
      // salieran de ella.
      if (PUERTAS_CON_PRUEBA.has(name)) {
        promesas.declaradas.push({
          tool: name,
          rechazo: session.rechazoPrueba ?? null,
          js: session.behaviorJs ?? null,
          // SI TOCÓ COMPORTAMIENTO, con la decisión del propio producto. Sin
          // esto el juez exigía promesa a cualquier edición, y en la batería
          // del 2026-09-22 acusaba a 32 turnos que sólo cambiaron un texto.
          conducta: r.cambioConducta === true,
        });
      }
    }
    if (tropiezos && r.response.ok === false) {
      tropiezos.push(`${name} ${resumenDeArgs(args)} → ${String(r.response.error ?? "").slice(0, 300)}`);
    }
    return r;
  };
}
