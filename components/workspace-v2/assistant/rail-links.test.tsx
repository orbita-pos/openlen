// THE PERSON'S ASSISTANTS IN THE START RAIL (spec local 2026-11-06-asistente-propio, §6.3): each one, with its figure,
// leads to its place. Nothing for someone without one, or without a session.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={`/es${href}`} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("../ui", () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { AssistantRailLinks } from "./rail-links";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
  return host;
}

describe("the person's assistants in the start rail", () => {
  it("lists each one, leading to its place", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ assistants: [{ id: "a1", name: "Lucía", slug: "lucia", look: { v: 1, shape: "drop", color: "#f4a48b", eyes: "oval", eyewear: "none", accessory: "none" } as const, color: "#f4a48b", tone: "friendly", projectId: "p1" }] }))));
    const host = await mount(<AssistantRailLinks open />);
    const link = host.querySelector<HTMLAnchorElement>("[data-assistant-rail-link]")!;
    expect(link.getAttribute("href")).toBe("/es/assistant/lucia");
    expect(link.textContent).toContain("Lucía");
  });

  it("shows nothing without a session or without assistants", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })));
    expect((await mount(<AssistantRailLinks open />)).querySelector("[data-assistant-rail-link]")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ assistants: [] }))));
    expect((await mount(<AssistantRailLinks open={false} />)).querySelector("[data-assistant-rail-link]")).toBeNull();
  });
});
