import { describe, expect, it, vi } from "vitest";
import type { EventoSse } from "@/lib/len-bench/sse";
import { AVISO_DE_ESPERA_MS, crearPuenteALen, fraseDeAvance, recortarParaLaVoz, type DepsDelPuente, type EventoParaLaVoz, type TarjetaDeLlamada } from "./puente-a-len";

function preparar(eventos: EventoSse[], o: { rechaza?: Error; espera?: Promise<void> } = {}) {
  const voz: EventoParaLaVoz[] = [];
  const tarjetas: TarjetaDeLlamada[] = [];
  const deps: DepsDelPuente = {
    pedirALen: vi.fn(async (_prompt, alEvento) => {
      for (const e of eventos) alEvento(e);
      if (o.espera) await o.espera;
      if (o.rechaza) throw o.rechaza;
    }),
    dirigir: vi.fn(async () => {}),
    enviarALaVoz: (e) => voz.push(e),
    mostrarTarjeta: (t) => tarjetas.push(t),
  };
  return { deps, voz, tarjetas, puente: crearPuenteALen(deps) };
}

const turno: EventoSse = { nombre: "turno", datos: { turnoId: "t1" } };
const done: EventoSse = { nombre: "done", datos: { turns: 1, toolCalls: 1 } };

describe("crearPuenteALen", () => {
  it("delegar pide a Len lo que se oyó, avisa en silencio y le pasa a la voz el resultado", async () => {
    const { deps, voz, tarjetas, puente } = preparar([
      turno,
      { nombre: "action", datos: { tool: "ver_visitas", status: "running" } },
      { nombre: "action", datos: { tool: "ver_visitas", status: "done" } },
      { nombre: "text", datos: { text: "Esta semana llevas **312** visitas." } },
      done,
    ]);
    puente.oir("¿Cómo va ");
    puente.oir("mi página?");
    await puente.delegar("d1");
    expect(deps.pedirALen).toHaveBeenCalledWith("¿Cómo va mi página?", expect.any(Function));
    expect(voz[0]).toEqual({ type: "session.thinking.append", delegation_id: "d1", content: fraseDeAvance("ver_visitas") });
    expect(voz.filter((e) => e.type === "session.thinking.append")).toHaveLength(1);
    const final = voz.at(-1)!;
    expect(final.type).toBe("session.commentary.append");
    expect(final.delegation_id).toBe("d1");
    expect(final.content).toContain("Esta semana llevas 312 visitas.");
    expect(tarjetas).toEqual([{ tipo: "visitas" }]);
  });

  it("el borrador y publicar llegan como tarjetas; mensajes, con el texto de Len", async () => {
    const respuesta = { action: "responder", para: "chat", id: "c1", con: "Juan", texto: "¡Hola!", botones: ["enviar"], correo: null, whatsapp: null };
    const { tarjetas, puente } = preparar([
      turno,
      { nombre: "action", datos: { tool: "ver_mensajes", status: "done" } },
      { nombre: "confirm", datos: respuesta },
      { nombre: "confirm", datos: { action: "publicar", subdominio: "espiga", idiomas: [], republicar: false } },
      { nombre: "text", datos: { text: "Te dejé el borrador." } },
      done,
    ]);
    puente.oir("dile que sí");
    await puente.delegar("d1");
    expect(tarjetas).toEqual([
      { tipo: "texto", texto: "Te dejé el borrador." },
      { tipo: "respuesta", respuesta },
      { tipo: "publicar", confirm: { action: "publicar", subdominio: "espiga", idiomas: [], republicar: false } },
    ]);
  });

  it("si Len falla, la voz dice el motivo real", async () => {
    const { voz, puente } = preparar([turno, { nombre: "error", datos: { message: "Sin créditos", code: "no_credits" } }]);
    puente.oir("hola");
    await puente.delegar("d1");
    expect(voz.at(-1)!.content).toMatch(/Len no pudo terminar.*Sin créditos/);
  });

  it("si el stream se corta sin done, la voz dice que Len sigue en el servidor", async () => {
    const { voz, puente } = preparar([turno], { rechaza: new Error("network error") });
    puente.oir("cambia el color");
    await puente.delegar("d1");
    expect(voz.at(-1)!.content).toMatch(/sigue trabajando/);
  });

  it("si el turno ni siquiera empezó (sin id de turno), no dice que Len sigue: da el motivo", async () => {
    const { voz, puente } = preparar([], { rechaza: new Error("/api/agent respondió 401") });
    puente.oir("hola");
    await puente.delegar("d1");
    expect(voz.at(-1)!.content).toMatch(/Len no pudo terminar.*401/);
    expect(voz.at(-1)!.content).not.toMatch(/sigue trabajando/);
  });

  it("una segunda delegación con Len trabajando va como corrección al turno", async () => {
    let soltar!: () => void;
    const espera = new Promise<void>((r) => (soltar = r));
    const { deps, voz, puente } = preparar([turno], { espera });
    puente.oir("las visitas de esta semana");
    const primera = puente.delegar("d1");
    await Promise.resolve();
    expect(puente.trabajando()).toBe(true);
    puente.oir("no, mejor las de ayer");
    await puente.delegar("d2");
    expect(deps.dirigir).toHaveBeenCalledWith("t1", "no, mejor las de ayer");
    expect(deps.pedirALen).toHaveBeenCalledTimes(1);
    expect(voz.some((e) => e.delegation_id === "d2" && e.type === "session.thinking.append")).toBe(true);
    soltar();
    await primera;
    expect(puente.trabajando()).toBe(false);
  });

  it("si Len pasa de 3 minutos, la voz ofrece colgar (una vez) y luego da el resultado", async () => {
    vi.useFakeTimers();
    try {
      let soltar!: () => void;
      const espera = new Promise<void>((r) => (soltar = r));
      const { voz, puente } = preparar([turno, { nombre: "text", datos: { text: "Listo." } }, done], { espera });
      puente.oir("hazme una página de pasteles");
      const p = puente.delegar("d1");
      vi.advanceTimersByTime(AVISO_DE_ESPERA_MS);
      expect(voz.filter((e) => e.type === "session.commentary.append" && /Ofrece colgar/.test(e.content))).toHaveLength(1);
      soltar();
      await p;
      vi.advanceTimersByTime(AVISO_DE_ESPERA_MS);
      expect(voz.filter((e) => /Ofrece colgar/.test(e.content))).toHaveLength(1);
      expect(voz.at(-1)!.content).toContain("Listo.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("delegar sin haber oído nada no molesta a Len", async () => {
    const { deps, voz, puente } = preparar([]);
    await puente.delegar("d1");
    expect(deps.pedirALen).not.toHaveBeenCalled();
    expect(voz.at(-1)!.type).toBe("session.commentary.append");
  });
});

describe("recortarParaLaVoz", () => {
  it("quita el formato de chat y junta los espacios", () => {
    expect(recortarParaLaVoz("**312** visitas\n\n> «¿Abren?»\n- uno\n`x`")).toBe("312 visitas «¿Abren?» uno x");
  });

  it("corta en el último punto antes del máximo", () => {
    const t = "Primera frase. Segunda frase que no cabe entera.";
    expect(recortarParaLaVoz(t, 30)).toBe("Primera frase. …");
  });
});

describe("fraseDeAvance", () => {
  it("una frase por herramienta conocida; nada para las demás", () => {
    expect(fraseDeAvance("ver_visitas")).toMatch(/visitas/);
    expect(fraseDeAvance("Edit")).toMatch(/cambiando la página/);
    expect(fraseDeAvance("TodoWrite")).toBeNull();
  });
});
