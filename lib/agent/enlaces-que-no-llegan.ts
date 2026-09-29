// lib/agent/enlaces-que-no-llegan.ts — el enlace que lleva a la portada en vez de a su sitio.
//
// 🔴 EL FALLO QUE CIERRA ES MUDO. En una página publicada, cualquier ruta que no
// existe la contesta Caddy con la PORTADA y un 200 (`try_files`, memoria
// `caddy-broken-links-serve-home`). Así que un enlace mal escrito no da error:
// el visitante toca «Menú» y aterriza en la misma página, sin saber por qué.
// Las formas en que pasa, y que el prompt ya prohíbe en su sección ENLACES:
//   · sin esquema — `instagram.com/juan` o `@juan` es una ruta RELATIVA del sitio;
//   · con `.html` — `menu.html` no existe: la página es `/menu/index.html`, su
//     ruta es `/menu`;
//   · relativa — `menu` a secas funciona desde la portada y se rompe desde
//     cualquier otra página;
//   · `#precios` sin un `id="precios"` en la página: el botón no hace nada.
//
// Hasta hoy lo decía sólo el prompt. Ahora también un DETECTOR, la comprobación
// sin modelo que Claude Code recibe de un linter, en el mismo
// `<new-diagnostics>`. Habla del FICHERO: `diagnosticos-de-la-escritura` resta
// lo que ya venía. El ancla muerta ya la medía el render
// (`visual-quality-renderer.ts`), pero no le volvía a Len al escribir.
//
// ⚰️ LO QUE NO ESTÁ, Y POR QUÉ: «enlace a una página que el sitio no tiene». Se
// escribió y se midió el 2026-09-29 sobre 3.165 escrituras grabadas: 79 avisos,
// y en los 79 Len creaba esa página unos pasos después, en el mismo turno —
// enlaza primero y crea después—. Al escribir es ruido puro; lo que de verdad
// falla es la página que al CERRAR el turno sigue sin existir, y eso es otra
// comprobación, en otro momento.

export type EnlaceQueNoLlega =
  | { readonly tipo: "sin-esquema"; readonly href: string; readonly sugerido: string | null }
  | { readonly tipo: "con-html"; readonly href: string; readonly sugerido: string }
  | { readonly tipo: "relativa"; readonly href: string; readonly sugerido: string }
  | { readonly tipo: "ancla-muerta"; readonly href: string };

/** Los `href` de los `<a>`, con las entidades más comunes deshechas. */
function hrefsDe(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']*)["']/gi)].map((m) =>
    m[1]!.replace(/&amp;/g, "&").replace(/&#0*39;|&apos;/g, "'").trim(),
  );
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ¿Tiene la página un elemento con ese id (o ese `name`, que el navegador también honra)? */
function tieneId(html: string, id: string): boolean {
  return new RegExp(`\\s(?:id|name)\\s*=\\s*["']${escapar(id)}["']`, "i").test(html);
}

const ESQUEMA = /^[a-z][a-z0-9+.-]*:/i;
/** Parece un dominio: `instagram.com/juan`, `www.taller.mx`, `wa.me/52…`. */
const DOMINIO = /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/?#:]|$)/i;
const CON_HTML = /\.html?(?:[?#]|$)/i;

/** `/menu.html`, `menu/index.html`, `./menu.html` → `/menu`; `index.html` → `/`. */
export function rutaLimpia(href: string): string {
  const [ruta, resto = ""] = href.split(/(?=[?#])/, 2);
  const segmentos = ruta!
    .replace(/^\.?\//, "")
    .replace(/(?:^|\/)index\.html?$/i, "")
    .replace(/\.html?$/i, "")
    .split("/")
    .filter((s) => s && s !== ".");
  return `/${segmentos.join("/")}${resto}`;
}

/** Los enlaces de un documento que no llegan a donde dicen. */
export function enlacesQueNoLlegan(html: string): EnlaceQueNoLlega[] {
  const out: EnlaceQueNoLlega[] = [];
  const vistos = new Set<string>();
  for (const href of hrefsDe(html)) {
    if (vistos.has(href)) continue;
    vistos.add(href);
    // Lo que no es un enlace a un sitio: vacío, el `#` de un control, subir al principio.
    if (href === "" || href === "#" || /^#top$/i.test(href)) continue;
    if (href.startsWith("#")) {
      let id = href.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        // Un `%` suelto: se busca tal cual.
      }
      // Un id que el script crea o busca, entre comillas: no se juzga sin correrlo.
      const loNombraOtraCosa = new RegExp(`["'\`]#?${escapar(id)}["'\`]`).test(html.replace(/<a\b[^>]*>/gi, ""));
      if (!tieneId(html, id) && !loNombraOtraCosa) out.push({ tipo: "ancla-muerta", href });
      continue;
    }
    if (ESQUEMA.test(href) || href.startsWith("//") || href.startsWith("?")) continue;
    if (href.startsWith("@")) {
      out.push({ tipo: "sin-esquema", href, sugerido: null });
      continue;
    }
    if (!href.startsWith("/") && !href.startsWith(".") && DOMINIO.test(href) && !CON_HTML.test(href)) {
      out.push({ tipo: "sin-esquema", href, sugerido: `https://${href}` });
      continue;
    }
    if (CON_HTML.test(href.split(/[?#]/)[0]!)) {
      out.push({ tipo: "con-html", href, sugerido: rutaLimpia(href) });
      continue;
    }
    if (!href.startsWith("/")) out.push({ tipo: "relativa", href, sugerido: rutaLimpia(href) });
  }
  return out;
}
