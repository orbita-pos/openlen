// get_docs: el manual de OpenLen que lee Len, para el agente de fuera.
import * as z from "zod4";
import { RUTA_APPS, RUTA_GUIA, RUTA_LIBRERIAS, RUTA_MANUAL } from "@/lib/agent/ficheros/manual";
import { textoDeLaPlataforma } from "@/lib/agent/manual-de-la-plataforma";
import type { AppDeProyecto } from "@/lib/projects/types";
import { openProject } from "../access";
import { textResult, toolError } from "../results";
import { defineTool, READ_ONLY } from "./define";

export const DOC_PATHS = {
  manual: RUTA_MANUAL,
  design_guide: RUTA_GUIA,
  libraries: RUTA_LIBRERIAS,
  apps: RUTA_APPS,
} as const;

const PREFACE =
  "This manual was written for Len, OpenLen's built-in agent. Through MCP its tools map like this: " +
  "Read → read_file, Grep → search_files, view_page → view_page. Bash, npm and Len's other tools are not available here.\n\n";

export const getDocsTool = defineTool({
  name: "get_docs",
  title: "Get OpenLen docs",
  description:
    "OpenLen's manual: how pages and apps are built here, the package catalog an app can import (there is no npm install), " +
    "the design guide and the page libraries. Pass project_id to get the version for that project's type (page or app). Read it before writing code.",
  inputSchema: z.object({
    project_id: z.string().optional(),
    doc: z.enum(["manual", "design_guide", "libraries", "apps"]).optional().describe("Default: manual."),
  }),
  annotations: READ_ONLY,
  async run({ project_id, doc = "manual" }, caller) {
    let app: AppDeProyecto | null = null;
    if (project_id) {
      const open = await openProject(caller, project_id, "ver");
      if (!open.ok) return open.result;
      app = open.row.data.app ?? null;
    }
    const text = textoDeLaPlataforma(DOC_PATHS[doc], "len", app);
    if (text === null) {
      return toolError(
        "not_available",
        `There is no "${doc}" document for ${app ? "an app" : "a page"} (an app's packages are listed in the manual). Use doc "manual".`,
      );
    }
    return textResult(PREFACE + text);
  },
});
