import { describe, expect, it } from "vitest";

import { compileCalcRegions } from "./document";

const region = (inner: string) =>
  `<!doctype html><html><body><div data-ol-calc>${inner}</div></body></html>`;

describe("compilar una región", () => {
  it("deja la fórmula legible y le pone su gemelo compilado al lado", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="recibo"><p data-ol-out="recibo * 0.72">0</p>`,
    ));
    // La legible se queda: es lo que el Chat edita y lo que un humano entiende.
    expect(out.html).toContain(`data-ol-out="recibo * 0.72"`);
    // Envuelto en TEXTO(...): el programa devuelve YA convertido lo que el DOM
    // necesita, con la misma `t()` en los dos evaluadores. Sin eso, el
    // cableado del navegador tendría que convertir por su cuenta.
    expect(out.html).toContain(
      `data-ol-out-c="[&quot;$recibo&quot;,0.72,&quot;*&quot;,&quot;@TEXTO:1&quot;]"`,
    );
    expect(out.issues).toEqual([]);
    expect(out.compiled).toBe(1);
  });

  // Sin esto, una página con cálculo y sin runtime muestra un hueco donde
  // debería ir un número — y conformance exige content-intact COMPUTADO.
  it("la página nace con un número visible, aunque el runtime nunca corra", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="recibo"><p data-ol-out="REDONDEA(recibo * 0.72 + 100, 0)">—</p>`,
    ));
    expect(out.html).toContain(">100<");
    expect(out.html).not.toContain(">—<");
  });

  it("un documento sin regiones sale byte-idéntico", () => {
    const html = `<!doctype html><html><body><p>hola</p></body></html>`;
    expect(compileCalcRegions(html)).toEqual({ html, regions: 0, compiled: 0, issues: [] });
  });

  it("compila mostrar-si y asignaciones, no sólo salidas", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="puntaje">` +
      `<p data-ol-if="puntaje > 7">alto</p>` +
      `<button data-ol-when="clic" data-ol-set="puntaje = puntaje + 1">+1</button>`,
    ));
    expect(out.compiled).toBe(2);
    expect(out.html).toContain("data-ol-if-c=");
    expect(out.html).toContain("data-ol-set-c=");
  });
});

describe("lo que NACE MUERTO se dice al ingerir, no en la página del visitante", () => {
  it("una fórmula que no parsea se reporta con el motivo", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="x"><p data-ol-out="x * ">0</p>`,
    ));
    expect(out.issues).toHaveLength(1);
    expect(out.compiled).toBe(0);
    // Y NO se escribe gemelo: media compilación es peor que ninguna.
    expect(out.html).not.toContain("data-ol-out-c");
  });

  it("una fórmula que apunta a un campo inexistente se reporta, y dice cuál", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="recibo"><p data-ol-out="recibo * tarifa">0</p>`,
    ));
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0]!.message).toContain(`"tarifa"`);
    expect(out.issues[0]!.message).toContain(`data-ol-val="tarifa"`);
  });

  it("un destino de asignación SÍ cuenta como declarado — la ruleta lo necesita", () => {
    const out = compileCalcRegions(region(
      `<ul data-ol-val="nombres"><li data-ol-item>Ana</li></ul>` +
      `<button data-ol-set="elegido = AZAR(nombres)">Girar</button>` +
      `<p data-ol-out="elegido">—</p>`,
    ));
    expect(out.issues).toEqual([]);
    expect(out.compiled).toBe(2);
  });

  it("una fórmula rota NO impide compilar las sanas de la misma región", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="a"><p data-ol-out="a * 2">0</p><p data-ol-out="a * ">0</p>`,
    ));
    expect(out.compiled).toBe(1);
    expect(out.issues).toHaveLength(1);
  });
});

describe("lo que depende de un gesto que aún no ocurrió", () => {
  // Sin esta regla la ruleta nacería diciendo "0" — la página muerta que todo
  // este sistema existe para impedir.
  it("respeta el texto del autor en vez de calcular un cero", () => {
    const out = compileCalcRegions(region(
      `<ul data-ol-val="nombres"><li data-ol-item>Ana</li></ul>` +
      `<button data-ol-set="elegido = AZAR(nombres)">Girar</button>` +
      `<p data-ol-out="elegido">Gira para elegir</p>`,
    ));
    expect(out.html).toContain(">Gira para elegir<");
    // Pero SÍ se compila: en cuanto el visitante gire, hay programa que correr.
    expect(out.html).toContain("data-ol-out-c=");
  });

  it("una fórmula que sólo lee campos SÍ se calcula al nacer", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="x"><p data-ol-out="x + 5">—</p>`,
    ));
    expect(out.html).toContain(">5<");
  });
});

const twinOf = (html: string, attr: string) => {
  const m = new RegExp(`${attr}="([^"]*)"`).exec(html);
  return JSON.parse((m?.[1] ?? "").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
};

describe("el gemelo de una asignación lleva su destino", () => {
  // Si no, el runtime tendría que re-parsear la fórmula legible del autor para
  // saber a qué nombre asigna — justo lo que compilar en la ingestión evita.
  it("va como LISTA de {n,p} — un gesto puede hacer varias cosas", () => {
    const out = compileCalcRegions(region(
      `<ul data-ol-val="nombres"><li data-ol-item>Ana</li></ul>` +
      `<button data-ol-set="elegido = AZAR(nombres)">Girar</button>`,
    ));
    const twin = twinOf(out.html, "data-ol-set-c");
    expect(twin).toEqual([{ n: "elegido", p: ["$nombres", "@AZAR:1"] }]);
  });

  // Sin esto no hay turnos: un clic tiene que poder poner la ficha Y cambiar
  // de jugador. Se separa por `;` FUERA de comillas.
  it("varias asignaciones en un gesto, en orden", () => {
    const out = compileCalcRegions(
      `<!doctype html><html><body>` +
      `<div data-ol-calc data-ol-state="turno = 'X'; c1 = ''">` +
      `<button data-ol-set="c1 = turno; turno = SI(turno = 'X', 'O', 'X')">1</button>` +
      `<span data-ol-out="c1">·</span>` +
      `</div></body></html>`,
    );
    expect(out.issues).toEqual([]);
    const twin = twinOf(out.html, "data-ol-set-c");
    expect(twin).toHaveLength(2);
    expect(twin.map((t: { n: string }) => t.n)).toEqual(["c1", "turno"]);
  });

  it("un `;` dentro de un texto NO parte la asignación", () => {
    const out = compileCalcRegions(region(
      `<div data-ol-state="msg = ''"></div>` +
      `<button data-ol-set="msg = 'hola; adiós'">di</button>` +
      `<p data-ol-out="msg">·</p>`,
    ));
    expect(out.issues).toEqual([]);
    expect(twinOf(out.html, "data-ol-set-c")).toHaveLength(1);
  });
});

describe("el estado que la región declara al nacer", () => {
  // Es lo que desbloquea acumuladores, tableros y turnos: sin un valor
  // inicial, un `data-ol-set` que lee su propio destino queda bloqueado por la
  // regla del gesto-no-ocurrido, para siempre.
  it("se evalúa al ingerir y el gemelo lleva el valor, no el programa", () => {
    const out = compileCalcRegions(
      `<!doctype html><html><body><div data-ol-calc data-ol-state="n = 0">` +
      `<button data-ol-set="n = n + 1">+1</button><p data-ol-out="n">0</p>` +
      `</div></body></html>`,
    );
    expect(out.issues).toEqual([]);
    expect(twinOf(out.html, "data-ol-state-c")).toEqual({ n: 0 });
  });

  it("y el valor de nacimiento SÍ lo usa — un acumulador nace en su inicio", () => {
    const out = compileCalcRegions(
      `<!doctype html><html><body><div data-ol-calc data-ol-state="n = 7">` +
      `<button data-ol-set="n = n + 1">+1</button><p data-ol-out="n * 2">?</p>` +
      `</div></body></html>`,
    );
    expect(out.html).toContain(">14<");
  });

  it("un estado que no parsea se reporta, no se traga", () => {
    const out = compileCalcRegions(
      `<!doctype html><html><body><div data-ol-calc data-ol-state="n =">` +
      `<p data-ol-out="n">0</p></div></body></html>`,
    );
    expect(out.issues.length).toBeGreaterThan(0);
  });
});

describe("CADA fuera de su lista", () => {
  it("se rechaza con el consejo correcto, no con 'declara un campo CADA'", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="x"><p data-ol-out="CADA + x">0</p>`,
    ));
    const issue = out.issues.find((i) => i.message.includes("CADA"));
    expect(issue?.message).toContain("sólo existe dentro de");
    expect(issue?.message).not.toContain("declara un campo");
  });

  it("dentro de su lista es perfectamente válido", () => {
    const out = compileCalcRegions(region(
      `<ul data-ol-val="precios"><li data-ol-item>50</li><li data-ol-item>200</li></ul>` +
      `<p data-ol-out="CUENTA_SI(precios, CADA > 100)">0</p>`,
    ));
    expect(out.issues).toEqual([]);
    expect(out.html).toContain(">1<");
  });
});

describe("el valor de nacimiento habla el idioma del navegador", () => {
  // `String(true)` sería "true" y `String([1,2])` sería "1,2" — la máquina del
  // navegador dice "sí" y "1, 2". Envolver en TEXTO(...) hace que los dos
  // lados usen LA MISMA conversión, en vez de dos que se separan.
  it("un booleano nace como sí/no, no como true/false", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="x" value="9"><p data-ol-out="x > 7">?</p>`,
    ));
    expect(out.html).toContain(">sí<");
    expect(out.html).not.toContain(">true<");
  });

  it("y el falso también — nunca 'false'", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="x" value="2"><p data-ol-out="x > 7">?</p>`,
    ));
    expect(out.html).toContain(">no<");
    expect(out.html).not.toContain(">false<");
  });

  // El valor de nacimiento sale del DOCUMENTO, no de un entorno vacío: si no,
  // la página diría "ahorras 0" junto a un campo que dice 1800.
  it("el campo con valor inicial se lee, no se ignora", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="recibo" type="number" value="1800">` +
      `<p data-ol-out="REDONDEA(recibo * 0.72, 0)">?</p>`,
    ));
    expect(out.html).toContain(">1296<");
  });
});

describe("las regiones no se pisan entre sí", () => {
  it("dos calculadoras en la misma página tienen nombres independientes", () => {
    const html =
      `<!doctype html><html><body>` +
      `<div data-ol-calc><input data-ol-val="total"><p data-ol-out="total * 2">0</p></div>` +
      `<div data-ol-calc><input data-ol-val="total"><p data-ol-out="total * 3">0</p></div>` +
      `</body></html>`;
    const out = compileCalcRegions(html);
    expect(out.regions).toBe(2);
    expect(out.issues).toEqual([]);
  });

  it("un nombre de OTRA región no vale — sería una fórmula muerta en silencio", () => {
    const html =
      `<!doctype html><html><body>` +
      `<div data-ol-calc><input data-ol-val="tarifa"></div>` +
      `<div data-ol-calc><input data-ol-val="peso"><p data-ol-out="peso * tarifa">0</p></div>` +
      `</body></html>`;
    const out = compileCalcRegions(html);
    // Se reportan DOS problemas distintos y los dos son ciertos: la 2ª región
    // lee un nombre que ahí no existe, y la 1ª declara un campo que nadie lee.
    // Se afirma por el MENSAJE y no por el conteo — un `toHaveLength` fijo se
    // pone rojo cada vez que el sistema aprende a ver una cosa más.
    const desconocido = out.issues.find((i) => i.message.includes("no existe en esta región"));
    expect(desconocido?.message).toContain(`"tarifa"`);
    const huerfano = out.issues.find((i) => i.message.includes("no lo lee ninguna fórmula"));
    expect(huerfano?.formula).toBe("tarifa");
  });
});

describe("no puede tumbar una página", () => {
  it("volver a compilar da el mismo documento — es idempotente", () => {
    const once = compileCalcRegions(region(
      `<input data-ol-val="x"><p data-ol-out="x + 1">0</p>`,
    ));
    expect(compileCalcRegions(once.html).html).toBe(once.html);
  });

  it("el resultado inicial se escapa — sale de una fórmula, no del autor", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="x"><p data-ol-out="'&lt;img onerror=alert(1)&gt;'">0</p>`,
    ));
    expect(out.html).not.toContain("<img onerror");
  });
});

describe("el gemelo compilado no lleva marcado crudo", () => {
  // JSON.stringify no escapa < ni >, y setAttribute sólo escapa comillas: un
  // texto literal con marcado salía crudo dentro del atributo. Entre comillas
  // es inerte, pero depender de eso es sostener un "depende".
  it("los ángulos viajan escapados", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="x"><p data-ol-out="'&lt;b&gt;hola&lt;/b&gt;'">0</p>`,
    ));
    expect(out.html).toContain("data-ol-out-c=");
    expect(out.html).not.toContain("<b>hola</b>");
  });

  it("y siguen siendo JSON que da la vuelta idéntico", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="x"><p data-ol-out="'&lt;b&gt;'">0</p>`,
    ));
    const attr = /data-ol-out-c="([^"]*)"/.exec(out.html)?.[1] ?? "";
    const json = attr.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    expect(JSON.parse(json)).toEqual(["'<b>", "@TEXTO:1"]);
  });
});

/**
 * La otra mitad del "nace muerto". Existe porque la PRIMERA eval con briefs de
 * cálculo lo cazó en la primera página: para los paneles solares el modelo
 * emitió un campo `recibo` Y un deslizador `recibo-range`, queriendo tenerlos
 * sincronizados. El deslizador nacía muerto —el visitante lo mueve y no pasa
 * nada— y todo lo determinista salía VERDE, porque las fórmulas sí compilaban.
 */
describe("un campo que nadie lee es un control muerto", () => {
  it("se reporta, y dice cuál", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="recibo" type="number" value="1800">` +
      `<input data-ol-val="recibo-range" type="range" value="1800">` +
      `<p data-ol-out="recibo * 0.72">1296</p>`,
    ));
    const huerfano = out.issues.find((i) => i.message.includes("no lo lee ninguna fórmula"));
    expect(huerfano?.formula).toBe("recibo-range");
  });

  it("un campo leído por un mostrar-si NO se acusa — `=` es igualdad, no asignación", () => {
    // El falso positivo que tuvo esta comprobación al nacer: probar
    // `parseAssignment` primero hacía que `dia = 'sabado'` se leyera como una
    // ASIGNACIÓN, así que `dia` no contaba como leído y el campo vivo salía
    // acusado. Un falso positivo aquí haría a la puerta rechazar páginas
    // correctas — peor que el hueco que cierra.
    const out = compileCalcRegions(region(
      `<select data-ol-val="dia"><option>sabado</option></select>` +
      `<p data-ol-if="dia = 'sabado'">Sábado: 9 a 20</p>`,
    ));
    expect(out.issues).toEqual([]);
  });

  it("leído sólo por una asignación también cuenta", () => {
    const out = compileCalcRegions(region(
      `<ul data-ol-val="nombres"><li data-ol-item>Ana</li></ul>` +
      `<button data-ol-set="elegido = AZAR(nombres)">Sortear</button>`,
    ));
    expect(out.issues).toEqual([]);
  });

  it("con una fórmula rota se calla — no acusa a los campos que sí usaba", () => {
    const out = compileCalcRegions(region(
      `<input data-ol-val="x"><p data-ol-out="x * ">0</p>`,
    ));
    expect(out.issues.filter((i) => i.message.includes("no lo lee"))).toEqual([]);
  });
});
