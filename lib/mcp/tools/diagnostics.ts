// get_diagnostics: lo que no compila de una app, y sus tipos y lint DE VERDAD
// (el mismo comprobador que la terminal de Len), con fichero y línea.
import * as z from "zod4";
import { erroresDeLaApp, problemasDelCascaron } from "@/lib/agent/compila-la-app";
import { isPublishableFolderPath } from "@/lib/agent/ficheros/folder";
import { realDeps } from "@/lib/agent/tools";
import { checkAppInWorker } from "@/lib/apps/checker/check-app";
import { textoDeDiagnostico } from "@/lib/apps/compilador";
import { openProject } from "../access";
import { consumeQuota } from "../quota";
import { jsonResult } from "../results";
import { defineTool, READ_ONLY } from "./define";

interface Checked {
  ruta: string;
  linea: number;
  columna: number;
  gravedad: string;
  mensaje: string;
  codigo: string;
}
const line = (d: Checked) => `${d.ruta}:${d.linea}:${d.columna} — ${d.gravedad} ${d.codigo}: ${d.mensaje}`;

export const getDiagnosticsTool = defineTool({
  name: "get_diagnostics",
  title: "Get diagnostics",
  description:
    "For an app: compile errors (with file:line) and, if it compiles, TypeScript and ESLint results from OpenLen's real checker. " +
    "An app that doesn't compile can't be published. Pages have no compile step: use view_page for them.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    include_types_and_lint: z.boolean().optional().describe("Default true. Types and lint take a few seconds."),
  }),
  annotations: READ_ONLY,
  async run({ project_id, include_types_and_lint = true }, caller) {
    const open = await openProject(caller, project_id, "ver");
    if (!open.ok) return open.result;
    const app = open.row.data.app;
    if (!app) {
      return jsonResult({ type: "page", compile: [], note: "Pages have no compile step. Use view_page to measure contrast, mobile overflow and JS errors." });
    }
    const denied = await consumeQuota(caller, "get_diagnostics");
    if (denied) return denied;
    const carpeta = (await realDeps().projectFiles?.(project_id)) ?? {};
    const compile = [...erroresDeLaApp(app, carpeta), ...problemasDelCascaron(app, open.row.data.html, carpeta)].map(textoDeDiagnostico);
    if (compile.length > 0 || !include_types_and_lint) {
      return jsonResult({
        type: "app",
        compile,
        types_and_lint: compile.length > 0 ? "skipped: fix the compile errors first" : "not requested",
      });
    }
    const files = Object.fromEntries(Object.entries(carpeta).filter(([ruta]) => isPublishableFolderPath(ruta)));
    const checked = await checkAppInWorker({ files, catalogo: app.catalogo });
    if (!checked) return jsonResult({ type: "app", compile, types_and_lint: "unavailable: the checker did not answer in time, try again" });
    return jsonResult({ type: "app", compile, types: checked.typescript.map(line), lint: checked.eslint.map(line) });
  },
});
