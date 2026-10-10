/**
 * LA CARPETA DEL PROYECTO (pieza 9 de plans/len-agente-2026/plan-2-5): los
 * ficheros de texto que no son páginas, como en un proyecto de Vercel +
 * Supabase — `js/`, `css/`, `data/*.json`, `sw.js`, `manifest.json`, `tests/`,
 * `supabase/`. Viven en `projectFiles` (lib/backend/files.ts).
 *
 * Esto decide, en un solo sitio, qué ruta vale, de qué CLASE es y cuánto cabe:
 *   · `web`      se publica tal cual junto a las páginas y la sirve el lienzo;
 *   · `tests`    las pruebas de Playwright (pieza 10): se guardan y viajan al exportar, no se publican ni se corren aquí;
 *   · `supabase` las migraciones y funciones del backend, con sus reglas de
 *                siempre (`supabase.ts`): se guardan, no se publican.
 *
 * Cualquier carpeta vale, también la raíz, como en Vercel: el modelo escribe
 * `/app.js` y `/style.css` por costumbre, y OpenLen se adapta a Len. Se prohíbe
 * sólo lo que nunca se vería —lo que Caddy manda a otra parte en el host de la
 * página, atado al Caddyfile por folder.test.ts— y lo que es de la plataforma.
 *
 * Los mensajes van en inglés: los lee el modelo, como los de Claude Code.
 * Sin imports pesados: lo prueba vitest y lo puede importar el cliente.
 */
import { esFicheroDeSupabase, motivoParaNoGuardar as supabaseSaveProblem } from "./supabase";

export type FolderFileKind = "web" | "tests" | "supabase";

/** `.jsx`, `.tsx` y `.ts` son FUENTES (apps web, spec local 2026-10-07-apps):
 *  se guardan como se escriben y se sirven y publican COMPILADOS a JavaScript,
 *  en su misma ruta (`lib/apps/compilador.ts`). */
export const WEB_EXTENSIONS = [".js", ".mjs", ".jsx", ".tsx", ".ts", ".css", ".json", ".webmanifest", ".txt", ".svg", ".md"] as const;
// `.tsx` y `.jsx`: las pruebas de vitest de una app (plan 04) también pueden vivir aquí.
const TEST_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".md", ".txt"] as const;

export const MAX_FOLDER_FILE_BYTES = 1024 * 1024;
export const MAX_TEST_FILE_BYTES = 256 * 1024;
export const MAX_FOLDER_BYTES = 10 * 1024 * 1024;
export const MAX_FOLDER_FILES = 500;
const MAX_PATH_LENGTH = 200;
const MAX_DEPTH = 8;

/** Primeras carpetas que no pueden ser del proyecto. Las de la primera línea
 *  son cada `handle` del bloque `*.openlen.app` del Caddyfile —un fichero ahí
 *  nunca se vería: Caddy contesta esa ruta con otra cosa— más las rutas de
 *  Supabase que vienen (`storage`, `functions`, `realtime`) y `openlen`, donde
 *  la plataforma sirve las dependencias de las apps (`lib/apps/dependencias.ts`);
 *  las de la segunda, las carpetas de Len y de su terminal. */
export const RESERVED_ROOTS: readonly string[] = [
  "api", "c", "assets", "uploads", "rest", "auth", "storage", "functions", "realtime", "openlen",
  "memoria", "ajustes", "tmp", "bin", "usr", "dev", "proc", "home",
];
/** Ficheros sueltos que no son de la carpeta: el manual de Len y el LEN.md
 *  del proyecto (su memoria, `len-md.ts`), que con `.md` se PUBLICARÍA. */
const RESERVED_FILES: readonly string[] = ["/AGENTS.md", "/LEN.md"];
const PLAYWRIGHT_CONFIG = /^\/playwright\.config\.(?:ts|js|mjs)$/;
/** Un trozo de ruta: letras, dígitos, `-`, `_` y `.`, sin empezar por punto
 *  (ni ficheros ocultos ni `..`). */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

export type FolderPathClass = { readonly ok: true; readonly kind: FolderFileKind } | { readonly ok: false; readonly reason: string };

export function classifyFolderPath(path: string): FolderPathClass {
  if (esFicheroDeSupabase(path)) return { ok: true, kind: "supabase" };
  const segments = path.split("/").slice(1);
  if (RESERVED_FILES.includes(path) || segments[0] === ".openlen") {
    return { ok: false, reason: `${path} belongs to the platform and is read-only.` };
  }
  if (
    !path.startsWith("/") ||
    path.length > MAX_PATH_LENGTH ||
    segments.length > MAX_DEPTH ||
    !segments.every((s) => SEGMENT.test(s))
  ) {
    return {
      ok: false,
      reason: `${path} is not a valid file path: use /folder/name.ext with letters, digits, "-", "_" and ".", no hidden files or "..", up to ${MAX_DEPTH} levels and ${MAX_PATH_LENGTH} characters.`,
    };
  }
  if (extensionOf(path) === ".html" || extensionOf(path) === ".htm") {
    return { ok: false, reason: `${path}: pages are /index.html and /<slug>/index.html; other HTML files are not part of the site.` };
  }
  if (RESERVED_ROOTS.includes(segments[0]!) && segments.length > 1) {
    return {
      ok: false,
      reason: `/${segments[0]}/ is reserved: the published site answers that path with something else, so a file there would never be seen. Use another folder (for example /js, /css, /data).`,
    };
  }
  if (segments[0] === "tests" || PLAYWRIGHT_CONFIG.test(path)) {
    if ((TEST_EXTENSIONS as readonly string[]).includes(extensionOf(path))) return { ok: true, kind: "tests" };
    return { ok: false, reason: `${path}: test files are ${TEST_EXTENSIONS.join(" ")}.` };
  }
  if ((WEB_EXTENSIONS as readonly string[]).includes(extensionOf(path))) return { ok: true, kind: "web" };
  return {
    ok: false,
    reason: `${path}: the project's folder holds text files only (${WEB_EXTENSIONS.join(" ")}); pages are /index.html and /<slug>/index.html, and images are uploaded, not written.`,
  };
}

export function isFolderPath(path: string): boolean {
  return classifyFolderPath(path).ok;
}

export function isPublishableFolderPath(path: string): boolean {
  const c = classifyFolderPath(path);
  return c.ok && c.kind === "web";
}

function bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/** Por qué no se guarda, o `null` si cabe. `existing` es la carpeta de AHORA:
 *  sustituir un fichero no lo cuenta dos veces. */
export function folderSaveProblem(path: string, content: string, existing: ReadonlyMap<string, string>): string | null {
  const c = classifyFolderPath(path);
  if (!c.ok) return c.reason;
  const creates = !existing.has(path);
  if (c.kind === "supabase") {
    const supabaseCount = [...existing.keys()].filter(esFicheroDeSupabase).length;
    const problem = supabaseSaveProblem(path, content, supabaseCount, creates);
    if (problem) return `Cannot save ${problem}`;
  } else {
    const max = c.kind === "tests" ? MAX_TEST_FILE_BYTES : MAX_FOLDER_FILE_BYTES;
    if (bytes(content) > max) return `${path} is larger than ${max / 1024} KB.`;
  }
  if (creates && existing.size >= MAX_FOLDER_FILES) return `the project's folder already has ${MAX_FOLDER_FILES} files.`;
  let total = bytes(content);
  for (const [p, t] of existing) if (p !== path) total += bytes(t);
  if (total > MAX_FOLDER_BYTES) return `the project's folder would go over ${MAX_FOLDER_BYTES / 1024 / 1024} MB.`;
  return null;
}

/** Lo que se publica, en el formato del árbol de la release: sin la barra y en orden. */
export function publishableFolderFiles(files: Readonly<Record<string, string>>): Array<{ path: string; content: string }> {
  return Object.keys(files)
    .filter(isPublishableFolderPath)
    .sort()
    .map((p) => ({ path: p.slice(1), content: files[p]! }));
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  // Los fuentes se sirven COMPILADOS: un <script type="module"> exige un tipo
  // de JavaScript, y con `text/plain` el navegador no lo ejecuta.
  ".jsx": "text/javascript",
  ".tsx": "text/javascript",
  ".ts": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain",
  ".svg": "image/svg+xml",
  ".md": "text/markdown",
};

/** El tipo con el que se sirve, como lo haría un servidor de estáticos. */
export function contentTypeFor(path: string): string {
  return `${CONTENT_TYPES[extensionOf(path)] ?? "text/plain"}; charset=utf-8`;
}
