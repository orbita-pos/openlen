// Run via: npx tsx --test lib/publish/tw-cdn-acuerdo.test.ts
// (node:test, no vitest: el oráculo es el sanitizador REAL, que entra por el
// binding nativo y vite no sabe cargar.)
//
// LA INVARIANTE, en una frase: **lo que la puerta DEJA PASAR, la expresión
// tiene que ENCONTRARLO.**
//
// Tres sitios deciden «¿es esto la etiqueta del CDN de Tailwind?»:
//
//   1. `crates/html-engine/src/sanitize/scripts.rs` — la PUERTA. ¿Sobrevive?
//   2. `lib/publish/tw-config.ts` (`injectTwCarrier`) — ¿dónde meto el carrier?
//   3. `lib/publish/optimize-html.ts` (`bakeTailwind`) — ¿qué sustituyo por CSS?
//
// Preguntan cosas distintas, así que NO tienen que dar la misma respuesta. Pero
// si la 1 conserva una etiqueta que la 3 no encuentra, `bakeTailwind` se va por
// su rama «no hay CDN»: retira el carrier `data-ol-tw` por inerte y deja el CDN
// vivo. La página se publica con el runtime de Tailwind pero SIN el
// `theme.extend` — `bg-ink` y `text-lime` compilan a nada. Es el
// blanco-sobre-blanco de 2026-07-18, esta vez en producción.
//
// Hasta el 2026-08-31 la 1 comparaba por IGUALDAD EXACTA contra dos cadenas
// literales y las otras dos por PREFIJO, con expresiones distintas entre sí
// (una exigía comillas dobles, la otra `src=` sin espacios). Medido ese día
// sobre el corpus del repo: 295 etiquetas, TODAS `src="https://cdn.tailwindcss.com"`.
// O sea que esto era LATENTE — ninguna página lo pisaba. Lo dejó de ser el día
// que el modelo escribe el HTML libre y puede poner `…com/3.4.16`.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { sanitizeForPublish } from "../html-engine";
import { CDN_TAG_RE } from "./tw-config";

const doc = (src: string) =>
  `<!doctype html><html><head><script src=${src}></script></head><body><p>x</p></body></html>`;

/** ¿Sobrevivió algún `<script>` al sanitizador? */
function sobrevive(html: string): boolean {
  const r = sanitizeForPublish(html);
  assert.notEqual(r.html, null, "el documento no debía ser rechazado entero");
  return /<script\b/i.test(r.html as string);
}

// El atributo tal cual se escribe, para poder probar comillas y espacios.
const CASOS: ReadonlyArray<readonly [atributo: string, pasa: boolean, por: string]> = [
  // --- Las dos que la lista literal ya conocía.
  [`"https://cdn.tailwindcss.com"`, true, "la forma canónica"],
  [
    `"https://cdn.tailwindcss.com?plugins=forms,typography,aspect-ratio,line-clamp"`,
    true,
    "los cuatro plugins, la segunda cadena de la lista vieja",
  ],

  // --- Las formas del MISMO CDN que la igualdad exacta borraba en silencio.
  [`"https://cdn.tailwindcss.com/3.4.16"`, true, "versión clavada en la ruta"],
  [`"https://cdn.tailwindcss.com/"`, true, "barra final"],
  [`"https://cdn.tailwindcss.com?plugins=forms"`, true, "un solo plugin"],
  [`"HTTPS://CDN.TAILWINDCSS.COM"`, true, "la caja no es otro host"],

  // --- Las formas que la puerta conserva y una de las dos expresiones NO
  // encontraba. Éstas son las que publicaban la página sin paleta.
  [`'https://cdn.tailwindcss.com'`, true, "comillas simples"],

  // --- Y lo que no puede pasar por abrir la ruta.
  [`"https://cdn.tailwindcss.com.evil.example/x.js"`, false, "sufijo del host"],
  [`"https://cdn.tailwindcss.com@evil.example/x.js"`, false, "usuario en la autoridad"],
  [`"https://evil.example/cdn.tailwindcss.com/x.js"`, false, "el host bueno en la RUTA"],
  [`"http://cdn.tailwindcss.com"`, false, "sin TLS"],
  [`"//cdn.tailwindcss.com"`, false, "protocolo-relativo"],
  [`"https://play.tailwindcss.com"`, false, "otro subdominio"],
  [`"https://evil.example/x.js"`, false, "un tercero cualquiera"],
];

test("lo que la puerta deja pasar, la expresión lo encuentra", () => {
  for (const [atributo, pasa, por] of CASOS) {
    if (atributo === "") continue;
    const html = doc(atributo);
    assert.equal(sobrevive(html), pasa, `la puerta y el caso no coinciden: ${por} (${atributo})`);
    if (pasa) {
      assert.ok(
        CDN_TAG_RE.test(html),
        `LA INVARIANTE: la puerta conserva ${atributo} (${por}) y la expresión no lo ve — ` +
          `bakeTailwind retiraría el carrier y publicaría la página sin paleta`,
      );
    }
  }
});

test("los espacios alrededor del `=` no esconden la etiqueta", () => {
  // Ésta la conservaba la puerta (lol-html lee el atributo, no el texto) y la
  // encontraba `tw-config` (`\s*=\s*`) pero NO el horneado, que exigía `src=`
  // pegado. Era el camino corto a publicar sin `theme.extend`.
  const html = `<!doctype html><html><head><script src = "https://cdn.tailwindcss.com"></script></head><body></body></html>`;
  assert.equal(sobrevive(html), true, "la puerta la conserva");
  assert.ok(CDN_TAG_RE.test(html), "y ahora la expresión también la ve");
});

test("una etiqueta que la puerta MATA no tiene que encontrarla nadie", () => {
  // El otro lado de la invariante no se exige: sobrar es gratis. Pero el caso
  // realista —un tercero— no debe parecerse al CDN por accidente.
  const html = doc(`"https://evil.example/tailwindcss.com.js"`);
  assert.equal(sobrevive(html), false);
  assert.equal(CDN_TAG_RE.test(html), false);
});
