/**
 * ¿SE LLENA `declaradas`? — LA COSTURA QUE NO EXISTÍA.
 *
 * 🔴 EL HUECO QUE ESTO CIERRA (2026-09-21). En la corrida de pago del brazo B,
 * `contador-se-construye` salió PASS y el informe dijo «ningún caso declaró
 * prueba en esta corrida». Ese caso lleva `prometioYSeComprobo`, que tenía que
 * haber acusado — y no acusó porque `prometioYSeComprobo` se calla por diseño
 * cuando `ctx.pruebas` llega vacío (`if (ctx.pruebas.length === 0) return null`,
 * `cases.ts:332`). O sea que un `declaradas` vacío no se distingue de un turno
 * que no editó: el instrumento se queda CIEGO y la corrida sale verde.
 *
 * Y el tramo del que se sospechaba era justo el que no cubría nada:
 *
 *   · `tools.test.ts`  → `runAgentTool` pone `session.behaviorSpec`.      ✅
 *   · `loop.test.ts`   → el bucle llama a `args.runTool`.                 ✅
 *   · el envoltorio del arnés entre los dos                               ❌
 *
 * `arnes-multiturno-como-la-ruta.test.ts` tampoco lo cubre: compara TEXTO, no
 * ejecución. Así que esto compone el bucle DE VERDAD con el envoltorio DE
 * VERDAD y mira si el dato aparece al otro lado. Cuesta cero: sin modelo, sin
 * navegador y sin base de datos.
 *
 * ⚠️ LO ÚNICO FALSO AQUÍ ES `ejecutar`, y a propósito: lo que hace la
 * herramienta de verdad —poner `behaviorSpec` / `specRechazoPrevio` en la
 * sesión— ya lo prueban 20 afirmaciones en `tools.test.ts`. Repetirlo aquí
 * pediría una base de datos, y en esta máquina `DATABASE_URL` apunta a
 * producción.
 */
import { describe, expect, it } from "vitest";
import type { Message, StreamEvent } from "@/lib/ai-gateway";
import { runAgentLoop, type AgentStreamEvent } from "@/lib/agent/loop";
import type { AgentSession, ToolOutcome } from "@/lib/agent/tools";
import { anotarPromesas, cumplimientoDelTurno, type PromesasDelArnes } from "./promesas";
import { prometioYSeComprobo, promesaIncumplida } from "./cases";

function scripted(...turns: StreamEvent[][]): (messages: Message[]) => AsyncIterable<StreamEvent> {
  let i = 0;
  return () => {
    const turn = turns[Math.min(i, turns.length - 1)];
    i += 1;
    return (async function* () { for (const ev of turn) yield ev; })();
  };
}

const done: StreamEvent = { type: "done", stopReason: { kind: "end_turn" } };
const llamada = (name: string): StreamEvent => ({ type: "function_call", name, args: {} });

const UNA_PROMESA = 'var c = await ui.texto("#cuenta"); await ui.clic("#sumar"); await ui.cambiaDe("#cuenta", c);';

/** La sesión REDUCIDA a lo que el anotador lee. No es un atajo: el anotador
 *  sólo toca estas dos claves, así que un objeto con las dos es el contrato
 *  entero que tiene con la sesión. */
function sesionFalsa(): AgentSession {
  return { behaviorJs: null, rechazoPrueba: null } as unknown as AgentSession;
}

const okOutcome: ToolOutcome = { response: { ok: true } };

/** Lo que devuelve la herramienta real, en lo que importa aquí: reescribir el
 *  runtime SIEMPRE cambia el comportamiento (`nuevoRuntime !== null` en
 *  `toolEditarPagina`); las demás puertas, en estos guiones, no. */
const salidaReal = (name: string): ToolOutcome =>
  name === "editar_runtime" ? { response: { ok: true }, cambioConducta: true } : okOutcome;

/** Corre el bucle de verdad con el envoltorio de verdad. `guion` dice qué le
 *  pasa a la SESIÓN en cada llamada — que es lo que hace la herramienta real. */
async function correr(
  nombres: string[],
  guion: (session: AgentSession, name: string, vuelta: number) => void,
  salida: (name: string) => ToolOutcome = salidaReal,
): Promise<PromesasDelArnes> {
  const session = sesionFalsa();
  const promesas: PromesasDelArnes = { js: null, suite: [], declaradas: [] };
  let vuelta = 0;
  const eventos: AgentStreamEvent[] = [];
  await runAgentLoop({
    messages: [{ role: "user", content: "hazme un contador" }],
    tools: [],
    openStream: scripted(...nombres.map((n) => [llamada(n)]), [done]),
    runTool: anotarPromesas({
      session,
      ejecutar: async (name) => {
        guion(session, name, vuelta);
        vuelta += 1;
        return salida(name);
      },
      promesas,
    }),
    emit: (e) => eventos.push(e),
    maxTurns: nombres.length + 2,
    maxToolCalls: nombres.length + 2,
  });
  return promesas;
}

describe("el arnés anota lo que el modelo promete — la costura de §2", () => {
  it("una llamada a una puerta con prueba deja UNA entrada, con la promesa", async () => {
    const p = await correr(["editar_runtime"], (s) => {
      s.behaviorJs = UNA_PROMESA;
    });
    expect(p.declaradas).toHaveLength(1);
    expect(p.declaradas[0]).toMatchObject({ tool: "editar_runtime", rechazo: null, js: UNA_PROMESA });
    // Y la ÚLTIMA viva, que es de donde sale `cumplimiento`.
    expect(p.js).toBe(UNA_PROMESA);
  });

  it("🔴 una puerta llamada SIN prometer deja entrada igual — vacío ≠ no editó", async () => {
    // Es la mitad que hace legible a la otra. Si sólo se anotaran las llamadas
    // CON prueba, `declaradas: []` significaría a la vez «no editó» y «editó
    // sin prometer», que son el PASS y el FAIL de la regla.
    const p = await correr(["editar_runtime"], () => {});
    expect(p.declaradas).toHaveLength(1);
    expect(p.declaradas[0]).toMatchObject({ tool: "editar_runtime", js: null, rechazo: null });
  });

  it("una prueba RECHAZADA viaja con su motivo, no como ausencia", async () => {
    const p = await correr(["editar_runtime"], (s) => {
      s.rechazoPrueba = "demasiado_grande";
    });
    expect(p.declaradas[0]).toMatchObject({ js: null, rechazo: "demasiado_grande" });
  });

  it("una herramienta que NO es puerta de edición no ensucia la lista", async () => {
    const p = await correr(["leer_estado"], (s) => {
      s.behaviorJs = UNA_PROMESA;
    });
    expect(p.declaradas).toHaveLength(0);
  });

  // 🔴 SI TOCÓ COMPORTAMIENTO, con la decisión del producto. Sin este dato el
  // juez exigía promesa a cualquier edición: 32 de 64 acusados por un texto.
  it("🔴 anota si la llamada cambió el comportamiento, leído del resultado", async () => {
    const p = await correr(["editar_texto", "editar_runtime"], () => {});
    expect(p.declaradas.map((d) => [d.tool, d.conducta])).toEqual([
      ["editar_texto", false],
      ["editar_runtime", true],
    ]);
  });
});

describe("y con eso el assert YA PUEDE acusar — lo que no pasó el 2026-09-21", () => {
  it("🔴 promete y luego reescribe el runtime sin prometer → ACUSA", async () => {
    // La promesa entra en la PRIMERA puerta y el último `editar_runtime` la
    // retira. El estado final es «sin promesa viva».
    const p = await correr(
      ["editar_html", "editar_runtime", "editar_runtime"],
      (s, _name, vuelta) => {
        if (vuelta === 0) s.behaviorJs = UNA_PROMESA;
        if (vuelta === 2) s.behaviorJs = null; // el último reescribe y no promete
      },
    );
    expect(p.declaradas).toHaveLength(3);
    expect(p.js).toBeNull();

    const reason = prometioYSeComprobo({ pruebas: p.declaradas, cumplimiento: null });
    expect(reason).toMatch(/terminó sin promesa viva/);
  });

  it("🔴 el turno que no editó NADA sigue callado — la lista vacía es legítima ahí", async () => {
    const p = await correr(["leer_estado"], () => {});
    expect(p.declaradas).toHaveLength(0);
    expect(prometioYSeComprobo({ pruebas: p.declaradas, cumplimiento: null })).toBeNull();
  });

  it("una prueba descartada se acusa CON su motivo, no como silencio", async () => {
    const p = await correr(["editar_runtime"], (s) => {
      s.rechazoPrueba = "demasiado_grande";
    });
    expect(prometioYSeComprobo({ pruebas: p.declaradas, cumplimiento: null })).toMatch(/demasiado_grande/);
  });
});

// ── 🔴 CON QUÉ SALIÓ LA PROMESA: `cumplimientoDelTurno` ───────────────────────
//
// Esta decisión vivía escrita a mano DENTRO de `harness.ts`, o sea detrás de
// `@/lib/db`, o sea sin poder probarse. Y es la que decide si un caso suspende.
//
// El 2026-09-21 (noche) se cerró aquí el PASE LIBRE de la ranura JS: hasta ese
// día una promesa en JavaScript no producía cumplimiento y nadie la juzgaba.
describe("cumplimientoDelTurno", () => {
  const FALLO = [{ paso: 1, mensaje: "#total no cambió" }];
  const base = { fallos: [], vacuas: [], corrio: true } as const;

  it("sin promesa, no hay nada que juzgar", () => {
    expect(cumplimientoDelTurno({ ...base, js: null })).toBeNull();
  });

  it("🔴 la promesa SE JUZGA, que es el pase libre cerrado", () => {
    const c = cumplimientoDelTurno({ ...base, js: UNA_PROMESA, fallos: FALLO });
    expect(c, "una promesa no producía cumplimiento: nadie la juzgaba").not.toBeNull();
    expect(c).toMatchObject({ corrio: true });
    expect(c?.fallos).toEqual(FALLO);
    // Y el juez la suspende, que es el punto entero.
    expect(promesaIncumplida(c)).toBe(true);
  });

  it("🔴 FAIL-OPEN: si no se pudo medir, no acusa a nadie", () => {
    const c = cumplimientoDelTurno({ js: UNA_PROMESA, fallos: FALLO, vacuas: [], corrio: false });
    expect(c?.corrio).toBe(false);
    expect(c?.fallos, "se colaron fallos de una medición que no ocurrió").toEqual([]);
    expect(promesaIncumplida(c)).toBe(false);
  });
});

// 🔴 EL MOTIVO VIAJA DENTRO (2026-09-22).
//
// Un arnes de evals riguroso es fail-closed —lo que no se pudo comprobar NO
// cuenta como aprobado— y el motivo va DENTRO del resultado. Aqui se mantiene
// fail-open (flipar el score sin numero es el error que `scored:false` existe
// para evitar), pero lo que no se sostenia era que ademas fuera MUDO: el
// informe decia «2 declararon, 1 se ejecuto» y la otra desaparecia sin
// explicacion.
describe("lo que no se pudo comprobar lo dice, no lo calla", () => {
  it("🔴 con `corrio:false` el motivo viaja en el cumplimiento", () => {
    const c = cumplimientoDelTurno({
      js: UNA_PROMESA, fallos: [], vacuas: [], corrio: false,
      motivo: "el render reventó: Navigation timeout",
    });
    expect(c?.corrio).toBe(false);
    expect(c?.motivo, "un `corrio:false` mudo manda a buscar a ciegas").toMatch(/Navigation timeout/);
  });

  // CONTRA-PRUEBA: lo que SI se midio no lleva motivo — un motivo ahi seria
  // ruido que se leeria como «paso algo».
  it("CONTRA-PRUEBA: lo que se midio no lleva motivo", () => {
    const c = cumplimientoDelTurno({ js: UNA_PROMESA, fallos: [], vacuas: [], corrio: true });
    expect(c?.corrio).toBe(true);
    expect(c?.motivo ?? null).toBeNull();
  });
});
