// Unit tests de lib/agent/verify.ts — todo mockeado (sin puppeteer, sin red).
// provider + render se inyectan via `internals`, igual que en
// lib/ai/vision-critique.test.ts (mismo patrón, mismo runner).
//
// Corre via: npx tsx --test lib/agent/verify.test.ts  (suite test:node)

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  buildVerifyPrompt,
  esDeAlgoQueBloqueamos,
  parseVisualVerdict,
  verifyEditedPage,
} from "./verify";
import type { InlineImage, StreamEvent } from "../ai-gateway";

const PARAMS = {
  html: "<!doctype html><html><body><h1>Hola</h1></body></html>",
  userPrompt: "cambia el hero a rojo",
  model: "gemini-test",
  apiKey: "k",
};

const IMAGE: InlineImage = { mimeType: "image/jpeg", dataBase64: "aGk=" };

function providerReturning(raw: string) {
  return {
    stream: () =>
      (async function* (): AsyncGenerator<StreamEvent> {
        yield { type: "text_delta", text: raw };
        yield { type: "done", stopReason: { kind: "end_turn" } };
      })() as AsyncIterableIterator<StreamEvent>,
  };
}

// ── parseVisualVerdict ──────────────────────────────────────────────────────

test("parsea un veredicto de rotura", () => {
  const v = parseVisualVerdict('{"broken":true,"issues":["texto encimado en el hero"]}');
  assert.deepEqual(v, {
    broken: true,
    issues: ["texto encimado en el hero"],
    observaciones: [],
    fallback: false,
  });
});

test("broken sin issues concretos NO dispara nada", () => {
  const v = parseVisualVerdict('{"broken":true,"issues":[]}');
  assert.equal(v?.broken, false);
});

test("recorta a 4 issues — más no es arreglo quirúrgico", () => {
  const v = parseVisualVerdict(
    JSON.stringify({ broken: true, issues: ["a", "b", "c", "d", "e", "f"] }),
  );
  assert.equal(v?.issues.length, 4);
});

test("sobrevive fences de markdown pese al JSON mode", () => {
  const v = parseVisualVerdict('```json\n{"broken":false,"issues":[]}\n```');
  assert.deepEqual(v, { broken: false, issues: [], observaciones: [], fallback: false });
});

test("basura → null (el caller lo mapea a fallback)", () => {
  assert.equal(parseVisualVerdict("no soy json"), null);
  assert.equal(parseVisualVerdict('{"issues":[]}'), null); // sin broken
  assert.equal(parseVisualVerdict(""), null);
});

// ── contentMap ──────────────────────────────────────────────────────────────

test("contentMap lista el texto del body con su etiqueta", async () => {
  const { contentMap } = await import("./verify");
  const map = contentMap(
    '<html><head><title>No va</title><style>.x{color:red}</style></head><body><h1>Tacos El Buen Sabor</h1><p>Al carbón desde 1998</p><script>var s="tampoco va";</script></body></html>',
  );
  assert.ok(map.includes("<h1> Tacos El Buen Sabor"));
  assert.ok(map.includes("<p> Al carbón desde 1998"));
  assert.ok(!map.includes("No va")); // el <head> no cuenta
  assert.ok(!map.includes("tampoco va")); // script fuera
});

test("contentMap se acota a 30 bloques", async () => {
  const { contentMap } = await import("./verify");
  const many = Array.from({ length: 60 }, (_, i) => `<p>bloque número ${i}</p>`).join("");
  const map = contentMap(`<html><body>${many}</body></html>`);
  assert.equal(map.split("\n").length, 30);
});

// ── verifyEditedPage ────────────────────────────────────────────────────────

test("rotura real → broken=true con los issues", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    provider: providerReturning('{"broken":true,"issues":["contraste ilegible en precios"]}'),
  });
  assert.equal(v.broken, true);
  assert.deepEqual(v.issues, ["contraste ilegible en precios"]);
  assert.equal(v.fallback, false);
});

test("página limpia → broken=false", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  assert.equal(v.broken, false);
  assert.equal(v.fallback, false);
});

test("sin screenshot → fallback fail-open (jamás rompe el turno)", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => null,
    provider: providerReturning('{"broken":true,"issues":["x"]}'),
  });
  assert.deepEqual(v, { broken: false, issues: [], observaciones: [], fallback: true });
});

test("el provider revienta → fallback", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    provider: {
      stream: () =>
        (async function* (): AsyncGenerator<StreamEvent> {
          throw new Error("503");
        })() as AsyncIterableIterator<StreamEvent>,
    },
  });
  assert.equal(v.fallback, true);
  assert.equal(v.broken, false);
});

test("timeout → fallback", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    provider: {
      stream: () =>
        (async function* (): AsyncGenerator<StreamEvent> {
          await new Promise((r) => setTimeout(r, 5_000));
          yield { type: "text_delta", text: '{"broken":false,"issues":[]}' };
        })() as AsyncIterableIterator<StreamEvent>,
    },
    timeoutMs: 100,
  });
  assert.equal(v.fallback, true);
});

test("veredicto malformado → fallback", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    provider: providerReturning("esto no es JSON"),
  });
  assert.equal(v.fallback, true);
});

// ── lo que el navegador GRITA ───────────────────────────────────────────────
// La captura de una pagina cuyo JavaScript murio pesa EXACTAMENTE lo mismo que
// la de una sana (medido con tres paginas: 12908 bytes las tres). Asi que este
// hecho no puede pasar por el juicio del critico visual — el ojo no lo ve.

test("un grito del navegador rompe el veredicto aunque el critico diga que esta bien", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async (_html, opts?: { onErrors?: (e: readonly string[]) => void }) => {
      opts?.onErrors?.(["TypeError: Cannot read properties of undefined"]);
      return IMAGE;
    },
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  assert.equal(v.broken, true);
  // Va PRIMERO: es lo mas accionable que el turno puede darle al modelo.
  assert.match(v.issues[0]!, /Cannot read properties of undefined/);
});

test("la frase no promete «al cargar» — tambien se pulsan los controles", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async (_html, opts?: { onErrors?: (e: readonly string[]) => void }) => {
      opts?.onErrors?.(["boom"]);
      return IMAGE;
    },
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  // Decir «al cargar» sobre un fallo que aparece al pulsar manda al modelo a
  // buscar el bug al sitio equivocado.
  assert.match(v.issues[0]!, /al cargarla o al usar sus controles/);
});

// ── EL TEXTO QUE NADIE PUEDE LEER ───────────────────────────────────────────
// MEDIDO el 2026-08-22: a «pon el boton de acento en #f5e050 con el texto en
// blanco» el Agente obedece y entrega 1.34:1. El usuario pidio los colores, asi
// que cambiar_tema (que camina el contraste hasta cumplir WCAG) ni entra. Por
// el camino determinista el peor de 12 fue 4.88:1; a mano, la mitad quedo bajo
// 4.5. El detector ya existia y ya lo cazaba — solo no llegaba al Agente.

test("un texto ilegible rompe el veredicto aunque el critico lo vea bonito", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    medir: async () => ({ unreadableText: [{ contrast: 1.34 }] }),
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  assert.equal(v.broken, true);
  assert.match(v.issues[0]!, /1\.34:1/);
  // Y el caso REAL: si el usuario pidio esos colores, decirselo en vez de
  // pisarlo en silencio.
  // Sin distinguir mayúsculas: lo que esto vigila es que la frase ESTÉ, no
  // dónde cae en el párrafo. Al darle dirección al mensaje (2026-08-30) la
  // frase pasó de ir tras un punto y coma a abrir oración, y la prueba cayó
  // por la «S» — que no es lo que garantiza.
  assert.match(v.issues[0]!, /si el usuario pidió ESOS colores/i);
});

test("un contraste sano no dice nada", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    medir: async () => ({ unreadableText: [] }),
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  assert.equal(v.broken, false);
});

// Fail-open, como TODO en este archivo: el medidor solo puede mejorar un turno.
test("si el medidor revienta, el turno sigue igual", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    medir: async () => { throw new Error("chrome murio"); },
    provider: providerReturning('{"broken":true,"issues":["texto encimado"]}'),
  });
  assert.equal(v.broken, true);
  assert.deepEqual(v.issues, ["texto encimado"]);
});

test("sin gritos, el veredicto del critico manda", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    medir: async () => ({ unreadableText: [] }),
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  assert.equal(v.broken, false);
  assert.deepEqual(v.issues, []);
});

// El desborde a lo ancho en movil: el otro hecho que el ojo del critico no
// puede juzgar. La captura se toma del documento COMPLETO, asi que una pagina
// que se sale 48px sale entera y bien compuesta en la foto — y en el telefono
// del dueno hay una barra horizontal y texto cortado.
test("el desborde en movil rompe el veredicto aunque la foto salga bien", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    medir: async () => ({ mobileOverflow: true, unreadableText: [] }),
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  assert.equal(v.broken, true);
  assert.match(v.issues[0]!, /se desborda a lo ancho en el teléfono/);
  // Y le dice DONDE mirar: la causa medida fue un width:100% con margenes
  // heredados que suman por fuera.
  assert.match(v.issues[0]!, /márgenes heredados/);
});

test("sin desborde no dice nada", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    medir: async () => ({ mobileOverflow: false, unreadableText: [] }),
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  assert.equal(v.broken, false);
});

// ── EL HECHO NO DEPENDE DE QUE EL CRÍTICO CONTESTE ──────────────────────────
// 🔴 EL DEFECTO QUE ESTO CIERRA (hallazgo 6). Los hechos del navegador se
// recogen ANTES de la llamada de visión y se mezclaban DESPUÉS. Entre medias
// había cuatro salidas tempranas —sin captura, turno abortado, sin API key,
// Gemini caído o JSON ilegible— y cada una devolvía broken:false, issues:[].
// Es decir: Chromium veía la excepción que mata el JavaScript de la página y,
// si el crítico tenía un pico de 503, el Agente recibía «todo bien» y se lo
// decía al usuario.

test("el crítico se cae, pero el grito de Chromium llega igual", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async (_html, opts?: { onErrors?: (e: readonly string[]) => void }) => {
      opts?.onErrors?.(["TypeError: cart.total is not a function"]);
      return IMAGE;
    },
    provider: {
      stream: () =>
        (async function* (): AsyncGenerator<StreamEvent> {
          throw new Error("503");
        })() as AsyncIterableIterator<StreamEvent>,
    },
  });
  assert.equal(v.broken, true);
  assert.match(v.issues[0]!, /cart\.total is not a function/);
  // `fallback` sigue diciendo la verdad: el crítico NO juzgó. Lo que cambia es
  // que ya no miente sobre lo que el navegador sí vio.
  assert.equal(v.fallback, true);
});

test("un veredicto ilegible no borra el contraste ni el desborde medidos", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    medir: async () => ({ mobileOverflow: true, unreadableText: [{ contrast: 1.9 }] }),
    provider: providerReturning("esto no es JSON"),
  });
  assert.equal(v.broken, true);
  assert.equal(v.fallback, true);
  const todo = v.issues.join(" | ");
  assert.match(todo, /1\.90:1/);
  assert.match(todo, /se desborda a lo ancho en el teléfono/);
});

// 🔴 SOBREVIVE, PERO YA NO ACUSA (2026-09-04, tarde). Esta prueba afirmaba
// `broken === true`. La corrida de 16 páginas de esa misma tarde desmintió al
// comprobador: de 11 pruebas ejecutadas acusó a 3 páginas y acertó en 0 — las
// tres funcionaban, y el fallo estaba en el vocabulario que le dábamos al
// modelo (faltaba `atributo`) y en no pedirle que rellenara campos `required`.
//
// Un comprobador que acierta 0 de 3 no declara rota la página de nadie: baja a
// `observaciones`, que el bucle emite igual —al usuario, al texto del turno y
// con él al historial que lee el modelo— sin llamar rota a la página. Es la
// regla del `Edit` de Claude Code: cuando la comprobación no casa, falla en
// SEGURO. Lo que se retira es la acusación, no el dato — y por eso esta prueba
// se cambia en vez de borrarse.
test("la prueba que el modelo declaró se DICE, pero no declara rota la página", async () => {
  const v = await verifyEditedPage(
    { ...PARAMS, runtime: "window.x=1", spec: [{ paso: "click", sel: "#b" }] as never },
    {
      render: async (
        _html,
        opts?: { onBehaviorResult?: (b: unknown) => void },
      ) => {
        opts?.onBehaviorResult?.([[0, "#total sigue en 0 tras pulsar Añadir"]]);
        return IMAGE;
      },
      provider: providerReturning("tampoco es JSON"),
    },
  );
  assert.equal(v.broken, false);
  assert.equal(v.issues.length, 0);
  // Y NO SE PIERDE: sale por el canal que informa sin suspender.
  assert.match(v.observaciones.join(" | "), /#total sigue en 0/);
});

// CONTROL DE LA REGLA ANTERIOR: los HECHOS del navegador sí siguen acusando.
// Sin esta prueba, «la prueba declarada no acusa» podría implementarse apagando
// el canal entero y las cuatro medidas de verdad se irían con ella.
test("pero un hecho del navegador sí: el desborde acusa aunque la prueba no", async () => {
  const v = await verifyEditedPage(
    { ...PARAMS, runtime: "window.x=1", spec: [{ paso: "click", sel: "#b" }] as never },
    {
      render: async (
        _html,
        opts?: { onBehaviorResult?: (b: unknown) => void },
      ) => {
        opts?.onBehaviorResult?.([[0, "#total sigue en 0 tras pulsar Añadir"]]);
        return IMAGE;
      },
      medir: async () => ({ mobileOverflow: true, unreadableText: [] }),
      provider: providerReturning("tampoco es JSON"),
    },
  );
  assert.equal(v.broken, true);
  assert.match(v.issues.join(" | "), /se desborda a lo ancho en el teléfono/);
});

// CONTROL: sin hechos, un fallback sigue siendo fail-open puro. Sin esta
// prueba, «broken siempre true en fallback» pasaría las tres de arriba.
test("sin hechos, el fallback sigue sin acusar a nadie", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    medir: async () => ({ mobileOverflow: false, unreadableText: [] }),
    provider: providerReturning("nada de JSON"),
  });
  assert.deepEqual(v, { broken: false, issues: [], observaciones: [], fallback: true });
});

// La salida MÁS probable en producción: Chromium ya corrió (es lo primero) y
// la llamada de visión es la parte lenta. Si el deadline vence, los hechos ya
// existen — tirarlos era tirar justo lo que costó arrancar el navegador.
test("el deadline vence con los hechos ya recogidos: se conservan", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async (_html, opts?: { onErrors?: (e: readonly string[]) => void }) => {
      opts?.onErrors?.(["ReferenceError: precio is not defined"]);
      return IMAGE;
    },
    provider: {
      stream: () =>
        (async function* (): AsyncGenerator<StreamEvent> {
          await new Promise((r) => setTimeout(r, 5_000));
          yield { type: "text_delta", text: '{"broken":false,"issues":[]}' };
        })() as AsyncIterableIterator<StreamEvent>,
    },
    timeoutMs: 120,
  });
  assert.equal(v.fallback, true);
  assert.equal(v.broken, true);
  assert.match(v.issues[0]!, /precio is not defined/);
});

// ─────────────────────────────────────────────────────────────────────────────
// HALLAZGO 11 — la puerta exigía una key que el proveedor por defecto no usa.
//
// `defaultVerifyProvider` devuelve Qwen por Fireworks salvo que
// `OPENLEN_AGENT_EYES=gemini` lo pida. Y aun así, arriba había un
// `if (!GEMINI_API_KEY) return fallback`, así que con una key de prepago
// AGOTADA —lo normal— los ojos de Len se apagaban enteros: seguía editando y
// nadie volvía a mirar la página. Su hermano, los ojos de Crear
// (lib/ai/vision-critique.ts), ya lo hacía bien.
test("los ojos miran sin credencial propia (van por Fireworks)", async () => {
  let miro = false;
  try {
    const v = await verifyEditedPage(
      PARAMS,
      {
        render: async () => IMAGE,
        provider: {
          stream: () => {
            miro = true;
            return (async function* (): AsyncGenerator<StreamEvent> {
              yield { type: "text_delta", text: '{"broken":true,"issues":["el hero se sale"]}' };
              yield { type: "done", stopReason: { kind: "end_turn" } };
            })() as AsyncIterableIterator<StreamEvent>;
          },
        },
      },
    );
    assert.equal(miro, true, "ni siquiera llamó al proveedor");
    assert.equal(v.broken, true);
    assert.equal(v.fallback, false);
  } finally {
    /* nada que restaurar: ya no hay credencial que esconder */
  }
});

// LA PALANCA YA NO DESVIA A NADIE. Aqui se exigia que
// `OPENLEN_AGENT_EYES=gemini` sin clave cayera al fallback. Con el proveedor
// borrado (2026-08-28) la variable no la lee nadie, y esta prueba es su lapida:
// se pone el valor que ANTES cambiaba el comportamiento y los ojos miran igual.
test("OPENLEN_AGENT_EYES ya no desvia a nadie", async () => {
  const previosOjos = process.env.OPENLEN_AGENT_EYES;
  process.env.OPENLEN_AGENT_EYES = "gemini";
  let miro = false;
  try {
    const v = await verifyEditedPage(PARAMS, {
      render: async () => IMAGE,
      provider: {
        stream: () => {
          miro = true;
          return (async function* (): AsyncGenerator<StreamEvent> {
            yield { type: "text_delta", text: '{"broken":false,"issues":[]}' };
            yield { type: "done", stopReason: { kind: "end_turn" } };
          })() as AsyncIterableIterator<StreamEvent>;
        },
      },
    });
    assert.equal(miro, true, "la palanca volvio a desviar el turno");
    assert.equal(v.fallback, false);
  } finally {
    if (previosOjos === undefined) delete process.env.OPENLEN_AGENT_EYES;
    else process.env.OPENLEN_AGENT_EYES = previosOjos;
  }
});

// ─── Lo que NOSOTROS bloqueamos no es un defecto de la página ────────────────
//
// MEDIDO el 2026-08-27, en vivo: Jesús adjuntó una foto, el Agente la colocó
// bien, y en el turno siguiente se la QUITÓ diciéndole que su URL «sólo existe
// en tu máquina, no en internet».
//
// La cadena: en dev toda subida propia sale con URL de localhost (no hay R2) →
// el guardia SSRF la corta al renderizar, y hace bien (una página hostil podría
// apuntar un <img> a la app del propio servidor) → la captura sale con un hueco
// → quien mira la foto no puede distinguir ese hueco de una imagen rota de
// verdad → «imagen rota» → el Agente la borra.
//
// El hecho lo tenía el guardia y lo tiraba. Es el mismo patrón que ya tiene
// `<photography>` en el crítico de creación: decirle qué parte de lo que ve NO
// es responsabilidad de la página.

test("el prompt de los ojos dice qué recursos cortamos NOSOTROS", () => {
  const p = buildVerifyPrompt("pon esta foto", "<h1>x</h1>", [
    "http://localhost:3000/uploads/casa.png",
  ]);
  assert.ok(p.includes("<blocked-by-us>"), "falta el bloque");
  assert.ok(p.includes("http://localhost:3000/uploads/casa.png"), "no nombra la URL");
  // Lo que de verdad hay que decirle, o el bloque sería decoración.
  assert.ok(p.includes("NOT broken on the real page"));
  assert.ok(p.includes("Never set broken=true"));
});

test("y sin nada bloqueado el prompt no cambia — el caso normal", () => {
  const p = buildVerifyPrompt("pon esta foto", "<h1>x</h1>");
  assert.ok(!p.includes("<blocked-by-us>"), "el bloque se coló sin motivo");
  // Y lo que ya decía sigue estando.
  assert.ok(p.includes("<flag-only>"));
  assert.ok(p.includes("A broken image"));
});

// ─── VER NO ES SENTENCIAR ────────────────────────────────────────────────────
//
// 🔴 MEDIDO el 2026-09-02: tres tarjetas se quedaron con su degradado — que es
// el comportamiento CORRECTO: una caja pintada es lo que el modelo quiso poner,
// y desde el 2026-09-04 más aún, porque ya no hay ningún hueco a la espera de
// que alguien lo rellene. El crítico las marcó como imágenes rotas y eso
// disparó un ciclo de reparación que no podía salir bien: ocho búsquedas de
// foto para un rubro que el catálogo no cubre.
//
// Y NO VIO MAL. En la captura hay, de hecho, rectángulos de color plano. Falló
// el paso siguiente —«por lo tanto está roto»—, que exige INTENCIÓN, y la
// intención vive en el HTML, no en los píxeles. Falló porque el esquema sólo
// aceptaba conclusiones.

test("una caja de color plano sale como observación, no como rotura", () => {
  const v = parseVisualVerdict(JSON.stringify({
    broken: false,
    issues: [],
    observaciones: ["tres tarjetas muestran un rectángulo de color plano sin foto"],
  }));
  assert.ok(v);
  assert.equal(v.broken, false);
  assert.deepEqual(v.issues, []);
  assert.deepEqual(v.observaciones, [
    "tres tarjetas muestran un rectángulo de color plano sin foto",
  ]);
});

test("un veredicto sin observaciones sigue siendo válido — el campo nace vacío", () => {
  const v = parseVisualVerdict(JSON.stringify({ broken: true, issues: ["texto encima de texto"] }));
  assert.ok(v);
  assert.equal(v.broken, true);
  assert.deepEqual(v.observaciones, []);
});

test("el prompt NO pide marcar como rota una caja de color plano", () => {
  const p = buildVerifyPrompt("haz la portada legible", "<body><h1>Hola</h1></body>");
  // La forma DECIDIBLE desde píxeles: el icono del navegador.
  assert.ok(p.includes("missing-image icon"), "ya no nombra el icono de imagen fallida");
  // Y la indecidible ya no se pide como rotura.
  assert.ok(
    !p.includes("empty frame where an image clearly belongs"),
    "el prompt sigue pidiendo un juicio que la captura no puede sostener",
  );
  // El canal nuevo tiene que ofrecerse, o el modelo no lo usará.
  assert.ok(p.includes("<observe-only>"), "falta el bloque de observación");
  assert.ok(p.includes("observaciones"), "la salida no nombra el campo");
});

// ─── Lo que NOSOTROS cortamos no puede romper un turno ────────────────────────
//
// `conHechos` fuerza broken=true por cualquier grito de consola, con la frase
// «El JavaScript de la página falla». El guardia SSRF aborta con
// `blockedbyclient` y Chromium lo grita como
// `Failed to load resource: net::ERR_BLOCKED_BY_CLIENT` — así llegaba al Agente
// como código roto por una IMAGEN que habíamos bloqueado nosotros, y el Agente
// borraba la foto del dueño (2026-08-27).
//
// `inline-image.ts` ya filtra los fallos de recurso. Esto es el CINTURÓN, y por
// eso compara URLs y motivo en vez de fiarse de una redacción: el día que
// Chromium cambie el texto, el filtro se cae y esto sigue en pie.

test("un grito causado por nuestro propio guardia no cuenta", () => {
  const bloqueadas = ["http://localhost:3000/api/projects/p1/assets/casa.png"];
  assert.equal(
    esDeAlgoQueBloqueamos(
      "consola: Failed to load resource: net::ERR_BLOCKED_BY_CLIENT",
      bloqueadas,
    ),
    true,
  );
  // Y también si el mensaje trae la URL en vez del motivo.
  assert.equal(
    esDeAlgoQueBloqueamos(
      "consola: no se pudo cargar http://localhost:3000/api/projects/p1/assets/casa.png",
      bloqueadas,
    ),
    true,
  );
});

test("pero un error de VERDAD del código del modelo sigue contando", () => {
  const bloqueadas = ["http://localhost:3000/api/projects/p1/assets/casa.png"];
  assert.equal(
    esDeAlgoQueBloqueamos("Uncaught TypeError: cart.total is not a function", bloqueadas),
    false,
  );
});

test("y sin nada bloqueado no se calla NADA — el caso normal", () => {
  // Conservador a propósito: si el guardia no cortó nada, ningún grito puede
  // ser suyo, ni siquiera uno que mencione el motivo.
  assert.equal(
    esDeAlgoQueBloqueamos("Failed to load resource: net::ERR_BLOCKED_BY_CLIENT", []),
    false,
  );
  assert.equal(esDeAlgoQueBloqueamos("Uncaught TypeError: x", []), false);
});

// ── EL CONTRASTE DICE DÓNDE, NO SÓLO CUÁNTO ──────────────────────────────────
//
// 🔴 MEDIDO el 2026-08-30 en una sesión real de un usuario: el veredicto era
// «1 texto(s) que el navegador pinta y nadie puede leer — el peor a 1.00:1», y
// nada más. Con eso el Agente dio CUATRO rondas seguidas oscureciendo el mismo
// velo del hero sin acertar, y en la última escribió veinte párrafos razonando
// en voz alta cuál de los textos de la página sería el del 1.00:1. Tenía el
// ratio y ninguna dirección.
//
// Es el mismo defecto que `sin_accion` en las pruebas de comportamiento, y el
// mismo arreglo: decir QUÉ elemento y CON QUÉ colores.
test("el veredicto NOMBRA el texto ilegible y sus dos colores", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    provider: providerReturning('{"broken":false,"issues":[]}'),
    medir: async () => ({
      unreadableText: [
        {
          contrast: 1,
          texto: "Mariscos frescos · desde 1987",
          etiqueta: "span",
          color: "#ffffff",
          background: "#dfe9f2",
        },
      ],
    }),
  });
  assert.equal(v.broken, true);
  const issue = v.issues.join(" ");
  assert.ok(issue.includes("Mariscos frescos"), `no nombra el texto: ${issue}`);
  assert.ok(issue.includes("#ffffff"), `no dice el color del texto: ${issue}`);
  assert.ok(issue.includes("#dfe9f2"), `no dice el color del fondo: ${issue}`);
});

test("con varios, nombra el PEOR primero y no lista más de tres", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    provider: providerReturning('{"broken":false,"issues":[]}'),
    medir: async () => ({
      unreadableText: [
        { contrast: 2.5, texto: "medio", etiqueta: "p", color: "#888", background: "#fff" },
        { contrast: 1.02, texto: "elpeor", etiqueta: "h2", color: "#fff", background: "#fff" },
        { contrast: 1.9, texto: "otro", etiqueta: "p", color: "#999", background: "#fff" },
        { contrast: 2.9, texto: "cuarto", etiqueta: "p", color: "#aaa", background: "#fff" },
      ],
    }),
  });
  const issue = v.issues.join(" ");
  assert.ok(issue.indexOf("elpeor") < issue.indexOf("medio"), `no ordena por gravedad: ${issue}`);
  assert.ok(!issue.includes("cuarto"), `lista más de tres: ${issue}`);
});

// BRAZO DE CONTROL: un medidor viejo que sólo trae el número no puede reventar
// el veredicto. Fail-soft, como todo en este fichero.
test("y un medidor que sólo da el número sigue funcionando", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    provider: providerReturning('{"broken":false,"issues":[]}'),
    medir: async () => ({ unreadableText: [{ contrast: 1.4 }] }),
  });
  assert.equal(v.broken, true);
  assert.ok(v.issues.join(" ").includes("1.40:1"));
});

// ⚰️ RETIRADAS LAS CINCO PRUEBAS DE «SÓLO LA CAPA DETERMINISTA» (2026-09-04).
//
// Fijaban la SEGUNDA pasada: medir sin llamar al modelo con visión, para
// comprobar si el ciclo de arreglo había arreglado. `12f6a11e` retiró ese
// ciclo esa misma mañana y el barrido de la tarde se llevó la pasada, que
// además era INALCANZABLE — el bucle no podía llegar a ella ni queriendo.
//
// No se pierde cobertura de lo que importaba: los cuatro hechos medibles
// (errores de JavaScript, la prueba declarada, desbordamiento en móvil y
// contraste) los siguen fijando las pruebas de arriba, sobre la pasada normal
// — que es la única que existe, y la que de verdad corre en producción.
