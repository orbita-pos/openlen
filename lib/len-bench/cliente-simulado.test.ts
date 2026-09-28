// lib/len-bench/cliente-simulado.test.ts
import { describe, expect, it } from "vitest";
import { decidirComoCliente, preguntoLen, respetaLaFicha, respuestaFija } from "./cliente-simulado";
import type { Ficha } from "./tipos";

const ficha: Ficha = {
  negocio: "Taquería de barrio en Guadalajara",
  datos: { telefono: "33 1234 5678", correo: "hola@taqueria.test", precio_taco: "$25" },
};

describe("respetaLaFicha", () => {
  it("acepta un dato que está en la ficha, en otro formato", () => {
    expect(respetaLaFicha("claro, es el (33) 1234-5678", ficha)).toEqual({ ok: true });
  });
  it("denuncia un teléfono que NO está en la ficha", () => {
    expect(respetaLaFicha("mi whats es 33 9999 0000", ficha)).toEqual({ ok: false, dato: "3399990000" });
  });
  it("quitarle la lada a un número de la ficha no es inventar; añadírsela, sí", () => {
    const conLada: Ficha = { ...ficha, datos: { whatsapp: "+52 33 1234 5678" } };
    expect(respetaLaFicha("es el 33 1234 5678", conLada)).toEqual({ ok: true });
    expect(respetaLaFicha("es el +1 33 1234 5678", ficha).ok).toBe(false);
  });
  it("denuncia un correo o un precio inventados", () => {
    expect(respetaLaFicha("escríbeme a otro@x.test", ficha).ok).toBe(false);
    expect(respetaLaFicha("la gringa cuesta $70", ficha).ok).toBe(false);
  });
  it("un mensaje sin datos siempre la respeta", () => {
    expect(respetaLaFicha("sigue con lo que falta porfa", ficha)).toEqual({ ok: true });
  });
  it("citar un dato de SU página no es inventar: lo dado es lo mismo que en `nada-inventado`", () => {
    // Calibración del 2026-09-24, `precio-de-la-competencia`: el dueño dijo
    // «el mío está en $52», el precio de su espresso en la partida, y la
    // corrida se contó como fallo del arnés.
    const sinDatos: Ficha = { negocio: "Café", datos: {} };
    const pagina = '<div class="mono">$52</div><a href="tel:+523398765432">(33) 9876-5432</a>';
    expect(respetaLaFicha("el mío está en $52", sinDatos, pagina)).toEqual({ ok: true });
    expect(respetaLaFicha("llámame al 33 9876 5432", sinDatos, pagina)).toEqual({ ok: true });
    expect(respetaLaFicha("el de ellos está en $65", sinDatos, pagina)).toEqual({ ok: false, dato: "$65" });
  });
  // 🔴 E del 26/09: el cliente REPETÍA lo que Len acababa de decir y la
  // corrida salía fuera de ficha, aunque `nada-inventado` ya lo daba por dado
  // desde V1. Las dos reglas se habían separado.
  it("🔴 repetir el precio con el porcentaje que dio el dueño no es inventar; otro precio, sí", () => {
    const sinDatos: Ficha = { negocio: "Barbería", datos: {} };
    const partida = "<p>Kit de afeitado 78 €</p>";
    const dicho = ["hazles un 10% de descuento con el código"];
    expect(respetaLaFicha("sí, que quede en 70,20 €", sinDatos, partida, dicho)).toEqual({ ok: true });
    expect(respetaLaFicha("sí, que quede en 69,90 €", sinDatos, partida, dicho).ok).toBe(false);
  });
  it("repetir el número con la lada del país que el dueño ya nombró no es inventar; sin haberlo dicho antes, sí", () => {
    const tel: Ficha = { negocio: "Electricista en Guadalajara", datos: { telefono: "33 2468 1357" } };
    expect(respetaLaFicha("sí, 523324681357", tel, "", ["es de México"])).toEqual({ ok: true });
    expect(respetaLaFicha("sí, es de México: 523324681357", tel).ok).toBe(false);
  });
  it("y lo que el dueño ya dijo antes en la conversación, también es dado", () => {
    const sinDatos: Ficha = { negocio: "Café", datos: {} };
    expect(respetaLaFicha("sí, a $36 como te dije", sinDatos, "", ["ahora el latte es a $36"])).toEqual({ ok: true });
  });
});

describe("respuestaFija — lo que contesta el dueño cuando Len PREGUNTA", () => {
  it("lleva cada dato de la ficha TAL CUAL, sin parafrasear", () => {
    const r = respuestaFija(ficha);
    expect(r).toContain("33 1234 5678");
    expect(r).toContain("hola@taqueria.test");
    expect(r).toContain("$25");
  });
  it("y lo que no está en la ficha, que no lo tiene", () => {
    expect(respuestaFija(ficha)).toMatch(/no lo tengo/i);
  });
  it("con la ficha vacía, sólo que no lo tiene", () => {
    const r = respuestaFija({ negocio: "x", datos: {} });
    expect(r).toMatch(/no lo tengo/i);
    expect(respetaLaFicha(r, { negocio: "x", datos: {} }).ok).toBe(true);
  });
  it("nunca se sale de la ficha (la corrida no puede salir `cliente_fuera_de_ficha`)", () => {
    expect(respetaLaFicha(respuestaFija(ficha), ficha).ok).toBe(true);
  });
});

describe("decidirComoCliente — el dueño FIJO, como los dobles `fixed` de Claude Code", () => {
  const paso = { tipo: "pide" as const, mensaje: "cambia el número" };
  it("si Len usó `preguntar`, contesta con la respuesta fija", async () => {
    const r = await decidirComoCliente({ ficha, paso, conversacion: [], pregunto: true });
    expect(r).toEqual({ ok: true, decision: { accion: "responder", mensaje: respuestaFija(ficha) }, usd: 0 });
  });
  // 🔴 El fallo del 27/09: Len termina y OFRECE («si quieres, los cableo»), y el
  // dueño simulado —un modelo— decía «sí, cablea» y añadía encargos. Un doble
  // fijo no acepta nada: pasa al siguiente mensaje del guion.
  it("🔴 si Len OFRECE algo sin preguntar, no dice «sí»: pasa al siguiente", async () => {
    const r = await decidirComoCliente({
      ficha,
      paso,
      conversacion: [{ quien: "len", texto: "Listo. Esos botones apuntan a #: si quieres, los cableo a tu WhatsApp. ¿Te parece?" }],
      pregunto: false,
    });
    expect(r).toEqual({ ok: true, decision: { accion: "siguiente" }, usd: 0 });
  });
  it("y sin la señal (las sondas viejas), también pasa al siguiente", async () => {
    const r = await decidirComoCliente({ ficha, paso, conversacion: [] });
    expect(r).toEqual({ ok: true, decision: { accion: "siguiente" }, usd: 0 });
  });
  it("es determinista: el mismo punto de la conversación da SIEMPRE lo mismo", async () => {
    const a = await decidirComoCliente({ ficha, paso, conversacion: [], pregunto: true });
    const b = await decidirComoCliente({ ficha, paso, conversacion: [], pregunto: true });
    expect(a).toEqual(b);
  });
});

describe("preguntoLen — la señal sale de la herramienta, no del texto", () => {
  it("la acción `preguntar` terminada es una pregunta", () => {
    expect(preguntoLen([{ nombre: "action", datos: { type: "action", tool: "preguntar", status: "done", summary: "" } }])).toBe(true);
  });
  it("un «¿te parece?» en el texto no lo es, ni otra herramienta", () => {
    expect(preguntoLen([{ nombre: "text", datos: { type: "text", text: "¿Te parece?" } }])).toBe(false);
    expect(preguntoLen([{ nombre: "action", datos: { type: "action", tool: "Edit", status: "done", summary: "" } }])).toBe(false);
    expect(preguntoLen([{ nombre: "action", datos: { type: "action", tool: "preguntar", status: "running", summary: "" } }])).toBe(false);
  });
});
