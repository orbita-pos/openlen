// Sin regla en Caddy, /api/d/* NO da error: la petición cae en `try_files` y se
// sirve la HOME estática. El `fetch` del modelo recibe HTML donde espera JSON, y
// el fallo es MUDO (ver memoria caddy-broken-links-serve-home; el propio
// Caddyfile lo documenta en el handle de /api/chat/*).
//
// Por eso el Caddyfile es parte de esta feature y tiene su prueba.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const caddy = readFileSync(join(process.cwd(), "infra", "caddy", "Caddyfile"), "utf8");

describe("Caddy reenvía los datos libres a Node", () => {
  // Lo que de verdad decide si llega a Node: sin `handle`, try_files sirve la
  // HOME. Es la única de las dos comprobaciones que evita el fallo mudo.
  it("hay un handle que lo reenvía a Next", () => {
    const bloque = caddy.match(/handle \/api\/d\/\*\s*\{[\s\S]{0,220}?\n\t\}/);
    expect(bloque, "falta el handle /api/d/*").not.toBeNull();
    expect(bloque![0]).toContain("reverse_proxy 127.0.0.1:3000");
  });

  // Y que no se cachee: `@doc` le pone un s-maxage público a todo lo que no
  // excluya, y Cloudflare guardaría en el borde la respuesta de un visitante
  // para servírsela a otro. En un almacén `propio` eso es servir el carrito de
  // alguien a un desconocido.
  it("está excluido de la caché pública", () => {
    const linea = caddy
      .split("\n")
      .find((l) => l.includes("not path") && l.includes("/api/f/*"));
    expect(linea, "no encuentro la línea de exclusión de @doc").toBeDefined();
    expect(linea).toContain("/api/d/*");
  });
});
