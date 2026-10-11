// write_file y delete_file: por la puerta de escritura, con la versión del
// fichero para no pisar a nadie. Una página no se borra desde aquí.
import * as z from "zod4";
import { paginaDeRuta } from "@/lib/agent/ficheros/sitio";
import { editorUrl } from "../config";
import { fileVersion } from "../file-version";
import { consumeQuota } from "../quota";
import { textResult, toolError } from "../results";
import { applyChanges, checkVersion, DESTRUCTIVE_ANNOTATIONS, loadTreeForWrite } from "../writes";
import { defineTool } from "./define";

const saved = (path: string, content: string, diagnostics: string | null, projectId: string) =>
  textResult(
    [
      `Saved ${path} — version ${fileVersion(content)}. This changes the draft; the published site changes only when you call publish.`,
      diagnostics ?? "",
      `Open in OpenLen: ${editorUrl(projectId)}`,
    ].filter(Boolean).join("\n"),
  );

export const writeFileTool = defineTool({
  name: "write_file",
  title: "Write file",
  description:
    "Creates a file, or replaces a whole file, in the project's draft. To replace a file that exists, pass the version read_file showed " +
    "as expected_version (to change part of a file, use edit_file). Pages are /index.html and /<slug>/index.html; app source lives in /src. " +
    "For apps the result includes compile diagnostics.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    path: z.string().min(1).describe("Absolute path, e.g. /src/components/Hero.tsx or /pricing/index.html"),
    content: z.string().describe("The whole new content of the file."),
    expected_version: z.string().optional().describe("Required when the file already exists: the version from read_file."),
  }),
  annotations: DESTRUCTIVE_ANNOTATIONS,
  async run({ project_id, path, content, expected_version }, caller) {
    const t = await loadTreeForWrite(caller, project_id);
    if (!t.ok) return t.result;
    const exists = Object.hasOwn(t.tree, path);
    if (exists) {
      if (!expected_version) {
        return toolError("read_first", `${path} already exists. Read it first and pass its version as expected_version, or use edit_file.`);
      }
      const conflict = checkVersion(t.tree, path, expected_version);
      if (conflict) return conflict;
      if (t.tree[path] === content) return textResult(`${path} is unchanged (version ${fileVersion(content)}).`);
    }
    const denied = await consumeQuota(caller, "write_file");
    if (denied) return denied;
    const r = await applyChanges(caller, t.open, [{ tipo: "escrito", ruta: path, contenido: content, crea: !exists }], t.tree);
    if (!r.ok) return r.result;
    return saved(path, r.saved[path] ?? content, r.diagnostics, project_id);
  },
});

export const deleteFileTool = defineTool({
  name: "delete_file",
  title: "Delete file",
  description:
    "Deletes a file of the project's draft (not a page: pages are removed by the person in the OpenLen editor). " +
    "Pass the version read_file showed as expected_version. The old content stays in the project's version history.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    path: z.string().min(1),
    expected_version: z.string().min(1).describe("The version from read_file."),
  }),
  annotations: DESTRUCTIVE_ANNOTATIONS,
  async run({ project_id, path, expected_version }, caller) {
    const t = await loadTreeForWrite(caller, project_id);
    if (!t.ok) return t.result;
    if (paginaDeRuta(path)) {
      return toolError(
        "page_delete_in_editor",
        `${path} is a page; pages are removed by the person in the OpenLen editor: ${editorUrl(project_id)}`,
      );
    }
    if (!Object.hasOwn(t.tree, path)) return toolError("not_found", `There is no file at ${path}.`);
    const conflict = checkVersion(t.tree, path, expected_version);
    if (conflict) return conflict;
    const denied = await consumeQuota(caller, "write_file");
    if (denied) return denied;
    const r = await applyChanges(caller, t.open, [{ tipo: "borrado", ruta: path }], t.tree);
    if (!r.ok) return r.result;
    return textResult([`Deleted ${path}.`, r.diagnostics ?? ""].filter(Boolean).join("\n"));
  },
});
