import { describe, expect, it } from "vitest";

import {
  bytesDeBase64,
  leerReferenciaAdjunta,
  leerReferenciasAdjuntas,
  MAX_BYTES_REFERENCIA,
  MAX_REFERENCIAS,
} from "./referencia-adjunta";

// Un PNG de 1×1 real, no una cadena inventada: si algún día esto pasa por un
// decodificador de verdad, el fixture ya es válido.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("bytesDeBase64", () => {
  // La cuenta es la razón de ser del módulo: un tope sobre la LONGITUD de la
  // cadena deja pasar un 33% más de lo que uno cree.
  it("mide los bytes decodificados, no la longitud de la cadena", () => {
    expect(bytesDeBase64("QUJD")).toBe(3); // "ABC"
    expect(bytesDeBase64("QUJDRA==")).toBe(4); // "ABCD"
    expect(bytesDeBase64("QUJDREU=")).toBe(5); // "ABCDE"
    expect(bytesDeBase64("")).toBe(0);
  });

  it("y esa diferencia no es cosmética", () => {
    const b64 = "A".repeat(1000);
    expect(b64.length).toBe(1000);
    expect(bytesDeBase64(b64)).toBe(750);
  });
});

describe("leerReferenciaAdjunta", () => {
  it("sin adjunto devuelve null — no es un error, es que no mandó ninguno", () => {
    expect(leerReferenciaAdjunta(undefined)).toBeNull();
    expect(leerReferenciaAdjunta(null)).toBeNull();
  });

  it("acepta un PNG bien formado", () => {
    const r = leerReferenciaAdjunta({ mimeType: "image/png", dataBase64: PNG });
    expect(r?.ok).toBe(true);
    if (r?.ok) {
      expect(r.imagen.mimeType).toBe("image/png");
      expect(r.imagen.dataBase64).toBe(PNG);
      expect(r.bytes).toBeGreaterThan(0);
    }
  });

  it("acepta el `data:` URI entero, que es lo que da un FileReader", () => {
    const r = leerReferenciaAdjunta({ dataBase64: `data:image/jpeg;base64,${PNG}` });
    expect(r?.ok).toBe(true);
    if (r?.ok) expect(r.imagen.mimeType).toBe("image/jpeg");
  });

  // El navegador sabe qué fichero leyó; el campo `mimeType` lo escribe quien
  // manda la petición. Cuando discrepan, gana el del `data:` URI.
  it("el tipo del data: URI manda sobre el declarado", () => {
    const r = leerReferenciaAdjunta({
      mimeType: "image/png",
      dataBase64: `data:image/webp;base64,${PNG}`,
    });
    expect(r?.ok).toBe(true);
    if (r?.ok) expect(r.imagen.mimeType).toBe("image/webp");
  });

  it.each([["image/png"], ["image/jpeg"], ["image/webp"], ["image/avif"]])(
    "%s entra",
    (mime) => {
      expect(leerReferenciaAdjunta({ mimeType: mime, dataBase64: PNG })?.ok).toBe(true);
    },
  );

  // SVG es un documento EJECUTABLE. Que "sea una imagen" en el menú del sistema
  // no lo convierte en píxeles, y nada aguas abajo lo trata como tal.
  it.each([["image/svg+xml"], ["text/html"], ["application/pdf"], ["image/gif"]])(
    "%s se rechaza",
    (mime) => {
      const r = leerReferenciaAdjunta({ mimeType: mime, dataBase64: PNG });
      expect(r).toEqual({ ok: false, motivo: "tipo-no-soportado" });
    },
  );

  it("rechaza lo que se pasa del tope, medido en bytes decodificados", () => {
    // 4/3 de caracteres por byte: esto decodifica a un byte MÁS que el tope.
    const b64 = "A".repeat(Math.ceil(((MAX_BYTES_REFERENCIA + 1) * 4) / 3));
    const r = leerReferenciaAdjunta({ mimeType: "image/png", dataBase64: b64 });
    expect(r).toEqual({ ok: false, motivo: "demasiado-grande" });
  });

  it("y acepta lo que cabe justo — el tope no puede morder al caso legítimo", () => {
    const b64 = "A".repeat(Math.floor((MAX_BYTES_REFERENCIA * 4) / 3) - 4);
    expect(leerReferenciaAdjunta({ mimeType: "image/png", dataBase64: b64 })?.ok).toBe(true);
  });

  it("rechaza lo que no es base64", () => {
    const r = leerReferenciaAdjunta({ mimeType: "image/png", dataBase64: "no soy base64!!" });
    expect(r).toEqual({ ok: false, motivo: "base64-invalido" });
  });

  it("una cadena vacía es 'vacia', no 'base64-invalido'", () => {
    expect(leerReferenciaAdjunta({ mimeType: "image/png", dataBase64: "   " })).toEqual({
      ok: false,
      motivo: "vacia",
    });
  });

  // BRAZO DE CONTROL del orden de las comprobaciones: si el tamaño se mirara
  // DESPUÉS de la forma, esto gastaría el regex sobre megabytes de basura.
  it("mide el tamaño ANTES que la forma", () => {
    const enorme = "!".repeat(Math.ceil(((MAX_BYTES_REFERENCIA + 1) * 4) / 3));
    expect(leerReferenciaAdjunta({ mimeType: "image/png", dataBase64: enorme })).toEqual({
      ok: false,
      motivo: "demasiado-grande",
    });
  });

  it("los espacios en blanco del transporte no invalidan la imagen", () => {
    const conSaltos = PNG.replace(/(.{20})/g, "$1\n");
    expect(leerReferenciaAdjunta({ mimeType: "image/png", dataBase64: conSaltos })?.ok).toBe(true);
  });
});

describe("leerReferenciasAdjuntas — el lote", () => {
  const buena = { mimeType: "image/png", dataBase64: PNG };

  it("sin nada devuelve un lote vacio, no revienta", () => {
    expect(leerReferenciasAdjuntas(undefined).imagenes).toEqual([]);
    expect(leerReferenciasAdjuntas(null).imagenes).toEqual([]);
  });

  it("lee un array entero", () => {
    const r = leerReferenciasAdjuntas([buena, buena, buena]);
    expect(r.imagenes).toHaveLength(3);
    expect(r.descartadas).toEqual([]);
  });

  it("acepta un objeto suelto — lo que manda el cliente viejo", () => {
    // En la ventana de un despliegue conviven las dos versiones del cliente.
    // Sin esta rama, quien tuviera la portada abierta pierde su foto en silencio.
    expect(leerReferenciasAdjuntas(buena).imagenes).toHaveLength(1);
  });

  it("una mala NO se lleva a las buenas", () => {
    const r = leerReferenciasAdjuntas([buena, { mimeType: "image/heic", dataBase64: PNG }, buena]);
    expect(r.imagenes).toHaveLength(2);
    expect(r.descartadas).toEqual(["tipo-no-soportado"]);
  });

  it("recorta al tope en silencio", () => {
    const r = leerReferenciasAdjuntas(Array.from({ length: MAX_REFERENCIAS + 3 }, () => buena));
    expect(r.imagenes).toHaveLength(MAX_REFERENCIAS);
  });

  it("suma los bytes de todas, que es lo que se registra", () => {
    const una = leerReferenciasAdjuntas([buena]);
    const dos = leerReferenciasAdjuntas([buena, buena]);
    expect(dos.bytes).toBe(una.bytes * 2);
  });

  it("un SVG sigue sin entrar ni acompanado", () => {
    // Es un documento ejecutable, no una imagen. El lote no relaja la puerta.
    const r = leerReferenciasAdjuntas([{ mimeType: "image/svg+xml", dataBase64: PNG }]);
    expect(r.imagenes).toEqual([]);
    expect(r.descartadas).toEqual(["tipo-no-soportado"]);
  });
});
