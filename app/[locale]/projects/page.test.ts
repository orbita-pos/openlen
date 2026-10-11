// /projects redirige a la lista del taller (`/new?view=projects`). Es también
// la VUELTA DEL COBRO: el checkout y el portal de Polar mandan aquí
// `?billing_error=<código>` si fallan y `?upgraded=<plan>` si se pagó, y quien
// pinta el aviso es la lista. La redirección tiraba la consulta: el aviso no
// salía nunca y sólo se veía «failed» un instante en la barra (11/10).
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((_a: { href: string; locale: string }) => {}),
}));

vi.mock("@/i18n/navigation", () => ({ redirect: mocks.redirect }));

import ProjectsPage from "./page";

async function destino(query: Record<string, string | string[] | undefined>): Promise<URL> {
  await ProjectsPage({ params: Promise.resolve({ locale: "es" }), searchParams: Promise.resolve(query) });
  expect(mocks.redirect).toHaveBeenCalledTimes(1);
  const { href, locale } = mocks.redirect.mock.calls[0][0];
  expect(locale).toBe("es");
  return new URL(href, "http://x");
}

describe("/projects → /new?view=projects", () => {
  beforeEach(() => mocks.redirect.mockClear());

  it("sin consulta, la lista", async () => {
    const url = await destino({});
    expect(url.pathname).toBe("/new");
    expect([...url.searchParams]).toEqual([["view", "projects"]]);
  });

  it("🔴 un pago que falló llega a la lista con su código", async () => {
    const url = await destino({ billing_error: "checkout_failed" });
    expect(url.pathname).toBe("/new");
    expect(url.searchParams.get("view")).toBe("projects");
    expect(url.searchParams.get("billing_error")).toBe("checkout_failed");
  });

  it("🔴 un pago que salió bien llega con su plan", async () => {
    const url = await destino({ upgraded: "max" });
    expect(url.searchParams.get("view")).toBe("projects");
    expect(url.searchParams.get("upgraded")).toBe("max");
  });

  it("un `view` en la consulta no saca de la lista", async () => {
    const url = await destino({ view: "explore", billing_error: "portal_failed" });
    expect(url.searchParams.getAll("view")).toEqual(["projects"]);
    expect(url.searchParams.get("billing_error")).toBe("portal_failed");
  });
});
