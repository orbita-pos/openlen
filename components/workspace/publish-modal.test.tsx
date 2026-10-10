// @vitest-environment jsdom
//
// EN UNA APP NO HAY TRADUCCIÓN AUTOMÁTICA (invariante 6 de CLAUDE.md). Visto en
// el ensayo de caja del 09/10: el diálogo de publicar ofrecía «Publica también
// en» los nueve idiomas a una app, cuyo texto vive en el código y que el
// servidor ya no traduce (`publishProject`, `localesPedidos: []`).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// La clave y, si los lleva, sus parámetros: así se ve con qué números se pinta el límite.
vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, valores?: Record<string, unknown>) => (valores ? `${clave}${JSON.stringify(valores)}` : clave),
}));

import { PublishModal } from "./publish-modal";
import { MAX_SUBDOMAINS_PER_PLAN } from "@/lib/subdomain/limits";

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
  // El límite cuenta PROYECTOS con subdominio —páginas y apps— y decía «1 página
  // publicada. Pro: 10» con los números a mano en 10 idiomas (sin Max) (10/10).
  it("🔴 el límite del plan se dice con los números del código, con todos los planes (gratis, Pro, Max y Ultra)", async () => {
    const { texto } = await publicar(false);
    expect(texto).toContain(`publish.limitsHint${JSON.stringify({ free: MAX_SUBDOMAINS_PER_PLAN.free, pro: MAX_SUBDOMAINS_PER_PLAN.pro, max: MAX_SUBDOMAINS_PER_PLAN.max, ultra: MAX_SUBDOMAINS_PER_PLAN.ultra })}`);
  });

  it("🔴 en una app no ofrece idiomas ni los manda", async () => {
    const { texto, cuerpos } = await publicar(true);
    expect(texto).not.toContain("publish.languages.title");
    expect(cuerpos).toEqual([{ subdomain: "caja", copyDraftData: false }]);
    // Y lo demás que se ve al publicarla habla de la app.
    expect(texto).toContain("publish.status.currentPageApp");
    expect(texto).toContain("publish.speedCard.measuringApp");
  });

  it("en una página, como siempre: los idiomas, y los que estaban guardados viajan", async () => {
    const { texto, cuerpos } = await publicar(false);
    expect(texto).toContain("publish.languages.title");
    expect(cuerpos).toEqual([{ subdomain: "caja", languages: ["en"], copyDraftData: false }]);
    expect(texto).not.toMatch(/currentPageApp|measuringApp/);
  });
});
