// Qué cuenta como «hazme una como ésta» dentro de una frase.
//
// El campo aparte podía ser laxo: si estás escribiendo en una caja que PIDE una
// dirección, `linear.app` a secas es obviamente una dirección. Dentro de un
// brief no: «una tienda tipo mercado libre.com para mi negocio» es una frase, y
// adivinar convertiría lo que alguien escribe en una petición de red.
import { describe, expect, it } from "vitest";

import { urlEnElBrief } from "./url-en-el-brief";

describe("una dirección dentro del brief", () => {
  it("se encuentra en medio de una frase", () => {
    expect(
      urlEnElBrief("hazme una como https://linear.app pero para tatuajes")?.url,
    ).toBe("https://linear.app/");
  });

  it("al principio y al final también", () => {
    expect(urlEnElBrief("https://stripe.com de referencia")?.url).toBe("https://stripe.com/");
    expect(urlEnElBrief("como esta: https://stripe.com")?.url).toBe("https://stripe.com/");
  });

  /** «mira https://linear.app.» no incluye el punto: la puntuación es de la
   *  frase, no de la dirección, y colada dentro rompe la petición. */
  it("y la puntuación de la frase se queda fuera", () => {
    expect(urlEnElBrief("mira https://linear.app.")?.url).toBe("https://linear.app/");
    expect(urlEnElBrief("mira https://linear.app, ¿te gusta?")?.url).toBe("https://linear.app/");
    expect(urlEnElBrief("(https://linear.app)")?.url).toBe("https://linear.app/");
  });

  it("conserva la ruta y la query, que son parte de lo que se quiere copiar", () => {
    expect(urlEnElBrief("mira https://linear.app/features?x=1")?.url).toBe(
      "https://linear.app/features?x=1",
    );
  });

  it("y guarda cómo la escribió el usuario, para poder señalarla", () => {
    expect(urlEnElBrief("mira https://linear.app.")?.crudo).toBe("https://linear.app");
  });
});

describe("lo que NO es una dirección", () => {
  /**
   * SIN ESQUEMA NO SE ADIVINA. Ésta es la diferencia con el campo que había:
   * ahí el contexto decía «esto es una URL»; aquí el contexto es una frase.
   */
  it.each([
    "una tienda tipo mercado libre.com para mi negocio",
    "algo minimalista, estilo apple.com",
    "una landing para mi.negocio",
  ])("«%s» no dispara nada", (texto) => {
    expect(urlEnElBrief(texto)).toBeNull();
  });

  it("un host sin punto tampoco — no es una web pública", () => {
    expect(urlEnElBrief("mira http://localhost:3000")).toBeNull();
    expect(urlEnElBrief("mira https://intranet")).toBeNull();
  });

  it("ni un brief normal, que es el caso de siempre", () => {
    expect(
      urlEnElBrief("Landing para un estudio de tatuajes blackwork en Guadalajara."),
    ).toBeNull();
    expect(urlEnElBrief("")).toBeNull();
  });
});

describe("dos direcciones", () => {
  /**
   * SE USA LA PRIMERA. Una referencia visual es UNA dirección: mezclar dos
   * paletas da una tercera que no es ninguna de las dos, y elegir en silencio es
   * peor que no elegir. La que escribió antes gana, y se puede quitar.
   */
  it("gana la que escribió primero", () => {
    expect(
      urlEnElBrief("entre https://linear.app y https://stripe.com me gusta más la primera")?.url,
    ).toBe("https://linear.app/");
  });

  /** Y si la primera no vale, se sigue mirando: una dirección rota al principio
   *  no puede tapar una buena que viene después. */
  it("pero una inválida no tapa a la siguiente", () => {
    expect(urlEnElBrief("http://localhost y https://stripe.com")?.url).toBe(
      "https://stripe.com/",
    );
  });
});
