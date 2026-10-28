// LA CARPETA DEL PROYECTO (pieza 9 de plans/len-agente-2026/plan-2-5): qué
// rutas valen, de qué clase son, cuánto cabe y qué se publica.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makePointer } from "@/lib/files/blob-pointer";
import { MAX_FILE_BYTES, MAX_PROJECT_BYTES, MAX_PROJECT_FILES } from "@/lib/files/limits";
import {
  RESERVED_ROOTS,
  classifyFolderPath,
  contentTypeFor,
  folderSaveProblem,
  isCompileInputPath,
  isPublishableFolderPath,
  isRemixedFolderPath,
  publishableFolderFiles,
} from "./folder";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "@/lib/apps/npm/paths";

const kind = (p: string) => {
  const c = classifyFolderPath(p);
  return c.ok ? c.kind : null;
};

describe("qué rutas son de la carpeta", () => {
  it("los ficheros de un proyecto estático, en cualquier carpeta y en la raíz", () => {
    for (const p of [
      "/js/app.js",
      "/js/lib/util.mjs",
      "/css/site.css",
      "/data/menu.json",
      "/sw.js",
      "/manifest.json",
      "/app.webmanifest",
      "/robots.txt",
      "/img/logo.svg",
      "/README.md",
      "/app.js",
      "/style.css",
    ]) {
      expect(kind(p), p).toBe("web");
    }
  });

  it("las pruebas y su configuración se guardan y NO se publican", () => {
    expect(kind("/tests/carrito.spec.ts")).toBe("tests");
    expect(kind("/tests/helpers/login.ts")).toBe("tests");
    expect(kind("/playwright.config.ts")).toBe("tests");
    // Plan 04: una prueba de vitest de una app (con JSX) también puede vivir en /tests.
    expect(kind("/tests/Carrito.test.tsx")).toBe("tests");
    expect(kind("/tests/Lista.test.jsx")).toBe("tests");
    expect(isPublishableFolderPath("/tests/carrito.spec.ts")).toBe(false);
  });

  it("/supabase sigue con sus reglas y no se publica", () => {
    expect(kind("/supabase/migrations/20261004120000_init.sql")).toBe("supabase");
    expect(isPublishableFolderPath("/supabase/migrations/20261004120000_init.sql")).toBe(false);
  });

  it("🔴 las páginas no son de la carpeta: siguen por su camino", () => {
    expect(kind("/index.html")).toBeNull();
    expect(kind("/menu/index.html")).toBeNull();
    expect(kind("/js/index.html")).toBeNull();
  });

  it("🔴 rechaza lo que Caddy sirve de otro sitio o es de la plataforma, con su motivo", () => {
    for (const p of [
      "/assets/x.js",
      "/api/x.json",
      "/c/x.js",
      "/uploads/a.svg",
      "/rest/v1.json",
      "/auth/x.js",
      "/memoria/x.md",
      "/ajustes/x.json",
      "/.openlen/x.json",
      "/tmp/x.js",
      "/AGENTS.md",
    ]) {
      const c = classifyFolderPath(p);
      expect(c.ok, p).toBe(false);
      if (!c.ok) expect(c.reason, p).toMatch(/reserved|platform|hidden/);
    }
  });

  it("🔴 rechaza `..`, rutas vacías o sin barra y lo que es de git o de Len", () => {
    for (const p of [
      "/js/../index.html",
      "/js/./app.js",
      "/js//app.js",
      "/js/app.js/",
      "js/app.js",
      "/.git/config",
      "/.git",
      "/.len/memory/x.md",
      "/js/a.js",
      `/${"a/".repeat(32)}x.js`,
      `/${"x".repeat(1025)}.js`,
    ]) {
      expect(classifyFolderPath(p).ok, p).toBe(false);
    }
  });

  it("como en un disco (spec local 2026-10-28): cualquier fichero, ocultos, espacios y rutas largas", () => {
    // Las extensiones web siguen siendo "web"; todo lo demás es "file".
    for (const p of ["/logo.png", "/fonts/x.woff2", "/js/app.py", "/doc/guia.pdf", "/data/x.bin", "/video/intro.mp4", "/app.wasm"]) {
      expect(kind(p), p).toBe("file");
      expect(isPublishableFolderPath(p), p).toBe(true);
    }
    for (const p of ["/.envrc", "/js/.secreto.js", "/.well-known/security.txt", "/.gitignore", "/js/a b.js", `/${"a/".repeat(31)}x.js`, `/${"x".repeat(1000)}.js`]) {
      expect(classifyFolderPath(p).ok, p).toBe(true);
    }
    expect(kind("/.well-known/security.txt")).toBe("web");
  });

  it("un .html que no es una página es un fichero y se publica tal cual", () => {
    expect(kind("/legal.html")).toBe("file");
    expect(kind("/blog/post/index.html")).toBe("file");
    expect(kind("/docs/a.htm")).toBe("file");
    expect(isPublishableFolderPath("/legal.html")).toBe(true);
  });

  it("los fuentes de una app (.jsx, .tsx, .ts) son de la carpeta y se publican; se sirven como JavaScript", () => {
    // Spec local 2026-10-07-apps: se guardan como se escriben y salen compilados.
    for (const p of ["/src/App.jsx", "/src/App.tsx", "/src/lib/util.ts", "/js/app.ts"]) {
      expect(kind(p), p).toBe("web");
      expect(isPublishableFolderPath(p), p).toBe(true);
      expect(contentTypeFor(p), p).toBe("text/javascript; charset=utf-8");
    }
    // Las pruebas siguen siendo pruebas: /tests/ manda sobre la extensión.
    expect(kind("/tests/app.spec.ts")).toBe("tests");
  });

  it("🔴 /openlen/ es de la plataforma: ahí se sirven las dependencias de las apps", () => {
    const c = classifyFolderPath("/openlen/vendor/2026-10/react.js");
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toMatch(/\/openlen\/ is reserved/);
  });
});

describe("cuánto cabe", () => {
  const vacio = new Map<string, string>();

  const blob = (size: number) => makePointer({ sha256: "a".repeat(64), size, gitOid: "b".repeat(40) });

  it("un fichero de más de 50 MB no; uno de 50 MB, sí", () => {
    expect(folderSaveProblem("/video/big.mp4", blob(MAX_FILE_BYTES + 1), vacio)).toMatch(/File too large: \/video\/big\.mp4 .* the maximum is 50 MB/);
    expect(folderSaveProblem("/video/ok.mp4", blob(MAX_FILE_BYTES), vacio)).toBeNull();
    expect(folderSaveProblem("/data/ok.json", "x".repeat(2 * 1024 * 1024), vacio)).toBeNull();
  });

  it("una prueba de más de 256 KiB no", () => {
    expect(folderSaveProblem("/tests/a.spec.ts", "x".repeat(256 * 1024 + 1), vacio)).toMatch(/256 KB/);
  });

  it("🔴 lleno = ENOSPC, como un disco: el fichero 20.001 o pasar de 1 GB; sustituir uno no cuenta doble", () => {
    const llenos = new Map(Array.from({ length: MAX_PROJECT_FILES }, (_, i) => [`/data/${i}.json`, "{}"] as const));
    expect(folderSaveProblem("/data/otro.json", "{}", llenos)).toBe("ENOSPC: no space left on device, write '/data/otro.json'");
    expect(folderSaveProblem("/data/0.json", '{"a":1}', llenos)).toBeNull();
    const pesados = new Map(Array.from({ length: 21 }, (_, i) => [`/v/${i}.mp4`, blob(Math.floor(MAX_PROJECT_BYTES / 21))] as const));
    expect(folderSaveProblem("/v/mas.mp4", blob(MAX_FILE_BYTES), pesados)).toMatch(/^ENOSPC/);
    expect(folderSaveProblem("/v/0.mp4", blob(1), pesados)).toBeNull();
  });

  it("con el uso del proyecto entero (páginas e historial de git), cuenta ése", () => {
    expect(folderSaveProblem("/a.png", blob(10), vacio, MAX_PROJECT_BYTES - 5)).toMatch(/^ENOSPC/);
    expect(folderSaveProblem("/a.png", blob(10), vacio, MAX_PROJECT_BYTES - 10)).toBeNull();
    // Sustituir: el uso ya incluye el fichero de antes.
    const uno = new Map([["/a.png", blob(10)]]);
    expect(folderSaveProblem("/a.png", blob(12), uno, MAX_PROJECT_BYTES - 2)).toBeNull();
    expect(folderSaveProblem("/a.png", blob(12), uno, MAX_PROJECT_BYTES - 1)).toMatch(/^ENOSPC/);
  });

  it("una migración sigue con su tope de /supabase", () => {
    expect(folderSaveProblem("/supabase/migrations/1_a.sql", "x".repeat(256 * 1024 + 1), vacio)).toMatch(/256 KB/);
  });
});

describe("lo que se publica", () => {
  it("todo lo que no es reservado, pruebas, /supabase ni manifiesto, sin la barra, en orden", () => {
    const files = {
      "/img/logo.png": "￿openlen-blob:" + "a".repeat(64) + ":3:" + "b".repeat(40),
      "/js/b.js": "b",
      "/tests/a.spec.ts": "t",
      "/supabase/migrations/1_a.sql": "s",
      "/a.css": "a",
      "/assets/x.js": "x",
    };
    expect(publishableFolderFiles(files)).toEqual([
      { path: "a.css", content: "a" },
      { path: "img/logo.png", content: files["/img/logo.png"] },
      { path: "js/b.js", content: "b" },
    ]);
  });

  it("cada uno con su tipo, como lo sirve un servidor de estáticos", () => {
    expect(contentTypeFor("/js/app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("/js/app.mjs")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("/app.webmanifest")).toBe("application/manifest+json; charset=utf-8");
    expect(contentTypeFor("/manifest.json")).toBe("application/json; charset=utf-8");
    expect(contentTypeFor("/img/a.svg")).toBe("image/svg+xml; charset=utf-8");
    expect(contentTypeFor("/css/a.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("/a.md")).toBe("text/markdown; charset=utf-8");
    expect(contentTypeFor("/robots.txt")).toBe("text/plain; charset=utf-8");
    expect(contentTypeFor("/img/a.png")).toBe("image/png");
    expect(contentTypeFor("/img/a.JPG")).toBe("image/jpeg");
    expect(contentTypeFor("/fonts/x.woff2")).toBe("font/woff2");
    expect(contentTypeFor("/doc/a.pdf")).toBe("application/pdf");
    expect(contentTypeFor("/app.wasm")).toBe("application/wasm");
    expect(contentTypeFor("/v/a.mp4")).toBe("video/mp4");
    expect(contentTypeFor("/legal.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("/data/x.bin")).toBe("application/octet-stream");
    expect(contentTypeFor("/Makefile")).toBe("application/octet-stream");
  });
});

// LA LISTA DE RESERVADAS SIGUE AL CADDYFILE. Un `handle` que Caddy pasa a Next o
// sirve de otra carpeta en el host de la página tapa cualquier fichero de la
// carpeta con esa raíz: si alguien añade uno (Storage, funciones…) y nadie lo
// pone aquí, Len guardaría ficheros que ningún visitante verá.
describe("🔴 las reservadas cubren cada handle del bloque de las páginas", () => {
  const caddy = readFileSync(join(import.meta.dirname, "..", "..", "..", "infra", "caddy", "Caddyfile"), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
  const i = caddy.indexOf("\n*.openlen.app {");
  const bloque = caddy.slice(i, caddy.indexOf("\n}\n", i));
  const raices = [...bloque.matchAll(/handle(?:_path)? \/([^/\s{*]+)/g)].map((m) => m[1]!);

  it("hay handles que mirar", () => expect(raices.length).toBeGreaterThan(5));
  for (const r of new Set(raices)) it(`/${r}/`, () => expect(RESERVED_ROOTS).toContain(r));
});

describe("LEN.md (plans/len-md): no es de la carpeta", () => {
  it("🔴 /LEN.md y /home no son de la carpeta: LEN.md nunca se publica", () => {
    expect(classifyFolderPath("/LEN.md").ok).toBe(false);
    expect(isPublishableFolderPath("/LEN.md")).toBe(false);
    expect(classifyFolderPath("/home/user/notas.md").ok).toBe(false);
  });
});

describe("/.env (spec local 2026-10-10-variables-de-entorno)", () => {
  it("sólo /.env es de la carpeta: se guarda, entra a compilar y NO se publica", () => {
    expect(kind("/.env")).toBe("env");
    expect(isPublishableFolderPath("/.env")).toBe(false);
    expect(isCompileInputPath("/.env")).toBe(true);
    expect(isCompileInputPath("/js/app.js")).toBe(true);
    expect(isCompileInputPath("/tests/a.test.ts")).toBe(false);
    expect(publishableFolderFiles({ "/.env": "VITE_A=1", "/js/a.js": "x" })).toEqual([{ path: "js/a.js", content: "x" }]);
  });

  it("🔴 los demás .env* se rechazan diciendo qué hacer", () => {
    for (const p of ["/.env.local", "/.env.production", "/.env.development", "/src/.env"]) {
      const c = classifyFolderPath(p);
      expect(c.ok, p).toBe(false);
      if (!c.ok) expect(c.reason, p).toMatch(/only \/\.env is/);
    }
  });

  it("lo que no vale de /.env se dice al guardar", () => {
    expect(folderSaveProblem("/.env", "VITE_A=1\n", new Map())).toBeNull();
    expect(folderSaveProblem("/.env", "SECRET=1\n", new Map())).toMatch(/would never reach the app/);
  });
});

describe("package.json and the esm lock", () => {
  it("package.json is a manifest: saved, compiled as input, never published", () => {
    expect(classifyFolderPath(PACKAGE_JSON_PATH)).toEqual({ ok: true, kind: "manifest" });
    expect(isPublishableFolderPath(PACKAGE_JSON_PATH)).toBe(false);
    expect(isCompileInputPath(PACKAGE_JSON_PATH)).toBe(true);
  });

  it("the lock belongs to the platform (read-only for Len) but is a compile input", () => {
    expect(classifyFolderPath(ESM_LOCK_PATH).ok).toBe(false);
    expect(isCompileInputPath(ESM_LOCK_PATH)).toBe(true);
    expect(isPublishableFolderPath(ESM_LOCK_PATH)).toBe(false);
  });

  it("/node_modules is npm's, read-only: nothing is saved there, and the reason says how packages get in", () => {
    const c = classifyFolderPath("/node_modules/leaflet/dist/leaflet.js");
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toMatch(/npm's and read-only; packages are installed with npm install/);
    expect(classifyFolderPath("/src/node_modules.ts").ok).toBe(true);
  });

  it("a package.json that isn't a JSON object is not saved, with the reason", () => {
    expect(folderSaveProblem(PACKAGE_JSON_PATH, "{ broken", new Map())).toMatch(/not valid JSON/);
    expect(folderSaveProblem(PACKAGE_JSON_PATH, "[1, 2]", new Map())).toMatch(/must be a JSON object/);
    expect(folderSaveProblem(PACKAGE_JSON_PATH, '{"dependencies":{}}', new Map())).toBeNull();
  });
});

describe("what a remix takes", () => {
  it("what the published site shows, plus package.json and the lock (without them a remixed app doesn't compile)", () => {
    expect(isRemixedFolderPath("/src/App.tsx")).toBe(true);
    expect(isRemixedFolderPath(PACKAGE_JSON_PATH)).toBe(true);
    expect(isRemixedFolderPath(ESM_LOCK_PATH)).toBe(true);
    expect(isRemixedFolderPath("/tests/a.spec.ts")).toBe(false);
    expect(isRemixedFolderPath("/.env")).toBe(false);
    expect(isRemixedFolderPath("/supabase/migrations/1_a.sql")).toBe(false);
  });
});
