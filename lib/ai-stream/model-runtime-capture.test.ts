// El JavaScript del modelo al CREAR, contra el HtmlStream DE VERDAD.
//
// No se inyecta `makeHtmlStream` a propósito: el mock de generate.test.ts es un
// passthrough y no sanea, así que con él la afirmación importante de este
// fichero pasaría en verde sin haberse comprobado. Aquí corre el crate real.
//
// ⚰️ ESTE FICHERO PROBABA LA CAPTURA, y la captura se retiró el 2026-09-04.
// Fijaba que `generateHtmlStream` sacara el `<script>` del modelo a un campo
// aparte «antes de que el saneador lo borrara», y que el HTML final saliera SIN
// ese script. Las dos mitades describían un mundo que ya no es:
//
//   · La captura no podía salir. `extractModelRuntime` cuenta CUALQUIER
//     `<script>`, y el contrato obliga al de Tailwind por CDN en toda página.
//   · Y el HTML final SÍ lleva el script, porque desde entonces producción
//     genera con `sanitize: false` (app/api/generate/route.ts: «es NUESTRO
//     generador»). La prueba vieja no lo veía porque corría con los defectos
//     del crate —`sanitize: true`—, o sea con una configuración que la ruta no
//     usa. Es la misma trampa que escondía el fallo de la captura: un fixture
//     que no se parece a producción.
//
// LO QUE SE PRUEBA AHORA es la garantía que de verdad importa y que nadie
// vigilaba en esta capa: con las opciones de la ruta, el JavaScript que escribe
// el modelo llega ENTERO al documento que se guarda.
//
// Run: npx tsx --test lib/ai-stream/model-runtime-capture.test.ts
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { generateHtmlStream, type PageStreamProvider } from "./generate";
import type { StreamEvent } from "../ai-gateway";
import type { TurnWriter } from "@/lib/ai/provider-switch";

const CODIGO = `document.querySelectorAll("[data-cuenta]").forEach(function(b){b.onclick=function(){b.textContent=String(Number(b.textContent||0)+1)}});`;

// Un documento como los que salen de verdad: con el `<script>` de Tailwind que
// el contrato exige, y el del modelo al final del body.
const DOC = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>contador</title>
<script src="https://cdn.tailwindcss.com"></script></head>
<body><h1>Contador</h1><button data-cuenta>0</button>
<script>${CODIGO}</script>
</body></html>`;

function proveedor(html: string): PageStreamProvider {
  const eventos: StreamEvent[] = [
    { type: "start", id: "m1" },
    { type: "text_delta", text: html },
    { type: "done", stopReason: { kind: "end_turn" } },
  ];
  return {
    async *stream() {
      for (const e of eventos) yield e;
    },
  } as unknown as PageStreamProvider;
}

// LAS OPCIONES DE LA RUTA, no las del crate. `app/api/generate/route.ts` genera
// con `sanitize: false` porque el documento es del modelo y no se le recorta.
// Correr esto con los defectos mediría otro producto.
const HTML_OPTS_DE_LA_RUTA = { injectOpIds: false, sanitize: false, normalizeOnEnd: false };

async function correr(wroteWith: TurnWriter = "deepseek") {
  const { stream, done } = generateHtmlStream(
    {
      messages: [{ role: "user" as const, content: "haz un contador" }],
      userId: "u1",
      htmlOpts: HTML_OPTS_DE_LA_RUTA,
    },
    { provider: proveedor(DOC), wroteWith, debit: (async () => {}) as never },
  );
  const reader = stream.getReader();
  for (;;) {
    const { done: d } = await reader.read();
    if (d) break;
  }
  return await done;
}

test("el JavaScript del modelo llega ENTERO al documento que se guarda", async () => {
  const s = await correr();
  assert.ok(s.finalHtml, "debería haber documento");
  assert.ok(
    s.finalHtml!.includes(CODIGO),
    "el código del modelo se perdió por el camino — es su página, no se le recorta",
  );
});

test("y la página sigue completa alrededor de él", async () => {
  const s = await correr();
  assert.match(s.finalHtml!, /Contador/);
  assert.match(s.finalHtml!, /data-cuenta/);
  assert.match(s.finalHtml!, /cdn\.tailwindcss\.com/);
});

// LO QUE ESTO CIERRA, y por qué merece una prueba propia: el `<script>` de
// Tailwind y el del modelo conviven en toda página real. Ésa es exactamente la
// forma que hacía fallar a la captura retirada, así que fijarla aquí deja el
// caso cubierto por su lado bueno — el documento sale con los dos.
test("conviven el script de Tailwind y el del modelo, que es la forma real", async () => {
  const s = await correr();
  const scripts = [...s.finalHtml!.matchAll(/<script([^>]*)>/gi)].map((m) => m[1] ?? "");
  assert.ok(
    scripts.some((a) => a.includes("cdn.tailwindcss.com")),
    "falta el de Tailwind",
  );
  assert.ok(
    scripts.some((a) => !a.includes("src=")),
    "falta el inline del modelo",
  );
});
