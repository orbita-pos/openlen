// create_project: una página desde HTML (la misma puerta que «pegar HTML») o
// una app nacida del esqueleto (lo mismo que elegir «App» al empezar).
import * as z from "zod4";
import { topeDeIngestion } from "@/lib/ingestion/tope";
import { findOrCreateBlankProject, renameProject } from "@/lib/projects";
import { createProjectFromHtml } from "@/lib/projects/create-from-html";
import { nacerComoApp } from "@/lib/projects/nacer-como-app";
import { editorUrl } from "../config";
import { jsonResult, toolError } from "../results";
import { defineTool } from "./define";

const CREATE_ERRORS = {
  empty: "The HTML is empty.",
  too_large: "The HTML is larger than 8 MB.",
  invalid_html: "The HTML contains OpenLen editor markers (data-slot-path). Send the rendered page instead.",
  db_insert_failed: "OpenLen could not save the project. Try again.",
} as const;

export const createProjectTool = defineTool({
  name: "create_project",
  title: "Create project",
  description:
    "Creates a new OpenLen project for this person: a page from HTML you provide (or an empty page to write with write_file), " +
    "or an app (React + TypeScript) started from OpenLen's skeleton. Returns its project_id and editor_url.",
  inputSchema: z.object({
    kind: z.enum(["page", "app"]),
    title: z.string().min(1).max(120),
    html: z.string().optional().describe("Pages only: the full HTML of the home page."),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async run({ kind, title, html }, caller) {
    const limited = await topeDeIngestion(caller.userId);
    if (limited) return toolError("rate_limited", "Too many projects created in the last hour. Try again later.");
    if (kind === "page" && html !== undefined) {
      const r = await createProjectFromHtml({ userId: caller.userId, html, title, brief: "Created from an AI assistant", tags: ["mcp"] });
      if (!r.ok) return toolError(r.error, CREATE_ERRORS[r.error]);
      return jsonResult({ project_id: r.projectId, type: "page", title: r.title, editor_url: editorUrl(r.projectId) });
    }
    const projectId = await findOrCreateBlankProject(caller.userId);
    if (kind === "app" && !(await nacerComoApp({ projectId, userId: caller.userId, titulo: title }))) {
      return toolError("create_failed", "OpenLen could not start the app. Try again.");
    }
    await renameProject(projectId, caller.userId, title);
    return jsonResult({
      project_id: projectId,
      type: kind,
      title,
      editor_url: editorUrl(projectId),
      next_step: kind === "app" ? "Call get_docs with this project_id before writing code." : "Write /index.html with write_file.",
    });
  },
});
