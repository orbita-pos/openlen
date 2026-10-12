// «Aplicaciones conectadas»: revocar quita la fila, y el secreto de un token
// nuevo se enseña UNA vez. Arnés de react-dom + act() como hero-kind-picker,
// con next-intl como pasapuertas de claves.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { ConnectionsView, type ConnectionItem } from "./connections-view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) => (vals ? `${key} ${JSON.stringify(vals)}` : key),
}));

const oauth: ConnectionItem = {
  id: "fam-1", kind: "oauth", name: "Claude Code", verified: true, clientHost: "claude.ai", scopes: ["projects:read"],
  projectTitle: null, createdAt: "2026-10-11T00:00:00.000Z", lastUsedAt: null, expiresAt: null,
};

const roots: Root[] = [];
function render(initial: ConnectionItem[] = [oauth], nextCursor: string | null = null) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    const root = createRoot(container);
    root.render(
      <ConnectionsView initial={initial} nextCursor={nextCursor} projects={[{ id: "p1", title: "Café Luna" }]} mcpUrl="https://mcp.openlen.com/mcp" locale="es" />,
    );
    roots.push(root);
  });
  return container;
}
const button = (c: HTMLElement, label: string) => Array.from(c.querySelectorAll("button")).find((b) => b.textContent === label)!;
const typeInto = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("confirm", () => true);
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Aplicaciones conectadas", () => {
  it("revocar llama a DELETE y quita la fila", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const c = render();
    expect(c.textContent).toContain("Claude Code");
    await act(async () => button(c, "revoke").click());
    expect(fetchMock).toHaveBeenCalledWith("/api/mcp/connections/fam-1", { method: "DELETE" });
    expect(c.textContent).not.toContain("Claude Code");
  });

  it("🔴 el secreto del token nuevo se enseña una vez y desaparece con «Listo»", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "t1", token: "olp_secreto" }), { status: 201 }));
    const c = render();
    act(() => typeInto(c.querySelector("input[maxlength='100']") as HTMLInputElement, "CI"));
    await act(async () => button(c, "create").click());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/mcp/tokens");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ name: "CI", scopes: [], project_id: null, expires_in_days: 90 });
    expect(c.querySelector("[data-secret]")?.textContent).toBe("olp_secreto");
    act(() => button(c, "done").click());
    expect(c.textContent).not.toContain("olp_secreto");
    expect(c.textContent).toContain("CI");
  });

  it("🔴 los controles del formulario siguen el tema oscuro (fondo propio, color-scheme), no el blanco del navegador", () => {
    const c = render();
    const controls = Array.from(c.querySelectorAll("input:not([type=checkbox]), select"));
    expect(controls.length).toBeGreaterThan(0);
    for (const el of controls) expect(el.className).toMatch(/bg-transparent/);
    for (const el of controls) expect(el.className).toMatch(/dark:\[color-scheme:dark\]/);
  });

  it("dos conexiones con el mismo nombre llevan una marca de su id; una con nombre único, no", () => {
    const c = render([
      { ...oauth, id: "fam-aaaa1111", name: "Cursor" },
      { ...oauth, id: "fam-bbbb2222", name: "Cursor" },
      { ...oauth, id: "fam-cccc3333", name: "Claude Code" },
    ]);
    const tags = Array.from(c.querySelectorAll("[data-connection-tag]")).map((e) => e.textContent);
    expect(tags).toEqual(["#1111", "#2222"]);
  });

  it("con más de una página: «Mostrar más» trae la siguiente y desaparece al acabar", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ connections: [{ ...oauth, id: "fam-2", name: "Gemini CLI" }], next_cursor: null }), { status: 200 }),
    );
    const c = render([oauth], "20");
    await act(async () => button(c, "showMore").click());
    expect(fetchMock).toHaveBeenCalledWith("/api/mcp/connections?cursor=20");
    expect(c.textContent).toContain("Gemini CLI");
    expect(c.textContent).toContain("Claude Code");
    expect(Array.from(c.querySelectorAll("button")).some((b) => b.textContent === "showMore")).toBe(false);
  });

  it("🔴 revocar una de la primera página retrocede el cursor: la siguiente no se salta ninguna", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ connections: [], next_cursor: null }), { status: 200 }));
    const c = render([oauth], "20");
    await act(async () => button(c, "revoke").click());
    await act(async () => button(c, "showMore").click());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/mcp/connections?cursor=19");
  });
});
