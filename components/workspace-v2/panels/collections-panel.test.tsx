// Task 16: render coverage for the sheet-backed read-only UI. Follows the
// manual react-dom + act() harness from ../scan-overlay.test.tsx (no
// @testing-library dependency in this repo). Two extra seams beyond that
// precedent — next-intl's useTranslations and the panel's on-mount fetch —
// are mocked directly rather than adding new test infra.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CollectionsPanel } from "./collections-panel";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// useTranslations("collections") needs a NextIntlClientProvider in the tree
// to resolve real strings. Mock it to a trivial key-passthrough (same trick
// as ../agent-action-card.test.ts) so the component renders without one —
// assertions below match on the raw dotted key.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function renderPanel(props: React.ComponentProps<typeof CollectionsPanel>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(<CollectionsPanel {...props} />);
  });
  return { container, root };
}

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  vi.restoreAllMocks();
});

const ITEMS = [
  {
    id: "i1",
    title: "Item A",
    subtitle: null,
    description: null,
    imageUrl: null,
    priceDisplay: null,
    badge: null,
    ctaLabel: null,
    ctaUrl: null,
    tags: [],
    status: "published" as const,
    sortOrder: 0,
  },
  {
    id: "i2",
    title: "Item B",
    subtitle: null,
    description: null,
    imageUrl: null,
    priceDisplay: null,
    badge: null,
    ctaLabel: null,
    ctaUrl: null,
    tags: [],
    status: "published" as const,
    sortOrder: 1,
  },
];

function mockFetch(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => body,
  })) as unknown as typeof fetch;
}

// Flush the microtask chain the panel's load() runs after mount
// (fetch → .then(json) → .then(setState)).
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("CollectionsPanel — Task 16 sheet-backed read-only UI", () => {
  it("sheetBacked:true renders the banner + Sheet link and disables editing controls", async () => {
    const SHEET_URL = "https://docs.google.com/spreadsheets/d/xyz/edit#gid=0";
    globalThis.fetch = mockFetch({
      collection: { id: "c1", name: "Menu", preset: "menu", layout: "grid" },
      items: ITEMS,
      sheetBacked: true,
      sheetUrl: SHEET_URL,
    });
    const { container, root } = renderPanel({ currentProjectId: "p1" });
    roots.push(root);
    await flush();

    expect(container.textContent).toContain("sheetBacked.banner");
    const link = container.querySelector("a") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe(SHEET_URL);
    expect(link?.textContent).toContain("sheetBacked.openSheet");

    const addBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("items.add"),
    ) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);

    const downButtons = container.querySelectorAll('[aria-label="reorder.down"]');
    const upButtons = container.querySelectorAll('[aria-label="reorder.up"]');
    // idx0's down + idx1's up are NOT boundary-disabled — only sheetBacked
    // can be disabling them, so these two are the real regression guard.
    expect((downButtons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((upButtons[1] as HTMLButtonElement).disabled).toBe(true);

    container.querySelectorAll('[aria-label="items.edit"]').forEach((b) => {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    });
    container.querySelectorAll('[aria-label="items.archive"]').forEach((b) => {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it("sheetBacked:false renders no banner and leaves controls enabled", async () => {
    globalThis.fetch = mockFetch({
      collection: { id: "c1", name: "Menu", preset: "menu", layout: "grid" },
      items: ITEMS,
      sheetBacked: false,
      sheetUrl: null,
    });
    const { container, root } = renderPanel({ currentProjectId: "p1" });
    roots.push(root);
    await flush();

    expect(container.textContent).not.toContain("sheetBacked.banner");
    expect(container.querySelector("a")).toBeNull();

    const addBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("items.add"),
    ) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(false);

    const downButtons = container.querySelectorAll('[aria-label="reorder.down"]');
    const upButtons = container.querySelectorAll('[aria-label="reorder.up"]');
    expect((downButtons[0] as HTMLButtonElement).disabled).toBe(false);
    expect((upButtons[1] as HTMLButtonElement).disabled).toBe(false);

    container.querySelectorAll('[aria-label="items.edit"]').forEach((b) => {
      expect((b as HTMLButtonElement).disabled).toBe(false);
    });
    container.querySelectorAll('[aria-label="items.archive"]').forEach((b) => {
      expect((b as HTMLButtonElement).disabled).toBe(false);
    });
  });
});

/**
 * DESCONECTAR EL SHEET. Antes no existía en ninguna superficie: conectar una
 * hoja dejaba la colección de SOLO LECTURA para siempre —el API 409ea toda
 * mutación manual— y la única salida era `OPENLEN_LIVE_DATA=0`, el kill-switch
 * GLOBAL del servidor, que apaga los datos vivos de todos los proyectos.
 */
describe("CollectionsPanel — desconectar el Sheet", () => {
  const CONECTADA = {
    collection: { id: "c1", name: "Menu", preset: "menu", layout: "grid" },
    items: ITEMS,
    sheetBacked: true,
    sheetUrl: "https://docs.google.com/spreadsheets/d/xyz/edit",
  };

  it("el botón sólo aparece cuando hay una hoja conectada", async () => {
    globalThis.fetch = mockFetch({ ...CONECTADA, sheetBacked: false, sheetUrl: null });
    const { container, root } = renderPanel({ currentProjectId: "p1" });
    roots.push(root);
    await flush();
    expect(container.textContent).not.toContain("sheetBacked.disconnect");
  });

  it("dice que lo ya sincronizado se queda ANTES de pulsarlo", async () => {
    // Si el usuario no sabe que no pierde su catálogo, no pulsa — y se queda
    // encerrado igual que antes.
    globalThis.fetch = mockFetch(CONECTADA);
    const { container, root } = renderPanel({ currentProjectId: "p1" });
    roots.push(root);
    await flush();
    expect(container.textContent).toContain("sheetBacked.disconnectHint");
  });

  it("pulsarlo manda DELETE a la ruta de la fuente y recarga el panel", async () => {
    const llamadas: Array<[string, string]> = [];
    globalThis.fetch = vi.fn(async (url: unknown, init?: unknown) => {
      llamadas.push([String(url), (init as RequestInit | undefined)?.method ?? "GET"]);
      return { ok: true, json: async () => CONECTADA };
    }) as unknown as typeof fetch;

    const { container, root } = renderPanel({ currentProjectId: "p1" });
    roots.push(root);
    await flush();

    const boton = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("sheetBacked.disconnect"),
    ) as HTMLButtonElement;
    expect(boton, "no se pintó el botón de desconectar").toBeTruthy();

    await act(async () => {
      boton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(llamadas).toContainEqual(["/api/projects/p1/collections/source", "DELETE"]);
    // Y vuelve a leer, para que el panel se destrabe solo sin recargar la app.
    expect(llamadas.filter(([u, m]) => u.endsWith("/collections/items") && m === "GET").length)
      .toBeGreaterThanOrEqual(2);
  });

  it("si el servidor falla, lo dice en vez de fingir que se desconectó", async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async () => {
      n++;
      return n === 1 ? { ok: true, json: async () => CONECTADA } : { ok: false, status: 500, json: async () => ({}) };
    }) as unknown as typeof fetch;

    const { container, root } = renderPanel({ currentProjectId: "p1" });
    roots.push(root);
    await flush();
    const boton = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("sheetBacked.disconnect"),
    ) as HTMLButtonElement;
    await act(async () => {
      boton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(container.textContent).toContain("sheetBacked.disconnectError");
  });
});
