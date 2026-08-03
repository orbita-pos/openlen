// La afordancia de inserción de "Mis plataformas" tiene que estar VIVA en las
// DOS superficies (hub de Módulos y Section Library) y en los TRES estados
// (sin links / con links / ya insertada). El motor ya estaba probado; lo que
// se rompe en silencio es el cableado de la tarjeta, así que se verifica
// renderizando de verdad (react-dom + act, mismo arnés que
// ./collections-panel.test.tsx — este repo no tiene @testing-library).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ModulesPanel } from "./modules-panel";
import { SectionsPanel, type ModuleCardState } from "./sections-panel";
import type { PlacedModule } from "@/lib/projects/module-placements";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Passthrough: las aserciones apuntan a la CLAVE i18n, no a la traducción.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
// La galería de secciones hace fetch en mount; aquí solo importan las tarjetas
// de módulo, así que se corta la red.
vi.mock("../use-sections", () => ({
  useSections: () => ({ sections: [], byType: () => [], isLoading: false, error: null }),
}));

const roots: Root[] = [];
function render(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
  roots.push(root);
  return container;
}
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
});

const placements = (platforms: string[]): Record<PlacedModule, string[]> => ({
  collections: [],
  bookings: [],
  comments: [],
  platforms,
});

/** El botón (o tarjeta) cuyo texto contiene `text`. */
function buttonWith(root: ParentNode, text: string): HTMLButtonElement | null {
  return (
    Array.from(root.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(text),
    ) ?? null
  );
}

describe("hub de Módulos — tarjeta Mis plataformas", () => {
  const base = { currentProjectId: "p1", gatedCount: 0 } as const;

  it("aparece aunque el usuario no tenga NINGÚN enlace (es descubrimiento)", () => {
    const c = render(
      <ModulesPanel {...base} platformLinkCount={0} placements={placements([])} />,
    );
    expect(c.textContent).toContain("platforms.title");
    // Sin links la tarjeta enseña el prerequisito en vez de la tagline.
    expect(c.textContent).toContain("platforms.needsLinks");
  });

  it("sin links el cajón dirige a Mi negocio y NO ofrece insertar", () => {
    const onOpenBusinessProfile = vi.fn();
    const onInsertPlatformsSection = vi.fn();
    const c = render(
      <ModulesPanel
        {...base}
        platformLinkCount={0}
        placements={placements([])}
        onOpenBusinessProfile={onOpenBusinessProfile}
        onInsertPlatformsSection={onInsertPlatformsSection}
      />,
    );
    act(() => buttonWith(c, "platforms.title")!.click());
    const drawer = document.querySelector('[role="dialog"]')!;
    expect(buttonWith(drawer, "platforms.insert")).toBeNull();
    act(() => buttonWith(drawer, "platforms.manage")!.click());
    expect(onOpenBusinessProfile).toHaveBeenCalledTimes(1);
    expect(onInsertPlatformsSection).not.toHaveBeenCalled();
  });

  it("con links el cajón inserta la banda", () => {
    const onInsertPlatformsSection = vi.fn();
    const c = render(
      <ModulesPanel
        {...base}
        platformLinkCount={2}
        placements={placements([])}
        onInsertPlatformsSection={onInsertPlatformsSection}
      />,
    );
    expect(c.textContent).not.toContain("platforms.needsLinks");
    act(() => buttonWith(c, "platforms.title")!.click());
    const drawer = document.querySelector('[role="dialog"]')!;
    act(() => buttonWith(drawer, "platforms.insert")!.click());
    expect(onInsertPlatformsSection).toHaveBeenCalledTimes(1);
  });

  it("ya colocada → cuenta como módulo ACTIVO (no hay toggle que leer)", () => {
    const off = render(
      <ModulesPanel {...base} platformLinkCount={2} placements={placements([])} />,
    );
    expect(off.textContent).toContain("modulesHub.availableGroup");
    expect(off.textContent).not.toContain("modulesHub.activeGroup");

    const on = render(
      <ModulesPanel {...base} platformLinkCount={2} placements={placements([""])} />,
    );
    expect(on.textContent).toContain("modulesHub.activeGroup");
  });

  it("el cajón de plataformas no muestra Switch (no existe settings.enabled)", () => {
    const c = render(
      <ModulesPanel {...base} platformLinkCount={2} placements={placements([])} />,
    );
    act(() => buttonWith(c, "platforms.title")!.click());
    const drawer = document.querySelector('[role="dialog"]')!;
    expect(drawer.querySelector('[role="switch"]')).toBeNull();
  });
});

describe("Section Library — tarjeta Mis plataformas", () => {
  const card = (over: Partial<ModuleCardState> = {}): ModuleCardState => ({
    module: "platforms",
    enabled: true,
    alreadyOnPage: false,
    needsMembers: false,
    needsPlatformLinks: false,
    ...over,
  });
  const panel = (cards: ModuleCardState[], onAddModule = vi.fn()) => ({
    container: render(
      <SectionsPanel
        onPreview={vi.fn()}
        moduleCards={cards}
        onAddModule={onAddModule}
        openModulesView
      />,
    ),
    onAddModule,
  });

  it("aparece junto a los otros módulos", () => {
    const { container } = panel([
      card({ module: "collections" }),
      card({ module: "bookings" }),
      card({ module: "comments" }),
      card(),
    ]);
    expect(container.textContent).toContain("sections.modulePlatformsTitle");
    expect(container.textContent).toContain("sections.modulePlatformsDesc");
  });

  it("con links: el botón inserta en esta página", () => {
    const { container, onAddModule } = panel([card()]);
    expect(container.textContent).not.toContain("sections.modulePlatformsNeedsLinks");
    act(() => buttonWith(container, "sections.moduleInsertHere")!.click());
    expect(onAddModule).toHaveBeenCalledWith("platforms", "section");
  });

  it("sin links: el botón cambia a capturarlos y sale el hint", () => {
    const { container, onAddModule } = panel([card({ enabled: false, needsPlatformLinks: true })]);
    expect(container.textContent).toContain("sections.modulePlatformsNeedsLinks");
    expect(buttonWith(container, "sections.moduleInsertHere")).toBeNull();
    act(() => buttonWith(container, "sections.modulePlatformsAddLinks")!.click());
    // Sigue pasando por el mismo motor: planModuleAdd decide desviar.
    expect(onAddModule).toHaveBeenCalledWith("platforms", "section");
  });

  it("ya insertada: el botón pasa a 'ya está aquí' (guard singleton)", () => {
    const { container } = panel([card({ alreadyOnPage: true })]);
    expect(container.textContent).toContain("sections.moduleAlreadyHere");
    expect(buttonWith(container, "sections.moduleInsertHere")).toBeNull();
  });

  it("NUNCA ofrece 'Como página nueva' (igual que Comentarios)", () => {
    const { container } = panel([card()]);
    expect(buttonWith(container, "sections.moduleAsPage")).toBeNull();
    const conCatalogo = panel([card({ module: "collections" })]);
    expect(buttonWith(conCatalogo.container, "sections.moduleAsPage")).not.toBeNull();
  });
});
