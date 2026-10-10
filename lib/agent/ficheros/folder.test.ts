// LA CARPETA DEL PROYECTO (pieza 9 de plans/len-agente-2026/plan-2-5): qué
// rutas valen, de qué clase son, cuánto cabe y qué se publica.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_FOLDER_BYTES,
  MAX_FOLDER_FILE_BYTES,
  MAX_FOLDER_FILES,
  RESERVED_ROOTS,
  classifyFolderPath,
  contentTypeFor,
  folderSaveProblem,
  isPublishableFolderPath,
  publishableFolderFiles,
} from "./folder";

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

  it("🔴 rechaza `..`, dotfiles, extensiones de fuera y rutas raras", () => {
    for (const p of [
      "/js/../index.html",
      "/.env",
      "/js/.secreto.js",
      "/logo.png",
      "/js/app.py",
      "/fuente.woff2",
      "/js//app.js",
      "/js/app.js/",
      "js/app.js",
      "/js/a b.js",
      `/${"a/".repeat(9)}x.js`,
      `/${"x".repeat(201)}.js`,
    ]) {
      expect(classifyFolderPath(p).ok, p).toBe(false);
    }
  });

  it("el motivo de una extensión de fuera nombra las que valen (es lo que lee Len)", () => {
    const c = classifyFolderPath("/logo.png");
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toContain(".js .mjs .jsx .tsx .ts .css .json .webmanifest .txt .svg .md");
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

  it("un fichero de más de 1 MiB no", () => {
    expect(folderSaveProblem("/data/big.json", "x".repeat(MAX_FOLDER_FILE_BYTES + 1), vacio)).toMatch(/1024 KB/);
    expect(folderSaveProblem("/data/ok.json", "x".repeat(MAX_FOLDER_FILE_BYTES), vacio)).toBeNull();
  });

  it("una prueba de más de 256 KiB no", () => {
    expect(folderSaveProblem("/tests/a.spec.ts", "x".repeat(256 * 1024 + 1), vacio)).toMatch(/256 KB/);
  });

  it("🔴 la carpeta entera: ni más de 500 ficheros ni más de 10 MiB; sustituir uno no cuenta doble", () => {
    const llenos = new Map(Array.from({ length: MAX_FOLDER_FILES }, (_, i) => [`/data/${i}.json`, "{}"] as const));
    expect(folderSaveProblem("/data/otro.json", "{}", llenos)).toMatch(/500 files/);
    expect(folderSaveProblem("/data/0.json", '{"a":1}', llenos)).toBeNull();
    const pesados = new Map(
      Array.from({ length: 10 }, (_, i) => [`/data/${i}.json`, "x".repeat(MAX_FOLDER_BYTES / 10)] as const),
    );
    expect(folderSaveProblem("/data/mas.json", "x", pesados)).toMatch(/10 MB/);
    expect(folderSaveProblem("/data/0.json", "x", pesados)).toBeNull();
  });

  it("una migración sigue con su tope de /supabase", () => {
    expect(folderSaveProblem("/supabase/migrations/1_a.sql", "x".repeat(256 * 1024 + 1), vacio)).toMatch(/256 KB/);
  });
});

describe("lo que se publica", () => {
  it("sólo lo de la web, sin la barra, en orden", () => {
    const files = {
      "/js/b.js": "b",
      "/tests/a.spec.ts": "t",
      "/supabase/migrations/1_a.sql": "s",
      "/a.css": "a",
      "/assets/x.js": "x",
    };
    expect(publishableFolderFiles(files)).toEqual([
      { path: "a.css", content: "a" },
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
