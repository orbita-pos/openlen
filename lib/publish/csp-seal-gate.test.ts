// EL PASE TERMINAL DEL RELEASE — lo que queda de él.
//
// Este fichero se llamaba así porque medía la CSP: que cada documento saliera
// con su política, que `unsealed` contara los que no, y que
// `OPENLEN_CSP_SEAL=strict` convirtiera esa pérdida en un aborto antes de
// tocar el disco.
//
// La política se retiró el 2026-08-26 (ver crates/html-engine/src/publish/
// seal.rs). Con el código del modelo viviendo dentro del documento, `script-src`
// por hash significaba re-sellar en cada edición — la misma fragilidad que la
// cápsula—, y `connect-src 'self'` impedía cargar una librería de un CDN o
// hablar con una API. Lo que acota el daño ahora es el dominio, no la jaula.
//
// Lo que el pase SIGUE haciendo son dos endurecimientos del marcado que no son
// CSP, y es lo que se mide aquí. Ninguno decide nada de diseño.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(tmpdir(), "olseal-"));
process.env.PUBLISH_ROOT = root;

import { publishToDir } from "./filesystem";

after(() => rmSync(root, { recursive: true, force: true }));

const doc = (cuerpo: string) =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>t</title></head>` +
  `<body>${cuerpo}</body></html>`;

const leer = (sub: string, sha: string) =>
  readFileSync(path.join(root, sub, "releases", sha, "index.html"), "utf8");

describe("el pase terminal endurece el marcado, y ya no emite política", () => {
  it("una página publicada sale SIN meta de CSP", async () => {
    const r = await publishToDir({ subdomain: "sinpolitica", html: doc("<h1>Hola</h1>") });
    assert.ok(!leer("sinpolitica", r.sha).includes("Content-Security-Policy"));
  });

  /**
   * Un `<base>` perdido secuestra TODA URL relativa de la página — cada enlace
   * interno, cada `<img src>` sin dominio. Casi siempre llega por copiar y
   * pegar de otro sitio, y el síntoma es que media página apunta a un dominio
   * ajeno sin que nada lo diga.
   */
  it("quita los <base>", async () => {
    const r = await publishToDir({
      subdomain: "conbase",
      html: doc('<base href="https://ajeno.test/"><a href="/precios">ir</a>'),
    });
    assert.ok(!leer("conbase", r.sha).includes("<base"));
  });

  /**
   * Sin `rel=noopener`, la pestaña que abres recibe un `window.opener` vivo y
   * puede reescribir la tuya — el tabnabbing clásico. Es una línea de marcado
   * y no cambia nada de lo que el modelo quiso.
   */
  it("y pone rel=noopener en cada target=_blank", async () => {
    const r = await publishToDir({
      subdomain: "connoopener",
      html: doc('<a href="https://ajeno.test" target="_blank">ir</a>'),
    });
    assert.ok(leer("connoopener", r.sha).includes("noopener"));
  });

  /**
   * Y NO TOCA EL SCRIPT DEL MODELO. Ésta es la que importa: el pase corre el
   * último, después de todos los horneados, así que si recortara algo sería
   * imposible de ver desde el editor. Antes su política decidía si ese script
   * podía correr; ahora ni lo mira.
   */
  it("el <script> del modelo llega intacto al fichero", async () => {
    const CODIGO = "window.__VIVO__=1";
    const r = await publishToDir({
      subdomain: "conscript",
      html: doc(`<h1>Hola</h1><script>${CODIGO}</script>`),
    });
    assert.ok(leer("conscript", r.sha).includes(CODIGO), "el pase se comió el script del modelo");
  });
});
