// list_projects y get_project: lo que la persona puede abrir, y la ficha de uno.
import * as z from "zod4";
import { cargarFicherosDeLaTerminal } from "@/lib/agent/herramientas-de-ficheros";
import { esDeLaPlataforma } from "@/lib/agent/ficheros/manual";
import { paginaDeRuta } from "@/lib/agent/ficheros/sitio";
import { realDeps } from "@/lib/agent/tools";
import { deployUrlFor } from "@/lib/publish/deploy-url";
import { openProject } from "../access";
import { editorUrl } from "../config";
import { jsonResult } from "../results";
import { projectsVisibleTo } from "../projects-list";
import { mcpAgentSession } from "../session";
import { defineTool, READ_ONLY } from "./define";

const ROLE = { dueno: "owner", editor: "editor", lector: "viewer" } as const;

export const listProjectsTool = defineTool({
  name: "list_projects",
  title: "List projects",
  description:
    "Lists the OpenLen projects this person can open (their own and the ones shared with them), newest first. " +
    "Returns id, title, role (owner/editor/viewer), status, published_url and editor_url. Use the id as project_id in every other tool.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(50).optional().describe("How many to return (default 20)."),
    cursor: z.string().optional().describe("The next_cursor of a previous call, to get the next page."),
  }),
  annotations: READ_ONLY,
  async run({ limit = 20, cursor }, caller) {
    const all = (await projectsVisibleTo(caller.userId)).filter(({ p }) => !caller.projectId || p.id === caller.projectId);
    const start = Math.max(0, Number.parseInt(cursor ?? "0", 10) || 0);
    const page = all.slice(start, start + limit);
    return jsonResult({
      projects: page.map(({ p, role }) => ({
        id: p.id,
        title: p.title,
        role,
        status: p.status,
        published_url: p.deployUrl,
        has_unpublished_changes: p.hasUnpublishedChanges,
        updated_at: p.updatedAt.toISOString(),
        editor_url: editorUrl(p.id),
      })),
      next_cursor: start + limit < all.length ? String(start + limit) : null,
    });
  },
});

export const getProjectTool = defineTool({
  name: "get_project",
  title: "Get project",
  description:
    "The details of one project: whether it is a page (HTML files) or an app (React + TypeScript in /src), its file tree with sizes, " +
    "its pages, where it is published and the editor_url to open it in OpenLen. Files marked read_only are OpenLen's manual.",
  inputSchema: z.object({ project_id: z.string().min(1).describe("From list_projects.") }),
  annotations: READ_ONLY,
  async run({ project_id }, caller) {
    const open = await openProject(caller, project_id, "ver");
    if (!open.ok) return open.result;
    const { acceso, row } = open;
    const session = mcpAgentSession({ projectId: project_id, ownerId: acceso.duenoId, personId: caller.userId, app: row.data.app });
    const tree = await cargarFicherosDeLaTerminal(session, realDeps());
    const paths = Object.keys(tree).sort();
    const app = row.data.app ?? null;
    return jsonResult({
      id: project_id,
      title: row.title,
      type: app ? "app" : "page",
      role: ROLE[acceso.rol],
      app: app ? { catalog: app.catalogo, entry: app.entrada } : null,
      pages: app ? [] : paths.flatMap((p) => {
        const hit = paginaDeRuta(p);
        return hit ? [hit.page ?? "/"] : [];
      }),
      files: paths.map((path) => ({
        path,
        bytes: Buffer.byteLength(tree[path] ?? "", "utf8"),
        ...(esDeLaPlataforma(path) ? { read_only: true } : {}),
      })),
      published_url: deployUrlFor(row.subdomain),
      published_at: row.publishedAt ? row.publishedAt.toISOString() : null,
      editor_url: editorUrl(project_id),
      next_step: "Call get_docs before writing code for this project.",
    });
  },
});
