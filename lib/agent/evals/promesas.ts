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
import { formaDePrueba, type PasoSpec, type FalloSpec } from "@/lib/agent/behavior-spec";
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
  spec: readonly PasoSpec[] | null;
  /** La promesa por la ranura `prueba_js`, o `null`. Ver `PruebaEnEval.js`. */
  js: string | null;
  suite: PruebaGuardada[];
  /** UNA ENTRADA POR LLAMADA QUE PUDO DECLARAR PRUEBA. Ver `PruebaEnEval`.
   *
   *  🔴 POR QUÉ NO BASTABA `spec` (2026-09-21). `spec` es la ÚLTIMA aceptada, y
   *  sólo eso. Una prueba RECHAZADA —seis pasos de más, un verbo inventado, un
   *  paso sin `entonces`— nunca llega a `session.behaviorSpec`, así que desde
   *  `spec` una prueba mal formada y ninguna prueba **son indistinguibles**. Y
   *  el grueso de las reglas del prompt (`RUNTIME_MANDA_PRUEBA`) se viola
   *  precisamente por rechazo, no por ausencia: sin el motivo al lado, ninguna
   *  de ellas se puede afirmar. */
  declaradas: PruebaEnEval[];
}

/** Las puertas que pueden llevar `prueba`. Son las cuatro de edición: el
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
 * ¿QUÉ PROMESA SE JUZGA, Y CON QUÉ SALIÓ? — la decisión, en un sitio y puro.
 *
 * 🔴 SÓLO CORRE UNA DE LAS DOS RUTAS. `verify` elige la ranura JS cuando viene
 * («pruebaJs manda cuando viene»), así que un turno que mandó las DOS ejecutó el
 * PROGRAMA y no el DSL — y atribuir esos fallos a la spec pondría lo que hizo un
 * programa a nombre de unos pasos que nadie ejecutó.
 *
 * 🔴 Y LAS DOS PUNTÚAN IGUAL desde el 2026-09-21 (noche). Antes la ranura JS era
 * un PASE LIBRE: `prometioYSeComprobo` devolvía `null` en cuanto había `js`, sin
 * mirar si la promesa se cumplió, mientras el DSL sí suspendía. La asimetría
 * empujaba al modelo justo a la ruta que nadie verificaba. Sale por
 * `cumplimiento` —el mismo canal— para que no existan dos definiciones de «se
 * cumplió» que puedan separarse con el tiempo.
 *
 * `corrio: false` ⇒ no se pudo medir (el render reventó), y eso NO acusa a
 * nadie: `promesaIncumplida` exige `corrio`. Fail-open, la regla de siempre.
 *
 * Devuelve `null` cuando no había nada que juzgar.
 */
export function cumplimientoDelTurno(opts: {
  js: string | null;
  spec: readonly PasoSpec[] | null;
  fallos: readonly FalloSpec[];
  vacuas: readonly FalloSpec[];
  corrio: boolean;
  /** Por qué no se pudo comprobar. Obligatorio de hecho cuando `corrio:false`:
   *  ver `EvalCumplimiento.motivo` — su grader mete el motivo DENTRO
   *  en vez de dejar un hueco mudo que manda a buscar a ciegas. */
  motivo?: string;
}): EvalCumplimiento | null {
  const { js, spec, fallos, vacuas, corrio, motivo } = opts;
  // `corrio:false` ⇒ no se midió: ni fallos ni vacuas, y el motivo al lado.
  const sinMedir = { corrio: false as const, fallos: [], vacuas: [], ...(motivo ? { motivo } : {}) };
  if (js) {
    // `pasos: []` es honesto: un programa no tiene pasos del DSL. El código
    // entero viaja por su propio canal (`pruebasJs`), que es donde se lee.
    return corrio
      ? { corrio: true, fallos, forma: "js", pasos: [], vacuas }
      : { ...sinMedir, forma: "js", pasos: [] };
  }
  if (!spec?.length) return null;
  return corrio
    ? { corrio: true, fallos, forma: formaDePrueba(spec), pasos: spec, vacuas }
    : { ...sinMedir, forma: formaDePrueba(spec), pasos: spec };
}

/**
 * EL `runTool` DEL ARNÉS: ejecuta la herramienta y ANOTA lo que la sesión sabe.
 *
 * `ejecutar` viene inyectado —en el arnés es `runAgentTool(session, deps, …)`—
 * por la misma razón que `verifyTurn` y `medirParaElModelo` en el bucle: así el
 * cableado entero se prueba sin base de datos y sin gastar una llamada.
 *
 * ⚠️ LA ANOTACIÓN VA DESPUÉS DE EJECUTAR, y no es un detalle: `behaviorSpec` y
 * `specRechazoPrevio` los pone la herramienta al correr. Leerlos antes anotaría
 * siempre el turno anterior.
 *
 * ⚠️ Y SE ANOTA AUNQUE NO HAYA PRUEBA. Una entrada con `spec: null` y
 * `rechazo: null` es el dato que dice «llamó a la puerta y no prometió nada»,
 * que es precisamente la violación que `RUNTIME_MANDA_PRUEBA` describe. Si sólo
 * se anotaran las llamadas CON prueba, `declaradas` vacío significaría dos cosas
 * opuestas —no editó, o editó sin prometer— y ningún caso podría distinguirlas.
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
      promesas.spec = session.behaviorSpec ?? null;
      promesas.js = session.behaviorJs ?? null;
      // Y LA ENTRADA DEL HECHO, con el rechazo al lado. Sólo de las puertas que
      // pueden llevar prueba: anotar un `leer_estado` aquí metería ruido que
      // ningún caso puede querer. Las dos mitades ya vivían en la sesión
      // (`behaviorSpec` y `specRechazoPrevio`); lo único que faltaba era que
      // salieran de ella.
      if (PUERTAS_CON_PRUEBA.has(name)) {
        promesas.declaradas.push({
          tool: name,
          spec: session.behaviorSpec ?? null,
          rechazo: session.specRechazoPrevio ?? null,
          // LA OTRA RUTA. Sin esto una promesa en JavaScript se leería como «no
          // mandó prueba» y el caso acusaría al modelo de lo contrario de lo
          // que hizo.
          js: session.behaviorJs ?? null,
          // Y POR QUÉ, cuando el rechazo fue `sin_accion`: contar el 56% no
          // dice nada; contar la CLASE de forma dice qué reparar.
          ...(session.ultimaClaseSinAccion ? { clase: session.ultimaClaseSinAccion } : {}),
        });
      }
    }
    if (tropiezos && r.response.ok === false) {
      tropiezos.push(`${name} ${resumenDeArgs(args)} → ${String(r.response.error ?? "").slice(0, 300)}`);
    }
    return r;
  };
}
