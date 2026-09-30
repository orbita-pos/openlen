import { describe, expect, it } from "vitest";
import {
  FORM_ID_ATTR,
  FORM_ID_FIELD,
  readFormIds,
  resolveFormConfigKey,
  stampFormIds,
} from "./form-identity";
import { wirePublishedForms } from "./forms";

const DOC = (cuerpo: string) =>
  `<!doctype html><html lang="es"><head><title>t</title></head><body>${cuerpo}</body></html>`;
const FORM = (dentro = "") => `<form>${dentro}<input name="email"><button>Enviar</button></form>`;

describe("stampFormIds", () => {
  it("da identidad a cada formulario", () => {
    const r = stampFormIds(DOC(FORM() + FORM()));
    expect(r.stamped).toBe(2);
    expect(r.ids).toHaveLength(2);
    expect(r.ids[0]).not.toBe(r.ids[1]);
    expect(r.ids.every((i) => /^f[0-9a-f]{12}$/.test(i))).toBe(true);
  });

  it("es idempotente: una segunda pasada no reescribe nada", () => {
    const una = stampFormIds(DOC(FORM() + FORM())).html;
    const dos = stampFormIds(una);
    expect(dos.stamped).toBe(0);
    expect(dos.html).toBe(una);
  });

  // Sin formularios el html tiene que salir BYTE A BYTE igual: el round-trip
  // del parser pierde comentarios y normaliza `/>`, así que pasar por aquí sin
  // trabajo que hacer no puede degradar una página.
  it("sin formularios devuelve el original intacto", () => {
    const html = DOC("<h1>hola</h1><!-- comentario --><br/>");
    const r = stampFormIds(html);
    expect(r.stamped).toBe(0);
    expect(r.html).toBe(html);
  });

  // Pasa de verdad: el modelo copia una sección entera, atributos incluidos.
  // Dos formularios con el mismo id resolverían la misma configuración — que es
  // exactamente el fallo que todo esto cierra.
  it("re-estampa un duplicado en vez de dejar dos formularios con la misma identidad", () => {
    const dup = DOC(
      `<form ${FORM_ID_ATTR}="fabc123456789"><input name="a"></form>` +
        `<form ${FORM_ID_ATTR}="fabc123456789"><input name="b"></form>`,
    );
    const r = stampFormIds(dup);
    expect(r.stamped).toBe(1);
    expect(new Set(r.ids).size).toBe(2);
    expect(r.ids[0]).toBe("fabc123456789");
  });

  // EL FALLO: al estampar, el documento entero salía de `dom.toString()` — sin
  // comentarios, con `<x/>` vuelto `<x></x>` y los `<meta … />` sin su barra —
  // y el primer guardado de cualquier página con un formulario reescribía
  // código que el modelo escribió y la edición no tocaba. Estampar es poner UN
  // atributo: quitándolo, tiene que quedar el original byte a byte.
  it("estampar no cambia ni un byte fuera del atributo", () => {
    const html =
      `<!doctype html>\n<html lang="es">\n<head>\n` +
      `  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width" />\n` +
      `  <!-- el modelo dejó esto aquí -->\n  <title>t</title>\n</head>\n<body>\n` +
      `  <h1>Hola<br/>mundo</h1>\n  <img src="a.png" alt="" />\n` +
      `  <!-- <form>un formulario comentado no es un formulario</form> -->\n` +
      `  <form class='caja  ancha' action="/enviar?a=1&amp;b=2" novalidate>\n` +
      `    <input name="email" required/><br/>\n    <button>Enviar</button>\n  </form>\n` +
      `  <FORM data-x=sin-comillas><input name="otro"></FORM>\n` +
      `</body>\n</html>\n`;
    const r = stampFormIds(html);
    expect(r.stamped).toBe(2);

    let sinIds = r.html;
    for (const id of r.ids) {
      expect(sinIds.split(` ${FORM_ID_ATTR}="${id}"`)).toHaveLength(2);
      sinIds = sinIds.replace(` ${FORM_ID_ATTR}="${id}"`, "");
    }
    expect(sinIds).toBe(html);
    // Lo que el round-trip se comía, dicho sin depender de la resta de arriba.
    expect(r.html).toContain(`<meta charset="utf-8" />`);
    expect(r.html).toContain("<!-- el modelo dejó esto aquí -->");
    expect(r.html).toContain("<h1>Hola<br/>mundo</h1>");
    expect(readFormIds(r.html)).toEqual(r.ids);
  });

  // Re-estampar un duplicado cambia el VALOR y nada más: ni la posición del
  // atributo ni el resto de la etiqueta.
  it("un duplicado se re-estampa en su sitio, sin tocar el resto", () => {
    const viejo = `${FORM_ID_ATTR}="fabc123456789"`;
    const dup = DOC(
      `<form class="a" ${viejo}><input name="a"/></form><!-- copia -->` +
        `<form class="b" ${viejo} data-y='z'><input name="b"/></form>`,
    );
    const r = stampFormIds(dup);
    expect(r.stamped).toBe(1);
    const segundo = dup.lastIndexOf(viejo);
    expect(r.html).toBe(
      dup.slice(0, segundo) + `${FORM_ID_ATTR}="${r.ids[1]}"` + dup.slice(segundo + viejo.length),
    );
    expect(readFormIds(r.html)).toEqual(r.ids);
  });

  // Un atributo vacío no es identidad: se rellena ESE, no se añade otro — con
  // dos, el navegador lee el primero y el editor pediría el ajuste sin id.
  it("un id vacío se rellena en su sitio, sin añadir un segundo atributo", () => {
    const html = DOC(`<form ${FORM_ID_ATTR}="" class="c"><input name="e"></form>`);
    const r = stampFormIds(html);
    expect(r.stamped).toBe(1);
    expect(r.html).toBe(DOC(`<form ${FORM_ID_ATTR}="${r.ids[0]}" class="c"><input name="e"></form>`));
    expect(readFormIds(r.html)).toEqual(r.ids);
  });

  it("readFormIds conserva el hueco de un formulario sin estampar", () => {
    const mixto = DOC(`<form ${FORM_ID_ATTR}="fdeadbeef001"></form><form></form>`);
    expect(readFormIds(mixto)).toEqual(["fdeadbeef001", ""]);
  });
});

describe("resolveFormConfigKey", () => {
  const ids = ["faaa000000001", "fbbb000000002"];

  it("la identidad gana sobre cualquier índice", () => {
    const cfg = { faaa000000001: { notifyEmail: "id@x.com" }, "0": { notifyEmail: "idx@x.com" } };
    expect(resolveFormConfigKey(ids, 0, null, cfg)).toBe("faaa000000001");
  });

  it("sin identidad cae a la clave con página", () => {
    const cfg = { "menu:1": { notifyEmail: "p@x.com" }, "1": { notifyEmail: "l@x.com" } };
    expect(resolveFormConfigKey(["", ""], 1, "menu", cfg)).toBe("menu:1");
  });

  it("y por último a la clave heredada por índice", () => {
    expect(resolveFormConfigKey(["", ""], 1, null, { "1": {} })).toBe("1");
  });

  it("sin nada configurado devuelve null", () => {
    expect(resolveFormConfigKey(ids, 0, null, {})).toBeNull();
  });

  /**
   * EL FALLO, reproducido. El dueño configura su formulario de contacto y una
   * edición posterior inserta OTRO formulario delante. Con claves por índice,
   * el nuevo hereda su correo y los leads se van al sitio equivocado.
   */
  it("un formulario insertado delante NO hereda el correo del de atrás", () => {
    const cfg = { fcontacto0001: { notifyEmail: "ventas@negocio.com" } };
    // Antes: contacto era el índice 0. Ahora es el 1, y el nuevo es el 0.
    const despues = ["fnuevo0000001", "fcontacto0001"];
    expect(resolveFormConfigKey(despues, 0, null, cfg)).toBeNull();
    expect(resolveFormConfigKey(despues, 1, null, cfg)).toBe("fcontacto0001");
  });

  it("y con claves por índice el fallo SÍ ocurre — por eso existe la identidad", () => {
    const cfg = { "0": { notifyEmail: "ventas@negocio.com" } };
    // Sin identidades (página anterior al estampado) el formulario nuevo que
    // ahora ocupa el índice 0 se lleva el correo del otro. Es el estado
    // heredado, documentado aquí para que se vea qué cambia el arreglo.
    expect(resolveFormConfigKey(["", ""], 0, null, cfg)).toBe("0");
  });
});

describe("wirePublishedForms con identidad", () => {
  const conIds = stampFormIds(DOC(FORM() + FORM())).html;
  const ids = readFormIds(conIds);

  it("hornea el campo oculto con la identidad, estático", () => {
    const out = wirePublishedForms(conIds, "misitio", {});
    // Estático y no inyectado por JS: de esto depende a qué correo llega un
    // lead, así que un POST nativo sin JavaScript tiene que enrutar igual.
    expect(out).toContain(`name="${FORM_ID_FIELD}" value="${ids[0]}"`);
    expect(out).toContain(`name="${FORM_ID_FIELD}" value="${ids[1]}"`);
  });

  it("es idempotente — no duplica el campo al re-publicar", () => {
    const una = wirePublishedForms(conIds, "misitio", {});
    const dos = wirePublishedForms(una, "misitio", {});
    expect((dos.match(new RegExp(FORM_ID_FIELD, "g")) ?? []).length).toBe(
      (una.match(new RegExp(FORM_ID_FIELD, "g")) ?? []).length,
    );
  });

  it("aplica la config de la IDENTIDAD, no la del índice", () => {
    const out = wirePublishedForms(conIds, "misitio", {
      [ids[1]!]: { successMessage: "gracias-por-identidad" },
    });
    expect(out).toContain("gracias-por-identidad");
  });

  it("una página SIN estampar sigue resolviendo por índice", () => {
    const legado = DOC(FORM());
    const out = wirePublishedForms(legado, "misitio", { "0": { successMessage: "legado-ok" } });
    expect(out).toContain("legado-ok");
    expect(out).not.toContain(FORM_ID_FIELD);
  });
});
