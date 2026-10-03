// Sin regla en Caddy, /api/a/* NO da error: la petición cae en `try_files` y se
// sirve la HOME estática con un 200 —un `POST login` «sale bien» y nadie
// entró—. Y sin la exclusión de @doc, Cloudflare guardaría en el borde el `me`
// de una cuenta para dárselo a otro. Por eso el Caddyfile es parte de las
// cuentas y tiene su prueba, como la de /api/d (lib/page-data/caddy-contract.test.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const caddy = readFileSync(join(process.cwd(), "infra", "caddy", "Caddyfile"), "utf8");
/** El bloque de las páginas: el único que las sirve desde el 2026-09-10. */
const paginas = caddy.slice(caddy.indexOf("*.openlen.app {"), caddy.indexOf("\nlen.openlen.com {"));

describe("Caddy pasa las cuentas de la página a Next", () => {
  it("hay un handle /api/a/* en el bloque de las páginas", () => {
    expect(paginas.length).toBeGreaterThan(0);
    const bloque = paginas.match(/handle \/api\/a\/\*\s*\{[\s\S]{0,220}?\n\t\}/);
    expect(bloque, "falta el handle /api/a/*").not.toBeNull();
    expect(bloque![0]).toContain("reverse_proxy 127.0.0.1:3000");
  });

  it("está excluido de la caché pública", () => {
    const linea = paginas.split("\n").find((l) => l.includes("not path") && l.includes("/api/f/*"));
    expect(linea, "no encuentro la línea de exclusión de @doc").toBeDefined();
    expect(linea).toContain("/api/a/*");
  });
});
