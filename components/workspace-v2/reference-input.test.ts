import { describe, expect, it } from "vitest";

import { normalizeReferenceUrl, referenceErrorCode, swatches } from "./reference-input";

describe("lo que la gente pega no es una URL", () => {
  it("sin esquema se completa — nadie escribe https:// a mano", () => {
    expect(normalizeReferenceUrl("stripe.com")).toBe("https://stripe.com/");
    expect(normalizeReferenceUrl("  linear.app  ")).toBe("https://linear.app/");
  });

  it("con esquema se respeta, incluido el camino", () => {
    expect(normalizeReferenceUrl("https://vercel.com/blog")).toBe("https://vercel.com/blog");
    expect(normalizeReferenceUrl("http://ejemplo.test/")).toBe("http://ejemplo.test/");
  });

  // Un host sin punto no es una web pública. Decirlo aquí ahorra el viaje, y no
  // revela NADA de la red interna — que es justo por lo que el servidor
  // devuelve un código opaco en vez de explicar qué encontró.
  it.each(["", "   ", "localhost", "intranet", "ejemplo.", "http://", "?????"])(
    "%s no llega a salir de casa",
    (entrada) => {
      expect(normalizeReferenceUrl(entrada)).toBeNull();
    },
  );

  // La validación de verdad —la que impide que el servidor sea un proxy
  // abierto— vive en `validateUrl` y vuelve a correr para cada redirección.
  // Esto es comodidad, y por eso puede permitirse ser generoso.
  it("no pretende ser la defensa: 127.0.0.1 pasa de aquí y lo para el servidor", () => {
    expect(normalizeReferenceUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080/");
  });
});

describe("qué se le cuenta al usuario cuando falla", () => {
  it("cada código del servidor se conserva tal cual", () => {
    expect(referenceErrorCode(400, { error: "blocked" })).toBe("blocked");
    expect(referenceErrorCode(502, { error: "unreachable" })).toBe("unreachable");
    expect(referenceErrorCode(502, { error: "not_rendered" })).toBe("not_rendered");
  });

  it("el límite de tasa tiene su propio mensaje, no 'algo falló'", () => {
    expect(referenceErrorCode(429, null)).toBe("rate_limited");
  });

  it("lo que no se reconoce cae en 'red', nunca se muestra crudo", () => {
    expect(referenceErrorCode(500, { error: "resuelve a 10.0.0.5" })).toBe("network");
    expect(referenceErrorCode(200, null)).toBe("network");
  });
});

describe("la pastilla", () => {
  it("enseña como mucho cinco colores — más son confeti", () => {
    const d = {
      hostname: "x.test",
      palette: Array.from({ length: 9 }, (_, i) => ({ role: "r", hex: `#00000${i}` })),
      polarity: "light" as const,
      fontFamily: "Inter",
      radius: "soft" as const,
    };
    expect(swatches(d)).toHaveLength(5);
  });
});
