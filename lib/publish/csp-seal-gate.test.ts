// El sellado CSP dejó de ser invisible.
//
// `sealRelease` siempre devolvió `sealed`, y las cuatro llamadas de
// `publishToDir` se quedaban con `.html` a secas. Consecuencia medida: un
// documento con su PROPIA CSP —incluida una permisiva como `default-src *`—
// devuelve `sealed:false`, sale a disco con la política del autor en lugar de
// la nuestra, y no lo contaba nadie. `sealed:false` tampoco lanza, así que el
// `catch` que había no lo veía jamás.
//
// Run: npx tsx --test lib/publish/csp-seal-gate.test.ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";

const root = mkdtempSync(path.join(tmpdir(), "olseal-"));
process.env.PUBLISH_ROOT = root;

import { publishToDir } from "./filesystem";

const LIMPIO = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>limpio</title></head>
<body><h1>hola</h1><p>una página cualquiera</p></body></html>`;

/** Una CSP del autor gana a la nuestra: el sellador se niega a pisarla y
 *  devuelve `sealed:false`. Es el caso real, no uno inventado para el test. */
const CON_CSP_PROPIA = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>suya</title>
<meta http-equiv="Content-Security-Policy" content="default-src *"></head>
<body><h1>hola</h1><p>trae su propia política</p></body></html>`;

const shaActual = (sub: string): string | null => {
  const current = path.join(root, sub, "current");
  if (!existsSync(current)) return null;
  // El entorno de test en Windows escribe un fichero marcador con el sha en
  // lugar de un symlink.
  try {
    return readFileSync(current, "utf8").trim();
  } catch {
    return path.basename(path.resolve(current));
  }
};

describe("el documento que sale sin CSP ahora se cuenta", () => {
  after(() => rmSync(root, { recursive: true, force: true }));

  it("una página normal se sella y no reporta nada", async () => {
    const r = await publishToDir({ subdomain: "sellabien", html: LIMPIO });
    assert.deepEqual(r.unsealed, []);
    const doc = readFileSync(
      path.join(root, "sellabien", "releases", r.sha, "index.html"),
      "utf8",
    );
    assert.match(doc, /Content-Security-Policy/i);
  });

  it("una con CSP propia se PUBLICA, pero queda apuntada", async () => {
    const r = await publishToDir({ subdomain: "sellamal", html: CON_CSP_PROPIA });
    assert.deepEqual(r.unsealed, ["/"], "el documento sin sellar tiene que viajar en el resultado");
    assert.ok(existsSync(path.join(root, "sellamal", "releases", r.sha, "index.html")));
  });

  // Con el sellado APAGADO no se sella ni un documento. Un `unsealed` vacío ahí
  // sería una mentira tranquilizadora: diría "todo bien" precisamente cuando
  // nada se comprobó. El resultado no puede mentir según cómo esté un switch.
  it("con el sellado apagado, el resultado lo DICE en vez de callarse", async () => {
    process.env.OPENLEN_CSP_SEAL = "0";
    try {
      const r = await publishToDir({ subdomain: "apagado", html: LIMPIO });
      assert.equal(r.unsealed.length, 1);
      assert.match(r.unsealed[0]!, /desactivado/);
      const doc = readFileSync(path.join(root, "apagado", "releases", r.sha, "index.html"), "utf8");
      assert.doesNotMatch(doc, /data-ol-csp/, "no debería haber sellado nada");
    } finally {
      delete process.env.OPENLEN_CSP_SEAL;
    }
  });

  it("también apunta una subpágina, con su ruta", async () => {
    const r = await publishToDir({
      subdomain: "subpag",
      html: LIMPIO,
      pages: [{ slug: "precios", html: CON_CSP_PROPIA }],
    });
    assert.deepEqual(r.unsealed, ["/precios"]);
  });
});

/**
 * LA PALANCA. Apagada por defecto a propósito: encenderla hoy rompería
 * publicaciones que hoy funcionan. Es la que habrá que encender el día que una
 * página lleve JavaScript escrito por el modelo — ahí publicar sin política
 * deja de ser una pérdida y pasa a ser un agujero.
 */
describe("OPENLEN_CSP_SEAL=strict aborta antes de tocar el disco", () => {
  let shaBueno: string | null = null;

  before(async () => {
    const r = await publishToDir({ subdomain: "estricto", html: LIMPIO });
    shaBueno = r.sha;
  });
  after(() => {
    delete process.env.OPENLEN_CSP_SEAL;
    rmSync(root, { recursive: true, force: true });
  });

  it("lanza en vez de publicar sin política", async () => {
    process.env.OPENLEN_CSP_SEAL = "strict";
    await assert.rejects(
      () => publishToDir({ subdomain: "estricto", html: CON_CSP_PROPIA }),
      /sin CSP sellada/,
    );
  });

  // Lo que de verdad importa: no basta con lanzar. Un release ya escrito con el
  // symlink movido no se deshace — o no llega a existir, o es el que está vivo.
  it("y el sitio vivo sigue siendo el release anterior", () => {
    assert.equal(shaActual("estricto"), shaBueno);
  });

  it("apagada la palanca, la misma página vuelve a publicarse", async () => {
    delete process.env.OPENLEN_CSP_SEAL;
    const r = await publishToDir({ subdomain: "estricto", html: CON_CSP_PROPIA });
    assert.deepEqual(r.unsealed, ["/"]);
    assert.notEqual(r.sha, shaBueno);
  });
});
