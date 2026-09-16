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
  esRuidoDeRed,
  parseVisualVerdict,
  verifyEditedPage,
} from "./verify";
import type { InlineImage, StreamEvent } from "../ai-gateway";
import { UMBRAL_CONTRASTE } from "../ai/contraste";
import type { ContextoDeVista } from "../lienzo/documento";

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

test("lo que el modelo llama rotura baja a OBSERVACIÓN — ver el porqué abajo", () => {
  const v = parseVisualVerdict('{"broken":true,"issues":["texto encimado en el hero"]}');
  assert.deepEqual(v, {
    broken: false,
    issues: [],
    observaciones: ["texto encimado en el hero"],
    fallback: false,
  });
});

test("broken sin issues concretos NO dispara nada", () => {
  const v = parseVisualVerdict('{"broken":true,"issues":[]}');
  assert.equal(v?.broken, false);
});

test("recorta a 4 — más no es arreglo quirúrgico (ahora sobre observaciones)", () => {
  const v = parseVisualVerdict(
    JSON.stringify({ broken: true, issues: ["a", "b", "c", "d", "e", "f"] }),
  );
  assert.equal(v?.observaciones.length, 4);
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

test("lo que el modelo ve llega al usuario, pero como observación", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    medir: async () => null,
    provider: providerReturning('{"broken":true,"issues":["contraste ilegible en precios"]}'),
  });
  // No acusa —eso lo hace la medida del navegador, que aquí no vio nada— pero
  // tampoco se pierde: el usuario lee lo que el modelo observó.
  assert.equal(v.broken, false);
  assert.deepEqual(v.observaciones, ["contraste ilegible en precios"]);
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
  // 🔴 EL CASO REAL, Y AHORA SE CUMPLE MEJOR. Esto exigia la frase «si el
  // usuario pidio ESOS colores, dile que asi no se lee y propon el ajuste
  // minimo» — una orden AL MODELO para que RELEVARA el aviso al usuario. Nacio
  // del caso medido el 2026-08-22: a «pon el boton en #f5e050 con el texto en
  // blanco» el Agente obedece y entrega 1.34:1, y `cambiar_tema` (que camina el
  // contraste hasta cumplir WCAG) ni entra porque los colores los pidio el.
  //
  // Desde que el ciclo de arreglo se retiro, `issues` NO va al modelo: el bucle
  // se lo emite al usuario verbatim. O sea que el aviso ya no depende de que el
  // modelo se acuerde de repetirlo — se lo decimos directamente, que es la
  // doctrina entera: se MIDE, se DICE, y quien corrige es el usuario. Lo que
  // esta prueba garantiza es esa promesa, no la redaccion vieja.
  assert.match(v.issues[0]!, /ilegibles/);
  assert.match(v.issues[0]!, /Dime y les cambio el color/);
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
  // Lo que el medidor no pudo medir no lo suple el modelo: su lectura baja a
  // observación y el turno cierra sin acusar.
  assert.equal(v.broken, false);
  assert.deepEqual(v.issues, []);
  assert.deepEqual(v.observaciones, ["texto encimado"]);
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
  // 🔴 SIGUE ACUSANDO —es un hecho del navegador— pero se dice en lo que el
  // VISITANTE va a ver, no en CSS. La frase la lee el dueno de la pagina: el
  // bucle emite `issues` verbatim como `critique` desde que se retiro el ciclo
  // de arreglo, asi que el diagnostico de `width:100%` y `margin` heredado se
  // mudo a la declaracion de `editar_estructura`, que el modelo lee cada turno.
  assert.match(v.issues[0]!, /se sale de la pantalla/);
  assert.match(v.issues[0]!, /barra de desplazamiento/);
});

// ─── LA DIRECCION DEL CULPABLE ──────────────────────────────────────────────
//
// El aviso decia QUIEN se sale (`span.font-display.text-xl`) y no DONDE esta.
// Medido en la pagina «Volcanica» el 2026-09-05: la sonda nombro al mismo
// culpable dos turnos seguidos, con su ancho exacto, y el Agente edito las dos
// veces un vecino. Sabia el arreglo —lo dijo— y no sabia cual era el nodo.
//
// La direccion ya NO se traduce fuera: la sonda la lee del nodo que mide, y
// llega aqui hecha. Por eso estas pruebas inyectan `overflowCulpritOpId` en el
// medidor en vez de un resolutor.

test("el aviso lleva el data-op-id que trae la sonda", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    medir: async () => ({
      mobileOverflow: true,
      unreadableText: [],
      overflowCulprit: "span.font-display.text-xl",
      overflowCulpritRight: 644,
      overflowCulpritOpId: "k3",
    }),
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  assert.equal(v.broken, true);
  assert.match(v.issues[0]!, /data-op-id `k3`/);
  // La descripcion NO se pierde: el aviso lo lee tambien el dueno, y `k3` no le
  // dice nada a una persona.
  assert.match(v.issues[0]!, /span\.font-display\.text-xl/);
  assert.match(v.issues[0]!, /644px/);
});

test("sin direccion, el aviso sale exactamente como antes", async () => {
  // Es lo que pasa cuando se mide un documento SIN etiquetar: la sonda no tiene
  // de donde leer el atributo. El aviso tiene que seguir siendo el util que ya
  // habia, no un hueco ni un `data-op-id` vacio.
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    medir: async () => ({
      mobileOverflow: true,
      unreadableText: [],
      overflowCulprit: "span.font-display.text-xl",
      overflowCulpritRight: 644,
    }),
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  assert.doesNotMatch(v.issues[0]!, /data-op-id/);
  assert.match(v.issues[0]!, /se sale de la pantalla/);
  assert.match(v.issues[0]!, /644px/);
});

test("se MIDE el gemelo y se FOTOGRAFIA el guardado", async () => {
  // El cambio entero depende de esto: si se midiera `html`, las sondas no
  // tendrian de donde leer la direccion y todo lo demas seria decoracion.
  let medido = "";
  let fotografiado = "";
  await verifyEditedPage(
    { ...PARAMS, taggedHtml: '<html><body><p data-op-id="7">hola</p></body></html>' },
    {
      render: async (html: string) => {
        fotografiado = html;
        return IMAGE;
      },
      medir: async (html: string) => {
        medido = html;
        return { mobileOverflow: false, unreadableText: [] };
      },
      provider: providerReturning('{"broken":false,"issues":[]}'),
    },
  );
  assert.match(medido, /data-op-id="7"/);
  assert.doesNotMatch(fotografiado, /data-op-id/);
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
  assert.match(todo, /se sale de la pantalla/);
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
  assert.match(v.issues.join(" | "), /se sale de la pantalla/);
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
// `defaultVerifyProvider` devuelve el papel con vision por Fireworks salvo que
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
    // Lo que se comprueba aquí es que MIRÓ con la credencial compartida, no qué
    // dictaminó: desde el 2026-09-15 su lectura es observación, no veredicto.
    assert.deepEqual(v.observaciones, ["el hero se sale"]);
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

test("un veredicto sin campo `observaciones` sigue siendo válido", () => {
  const v = parseVisualVerdict(JSON.stringify({ broken: true, issues: ["texto encima de texto"] }));
  assert.ok(v);
  assert.equal(v.broken, false);
  // Lo que venía en `issues` es lo que el modelo vio, así que ahí acaba.
  assert.deepEqual(v.observaciones, ["texto encima de texto"]);
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

// ── LA VOZ: ESTO LO LEE UNA PERSONA, NO UN MODELO ───────────────────────────
//
// 🔴 GUARDA DE REGRESION, y existe porque el defecto no se metio escribiendo
// mal: se metio RETIRANDO algo. Cuando el ciclo de arreglo del Agente vivia,
// `issues` era un canal hacia el MODELO y «Arreglalo con editar_html» era la
// redaccion correcta. Al retirarlo el 2026-09-04, `app/api/agent/route.ts` paso
// esa misma lista a `critique` y el bucle la emite VERBATIM al usuario — nadie
// reescribio el texto, y el dueno de la pagina llevaba desde entonces leyendo
// ordenes escritas para un modelo, con el nombre de una herramienta interna
// dentro.
//
// La leccion que fija esta prueba es la general: al retirar un consumidor, hay
// que mirar QUIEN HEREDA EL CANAL. Sin guarda, la proxima vez que alguien anada
// un hecho medido volvera a redactarlo para el modelo, porque los que ya estan
// ahi le serviran de ejemplo.
const PROHIBIDO = [
  // Herramientas internas: el usuario no las tiene ni puede llamarlas.
  /editar_html/, /editar_runtime/, /editar_estructura/, /editar_atributos/,
  /cambiar_tema/, /redisenar_pagina/,
  // Recetas de CSS: son para quien escribe el codigo. Viven en catalog.ts.
  /overflow-x/, /overflow:\s*hidden/, /width:\s*100%/,
];

async function issuesDe(medir: () => Promise<unknown>) {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    medir: medir as never,
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  return v;
}

test("el desborde le habla al dueno de la pagina: sin herramientas ni recetas de CSS", async () => {
  for (const medida of [
    // Con culpable y sin el: las dos redacciones existen y las dos se emiten.
    async () => ({ mobileOverflow: true, unreadableText: [], overflowCulprit: ".hero-grid", overflowCulpritRight: 438 }),
    async () => ({ mobileOverflow: true, unreadableText: [] }),
  ]) {
    const v = await issuesDe(medida);
    assert.equal(v.broken, true, "sigue siendo un defecto medido: tiene que acusar");
    const texto = v.issues.join(" | ");
    for (const malo of PROHIBIDO) {
      assert.ok(!malo.test(texto), `le habla al modelo (${malo}): ${texto}`);
    }
    // Y sigue diciendo lo que el VISITANTE va a ver, que es lo que hace la
    // queja creible en vez de una etiqueta.
    assert.match(texto, /barra de desplazamiento/);
  }
});

test("el contraste igual — y conserva los hechos que costaron cuatro rondas a ciegas", async () => {
  const v = await issuesDe(async () => ({
    unreadableText: [
      { contrast: 1.34, texto: "Reservar ahora", etiqueta: "a", color: "#ffffff", background: "#f5e050" },
    ],
  }));
  assert.equal(v.broken, true);
  const texto = v.issues.join(" | ");
  for (const malo of PROHIBIDO) {
    assert.ok(!malo.test(texto), `le habla al modelo (${malo}): ${texto}`);
  }
  // LOS HECHOS NO SE TOCAN: que texto, sus dos colores y el ratio. Sin ellos el
  // Agente dio cuatro rondas oscureciendo el velo equivocado (2026-08-30).
  assert.ok(texto.includes("Reservar ahora"), texto);
  assert.ok(texto.includes("#ffffff"), texto);
  assert.ok(texto.includes("#f5e050"), texto);
  assert.ok(texto.includes("1.34"), texto);
});

// 🔴 LA AVERÍA QUE ESTA CIERRA, y no la cazaba nadie: el aviso decía «por debajo
// del mínimo de 3:1 que hace falta» mientras `juzgarContraste` comparaba contra
// 2. No es un redondeo — le prometía al dueño que un texto a 2,5:1 se habría
// comprobado y estaba bien, cuando ni se mira. La misma cifra escrita en dos
// sitios, que es la forma que ya nos costó caro en otras superficies.
test("el aviso de contraste nombra el umbral que se MIDIÓ, y no inventa ningún otro", async () => {
  const v = await issuesDe(async () => ({
    unreadableText: [
      { contrast: 1.34, texto: "Reservar ahora", etiqueta: "a", color: "#ffffff", background: "#f5e050" },
    ],
  }));
  const texto = v.issues.join(" | ");
  assert.ok(texto.includes(`${UMBRAL_CONTRASTE}:1`), `no nombra el umbral que se mide: ${texto}`);
  // Y ningún OTRO ratio: los únicos números «N:1» que pueden salir son el
  // umbral y el contraste medido del propio hallazgo. Cualquier otro es una
  // cifra inventada, que es exactamente lo que había.
  const permitidos = new Set([String(UMBRAL_CONTRASTE), "1.34"]);
  for (const m of texto.matchAll(/(\d+(?:[.,]\d+)?):1/g)) {
    const ratio = m[1].replace(",", ".");
    assert.ok(permitidos.has(ratio), `ratio inventado en el aviso: ${ratio}:1 — ${texto}`);
  }
});

// CONTROL: el grito del JavaScript ya estaba bien redactado —no nombra ninguna
// herramienta— y tiene que seguir igual. Sin esta, «quitar las ordenes» podria
// implementarse borrando la unica linea que de verdad le dice al usuario que su
// pagina esta rota.
test("el grito del JavaScript ya hablaba en cristiano y sigue acusando", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async (_html, opts?: { onErrors?: (e: readonly string[]) => void }) => {
      opts?.onErrors?.(["TypeError: x is not a function"]);
      return IMAGE;
    },
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  assert.equal(v.broken, true);
  const texto = v.issues.join(" | ");
  for (const malo of PROHIBIDO) {
    assert.ok(!malo.test(texto), `le habla al modelo (${malo}): ${texto}`);
  }
});

// ───── EL EMBED DE TERCEROS QUE NO LLEGA A LA RED NO ES CÓDIGO ROTO ─────
//
// 🔴 MEDIDO el 2026-09-15 sobre el corpus de 55 páginas: de las 6 que los ojos
// acusaron, DOS lo fueron por esto — `sorteo.html` y `terror.html`, las dos con
// el mismo grito literal de un `<gmp-place-details-compact>` de Google Maps que
// no alcanza la red en nuestro renderizador headless (sin clave, sin salida, o
// con la cuota agotada).
//
// Al modelo le llegaba como «El JavaScript de la página falla», que es FALSO:
// en el navegador de un visitante, con la clave puesta, ese mapa carga. Y la
// consecuencia no es cosmética — es la avería medida el 2026-08-27 con la foto
// del dueño: al Agente se le dice que algo suyo está roto y lo "arregla"
// borrándolo.
//
// `esDeAlgoQueBloqueamos` no lo cubría porque sólo mira lo que bloqueamos
// NOSOTROS (`bloqueadas`) o `ERR_BLOCKED_BY_CLIENT`. Una petición PERMITIDA que
// falla por la red es otro caso, y no había ninguno.
test("red · el grito exacto que salió en la medición se calla", () => {
  assert.equal(
    esRuidoDeRed(
      "consola: <gmp-place-details-compact>: Encountered a network request error: " +
        "Rpc failed due to xhr error. uri: https://maps.googleapis.com/maps/api/place/js/PlaceService",
    ),
    true,
  );
});

test("red · las demás formas en que Chromium cuenta un fallo de transporte", () => {
  for (const grito of [
    "consola: Failed to load resource: net::ERR_NAME_NOT_RESOLVED",
    "consola: Failed to load resource: net::ERR_CONNECTION_REFUSED",
    "consola: Failed to load resource: net::ERR_INTERNET_DISCONNECTED",
    "consola: Failed to load resource: net::ERR_TIMED_OUT",
    "consola: Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
    "consola: TypeError: Failed to fetch",
    "consola: NetworkError when attempting to fetch resource.",
  ]) {
    assert.equal(esRuidoDeRed(grito), true, grito);
  }
});

test("red · 🔴 pero un error de VERDAD del código sigue contando", () => {
  for (const grito of [
    "Uncaught TypeError: cart.total is not a function",
    "Uncaught ReferenceError: deckTabs is not defined",
    "Identifier 'GAMES' has already been declared",
    "Uncaught SyntaxError: Unexpected token '}'",
    "Uncaught TypeError: Cannot read properties of undefined (reading 'fetch')",
  ]) {
    assert.equal(esRuidoDeRed(grito), false, grito);
  }
});

// ───── EL MODELO OBSERVA; LO QUE MIDE EL NAVEGADOR ACUSA ─────
//
// 🔴 MEDIDO el 2026-09-15 sobre el corpus de 55 páginas, dos corridas. De las
// razones por las que los ojos decían «rota», el 88% las encontró la mitad
// DETERMINISTA —contraste leído en el píxel, desborde medido, errores de
// JavaScript capturados—. Lo que el modelo con visión aportó por su cuenta fue
// UN hallazgo… y en la segunda corrida cambió de opinión sobre las mismas
// páginas. Un juez que no repite no es un juez.
//
// Y la vara lo dice igual: Claude Code NO tiene ningún
// modelo juzgando sus propias ediciones. Entrega DIAGNÓSTICOS —hechos de una
// herramienta, con fichero y línea— y el modelo decide. `critique` sólo aparece
// en su telemetría de PLANIFICACIÓN (`…`).
//
// Así que el voto se retira y el dato se conserva: es exactamente lo que ya se
// decidió con la prueba declarada que acusó a 3 páginas y acertó en 0.
test("ojos · lo que dice el modelo NO acusa por sí solo — pasa a observación", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    medir: async () => null,
    provider: providerReturning(
      '{"broken":true,"issues":["la sección de proyectos se ve vacía"]}',
    ),
  });
  assert.equal(v.broken, false, "el modelo ya no decide si la página está rota");
  assert.deepEqual(v.issues, []);
  // Pero NO se tira: lo que vio sigue llegando al usuario como observación.
  assert.match(v.observaciones.join(" | "), /la sección de proyectos se ve vacía/);
});

test("ojos · lo MEDIDO sigue acusando — el contraste del navegador", async () => {
  const v = await verifyEditedPage(PARAMS, {
    render: async () => IMAGE,
    medir: async () => ({
      unreadableText: [{ contrast: 1.2, sample: "Precios", color: "#fff", background: "#fff" }],
    }),
    provider: providerReturning('{"broken":false,"issues":[]}'),
  });
  assert.equal(v.broken, true, "una medida del navegador SÍ acusa");
  assert.match(v.issues.join(" | "), /ilegibles/);
});

// ── EL DOCUMENTO QUE SE MIDE ES EL QUE EL USUARIO TIENE DELANTE ─────────────
//
// D5 de la spec 2026-09-15: el lienzo y el medidor hornean con la MISMA
// función. Aquí se comprueba el lado del medidor: que `vista` llega a lo que se
// mide, y que sin ella nada cambia.

const VISTA: ContextoDeVista = {
  projectId: "4f9c10cb-8781-48f1-b291-c5d146579f09",
  title: "Mi negocio",
  sub: null,
  pagina: null,
  settings: undefined,
  logoUrl: null,
};

test("con `vista`, lo que se MIDE va horneado (y la foto no)", async () => {
  let medido = "";
  let fotografiado = "";
  await verifyEditedPage(
    { ...PARAMS, taggedHtml: '<html><body><h1 data-op-id="h1">Hola</h1></body></html>', vista: VISTA },
    {
      provider: providerReturning('{"broken":false,"issues":[]}'),
      render: async (html: string) => {
        fotografiado = html;
        return IMAGE;
      },
      medir: async (html: string) => {
        medido = html;
        return null;
      },
    },
  );
  // El horneado deja su huella: el sello reserializa el documento, así que lo
  // medido NO puede ser idéntico al gemelo que entró.
  assert.notEqual(medido, "");
  assert.notEqual(medido, '<html><body><h1 data-op-id="h1">Hola</h1></body></html>');
  // …y la dirección sobrevive, que es para lo que existe el gemelo.
  assert.ok(medido.includes('data-op-id="h1"'));
  // La FOTO sigue siendo el documento guardado, sin gemelo y sin hornear: los
  // ojos no necesitan direcciones y cambiarles el documento cambiaría lo que ve
  // el modelo con visión.
  assert.equal(fotografiado, PARAMS.html);
});

test("sin `vista`, se mide exactamente lo de siempre", async () => {
  let medido = "";
  await verifyEditedPage(
    { ...PARAMS, taggedHtml: "<html><body><h1>Hola</h1></body></html>" },
    {
      provider: providerReturning('{"broken":false,"issues":[]}'),
      render: async () => IMAGE,
      medir: async (html: string) => {
        medido = html;
        return null;
      },
    },
  );
  assert.equal(medido, "<html><body><h1>Hola</h1></body></html>");
});

// ── LO QUE NO PODEMOS COMPROBAR SE DICE, Y NO ACUSA A NADIE ────────────────
//
// D6 de la spec 2026-09-15. Un diálogo nativo no es un defecto: es la página
// haciendo exactamente lo que el modelo escribió. Lo que pasa es que NOSOTROS
// lo cancelamos para poder medir, así que de esa página conocemos una rama y no
// la otra. Eso es una observación — el mismo canal que ya usan los fallos de la
// prueba declarada, y por el mismo motivo (hechos antes que el juicio).

const medirDevolviendo = (m: Record<string, unknown>) => async () => m as never;

test("un prompt() descartado sale como OBSERVACIÓN, con broken=false", async () => {
  const v = await verifyEditedPage(PARAMS, {
    provider: providerReturning('{"broken":false,"issues":[]}'),
    render: async () => IMAGE,
    medir: medirDevolviendo({ dialogosNativos: ["prompt: Nombre del nuevo deck:"] }),
  });
  assert.equal(v.broken, false);
  assert.deepEqual(v.issues, []);
  const texto = v.observaciones.join(" ");
  assert.ok(texto.includes("prompt"), `no se dijo nada del diálogo: ${texto}`);
  // Por la RAÍZ, no por una conjugación. El plan pedía «cancelar» o «canceló» y
  // su propio texto dice «CANCELA»: la aserción comprobaba la forma del verbo,
  // no lo que la frase tiene que decir, que es que esa rama la cerramos
  // nosotros.
  assert.ok(
    texto.toLowerCase().includes("cancel"),
    `no se dice qué rama se midió: ${texto}`,
  );
});

test("dos verbos distintos se nombran los dos, una sola vez", async () => {
  const v = await verifyEditedPage(PARAMS, {
    provider: providerReturning('{"broken":false,"issues":[]}'),
    render: async () => IMAGE,
    medir: medirDevolviendo({
      dialogosNativos: ["prompt: Nombre:", "confirm: ¿Borrar?", "prompt: Otro nombre:"],
    }),
  });
  const texto = v.observaciones.join(" ");
  assert.ok(texto.includes("prompt"));
  assert.ok(texto.includes("confirm"));
  // Una línea, no tres: el turno se le lee al usuario.
  assert.equal(v.observaciones.filter((o) => o.includes("prompt")).length, 1);
});

test("CONTRA-PRUEBA: sin diálogos no se añade nada", async () => {
  const v = await verifyEditedPage(PARAMS, {
    provider: providerReturning('{"broken":false,"issues":[]}'),
    render: async () => IMAGE,
    medir: medirDevolviendo({}),
  });
  assert.deepEqual(v.observaciones, []);
  assert.equal(v.broken, false);
});

test("una llamada a /api/f/ sale como observación, sin acusar a la página", async () => {
  const v = await verifyEditedPage(PARAMS, {
    provider: providerReturning('{"broken":false,"issues":[]}'),
    render: async () => IMAGE,
    medir: medirDevolviendo({ llamadasSoloPublicada: ["/api/f/mi-negocio → 404"] }),
  });
  assert.equal(v.broken, false);
  assert.deepEqual(v.issues, []);
  const texto = v.observaciones.join(" ");
  assert.ok(texto.includes("/api/f/mi-negocio"), texto);
  assert.ok(texto.includes("publicada"), texto);
});
