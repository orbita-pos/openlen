import { describe, it, expect } from "vitest";
import { extractMapQuery, buildMapEmbedUrl, bakeMapEmbeds } from "./map-embed";

const DOC = `<!doctype html><html><head><title>Taller</title></head><body><p>Estamos en <a href="https://maps.google.com/?q=Av.%20Reforma%20222,%20CDMX">Av. Reforma 222, CDMX</a></p></body></html>`;

describe("extractMapQuery — válidas", () => {
  it("la forma que YA emite contact-widget.ts", () => {
    // lib/business-profiles/contact-widget.ts:82 — en cuanto existe este
    // horneado, el widget de contacto que ya corre en producción se convierte
    // en mapa sin tocarlo.
    expect(extractMapQuery("https://maps.google.com/?q=Av.%20Reforma%20222,%20CDMX")).toBe(
      "Av. Reforma 222, CDMX",
    );
  });

  it("www.google.com/maps con ?q=", () => {
    expect(extractMapQuery("https://www.google.com/maps?q=Calle+Mayor+3,+Madrid")).toBe(
      "Calle Mayor 3, Madrid",
    );
  });

  it("la ruta /maps/place/ de copiar la barra de direcciones", () => {
    expect(extractMapQuery("https://www.google.com/maps/place/Plaza+Mayor,+Madrid")).toBe(
      "Plaza Mayor, Madrid",
    );
  });

  it("conserva acentos y ñ — son direcciones reales, no ruido", () => {
    expect(extractMapQuery("https://maps.google.com/?q=Calle%20Espa%C3%B1a%2012,%20Alcal%C3%A1")).toBe(
      "Calle España 12, Alcalá",
    );
  });
});

describe("extractMapQuery — hostil o inválida → null", () => {
  const malas = [
    "https://google.com.evil.com/maps?q=x",       // host parecido
    "https://maps.google.com.evil.com/?q=x",      // host parecido
    "https://evil.com/maps?q=Madrid",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://www.google.com/search?q=Madrid",     // google.com SIN /maps
    "https://www.google.com/?q=Madrid",           // idem
    "https://maps.app.goo.gl/AbCdEf",             // enlace corto: no se resuelve
    "no es una url",
    "",
  ];
  for (const u of malas) {
    it(`rechaza ${u.slice(0, 44) || "(vacío)"}`, () => {
      expect(extractMapQuery(u)).toBeNull();
    });
  }

  it("una consulta demasiado corta no es una dirección", () => {
    // Un mapa del mundo con un pin en cualquier parte es peor que no poner mapa.
    expect(extractMapQuery("https://maps.google.com/?q=ab")).toBeNull();
  });
});

describe("la consulta se LIMPIA, no se confía", () => {
  it("los caracteres que podrían escapar del atributo caen", () => {
    const q = extractMapQuery('https://maps.google.com/?q=Calle%20"><script>alert(1)</script>%20Madrid');
    expect(q).not.toBeNull();
    for (const c of ['"', "<", ">", "&"]) {
      expect(q, `sobrevivió ${c}`).not.toContain(c);
    }
  });

  // OJO CON LO QUE SE MIDE: el horneado CONSERVA el href tal cual (mejora
  // progresiva), así que basura que ya venía en el href sigue en la salida —
  // sanearla es trabajo de `sanitizeForPublish`, que corre ANTES. Lo que este
  // módulo tiene que garantizar es que no se cuele en el atributo que él AÑADE.
  it("nunca llegan al atributo que añade el horneado", () => {
    // El veneno va URL-CODIFICADO, que es como viaja de verdad dentro de una
    // query. Un `>` crudo dentro del atributo sería HTML malformado y no puede
    // llegar hasta aquí: `sanitizeForPublish` es un parser real y corre antes.
    const html = bakeMapEmbeds(
      `<body><a href="https://maps.google.com/?q=x%22%3E%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E%20Madrid">ver</a></body>`,
    );
    const puesto = /data-ol-map="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(puesto).not.toBe("");
    // Se miden los CARACTERES, no las palabras. "onerror" suelto dentro de un
    // atributo de texto es inerte: sin `=`, `<`, `>` ni comilla no puede
    // convertirse en nada. Lo peligroso es exactamente lo que se quita.
    for (const veneno of ["<", ">", '"', "=", "&"]) {
      expect(puesto, `se coló ${veneno} en data-ol-map`).not.toContain(veneno);
    }
    // Y el atributo no puede haber cerrado antes de tiempo: si la comilla se
    // escapara mal, aquí habría DOS anclas donde el documento tenía una.
    expect(html.match(/<a\b/g)?.length).toBe(1);
  });

  it("se acota la longitud", () => {
    const larga = "a".repeat(500);
    expect((extractMapQuery(`https://maps.google.com/?q=${larga}`) ?? "").length).toBeLessThanOrEqual(200);
  });
});

describe("buildMapEmbedUrl", () => {
  it("origen FIJO + consulta codificada", () => {
    expect(buildMapEmbedUrl("Av. Reforma 222, CDMX")).toBe(
      "https://www.google.com/maps?q=Av.%20Reforma%20222%2C%20CDMX&output=embed",
    );
  });
});

describe("bakeMapEmbeds", () => {
  it("marca el ancla y conserva su href — sin JS el enlace sigue funcionando", () => {
    const out = bakeMapEmbeds(DOC);
    expect(out).toContain('data-ol-map="Av. Reforma 222, CDMX"');
    expect(out).toContain('href="https://maps.google.com/?q=Av.%20Reforma%20222,%20CDMX"');
  });

  it("inyecta CSS y runtime UNA sola vez", () => {
    const out = bakeMapEmbeds(DOC);
    expect(out).toContain("<style data-ol-map-embed>");
    expect(out).toContain("<script data-ol-map-embed>");
    expect(out.match(/data-ol-map-embed/g)?.length).toBe(2);
  });

  // MEDIDO: el recolector de orígenes del sellado clasifica cualquier
  // `<link href>` como origen de ESTILOS sin mirar el `rel`, así que un
  // preconnect a Google acababa dentro de `style-src`. El mapa toca UNA sola
  // directiva del CSP —`frame-src`— y esta prueba lo mantiene así.
  it("NO añade preconnect — ensancharía style-src sin necesidad", () => {
    expect(bakeMapEmbeds(DOC)).not.toContain("preconnect");
  });

  it("una página SIN enlaces de mapa sale byte a byte idéntica", () => {
    const limpia = `<!doctype html><html><body><a href="/contacto">Contacto</a></body></html>`;
    expect(bakeMapEmbeds(limpia)).toBe(limpia);
  });

  it("es idempotente: hornear dos veces da lo mismo", () => {
    const una = bakeMapEmbeds(DOC);
    expect(bakeMapEmbeds(una)).toBe(una);
  });

  it("no toca los enlaces que no son mapas", () => {
    const out = bakeMapEmbeds(
      `<body><a href="https://ejemplo.com">web</a><a href="https://maps.google.com/?q=Plaza+Mayor,+Madrid">mapa</a></body>`,
    );
    expect(out.match(/data-ol-map="/g)?.length).toBe(1);
    expect(out).toContain('<a href="https://ejemplo.com">web</a>');
  });

  it("des-escapa el &amp; del href — si no, ?q= se pierde", () => {
    const out = bakeMapEmbeds(
      `<body><a href="https://www.google.com/maps?hl=es&amp;q=Gran+Via+1,+Madrid">ver</a></body>`,
    );
    expect(out).toContain('data-ol-map="Gran Via 1, Madrid"');
  });

  // El runtime NO puede llevar datos por página: su sha256 entra en `script-src`
  // al sellar, y si cambiara entre publicaciones el sellado dejaría de ser
  // idempotente. Mismo invariante que el runtime del vídeo.
  it("el runtime es ESTÁTICO — dos direcciones distintas dan el mismo script", () => {
    const script = (h: string) => /<script data-ol-map-embed>([\s\S]*?)<\/script>/.exec(h)?.[1];
    const a = bakeMapEmbeds(`<body><a href="https://maps.google.com/?q=Plaza+Mayor,+Madrid">a</a></body>`);
    const b = bakeMapEmbeds(`<body><a href="https://maps.google.com/?q=Av.+Reforma+222,+CDMX">b</a></body>`);
    expect(script(a)).toBe(script(b));
  });

  // El origen del iframe TIENE que estar en `frame-src` del sellado
  // (crates/html-engine/src/publish/seal.rs). Si se desincronizan, el mapa se
  // inyecta y el navegador lo bloquea: bien en el editor, muerto al publicar.
  it("el runtime sólo nombra el origen que el sellado autoriza", () => {
    const out = bakeMapEmbeds(DOC);
    const script = /<script data-ol-map-embed>([\s\S]*?)<\/script>/.exec(out)?.[1] ?? "";
    const origenes = [...script.matchAll(/https:\/\/[a-z0-9.-]+/g)].map((m) => m[0]);
    expect([...new Set(origenes)]).toEqual(["https://www.google.com"]);
  });
});
