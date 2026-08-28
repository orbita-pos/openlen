// El Agente escribe en el perfil, y lo que escribe tiene consumidores de CÓDIGO.
//
// `contact.whatsapp` es lo que `contact-widget.ts` mete en el `wa.me`; `socials`
// es lo que arma la banda de plataformas. Un dato mal escrito aquí no es un
// texto feo: es un botón que no llama a nadie.
import { describe, expect, it } from "vitest";

import type { BusinessProfileData } from "./types";
import { aprenderDelNegocio, CAMPOS_APRENDIBLES } from "./aprender";
import { buildBusinessFacts } from "./facts";

const VACIO = {} as BusinessProfileData;

const CON_DATOS = {
  business_name: "Aguja Negra",
  contact: {
    whatsapp: "5213311111111",
    phone: null,
    email: null,
    address: null,
    socials: { instagram: "https://instagram.com/aguja", facebook: null, tiktok: null, website: null },
  },
} as unknown as BusinessProfileData;

describe("lo que el Agente aprende del negocio", () => {
  it("escribe un dato que no estaba", () => {
    const r = aprenderDelNegocio(VACIO, "whatsapp", "5213312345678");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.contact?.whatsapp).toBe("5213312345678");
    expect(r.anterior).toBeNull();
    expect(r.cambio).toBe(true);
  });

  it("y una red social sin tocar las demás", () => {
    const r = aprenderDelNegocio(CON_DATOS, "tiktok", "https://tiktok.com/@aguja");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.contact?.socials?.tiktok).toBe("https://tiktok.com/@aguja");
    expect(r.data.contact?.socials?.instagram).toBe("https://instagram.com/aguja");
    // Y el resto del contacto sigue en pie.
    expect(r.data.contact?.whatsapp).toBe("5213311111111");
  });

  /**
   * PISAR UN DATO EN SILENCIO ES CÓMO SE PIERDE EL NÚMERO QUE SÍ FUNCIONABA.
   * Un teléfono tiene UN valor —acumularlos daría tres WhatsApps y ninguna forma
   * de saber cuál es el bueno— pero lo que había vuelve, para que el Agente
   * pueda decir «cambié el WhatsApp, antes tenías otro».
   */
  it("sobrescribe, y DEVUELVE lo que había", () => {
    const r = aprenderDelNegocio(CON_DATOS, "whatsapp", "5213399999999");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.contact?.whatsapp).toBe("5213399999999");
    expect(r.anterior, "sin esto, el usuario pierde su número y no se entera").toBe(
      "5213311111111",
    );
    expect(r.cambio).toBe(true);
  });

  it("y guardar el mismo valor se nota como que no cambió nada", () => {
    const r = aprenderDelNegocio(CON_DATOS, "whatsapp", "  5213311111111  ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cambio).toBe(false);
  });

  /** El perfil que entra puede venir de una caché compartida: mutarlo cambiaría
   *  lo que otro lector ya tiene en la mano. */
  it("nunca muta el perfil que recibe", () => {
    const antes = JSON.stringify(CON_DATOS);
    aprenderDelNegocio(CON_DATOS, "email", "hola@aguja.mx");
    expect(JSON.stringify(CON_DATOS)).toBe(antes);
  });
});

describe("lo que NO se acepta", () => {
  /**
   * LISTA CERRADA. Con claves libres el modelo inventaría `color_favorito`: se
   * guardaría, nadie lo leería, y el usuario creería que se tuvo en cuenta. Un
   * campo sin consumidor es una promesa que no se cumple.
   */
  it("un campo que nadie lee", () => {
    const r = aprenderDelNegocio(VACIO, "color_favorito", "azul");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("campo_desconocido");
  });

  it("un valor vacío o sólo espacios", () => {
    expect(aprenderDelNegocio(VACIO, "email", "   ")).toMatchObject({ motivo: "valor_vacio" });
  });

  /** Un dato de contacto no es un párrafo: «llámanos de 9 a 6 y si no contesta
   *  escribe al otro» no cabe en un `wa.me` ni en un `mailto:`. */
  it("y un texto disfrazado de dato", () => {
    expect(aprenderDelNegocio(VACIO, "telefono", "x".repeat(201))).toMatchObject({
      motivo: "valor_largo",
    });
  });
});

describe("y lo escrito LLEGA al modelo", () => {
  /**
   * LA PRUEBA QUE JUSTIFICA LA LISTA CERRADA. Guardar en un sitio que
   * `buildBusinessFacts` no lee sería guardar en el vacío: el usuario habría
   * dicho su dato, el Agente habría confirmado, y la siguiente página lo
   * seguiría inventando.
   */
  it.each(CAMPOS_APRENDIBLES)("%s aparece en el bloque <business>", (campo) => {
    const r = aprenderDelNegocio(VACIO, campo, `valor-de-${campo}`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bloque = buildBusinessFacts(r.data);
    expect(bloque, `${campo} se guarda pero el modelo no lo ve`).toContain(
      `valor-de-${campo}`,
    );
  });
});
