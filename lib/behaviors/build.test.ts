import { describe, it, expect } from "vitest";
import { buildBehaviorsScript, buildBehaviorsHead, bakeBehaviors, BEHAVIORS_MARKER, usedBehaviors } from "./build";
import type { Behavior, BehaviorName } from "./types";

const fake = (name: string, marker: string, js: string, headJs?: string): Behavior =>
  ({
    name: name as BehaviorName, marker, js, headJs, budgetBytes: 700, docBudgetChars: 1200,
    schema: { root: { kind: "flag" } },
    degradation: "content-intact", a11y: [], status: "stable",
    doc: { label: "", when: "", whenNot: "", example: "" },
  }) as Behavior;

const REG = {
  countdown: fake("countdown", "data-ol-countdown", "/*CD*/"),
  filter: fake("filter", "data-ol-filter", "/*FI*/"),
} as Partial<Record<BehaviorName, Behavior>>;
const ORDER: BehaviorName[] = ["countdown", "filter"];

describe("buildBehaviorsScript", () => {
  it("devuelve null cuando la página no usa ninguna conducta", () => {
    expect(buildBehaviorsScript("<p>hola</p>", REG, ORDER)).toBeNull();
  });
  it("incluye SOLO el trozo cuyo marcador está presente", () => {
    const out = buildBehaviorsScript(`<div data-ol-countdown="x"></div>`, REG, ORDER)!;
    expect(out).toContain("/*CD*/");
    expect(out).not.toContain("/*FI*/");
  });
  it("emite en el orden del REGISTRO, no en el de aparición (hash CSP estable)", () => {
    const html = `<div data-ol-filter="a"></div><div data-ol-countdown="x"></div>`;
    const out = buildBehaviorsScript(html, REG, ORDER)!;
    expect(out.indexOf("/*CD*/")).toBeLessThan(out.indexOf("/*FI*/"));
  });
});

describe("bakeBehaviors", () => {
  it("inyecta el script antes de </body>", () => {
    const html = `<html><body><div data-ol-countdown="x"></div></body></html>`;
    const out = bakeBehaviors(html, REG, ORDER);
    expect(out).toContain(BEHAVIORS_MARKER);
    expect(out.indexOf(BEHAVIORS_MARKER)).toBeLessThan(out.indexOf("</body>"));
  });
  it("es idempotente — un segundo bake no duplica nada", () => {
    const html = `<html><body><div data-ol-countdown="x"></div></body></html>`;
    const once = bakeBehaviors(html, REG, ORDER);
    expect(bakeBehaviors(once, REG, ORDER)).toBe(once);
  });
  it("no toca una página sin conductas", () => {
    const html = `<html><body><p>hola</p></body></html>`;
    expect(bakeBehaviors(html, REG, ORDER)).toBe(html);
  });
});

// IMPORTANT (revisión final de rama) — el guard viejo era
// `html.includes(BEHAVIORS_MARKER)`: un substring SUELTO sobre TODO el
// documento, no "¿existe ya el <script> real?". Probado con el sanitizer
// real, los 4 vectores de abajo sobreviven y en los 4 el guard viejo daba
// `true` sin que ningún <script data-ol-behaviors> existiera — bakeBehaviors
// hacía bail-out creyendo que ya estaba horneado, PARA SIEMPRE (ninguna
// receta con marcador legítimo volvía a inyectarse en esa página), mientras
// usedBehaviors() (que mira el marcador de CADA receta, no BEHAVIORS_MARKER)
// seguía reportando la conducta como "usada" — la telemetría mentía. El fix
// es mirar el TAG literal (`<script ${BEHAVIORS_MARKER}>`).
describe("bakeBehaviors — el guard no confunde el marcador SUELTO con el <script> real (4 vectores)", () => {
  const withCountdown = (extra: string) =>
    `<!doctype html><html><head></head><body>${extra}<div data-ol-countdown="x"></div></body></html>`;

  it("(A) un <style data-ol-behaviors> residual (sin el <script>) no bloquea un bake nuevo", () => {
    const html = withCountdown(`<style ${BEHAVIORS_MARKER}>.leftover{}</style>`);
    const out = bakeBehaviors(html, REG, ORDER);
    expect(out).toContain(`<script ${BEHAVIORS_MARKER}>`);
    expect(out).toContain("/*CD*/");
  });

  it("(B) la cadena dentro de un comentario HTML no bloquea un bake nuevo", () => {
    const html = withCountdown(`<!-- nota interna: ${BEHAVIORS_MARKER} -->`);
    const out = bakeBehaviors(html, REG, ORDER);
    expect(out).toContain(`<script ${BEHAVIORS_MARKER}>`);
  });

  it("(C) la cadena en texto visible (una página que habla del propio marcador) no bloquea un bake nuevo", () => {
    const html = withCountdown(`<p>Esta demo usa el atributo ${BEHAVIORS_MARKER} para su runtime.</p>`);
    const out = bakeBehaviors(html, REG, ORDER);
    expect(out).toContain(`<script ${BEHAVIORS_MARKER}>`);
  });

  it("(D) una regla CSS del autor [data-ol-behaviors]{} no bloquea un bake nuevo", () => {
    const html = withCountdown(`<style>[${BEHAVIORS_MARKER}]{outline:1px solid red}</style>`);
    const out = bakeBehaviors(html, REG, ORDER);
    expect(out).toContain(`<script ${BEHAVIORS_MARKER}>`);
  });

  it("usedBehaviors() y el bake real quedan de acuerdo — ya no hay telemetría mentirosa", () => {
    const html = withCountdown(`<!-- ${BEHAVIORS_MARKER} -->`);
    expect(usedBehaviors(html, REG, ORDER)).toEqual(["countdown"]);
    expect(bakeBehaviors(html, REG, ORDER)).toContain(`<script ${BEHAVIORS_MARKER}>`);
  });

  it("sigue siendo idempotente sobre un documento YA horneado de verdad", () => {
    const html = withCountdown("");
    const once = bakeBehaviors(html, REG, ORDER);
    expect(bakeBehaviors(once, REG, ORDER)).toBe(once);
  });
});

// Arreglo 3 (revisión final de rama) — el guard de arriba mira el TAG real,
// pero como substring EXACTO (`<script data-ol-behaviors>`). Ese mismo tag,
// pasado por un round-trip de DOMParser + outerHTML (exactamente lo que
// stashBehaviorsPristineState hace una línea después de invocar el inyector
// del preview, dentro de derive() en preview-area.tsx), vuelve serializado
// como `<script data-ol-behaviors="">` — un atributo sin valor se parsea como
// "" y el serializador SIEMPRE escribe `nombre=""`, nunca el nombre pelado.
// Un `.includes` de substring exacto no matchea esa segunda forma, así que un
// re-bake sobre HTML que pasó por ese round-trip duplicaría el <script>.
describe("bakeBehaviors — idempotente tras un round-trip de DOMParser (Arreglo 3, revisión final de rama)", () => {
  it("un documento ya horneado, serializado como data-ol-behaviors=\"\" (round-trip DOMParser+outerHTML), no se vuelve a hornear", () => {
    const html = `<!doctype html><html><head></head><body><div data-ol-countdown="x"></div></body></html>`;
    const baked = bakeBehaviors(html, REG, ORDER);
    const roundTripped =
      "<!doctype html>\n" + new DOMParser().parseFromString(baked, "text/html").documentElement.outerHTML;

    // Sanity: el round-trip de verdad cambió la serialización que le
    // importaba al guard viejo — si esto fallara, el resto del test no
    // probaría nada (el bug requiere justo este cambio de forma).
    expect(roundTripped, "sanity: el round-trip debe DEJAR de traer el tag pelado").not.toContain(
      `<script ${BEHAVIORS_MARKER}>`,
    );
    expect(roundTripped, "sanity: el round-trip debe producir la forma con =\"\"").toContain(
      `<script ${BEHAVIORS_MARKER}="">`,
    );

    const rebaked = bakeBehaviors(roundTripped, REG, ORDER);
    const scriptCount = (rebaked.match(new RegExp(`<script ${BEHAVIORS_MARKER}`, "g")) ?? []).length;
    expect(
      scriptCount,
      `el round-trip de DOMParser no debe producir un segundo <script> de runtime (encontrados: ${scriptCount})`,
    ).toBe(1);
    expect(rebaked, "el guard tolerante al round-trip debe devolver el html sin tocar").toBe(roundTripped);
  });
});

describe("inyección en <head> (headJs)", () => {
  const REG_HEAD = {
    theme: fake("theme", "data-ol-theme", "/*BODY*/", "/*HEAD*/"),
  } as Partial<Record<BehaviorName, Behavior>>;
  const ORDER_HEAD: BehaviorName[] = ["theme"];

  it("con </head> presente, el script del head va antes de </head>", () => {
    const html = `<!DOCTYPE html><html><head></head><body><div data-ol-theme="x"></div></body></html>`;
    const out = bakeBehaviors(html, REG_HEAD, ORDER_HEAD);
    expect(out).toContain("/*HEAD*/");
    expect(out.indexOf("/*HEAD*/")).toBeLessThan(out.indexOf("</head>"));
  });

  it("sin </head> pero con <!DOCTYPE html>, el doctype sigue siendo lo primero del documento", () => {
    const html = `<!DOCTYPE html><html><body><div data-ol-theme="x"></div></body></html>`;
    const out = bakeBehaviors(html, REG_HEAD, ORDER_HEAD);
    expect(out.trimStart().startsWith("<!DOCTYPE")).toBe(true);
    expect(out).toContain("/*HEAD*/");
  });

  it("buildBehaviorsHead: IIFE envuelto si hay headJs, null si ninguna conducta lo tiene", () => {
    const html = `<div data-ol-theme="x"></div>`;
    expect(buildBehaviorsHead(html, REG_HEAD, ORDER_HEAD)).toBe("(function(){/*HEAD*/})();");
    expect(buildBehaviorsHead(`<div data-ol-countdown="x"></div>`, REG, ORDER)).toBeNull();
  });
});

describe("usedBehaviors", () => {
  it("devuelve los nombres en orden de REGISTRO, no de aparición en el HTML", () => {
    const reg = {
      countdown: fake("countdown", "data-ol-countdown", "/*CD*/"),
      copy: fake("copy", "data-ol-copy", "/*CP*/"),
    } as Partial<Record<BehaviorName, Behavior>>;
    const order: BehaviorName[] = ["countdown", "copy"];
    // El marcador de "copy" aparece ANTES que el de "countdown" en el HTML —
    // si usedBehaviors escaneara por orden de aparición devolvería
    // ["copy", "countdown"]. present() itera BEHAVIOR_ORDER, así que debe
    // devolver ["countdown", "copy"] pase lo que pase en el string.
    const html = `<button data-ol-copy="x"></button><div data-ol-countdown="y"></div>`;
    expect(usedBehaviors(html, reg, order)).toEqual(["countdown", "copy"]);
  });

  it("devuelve [] cuando la página no usa ninguna conducta", () => {
    const reg = {
      countdown: fake("countdown", "data-ol-countdown", "/*CD*/"),
      copy: fake("copy", "data-ol-copy", "/*CP*/"),
    } as Partial<Record<BehaviorName, Behavior>>;
    expect(usedBehaviors("<p>hola, nada aquí</p>", reg, ["countdown", "copy"])).toEqual([]);
  });

  // El sensor de demanda (deuda anotada en la revisión Fable): present()
  // matcheaba el marcador como SUBSTRING, y `data-ol-copy` ⊂ `data-ol-copied`,
  // `data-ol-filter` ⊂ `data-ol-filter-group`/`-target`. Una página con SOLO
  // el atributo hermano (que NO es el marcador de la receta) contaba la
  // conducta como "usada" — la telemetría que decide qué construir después
  // MENTÍA. El marcador debe matchear como NOMBRE DE ATRIBUTO completo
  // (terminado en `=`, espacio, `/` o `>`), nunca como trozo suelto.
  it("NO cuenta copy por un data-ol-copied hermano, ni filter por data-ol-filter-group/target", () => {
    const reg = {
      copy: fake("copy", "data-ol-copy", "/*CP*/"),
      filter: fake("filter", "data-ol-filter", "/*FI*/"),
    } as Partial<Record<BehaviorName, Behavior>>;
    const order: BehaviorName[] = ["copy", "filter"];
    // Solo los atributos HERMANOS, nunca el marcador real:
    const html =
      `<button data-ol-copied="¡Copiado!">x</button>` +
      `<div data-ol-filter-group="m"></div><div data-ol-filter-target="m"></div>`;
    expect(usedBehaviors(html, reg, order)).toEqual([]);
  });

  it("SÍ cuenta cuando el marcador real está presente como atributo (=, espacio, >)", () => {
    const reg = {
      copy: fake("copy", "data-ol-copy", "/*CP*/"),
      filter: fake("filter", "data-ol-filter", "/*FI*/"),
    } as Partial<Record<BehaviorName, Behavior>>;
    const order: BehaviorName[] = ["copy", "filter"];
    expect(usedBehaviors(`<button data-ol-copy="cup"></button>`, reg, order)).toEqual(["copy"]);
    expect(usedBehaviors(`<button data-ol-filter="*"></button>`, reg, order)).toEqual(["filter"]);
    // marcador flag (sin valor): `data-ol-x>` o `data-ol-x ` también cuentan
    expect(usedBehaviors(`<button data-ol-copy >`, reg, order)).toEqual(["copy"]);
  });

  // Hallazgo Fable (2026-07-13): un marcador publicado en documentos de
  // usuarios es un CONTRATO PARA SIEMPRE. La semántica anterior filtraba
  // deprecated de la EMISIÓN — deprecar una receta mataba el runtime de toda
  // página existente en su siguiente republicación, sin que el usuario
  // hubiera tocado nada. La política correcta parte la palabra en dos:
  // deprecated = OCULTA para la IA (doc.ts la excluye de docs/nombres/glosas
  // — ninguna página NUEVA la adquiere) pero SIGUE EMITIENDO para las
  // páginas que ya la usan. La telemetría (usedBehaviors) también la sigue
  // contando: saber cuántas páginas vivas aún la usan es exactamente el dato
  // que decide cuándo (si alguna vez) se puede retirar de verdad.
  it('una receta "deprecated" SIGUE emitiendo runtime y contando en usedBehaviors — las páginas existentes no pierden su conducta', () => {
    const reg = {
      countdown: fake("countdown", "data-ol-countdown", "/*CD*/"),
      filter: { ...fake("filter", "data-ol-filter", "/*FI*/"), status: "deprecated" as const },
    } as Partial<Record<BehaviorName, Behavior>>;
    const html = `<div data-ol-countdown="x"></div><div data-ol-filter="y"></div>`;
    expect(usedBehaviors(html, reg, ["countdown", "filter"])).toEqual(["countdown", "filter"]);
    expect(buildBehaviorsScript(html, reg, ["countdown", "filter"])).toContain("/*FI*/");
  });
});
