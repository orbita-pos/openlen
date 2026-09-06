// ¿MIDEN LOS DOS EL MISMO DOCUMENTO? — la guarda del memo del render.
//
// Un turno del Agente que edita mide DOS veces: la medición que vuelve al
// modelo tras editar (`medirParaElModelo`, en `loop.ts`) y la de los ojos al
// cerrar (`verifyTurn` → `verifyEditedPage`). La ruta las hace pasar por
// `medirUnaVezPorDocumento`, cuya clave es el documento ENTERO — así que el
// ahorro existe si y sólo si las dos arman el MISMO documento.
//
// ⚰️ Y hasta el 2026-09-06 se creía que NO. El motivo escrito era «los ojos
// inyectan el script y las fotos por su cuenta, así que una caché por hash no
// acertaría nunca», y había caducado sin que nadie lo mirara: desde `933acc9d`
// el `<script>` vive DENTRO de `data.html`, `scriptDelDocumento` lo saca de ese
// mismo documento, y `injectModelRuntime` devuelve el html intacto cuando el
// código ya está.
//
// 🔴 ESTA PRUEBA EXISTE PARA QUE ESO NO SE VUELVA A DAR POR SUPUESTO EN NINGUNA
// DIRECCIÓN. Si alguien vuelve a hacer que los ojos armen un documento distinto,
// el memo deja de acertar EN SILENCIO —no rompe nada, sólo vuelve a renderizar
// dos veces— y este fichero es lo único que lo diría.
//
// Va bajo `npm run test:node` porque `tagWithOpIds` es el binding nativo, que
// vitest no carga.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { tagWithOpIds } from "@/lib/html-ops";
import { injectModelRuntime } from "@/lib/ai-stream/inject-model-runtime";
import { scriptDelDocumento } from "@/lib/page-engine/conservar-scripts";
import { inlineOwnAssets } from "@/lib/projects/inline-own-assets";

/** Una página como las que se guardan: el CDN de Tailwind (que el contrato
 *  OBLIGA) más el JavaScript del modelo, dentro del documento. */
const GUARDADO = `<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://cdn.tailwindcss.com"></script>
<title>Cantina</title></head>
<body class="bg-white">
<header><h1>La Bufa</h1></header>
<main><section id="carta"><p>Asado de boda</p></section></main>
<script>
const BOTON = document.querySelector("#carta");
BOTON?.addEventListener("click", () => { BOTON.classList.toggle("abierto"); });
</script>
</body></html>`;

describe("las dos medidas del turno son del mismo documento", () => {
  it("🔴 el injerto del script es un NO-OP sobre el gemelo: el documento ya lo trae", () => {
    const gemelo = tagWithOpIds(GUARDADO).taggedHtml;
    const codigo = scriptDelDocumento(GUARDADO);
    // Contra-comprobación del propio montaje: si esto saliera vacío, la
    // igualdad de abajo se cumpliría por no haber nada que injertar y la prueba
    // no probaría nada.
    assert.ok(codigo.includes("addEventListener"), "no se extrajo el script del modelo");
    assert.ok(!codigo.includes("cdn.tailwindcss.com"), "se extrajo el script de infraestructura");

    // Lo que hace la ruta: el bucle mide `gemelo`; los ojos miden
    // `injectModelRuntime(gemelo, codigo)`. Tienen que ser el mismo string.
    assert.equal(injectModelRuntime(gemelo, codigo), gemelo);
  });

  it("el gemelo conserva el script literal del documento guardado", () => {
    const gemelo = tagWithOpIds(GUARDADO).taggedHtml;
    // Es la razón POR LA QUE el injerto es un no-op: etiquetar añade atributos
    // a los elementos, no toca el interior del <script>. Si el etiquetador
    // empezara a reserializarlo, `html.includes(code)` fallaría y volverían a
    // ser dos documentos.
    assert.ok(gemelo.includes(scriptDelDocumento(GUARDADO)));
  });

  it("CONTRA-PRUEBA: si el documento NO trae el script, sí se injerta y son distintos", () => {
    const sinScript = GUARDADO.replace(/<script>[\s\S]*?<\/script>/i, "");
    const gemelo = tagWithOpIds(sinScript).taggedHtml;
    const codigo = scriptDelDocumento(GUARDADO);
    assert.notEqual(injectModelRuntime(gemelo, codigo), gemelo);
  });

  it("las fotos del dueño las pone la MISMA función, y sin subidas propias no toca nada", async () => {
    // Las dos rutas llaman a `inlineOwnAssets` sobre el mismo gemelo. En una
    // página sin subidas propias —el caso normal en producción y en todo lo que
    // nace del catálogo— devuelve el html tal cual, así que el documento que
    // llega al medidor es idéntico por los dos caminos.
    const gemelo = tagWithOpIds(GUARDADO).taggedHtml;
    assert.equal(await inlineOwnAssets(gemelo), gemelo);
  });
});
