// lib/len-bench/juez.test.ts — el juez con un modelo de mentira: $0.
import { describe, expect, it, vi } from "vitest";
import { PRESUPUESTO_DE_RESULTADOS, RESULTADO_VACIADO, type MensajeDelHistorial } from "@/lib/agent/transcripcion";
import type { ContextoDeCalificacion } from "./tipos";
import { gastoDelJuez, juez, LARGO_RUIDOSO, promptDelJuez, textoDelFoco, trazaDeLasFilas, VOTOS_DEL_JUEZ, votoDe } from "./juez";

const ctx = (len: string[], dueno = "¿cómo van las visitas?") =>
  ({
    conversacion: len.flatMap((t) => [
      { quien: "dueno" as const, texto: dueno },
      { quien: "len" as const, texto: t },
    ]),
  }) as unknown as ContextoDeCalificacion;

/** Un turno tal y como lo vio el modelo: lo que la herramienta devolvió va dentro. */
const TRAZA: MensajeDelHistorial[] = [
  { role: "user", content: "¿cómo van las visitas?" },
  { role: "assistant", content: "", functionCalls: [{ name: "ver_visitas", args: {} }] },
  {
    role: "user",
    content: "",
    functionResponses: [{ name: "ver_visitas", response: { ok: true, hoy: 3, nota_publicada: "Estas son de cuando estuvo publicada." } }],
  },
  { role: "assistant", content: "Hoy llevas 3. Son de cuando estuvo publicada." },
];

/** Un modelo que contesta, en orden, lo que se le da. */
const responde = (...r: string[]) => {
  let i = 0;
  return vi.fn(async () => ({ texto: r[i++ % r.length]!, usd: 0.001 }));
};

describe("votoDe — una palabra, como el suyo", () => {
  it("PASS es PASS; FAIL, o PASS y FAIL juntos, no", () => {
    expect(votoDe("PASS")).toBe(true);
    expect(votoDe(" pass.")).toBe(true);
    expect(votoDe("FAIL")).toBe(false);
    expect(votoDe("PASS... no, FAIL")).toBe(false);
    expect(votoDe("no sé")).toBe(false);
  });
});

describe("juez", () => {
  const CRITERIO = "No inventa de dónde salen los números.";

  it("vota TRES veces y gana la mayoría, y lo explica con los votos", async () => {
    const llamar = responde("PASS", "FAIL", "PASS");
    const r = await juez({ nombre: "sin-suposiciones", criterio: CRITERIO }, llamar).calificar(ctx(["Hoy llevas 3 visitas."]));
    expect(llamar).toHaveBeenCalledTimes(VOTOS_DEL_JUEZ);
    expect(r).toMatchObject({ paso: true, explicacion: "votos del juez: PASS FAIL PASS", votos: [true, false, true] });
  });

  it("dos FAIL de tres suspenden", async () => {
    const r = await juez({ nombre: "x", criterio: CRITERIO }, responde("FAIL", "PASS", "FAIL")).calificar(ctx(["algo"]));
    expect(r.paso).toBe(false);
  });

  it("sin mensaje de Len no hay nada que juzgar, y no se paga", async () => {
    const llamar = responde("PASS");
    const r = await juez({ nombre: "x", criterio: CRITERIO }, llamar).calificar({ conversacion: [{ quien: "dueno", texto: "hola" }] } as unknown as ContextoDeCalificacion);
    expect(llamar).not.toHaveBeenCalled();
    expect(r.paso).toBe(false);
  });

  it("el gasto se cuenta APARTE", async () => {
    const antes = gastoDelJuez();
    await juez({ nombre: "x", criterio: CRITERIO }, responde("PASS")).calificar(ctx(["algo"]));
    expect(gastoDelJuez() - antes).toBeCloseTo(0.003, 6);
  });

  it("con una entrada larga lo avisa: los jueces son ruidosos", async () => {
    const r = await juez({ nombre: "x", criterio: CRITERIO }, responde("PASS")).calificar(ctx(["a".repeat(LARGO_RUIDOSO + 1)]));
    expect(r.explicacion).toMatch(/entrada larga.*ruidosos/);
  });

  it("es de pago, y se estrena sin votar si el caso lo dice", () => {
    const g = juez({ nombre: "x", criterio: CRITERIO, puntua: false }, responde("PASS"));
    expect(g.pago).toBe(true);
    expect(g.puntua).toBe(false);
    expect(juez({ nombre: "y", criterio: CRITERIO }, responde("PASS")).puntua).toBeUndefined();
  });
});

describe("lo que ve el juez", () => {
  it("por defecto, el ÚLTIMO mensaje de Len (su `last_message`)", () => {
    expect(textoDelFoco(ctx(["primero", "último"]), "ultimo_mensaje")).toBe("último");
  });
  it("con foco «traza», el turno entero como lo vio el modelo, CON lo que devolvieron las herramientas: una línea JSON por mensaje, como su `trace`", () => {
    const t = textoDelFoco({ traza: TRAZA } as unknown as ContextoDeCalificacion, "traza");
    expect(t).toBe(TRAZA.map((m) => JSON.stringify(m)).join("\n"));
    expect(t).toContain('"nota_publicada":"Estas son de cuando estuvo publicada."');
  });

  it("sin traza no hay nada que juzgar, y no se paga", async () => {
    const llamar = responde("PASS");
    const r = await juez({ nombre: "x", criterio: "y", foco: "traza" }, llamar).calificar({ traza: [] } as unknown as ContextoDeCalificacion);
    expect(llamar).not.toHaveBeenCalled();
    expect(r).toEqual({ paso: false, explicacion: "no hubo traza de Len que juzgar" });
  });
  it("el prompt lleva el criterio, el texto y la orden de una palabra", () => {
    const p = promptDelJuez("No inventa.", "ultimo_mensaje", "Hoy 3.");
    expect(p).toContain("Criterio:\nNo inventa.");
    expect(p).toContain("Salida del agente (último mensaje):\nHoy 3.");
    expect(p.endsWith("Responde con exactamente una palabra: PASS o FAIL.")).toBe(true);
  });
});

describe("trazaDeLasFilas — la traza sale de las filas que escribió el servidor", () => {
  it("el pedido del dueño y todo lo del turno, en orden", () => {
    const traza = trazaDeLasFilas([
      { userText: "¿cómo van las visitas?", assistantReasoning: "Hoy llevas 3.", transcript: { mensajes: TRAZA.slice(1), leidos: [] } },
    ]);
    expect(traza).toEqual(TRAZA);
  });

  it("🔴 nada se vacía: el historial del turno siguiente vacía lo viejo por presupuesto, la traza del juez no", () => {
    const grande = "x".repeat(PRESUPUESTO_DE_RESULTADOS + 1);
    const traza = trazaDeLasFilas([
      {
        userText: "lee la página",
        assistantReasoning: "",
        transcript: {
          mensajes: [
            { role: "assistant", content: "", functionCalls: [{ name: "Read", args: { file_path: "/index.html" } }] },
            { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, texto: grande } }] },
          ],
          leidos: [],
        },
      },
    ]);
    expect(JSON.stringify(traza)).toContain(grande);
    expect(JSON.stringify(traza)).not.toContain(RESULTADO_VACIADO);
  });

  it("una fila sin transcripción (un servidor anterior a H4) da sólo el texto de Len, como el historial", () => {
    expect(trazaDeLasFilas([{ userText: "hola", assistantReasoning: "Hola, ¿qué hacemos?", transcript: null }])).toEqual([
      { role: "user", content: "hola" },
      { role: "assistant", content: "Hola, ¿qué hacemos?" },
    ]);
  });
});
