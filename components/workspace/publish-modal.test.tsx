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
  // La revisión de seguridad (spec local 2026-10-15) manda el idioma de quien publica.
  useLocale: () => "es",
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
    expect(cuerpos).toEqual([{ subdomain: "caja", copyDraftData: false, locale: "es" }]);
    // Y lo demás que se ve al publicarla habla de la app.
    expect(texto).toContain("publish.status.currentPageApp");
    expect(texto).toContain("publish.speedCard.measuringApp");
  });

  it("en una página, como siempre: los idiomas, y los que estaban guardados viajan", async () => {
    const { texto, cuerpos } = await publicar(false);
    expect(texto).toContain("publish.languages.title");
    expect(cuerpos).toEqual([{ subdomain: "caja", languages: ["en"], copyDraftData: false, locale: "es" }]);
    expect(texto).not.toMatch(/currentPageApp|measuringApp/);
  });
});

// APPS EN EL ESCRITORIO (spec local 2026-11-26-apps-en-el-escritorio, §5): hay UNA producción, la del sitio publicado y
// la de la app instalada. Publicar lo dice si la persona tiene la app en su escritorio.
describe("el diálogo de publicar, con la app en el escritorio", () => {
  const ESCRITORIO = { id: "d1", url: "/desktop/d1", name: "Caja", releaseSha: "abc123", installedAt: "2026-11-26T10:00:00.000Z" };

  async function abrir(esApp: boolean, escritorio: Record<string, unknown> | null) {
    const llamadas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        llamadas.push(String(url));
        if (String(url).endsWith("/desktop")) {
          return new Response(JSON.stringify({ desktopApp: escritorio, updateAvailable: false, published: true }), { status: 200 });
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
          project={{ id: "p1", subdomain: "caja", publishedAt: null, hasUnpublishedChanges: true, languages: [], esApp }}
        />,
      ),
    );
    return { texto: host.textContent ?? "", llamadas };
  }

  it("shows the desktop notice when a desktop app exists", async () => {
    const { texto, llamadas } = await abrir(true, ESCRITORIO);
    expect(llamadas).toContain("/api/projects/p1/desktop");
    expect(texto).toContain("desktopInstall.publishNotice");
  });

  it("sin la app en el escritorio, no dice nada", async () => {
    const { texto } = await abrir(true, null);
    expect(texto).not.toContain("desktopInstall.publishNotice");
  });

  it("una página no pregunta por el escritorio: sólo las apps se instalan", async () => {
    const { texto, llamadas } = await abrir(false, ESCRITORIO);
    expect(llamadas.some((u) => u.endsWith("/desktop"))).toBe(false);
    expect(texto).not.toContain("desktopInstall.publishNotice");
  });
});
