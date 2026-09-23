import { describe, expect, it } from "vitest";
import { deshacerSobreLoActual } from "./deshacer-lo-de-len";

// La página del arnés, recortada: una línea por elemento, como la escribe el
// modelo.
const ANTES = [
  "<body>",
  "<h1>Bienvenido a Mi Negocio</h1>",
  "<p>El mejor lugar de la ciudad.</p>",
  '<a href="#contacto" role="button">Contáctanos</a>',
  "<section id=\"servicios\">",
  "<h2>Nuestros servicios</h2>",
  "</section>",
  "<footer><p>© 2026 Mi Negocio</p></footer>",
  "</body>",
].join("\n");
// Len pone el botón en rojo.
const DEL_LEN = ANTES.replace('role="button">', 'role="button" style="background:#dc2626">');
// Y después el dueño cambia el titular a mano.
const CON_EL_DUENO = DEL_LEN.replace("Bienvenido a Mi Negocio</h1>", "Vitalvet · Urgencias 24h</h1>");

describe("deshacer lo de Len sobre lo que hay ahora", () => {
  it("sin edición del dueño, vuelve exactamente al antes", () => {
    const r = deshacerSobreLoActual({ antes: ANTES, delLen: DEL_LEN, actual: DEL_LEN });
    expect(r).toEqual({ ok: true, html: ANTES, bloques: 1 });
  });

  it("🔴 el titular del dueño se queda y el rojo de Len se va", () => {
    const r = deshacerSobreLoActual({ antes: ANTES, delLen: DEL_LEN, actual: CON_EL_DUENO });
    expect(r.ok).toBe(true);
    const html = (r as { html: string }).html;
    expect(html).toContain("Vitalvet · Urgencias 24h");
    expect(html).not.toContain("#dc2626");
  });

  it("🔴 si el dueño tocó LO MISMO que Len, no se toca nada y se dice", () => {
    const encima = DEL_LEN.replace('style="background:#dc2626"', 'style="background:#111827"');
    expect(deshacerSobreLoActual({ antes: ANTES, delLen: DEL_LEN, actual: encima })).toEqual({
      ok: false,
      motivo: "se_solapan",
    });
  });

  it("el dueño tocó la línea VECINA, no la de Len: se deshace igual", () => {
    const pegado = DEL_LEN.replace("<p>El mejor lugar de la ciudad.</p>", "<p>Otra cosa.</p>");
    const r = deshacerSobreLoActual({ antes: ANTES, delLen: DEL_LEN, actual: pegado });
    expect((r as { html: string }).html).toBe(ANTES.replace("<p>El mejor lugar de la ciudad.</p>", "<p>Otra cosa.</p>"));
  });

  it("🔴 si lo que tocó Len ya no se distingue —el dueño duplicó la sección—, falla cerrado", () => {
    const relleno = "<i>k</i>".repeat(8);
    const antes = `${relleno}<b>x</b>${relleno}`;
    const delLen = antes.replace("<b>x</b>", "<b>y</b>");
    const actual = delLen + delLen;
    expect(deshacerSobreLoActual({ antes, delLen, actual })).toEqual({ ok: false, motivo: "se_solapan" });
  });

  it("🔴 un documento de UNA línea se deshace igual: la pieza es la etiqueta", () => {
    const antes = '<h1>Tacos</h1><p>Los mejores</p><a role="button">Pide</a>';
    const delLen = antes.replace("<h1>Tacos</h1>", "<h1>Tacos El Güero</h1>");
    const actual = delLen.replace("Los mejores", "Los mejores del barrio");
    const r = deshacerSobreLoActual({ antes, delLen, actual });
    expect((r as { html: string }).html).toBe(antes.replace("Los mejores", "Los mejores del barrio"));
  });

  it("deshace varios bloques y una inserción entera", () => {
    const delLen = ANTES.replace("<h2>Nuestros servicios</h2>", "<h2>Servicios</h2>\n<p>Nuevo párrafo de Len</p>").replace(
      "© 2026 Mi Negocio",
      "© 2026 Vitalvet",
    );
    const actual = delLen.replace("Bienvenido a Mi Negocio", "Hola");
    const r = deshacerSobreLoActual({ antes: ANTES, delLen, actual });
    expect(r.ok).toBe(true);
    expect((r as { html: string }).html).toBe(ANTES.replace("Bienvenido a Mi Negocio", "Hola"));
  });

  it("deshace un borrado de Len devolviendo lo que quitó", () => {
    const delLen = ANTES.replace("<p>El mejor lugar de la ciudad.</p>\n", "");
    const actual = delLen.replace("Nuestros servicios", "Lo que hacemos");
    const r = deshacerSobreLoActual({ antes: ANTES, delLen, actual });
    expect((r as { html: string }).html).toBe(ANTES.replace("Nuestros servicios", "Lo que hacemos"));
  });

  it("BRAZO DE CONTROL: si Len no cambió nada, no hay nada que deshacer", () => {
    expect(deshacerSobreLoActual({ antes: ANTES, delLen: ANTES, actual: CON_EL_DUENO })).toEqual({
      ok: false,
      motivo: "sin_cambios_de_len",
    });
  });
});
