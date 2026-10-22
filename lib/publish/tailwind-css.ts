import postcss from "postcss";
import tailwindcss from "tailwindcss";
import type {TwDarkMode} from "./tw-config";
import type {FuenteDeClases} from "./bake-tailwind";
const TAILWIND_INPUT = "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n";

/** Las hojas de la app traen su `@tailwind base` (lo copian de Vite); el horneado
 *  ya lo pone una vez en `TAILWIND_INPUT`, y dos veces duplicaría el preflight. */
function sinDirectivasTailwind(css: string): string {
  return css.replace(/@tailwind\s+[\w-]+\s*;?/g, "");
}

export async function generateTailwindCss(
  html: string,
  extend: Record<string, unknown> = {},
  fuentes: readonly FuenteDeClases[] = [],
  stylesheets: readonly string[] = [],
  darkMode: TwDarkMode | null = null,
): Promise<string> {
  const entrada = [TAILWIND_INPUT, ...stylesheets.map(sinDirectivasTailwind)].join("\n");
  const result = await postcss([
    tailwindcss({
      content: [{ raw: html, extension: "html" }, ...fuentes.map((f) => ({ raw: f.raw, extension: f.extension }))],
      theme: { extend },
      ...(darkMode ? { darkMode } : {}),
      plugins: [],
      corePlugins: { preflight: true },
    } as Parameters<typeof tailwindcss>[0]),
    // Sin mapas: PostCSS cargaría del disco del servidor el «anterior» que nombre un
    // `sourceMappingURL` de la hoja (que escriben el modelo o el dueño), y nada aquí los usa.
  ]).process(entrada, { from: undefined, map: false });

  // El CSS va dentro de un `<style>` del documento: un `</style>` de la hoja
  // (en un comentario, en un `content:`) lo cerraría y el resto saldría como
  // HTML. En el lienzo no pasa (va por `textContent`). `<\/style` es el mismo
  // texto para CSS —en un comentario o en una cadena, `\/` es `/`—.
  return result.css.replace(/<\/(style)/gi, "<\\/$1");
}
