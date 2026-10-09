// CADDY Y EL LIENZO. Spec 2026-09-15, corregida al leer el bloque: un `handle`
// de ruta (orden definido), no una regla por host. Y la exclusión de `@doc`,
// que la spec no tenía: sin ella Caddy estampa `Cache-Control: public,
// s-maxage=3600` y Cloudflare podría guardar un borrador en el borde.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RUTAS_SOLO_PUBLICADA } from "./rutas-solo-publicada";
import { RESERVED_ROOTS, WEB_EXTENSIONS } from "@/lib/agent/ficheros/folder";

const RAIZ = join(import.meta.dirname, "..", "..");
const sinComentarios = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
const CADDY = sinComentarios(readFileSync(join(RAIZ, "infra", "caddy", "Caddyfile"), "utf8"));

function bloque(texto: string, apertura: string): string {
  const i = texto.indexOf(apertura);
  if (i < 0) throw new Error(`no está «${apertura.trim()}»`);
  let prof = 0;
  for (let j = texto.indexOf("{", i); j < texto.length; j++) {
    if (texto[j] === "{") prof++;
    else if (texto[j] === "}" && --prof === 0) return texto.slice(i, j + 1);
  }
  throw new Error("bloque sin cerrar");
}

const PAGINAS = bloque(CADDY, "\n*.openlen.app {");

describe("Caddy y el lienzo", () => {
  it("🔴 /api/lienzo/* pasa a Next y sin X-Frame-Options", () => {
    const h = bloque(PAGINAS, "handle /api/lienzo/* {");
    expect(h).toContain("header -X-Frame-Options");
    expect(h).toContain("reverse_proxy 127.0.0.1:3000");
  });

  it("🔴 /api/lienzo/* está fuera de la caché pública de @doc", () => {
    const doc = bloque(PAGINAS, "@doc {");
    expect(doc).toMatch(/not path [^\n]*\/api\/lienzo\/\*/);
  });

  it("todo handle que pasa a Next es de la lista «sólo publicada» o es el lienzo", () => {
    const pasan = [...PAGINAS.matchAll(/handle (\/[^\s{]+) \{([^}]*)\}/g)]
      .filter(([, , cuerpo]) => cuerpo!.includes("reverse_proxy"))
      .map(([, ruta]) => ruta!);
    expect(pasan.length).toBeGreaterThan(5);
    for (const ruta of pasan) {
      if (ruta === "/api/lienzo/*") continue;
      // carril D: /storage/v1 y /realtime/v1 sólo contestan en
      // `<ref>.openlen.app`, la URL del proyecto (lib/backend/storage,
      // lib/backend/realtime); en el host de la página dan 404 también
      // PUBLICADA, así que avisar «sólo funciona publicada» sería mentir.
      if (ruta === "/storage/v1/*" || ruta === "/realtime/v1/*") continue;
      expect(RUTAS_SOLO_PUBLICADA, `${ruta} pasa a Next y el aviso del lienzo no lo conoce`).toContain(ruta.replace(/\*$/, ""));
    }
  });

  it("CONTRA-PRUEBA: las páginas publicadas siguen sin dejarse enmarcar", () => {
    expect(bloque(PAGINAS, "header {")).toContain('X-Frame-Options "SAMEORIGIN"');
  });
});

// ── LA CARPETA Y EL SITIO ENTERO DEL LIENZO (pieza 9 de Len 2.5) ────────────
//
// C le cedió a B este bloque con ocho notas; cada una tiene aquí su prueba.
describe("Caddy, la carpeta y el host lienzo-*", () => {
  /** La DEFINICIÓN de un matcher con nombre (la línea que empieza por él, o su
   *  bloque) — no un `handle @nombre {`. */
  const matcher = (nombre: string): string => {
    const linea = PAGINAS.split("\n").find((l) => l.trim().startsWith(`@${nombre} `));
    if (!linea) throw new Error(`no está @${nombre}`);
    return linea.trim() === `@${nombre} {` ? bloque(PAGINAS, linea) : linea;
  };
  const rutasDe = (texto: string, prefijo: string): string[] =>
    texto
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith(prefijo))
      .flatMap((l) => l.slice(prefijo.length).trim().split(/\s+/));

  it("🔴 un host lienzo-* va ENTERO a Next, sin X-Frame-Options", () => {
    expect(matcher("lienzo")).toMatch(/^\s*@lienzo header_regexp Host \^lienzo-\[0-9a-f\]\{32\}\\.$/);
    const h = bloque(PAGINAS, "handle @lienzo {");
    expect(h).toContain("header -X-Frame-Options");
    expect(h).toContain("reverse_proxy 127.0.0.1:3000");
  });

  it("la expresión del host casa lo que `etiquetaDelHost` reconoce, y nada más", () => {
    const re = new RegExp(/header_regexp Host (\S+)/.exec(matcher("lienzo"))![1]!);
    expect(re.test(`lienzo-${"a".repeat(32)}.openlen.app`)).toBe(true);
    expect(re.test("marea.openlen.app")).toBe(false);
    expect(re.test("lienzo-abc.openlen.app")).toBe(false);
  });

  it("🔴 nota 4: ni las cabeceras de caché ni los tipos se estampan en un host lienzo (Next pone los suyos; Caddy los duplicaría)", () => {
    for (const nombre of ["assets", "carpeta", "fuentes", "doc", "webmanifest", "markdown"]) {
      expect(matcher(nombre), `@${nombre}`).toMatch(/\n\s*not header_regexp Host \^lienzo-\n/);
    }
  });

  it("🔴 nota 1: lo inmutable es lo que lleva hash en el nombre o es binario; nunca un .js/.css/.svg de nombre fijo", () => {
    const a = matcher("assets");
    const rutas = rutasDe(a, "path ");
    for (const r of ["*.jpg", "*.jpeg", "*.png", "*.gif", "*.webp", "*.ico", "*.woff", "*.woff2", "*.avif", "/assets/*", "/uploads/*"]) {
      expect(rutas, r).toContain(r);
    }
    for (const r of ["*.js", "*.css", "*.svg"]) expect(rutas, r).not.toContain(r);
    expect(PAGINAS).toContain('header @assets Cache-Control "public, immutable, max-age=2592000"');
  });

  it("🔴 cada extensión de la carpeta se revalida siempre (como public/ en Vercel), y no lleva la caché del HTML", () => {
    const c = matcher("carpeta");
    const rutas = rutasDe(c, "path ");
    // /storage/v1/* (carril D): Next pone la caché de cada objeto, los privados `private`.
    expect(rutasDe(c, "not path ")).toEqual(["/assets/*", "/uploads/*", "/storage/v1/*"]);
    expect(PAGINAS).toContain('header @carpeta Cache-Control "public, max-age=0, must-revalidate"');
    const doc = matcher("doc");
    // Nota 8: la línea de extensiones, NO la de `/api/f/*` (la vigila caddy-contract).
    const extensionesDoc = doc.split("\n").find((l) => l.includes("not path *."))!;
    for (const ext of WEB_EXTENSIONS) {
      expect(rutas, ext).toContain(`*${ext}`);
      expect(extensionesDoc, ext).toContain(`*${ext}`);
    }
  });

  it("🔴 apps web: los fuentes compilados (.jsx .tsx .ts) salen como JavaScript", () => {
    // Un <script type="module"> con otro tipo no se ejecuta. La tabla del
    // sistema da `video/mp2t` a .ts y nada a .jsx/.tsx.
    expect(rutasDe(matcher("fuentes"), "path ")).toEqual(["*.jsx", "*.tsx", "*.ts"]);
    expect(PAGINAS).toContain('header @fuentes Content-Type "text/javascript; charset=utf-8"');
  });

  it("apps web (plan 02): el catálogo va DENTRO del paquete; la release no lo lleva y no hay regla para él", () => {
    expect(PAGINAS).not.toContain("/openlen/vendor/");
  });

  it("nota 6: .webmanifest y .md con su tipo explícito (la tabla de Go no los trae)", () => {
    expect(matcher("webmanifest")).toMatch(/\n\s*path \*\.webmanifest\n/);
    expect(PAGINAS).toContain('header @webmanifest Content-Type "application/manifest+json"');
    expect(matcher("markdown")).toMatch(/\n\s*path \*\.md\n/);
    expect(PAGINAS).toContain('header @markdown Content-Type "text/markdown; charset=utf-8"');
  });

  // Nota 3: el orden de los `handle` lo decide Caddy y cambia con la versión
  // (medido con 2.11.4: `@lienzo` va PRIMERO; antes, los de una ruta podían
  // adelantarse). Si se adelantan, las que van a Next no importan (el
  // middleware también las manda al lienzo), y las que sirven del disco tienen
  // que ser carpetas RESERVADAS, que ningún fichero del dueño puede usar.
  it("🔴 nota 3: lo que podría adelantarse a @lienzo y sirve del disco es sólo de carpetas reservadas", () => {
    const delDisco = [...PAGINAS.matchAll(/handle(?:_path)? (\/[^\s{]+) \{([^}]*)\}/g)]
      .filter(([, , cuerpo]) => !cuerpo!.includes("reverse_proxy"))
      .map(([, ruta]) => ruta!);
    expect(delDisco.sort()).toEqual(["/assets/*", "/uploads/*"]);
    for (const ruta of delDisco) expect(RESERVED_ROOTS).toContain(ruta.split("/")[1]);
  });
});
