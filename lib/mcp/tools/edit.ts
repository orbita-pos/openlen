// edit_file: el `str_replace` del text editor de Anthropic, que es lo que los
// modelos conocen. `old_string` coincide EXACTO y una sola vez (o todas con
// replace_all); los errores dicen qué pasó y qué hacer.
import * as z from "zod4";
import { editorUrl } from "../config";
import { fileVersion } from "../file-version";
import { consumeQuota } from "../quota";
import { textResult, toolError } from "../results";
import { applyChanges, checkVersion, loadTreeForWrite, WRITE_ANNOTATIONS } from "../writes";
import { defineTool } from "./define";

export function replaceExact(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): { ok: true; content: string; count: number } | { ok: false; code: "no_match" | "multiple_matches" | "no_change"; count: number } {
  if (oldString === newString) return { ok: false, code: "no_change", count: 0 };
  const count = oldString.length === 0 ? 0 : content.split(oldString).length - 1;
  if (count === 0) return { ok: false, code: "no_match", count };
  if (count > 1 && !replaceAll) return { ok: false, code: "multiple_matches", count };
  // split/join y no replace(): los `$` del texto nuevo son texto, no patrones.
  return { ok: true, content: content.split(oldString).join(newString), count };
}

export const editFileTool = defineTool({
  name: "edit_file",
  title: "Edit file",
  description:
    "Replaces an exact piece of text in one file of the project's draft. old_string must match exactly (whitespace included) and only once, " +
    "unless replace_all is true. Pass the version read_file showed as expected_version to be sure nobody changed the file meanwhile. " +
    "For apps the result includes compile diagnostics.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    path: z.string().min(1),
    old_string: z.string().min(1).describe("The exact text to replace."),
    new_string: z.string().describe("The text to put instead."),
    replace_all: z.boolean().optional().describe("Replace every occurrence (default false)."),
    expected_version: z.string().optional().describe("The version from read_file."),
  }),
  annotations: WRITE_ANNOTATIONS,
  async run({ project_id, path, old_string, new_string, replace_all = false, expected_version }, caller) {
    const t = await loadTreeForWrite(caller, project_id);
    if (!t.ok) return t.result;
    if (!Object.hasOwn(t.tree, path)) {
      return toolError("not_found", `There is no file at ${path}. edit_file only changes existing files; use write_file to create one.`);
    }
    if (expected_version) {
      const conflict = checkVersion(t.tree, path, expected_version);
      if (conflict) return conflict;
    }
    const r = replaceExact(t.tree[path] ?? "", old_string, new_string, replace_all);
    if (!r.ok) {
      const why = {
        no_match: `old_string was not found in ${path}. Read the file again and copy the exact text, including spaces and line breaks.`,
        multiple_matches: `old_string appears ${r.count} times in ${path}. Add surrounding text to make it unique, or set replace_all.`,
        no_change: "old_string and new_string are the same: there is nothing to change.",
      }[r.code];
      return toolError(r.code, why);
    }
    const denied = await consumeQuota(caller, "write_file");
    if (denied) return denied;
    const w = await applyChanges(caller, t.open, [{ tipo: "escrito", ruta: path, contenido: r.content, crea: false }], t.tree);
    if (!w.ok) return w.result;
    const final = w.saved[path] ?? r.content;
    return textResult(
      [
        `Edited ${path} (${r.count} replacement${r.count === 1 ? "" : "s"}) — version ${fileVersion(final)}. This changes the draft, not the published site.`,
        w.diagnostics ?? "",
        `Open in OpenLen: ${editorUrl(project_id)}`,
      ].filter(Boolean).join("\n"),
    );
  },
});
