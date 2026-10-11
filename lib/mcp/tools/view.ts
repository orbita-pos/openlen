// view_page: cómo se VE el borrador (no lo publicado), con las medidas.
import * as z from "zod4";
import { realDeps } from "@/lib/agent/tools";
import { pantallaDe, vistaConCarpeta, vistaParaMedir } from "@/lib/lienzo/documento";
import { openProject } from "../access";
import { acquireCaptureSlot, captureProjectView } from "../capture";
import { consumeQuota } from "../quota";
import { imageResult, textResult, toolError } from "../results";
import { defineTool, READ_ONLY } from "./define";

// Las capturas cuestan Chromium: que el modelo no las pida en bucle.
const QUOTA_NOTE = "Screenshots are rate-limited: take one after a meaningful change, not after every edit.";

export const viewPageTool = defineTool({
  name: "view_page",
  title: "View page",
  description:
    "Renders the project's saved draft in a real browser and returns a screenshot plus measurements (unreadable contrast, " +
    "mobile overflow, JavaScript errors). page = a page slug (omit for the home page); for an app, screen = a hash route like /sales. " +
    "Use it after editing to check your work.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    page: z.string().optional().describe("Page slug, e.g. pricing. Omit for the home page."),
    screen: z.string().optional().describe("Apps only: the screen to open, e.g. /sales."),
    viewport: z.enum(["desktop", "mobile"]).optional().describe("Default desktop (1280px); mobile is 390px."),
    full_page: z.boolean().optional().describe("Capture the whole page (up to 4096px tall) instead of the first screen."),
  }),
  annotations: READ_ONLY,
  async run({ project_id, page, screen, viewport = "desktop", full_page = false }, caller) {
    const open = await openProject(caller, project_id, "ver");
    if (!open.ok) return open.result;
    const { row } = open;
    const app = row.data.app ?? null;
    const slug = !app && page && page !== "/" ? page.replace(/^\/|\/$/g, "") : null;
    const html = slug ? row.data.pages?.[slug]?.html : row.data.html;
    if (html === undefined) {
      const pages = Object.keys(row.data.pages ?? {});
      return toolError("not_found", `There is no page "${page}". Pages: home${pages.length ? `, ${pages.join(", ")}` : ""}.`);
    }
    const release = acquireCaptureSlot();
    if (!release) {
      return toolError("busy", "OpenLen is rendering other pages right now. Wait a few seconds and call view_page again.");
    }
    let r: Awaited<ReturnType<typeof captureProjectView>>;
    try {
      const denied = await consumeQuota(caller, "view_page");
      if (denied) return denied;
      let vista = await vistaConCarpeta(vistaParaMedir(project_id, row, slug), realDeps(), project_id);
      if (app && screen) vista = { ...vista, pantalla: pantallaDe(screen) };
      r = await captureProjectView({ html, vista, viewport, fullPage: full_page });
    } finally {
      release();
    }
    if (!r.image && !r.measurements) {
      return toolError("render_failed", "The page could not be rendered right now. Try again in a moment; if it repeats, check get_diagnostics.");
    }
    const where = app ? `app${screen ? ` screen ${screen}` : ""}` : slug ? `page /${slug}` : "home page";
    const text = [
      `Draft ${where} at ${viewport} — this is the saved draft, not the published site.`,
      r.measurements ?? "Measurements unavailable this time.",
      r.image ? "" : "Screenshot unavailable this time.",
      QUOTA_NOTE,
    ].filter(Boolean).join("\n");
    return r.image ? imageResult(r.image, text) : textResult(text);
  },
});
