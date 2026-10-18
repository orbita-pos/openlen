// @vitest-environment jsdom
//
// El aviso de la vuelta del cobro (`?billing_error=` / `?upgraded=`). La lista
// vive DENTRO del taller (`/new?view=projects`): al quitar el parámetro hay que
// quedarse ahí. Antes hacía `router.replace("/projects")`, que sacaba del
// taller, volvía a montar la lista y se llevaba el aviso (11/10).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import messages from "@/messages/es/projects.json";
import type { ProjectSummary } from "@/lib/projects";

// Estables entre renders, como los de Next: el efecto depende de ellos.
const nav = vi.hoisted(() => {
  const replace = (_href: string) => {};
  return {
    params: new URLSearchParams("view=projects"),
    replace: vi.fn(replace),
    router: null as unknown as { replace: (href: string) => void; push: () => void; refresh: () => void },
  };
});
nav.router = { replace: nav.replace, push: () => {}, refresh: () => {} };

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => nav.router,
  usePathname: () => "/new",
}));
vi.mock("@/components/workspace-v2/toast", () => ({
  useToast: () => ({ show: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/components/community/visibility-toggle", () => ({ default: () => null }));
vi.mock("@/components/community/handle-dialog", () => ({ default: () => null }));

import { ProjectsView } from "./projects-view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
beforeEach(() => {
  nav.replace.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("null", { status: 404 })));
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function render(query: string, projects: ProjectSummary[] = []): HTMLElement {
  nav.params = new URLSearchParams(query);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="es" messages={{ projects: messages }}>
        <ProjectsView projects={projects} />
      </NextIntlClientProvider>,
    ),
  );
  return host;
}

describe("la vuelta del cobro en la lista del taller", () => {
  it("🔴 un pago que falló dice por qué y se queda en /new?view=projects", () => {
    const host = render("view=projects&billing_error=checkout_failed");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      messages.billing.errors.checkout_failed,
    );
    expect(nav.replace).toHaveBeenCalledWith("/new?view=projects");
  });

  it("🔴 un pago que salió bien lo dice, y tampoco sale del taller", () => {
    const host = render("view=projects&upgraded=max");
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    expect(nav.replace).toHaveBeenCalledWith("/new?view=projects");
  });

  it("sin vuelta del cobro, ni aviso ni cambio de URL", () => {
    const host = render("view=projects");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

it("updates a completed thumbnail in the open list and stops polling", async () => {
  vi.useFakeTimers();
  const project: ProjectSummary = { id: "p1", title: "My app", status: "draft", visibility: "private", tags: [], deployUrl: null, thumbnailUrl: null, thumbnailPending: true, logoUrl: null, subdomain: null, publishedAt: null, hasUnpublishedChanges: true, sectionCount: 0, isBlank: false, createdAt: new Date(), updatedAt: new Date() };
  const fetcher = vi.fn(async (url: string) => url === "/api/projects" ? new Response(JSON.stringify({ projects: [{ ...project, thumbnailUrl: "https://image.test/new.avif", thumbnailPending: false }], shared: [] })) : new Response("null", { status: 404 }));
  vi.stubGlobal("fetch", fetcher);
  const host = render("view=projects", [project]);
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(host.querySelector('img[src="https://image.test/new.avif"]')).not.toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(fetcher.mock.calls.filter(([url]) => url === "/api/projects")).toHaveLength(1);
});
