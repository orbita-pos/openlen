// «ATENDER UNA PÁGINA» (spec local 2026-11-19-agentes-para-todos, §6.7): an agent attends a page only because the person
// put it there, one agent per page. An agent of the space has no home page: its pages are only the ones it attends.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, v?: Record<string, unknown>) => (v ? `${clave} ${JSON.stringify(v)}` : clave),
  useLocale: () => "es",
}));

import { HerProjects } from "./her-projects";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));

const row = (projectId: string, title: string) => ({ projectId, title, address: null, isHome: false, onPage: true, needsPublish: true, nothingToKnow: false, knowsIt: false });

function serve(o: { attends: ReturnType<typeof row>[]; taken?: string }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let attends = [...o.attends];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init ? { init } : {}) });
      const u = String(url);
      if (u === "/api/assistants/a2/projects" && !init?.method) return new Response(JSON.stringify({ projects: attends }));
      if (u === "/api/projects")
        return new Response(JSON.stringify({ projects: [{ id: "p1", title: "Panadería" }, { id: "p2", title: "Tienda" }, { id: "p9", title: "", isBlank: true }], shared: [] }));
      if (u === "/api/assistants/a2/projects" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { projectId: string; replace?: boolean };
        if (body.projectId === o.taken && !body.replace) return new Response(JSON.stringify({ error: "project_has_assistant", current: { name: "Lucía", slug: "lucia" } }), { status: 409 });
        attends = [...attends, row(body.projectId, body.projectId === "p1" ? "Panadería" : "Tienda")];
        return new Response(JSON.stringify({ projectId: body.projectId }), { status: 201 });
      }
      if (u.startsWith("/api/assistants/a2/projects/") && init?.method === "DELETE") {
        attends = attends.filter((r) => !u.endsWith(`/${r.projectId}`));
        return new Response(null, { status: 204 });
      }
      return new Response("{}", { status: 200 });
    }),
  );
  return calls;
}

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<HerProjects assistantId="a2" name="Mr. Smith" homeOnPage={false} homeNeedsPublish={false} homeNothingToKnow={false} inSpace />));
  await settle();
  act(() => host.querySelector<HTMLButtonElement>("[data-her-projects-open]")!.click());
  return host;
}
const posts = (calls: { url: string; init?: RequestInit }[]) => calls.filter((c) => c.init?.method === "POST").map((c) => JSON.parse(String(c.init!.body)));

describe("an agent of the space", () => {
  it("🔴 has no home switch, counts only the pages it attends, and can leave its only one", async () => {
    serve({ attends: [row("p1", "Panadería")] });
    const host = await mount();
    expect(host.querySelector("[data-her-projects-open]")!.textContent).toContain('ownAssistant.projects.count {"count":1}');
    // No switch for a home page: the space is not one.
    expect(host.querySelector("[data-her-home-switch]")).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>("[data-her-project-remove]")!.click());
    act(() => host.querySelector<HTMLButtonElement>("[data-her-project-remove-confirm]")!.click());
    await settle();
    expect(host.querySelector('[data-her-project="p1"]')).toBeNull();
    expect(host.querySelector("[data-her-projects-open]")!.textContent).toContain('ownAssistant.projects.count {"count":0}');
  });
});

describe("«Atender una página»", () => {
  it("🔴 lists the person's pages it doesn't attend; a free one is attended with the bubble on", async () => {
    const calls = serve({ attends: [row("p1", "Panadería")] });
    const host = await mount();
    act(() => host.querySelector<HTMLButtonElement>("[data-her-attend]")!.click());
    await settle();
    const offered = [...host.querySelectorAll<HTMLButtonElement>("[data-her-attend-page]")].map((b) => b.getAttribute("data-her-attend-page"));
    expect(offered).toEqual(["p2"]);
    act(() => host.querySelector<HTMLButtonElement>('[data-her-attend-page="p2"]')!.click());
    await settle();
    expect(posts(calls)).toEqual([{ projectId: "p2", onPage: true }]);
    expect(host.querySelector('[data-her-project="p2"]')).not.toBeNull();
  });

  it("🔴 a page another one attends asks first; «Cambiar» puts her there in its place", async () => {
    const calls = serve({ attends: [], taken: "p2" });
    const host = await mount();
    act(() => host.querySelector<HTMLButtonElement>("[data-her-attend]")!.click());
    await settle();
    act(() => host.querySelector<HTMLButtonElement>('[data-her-attend-page="p2"]')!.click());
    await settle();
    expect(host.querySelector("[data-her-attend-ask]")!.textContent).toContain('ownAssistant.projects.attendReplace {"current":"Lucía","name":"Mr. Smith"}');
    expect(host.querySelector('[data-her-project="p2"]')).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>("[data-her-attend-replace]")!.click());
    await settle();
    expect(posts(calls)).toEqual([
      { projectId: "p2", onPage: true },
      { projectId: "p2", onPage: true, replace: true },
    ]);
    expect(host.querySelector('[data-her-project="p2"]')).not.toBeNull();
  });
});
