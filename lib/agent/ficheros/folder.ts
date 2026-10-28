/**
 * LA CARPETA DEL PROYECTO (pieza 9 de plans/len-agente-2026/plan-2-5): los
 * ficheros de texto que no son páginas, como en un proyecto de Vercel +
 * Supabase — `js/`, `css/`, `data/*.json`, `sw.js`, `manifest.json`, `tests/`,
 * `supabase/`. Viven en `projectFiles` (lib/backend/files.ts).
 *
 * Esto decide, en un solo sitio, qué ruta vale, de qué CLASE es y cuánto cabe:
 *   · `web`      se publica tal cual junto a las páginas y la sirve el lienzo;
 *   · `tests`    las pruebas de Playwright (pieza 10): se guardan y viajan al exportar, no se publican; con la
 *                terminal real, `npx playwright test` las corre en la caja contra el borrador (plan local
 *                2026-10-21-playwright-in-the-box); sin ella, no se corren;
 *   · `supabase` las migraciones y funciones del backend, con sus reglas de
 *                siempre (`supabase.ts`): se guardan, no se publican;
 *   · `env`      `/.env`, sólo en la raíz (spec local 2026-10-10): lo lee el
 *                compilador para `import.meta.env`; se guarda y viaja al
 *                exportar, pero nunca se publica ni se sirve (como en Vite).
 *   · `manifest` /package.json: the app's packages (lib/apps/npm/); read by the
 *                compiler, never published.
 *
 *   · `file`     todo lo demás (spec local 2026-10-28-ficheros-al-nivel-de-claude-code): imágenes,
 *                fuentes, PDF, vídeo, `.wasm`, un `.html` que no es una página… Se publica y se sirve
 *                tal cual; un binario vive aquí como PUNTERO (`lib/files/blob.ts`).
 *
 * Cualquier carpeta vale, también la raíz, y cualquier fichero, como en un disco con Claude Code
 * encima: ocultos, espacios, cualquier extensión. Se prohíbe sólo lo que nunca se vería —lo que Caddy
 * manda a otra parte en el host de la página, atado al Caddyfile por folder.test.ts—, lo que es de la
 * plataforma, de git o de Len, y las rutas de las páginas, que siguen su camino.
 *
 * Los mensajes van en inglés: los lee el modelo, como los de Claude Code.
 * Sin imports pesados: lo prueba vitest y lo puede importar el cliente.
 */
import { esFicheroDeSupabase, motivoParaNoGuardar as supabaseSaveProblem } from "./supabase";
import { DOTENV_PATH } from "@/lib/apps/env/rules";
import { dotEnvSaveProblem } from "@/lib/apps/env/dotenv";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "@/lib/apps/npm/paths";
import { sizeOf } from "@/lib/files/blob-pointer";
import { contentTypeOf } from "@/lib/files/content-types";
import { MAX_FILE_BYTES, MAX_PATH_CHARS, MAX_PATH_DEPTH, MAX_PROJECT_BYTES, MAX_PROJECT_FILES } from "@/lib/files/limits";

export type FolderFileKind = "web" | "tests" | "supabase" | "env" | "manifest" | "file";

/** `.jsx`, `.tsx` y `.ts` son FUENTES (apps web, spec local 2026-10-07-apps):
 *  se guardan como se escriben y se sirven y publican COMPILADOS a JavaScript,
 *  en su misma ruta (`lib/apps/compilador.ts`). */
export const WEB_EXTENSIONS = [".js", ".mjs", ".jsx", ".tsx", ".ts", ".css", ".json", ".webmanifest", ".txt", ".svg", ".md"] as const;
// `.tsx` y `.jsx`: las pruebas de vitest de una app (plan 04) también pueden vivir aquí.
const TEST_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".md", ".txt"] as const;

export const MAX_TEST_FILE_BYTES = 256 * 1024;

/** Primeras carpetas que no pueden ser del proyecto. Las de la primera línea
 *  son cada `handle` del bloque `*.openlen.app` del Caddyfile —un fichero ahí
 *  nunca se vería: Caddy contesta esa ruta con otra cosa— más las rutas de
 *  Supabase que vienen (`storage`, `functions`, `realtime`) y `openlen`, donde
 *  la plataforma sirve las dependencias de las apps (`lib/apps/dependencias.ts`);
 *  las de la segunda, las carpetas de Len y de su terminal. */
export const RESERVED_ROOTS: readonly string[] = [
  "api", "c", "assets", "uploads", "rest", "auth", "storage", "functions", "realtime", "ai", "email", "openlen",
  "memoria", "ajustes", "tmp", "bin", "usr", "dev", "proc", "home",
];
/** Ficheros sueltos que no son de la carpeta: el manual de Len y el LEN.md
 *  del proyecto (su memoria, `len-md.ts`), que con `.md` se PUBLICARÍA. */
const RESERVED_FILES: readonly string[] = ["/AGENTS.md", "/LEN.md"];
/** Las carpetas ocultas que no son del proyecto: el git de Len (que no es un fichero de la carpeta, como
 *  en un repo) y la de Len (su memoria, sus skills). `.openlen` es de la plataforma, aparte. */
const HIDDEN_ROOTS: readonly string[] = [".git", ".len"];
const PLAYWRIGHT_CONFIG = /^\/playwright\.config\.(?:ts|js|mjs)$/;
/** Un trozo de ruta, como en un disco: cualquier cosa menos vacío, `.`, `..`, una barra invertida o
 *  caracteres de control. */
const SEGMENT_PROBLEM = /[\u0000-\u001f\u007f\\]/;
/** Las rutas de las páginas, `/index.html` y `/<slug>/index.html`: son del motor de páginas. */
const PAGE_PATH = /^\/(?:[^/]+\/)?index\.html$/;

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
  // OPEN NPM: /node_modules is what npm installs, read-only (`lib/apps/npm/node-modules.ts`).
  if (segments[0] === "node_modules") {
    return { ok: false, reason: `${path}: /node_modules is npm's and read-only; packages are installed with npm install, or by importing them.` };
  }
  // EL `.env` DE VITE (spec local 2026-10-10): sólo `/.env`, en la raíz. Los
  // demás `.env*` se rechazan con el porqué: aquí no hay modos que los elijan.
  if (path === DOTENV_PATH) return { ok: true, kind: "env" };
  // OPEN NPM (spec 2026-10-13): /package.json, only at the root, like in Vite.
  if (path === PACKAGE_JSON_PATH) return { ok: true, kind: "manifest" };
  if (/^\.env(?:\..+)?$/.test(segments[segments.length - 1] ?? "")) {
    return {
      ok: false,
      reason: `${path} is not read: only ${DOTENV_PATH} is, and the canvas and the published app run the same build. For a value that differs between draft and production, the owner sets it in the project's Environment variables.`,
    };
  }
  if (
    !path.startsWith("/") ||
    path.length > MAX_PATH_CHARS ||
    segments.length > MAX_PATH_DEPTH ||
    !segments.every((s) => s !== "" && s !== "." && s !== ".." && !SEGMENT_PROBLEM.test(s))
  ) {
    return {
      ok: false,
      reason: `${path} is not a valid file path: no empty, "." or ".." parts, backslashes or control characters, up to ${MAX_PATH_DEPTH} levels and ${MAX_PATH_CHARS} characters.`,
    };
  }
  if (HIDDEN_ROOTS.includes(segments[0]!)) {
    return { ok: false, reason: `${path}: /${segments[0]} is not part of the project's files (${segments[0] === ".git" ? "it is git's own folder" : "it is Len's"}).` };
  }
  if (PAGE_PATH.test(path)) {
    return { ok: false, reason: `${path} is a page: pages are /index.html and /<slug>/index.html.` };
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
  return { ok: true, kind: "file" };
}

export function isFolderPath(path: string): boolean {
  return classifyFolderPath(path).ok;
}

export function isPublishableFolderPath(path: string): boolean {
  const c = classifyFolderPath(path);
  return c.ok && (c.kind === "web" || c.kind === "file");
}

/** Lo que entra a CONSTRUIR el sitio: lo que se publica, `/.env`, que el
 *  compilador lee para `import.meta.env` (lib/apps/compilador.ts), y
 *  `/package.json` con el lock de esm.sh (lib/apps/npm/), que dicen de dónde sale
 *  cada paquete. Ninguno de los tres se escribe en la release
 *  (`publishableFolderFiles` sólo deja la web). */
export function isCompileInputPath(path: string): boolean {
  return path === DOTENV_PATH || path === PACKAGE_JSON_PATH || path === ESM_LOCK_PATH || isPublishableFolderPath(path);
}

/** What a REMIX takes (lib/backend/files.ts): what the published site already
 *  shows, plus /package.json and the esm lock — without them a remixed app
 *  doesn't compile. Not the tests, /.env or /supabase: those stay the author's. */
export function isRemixedFolderPath(path: string): boolean {
  return path === PACKAGE_JSON_PATH || path === ESM_LOCK_PATH || isPublishableFolderPath(path);
}

/** Lleno, como lo dice un disco (spec local 2026-10-28, §4). */
export const enospc = (path: string) => `ENOSPC: no space left on device, write '${path}'`;

/** Por qué no se guarda, o `null` si cabe. `existing` es la carpeta de AHORA:
 *  sustituir un fichero no lo cuenta dos veces. `usage`, si se sabe, es lo que ocupa el proyecto
 *  entero —páginas, carpeta e historial de git (`lib/files/quota.ts`)— con el fichero de antes dentro;
 *  sin él, cuenta sólo la carpeta. */
export function folderSaveProblem(path: string, content: string, existing: ReadonlyMap<string, string>, usage?: number): string | null {
  const c = classifyFolderPath(path);
  if (!c.ok) return c.reason;
  // Invariante 4: el marcador del editor no entra en un .html de la carpeta, como en una página.
  if (/\.html?$/i.test(path) && content.includes("data-slot-path=")) return `${path}: data-slot-path is reserved for OpenLen's editor and can't be saved.`;
  const creates = !existing.has(path);
  if (c.kind === "manifest") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return `${path} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return `${path} must be a JSON object, like npm's.`;
  }
  if (c.kind === "supabase") {
    const supabaseCount = [...existing.keys()].filter(esFicheroDeSupabase).length;
    const problem = supabaseSaveProblem(path, content, supabaseCount, creates);
    if (problem) return `Cannot save ${problem}`;
  } else if (c.kind === "env") {
    const problem = dotEnvSaveProblem(content);
    if (problem) return problem;
  } else if (c.kind === "tests") {
    if (sizeOf(content) > MAX_TEST_FILE_BYTES) return `${path} is larger than ${MAX_TEST_FILE_BYTES / 1024} KB.`;
  } else if (sizeOf(content) > MAX_FILE_BYTES) {
    return `File too large: ${path} is ${(sizeOf(content) / 1024 / 1024).toFixed(1)} MB, the maximum is ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
  }
  if (creates && existing.size >= MAX_PROJECT_FILES) return enospc(path);
  const before = existing.has(path) ? sizeOf(existing.get(path)!) : 0;
  let total: number;
  if (usage !== undefined) total = usage - before + sizeOf(content);
  else {
    total = sizeOf(content);
    for (const [p, t] of existing) if (p !== path) total += sizeOf(t);
  }
  if (total > MAX_PROJECT_BYTES) return enospc(path);
  return null;
}

/** Lo que se publica, en el formato del árbol de la release: sin la barra y en orden. */
export function publishableFolderFiles(files: Readonly<Record<string, string>>): Array<{ path: string; content: string }> {
  return Object.keys(files)
    .filter(isPublishableFolderPath)
    .sort()
    .map((p) => ({ path: p.slice(1), content: files[p]! }));
}

const TEXT_CONTENT_TYPES: Readonly<Record<string, string>> = {
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

/** El tipo con el que se sirve, como lo haría un servidor de estáticos: el de la web con su charset,
 *  y cualquier otro por su extensión (`lib/files/content-types.ts`). */
export function contentTypeFor(path: string): string {
  const text = TEXT_CONTENT_TYPES[extensionOf(path)];
  if (text) return `${text}; charset=utf-8`;
  return contentTypeOf(path);
}
