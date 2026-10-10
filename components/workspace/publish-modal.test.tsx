// @vitest-environment jsdom
//
// EN UNA APP NO HAY TRADUCCIÓN AUTOMÁTICA (invariante 6 de CLAUDE.md). Visto en
// el ensayo de caja del 09/10: el diálogo de publicar ofrecía «Publica también
// en» los nueve idiomas a una app, cuyo texto vive en el código y que el
// servidor ya no traduce (`publishProject`, `localesPedidos: []`).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (clave: string) => clave }));

import { PublishModal } from "./publish-modal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function publicar(esApp: boolean) {
  const cuerpos: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/publish")) {
        cuerpos.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ subdomain: "caja", url: "https://caja.openlen.app" }), { status: 200 });
      }
      return new Response(JSON.stringify({ available: true }), { status: 200 });
    }),
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <PublishModal
        open
        onClose={() => {}}
        onSuccess={() => {}}
        project={{ id: "p1", subdomain: "caja", publishedAt: null, hasUnpublishedChanges: true, languages: ["en"], esApp }}
      />,
    ),
  );
  const texto = host.textContent ?? "";
  // El botón principal (con subdominio ya puesto dice «republicar»).
  const boton = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("publish.primary."));
  await act(async () => boton!.click());
  return { texto, cuerpos };
}

describe("el diálogo de publicar", () => {
  it("🔴 en una app no ofrece idiomas ni los manda", async () => {
    const { texto, cuerpos } = await publicar(true);
    expect(texto).not.toContain("publish.languages.title");
    expect(cuerpos).toEqual([{ subdomain: "caja" }]);
    // Y lo demás que se ve al publicarla habla de la app.
    expect(texto).toContain("publish.status.currentPageApp");
    expect(texto).toContain("publish.speedCard.measuringApp");
  });

  it("en una página, como siempre: los idiomas, y los que estaban guardados viajan", async () => {
    const { texto, cuerpos } = await publicar(false);
    expect(texto).toContain("publish.languages.title");
    expect(cuerpos).toEqual([{ subdomain: "caja", languages: ["en"] }]);
    expect(texto).not.toMatch(/currentPageApp|measuringApp/);
  });
});
