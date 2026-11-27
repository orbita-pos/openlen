// @vitest-environment node
// The name of an app on the desktop (spec local 2026-11-26-apps-en-el-escritorio): what the person SEES for the project, never
// the raw placeholder a project that was never named carries in the database.
import { describe, expect, it } from "vitest";

import { routing } from "@/i18n/routing";
import { UNTITLED_PROJECT_TITLE } from "@/lib/projects/titulo-del-html";

import { desktopAppName } from "./name";

describe("desktopAppName", () => {
  // The workspace shows `tProjects("newProject")` — `messages/<locale>/projects.json` — for the placeholder title.
  it("the placeholder is the workspace's own label, in each of the app's languages", async () => {
    for (const locale of routing.locales) {
      const { default: projects } = (await import(`@/messages/${locale}/projects.json`)) as { default: { newProject: string } };
      expect(projects.newProject, locale).toBeTruthy();
      expect(await desktopAppName(UNTITLED_PROJECT_TITLE, locale), locale).toBe(projects.newProject);
    }
  });

  it("an empty or blank title is a placeholder too", async () => {
    expect(await desktopAppName("", "es")).toBe("Proyecto nuevo");
    expect(await desktopAppName(" \n\t", "es")).toBe("Proyecto nuevo");
  });

  it("a locale that isn't one of the app's, or isn't a locale at all, falls back to the default language", async () => {
    const fallback = await desktopAppName(UNTITLED_PROJECT_TITLE, routing.defaultLocale);
    for (const odd of ["xx", "", "../../etc/passwd", "__proto__", "es/../en"]) {
      expect(await desktopAppName(UNTITLED_PROJECT_TITLE, odd), odd).toBe(fallback);
    }
  });

  it("a region or a capital letter on the language is still that language", async () => {
    expect(await desktopAppName(UNTITLED_PROJECT_TITLE, "es-MX")).toBe("Proyecto nuevo");
    expect(await desktopAppName(UNTITLED_PROJECT_TITLE, "PT-br")).toBe("Projeto novo");
  });

  it("a name the person gave stays as it is, in any language", async () => {
    for (const title of ["Mis reservas", "  Padded  ", `${UNTITLED_PROJECT_TITLE} 2`, "untitled page", "新しいプロジェクト"]) {
      expect(await desktopAppName(title, "en"), title).toBe(title);
      expect(await desktopAppName(title, "ja"), title).toBe(title);
    }
  });
});
