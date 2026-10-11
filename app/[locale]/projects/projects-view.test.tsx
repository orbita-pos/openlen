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
});

function render(query: string): HTMLElement {
  nav.params = new URLSearchParams(query);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="es" messages={{ projects: messages }}>
        <ProjectsView projects={[]} />
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
