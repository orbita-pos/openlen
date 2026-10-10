// LA HUELLA DE LA CARPETA PUBLICABLE (pieza 9 de plans/len-agente-2026/plan-2-5).
// `projects.filesHash` la guarda al día con cada fichero que se escribe o se
// borra, y `publishedFilesHash` la de la última publicación: si difieren, hay
// «cambios sin publicar» aunque ninguna página se haya movido
// (`computeUnpublishedChanges`, lib/projects.ts). Sólo cuenta lo que se publica:
// una prueba o una migración nueva no cambia lo que ven los visitantes. Y
// `/.env` (spec local 2026-10-10), que no se publica pero va DENTRO del paquete
// de la app: cambiarlo cambia lo que ven los visitantes.
import { createHash } from "node:crypto";

import { isCompileInputPath } from "@/lib/agent/ficheros/folder";

export function folderFingerprint(files: Readonly<Record<string, string>>): string | null {
  const paths = Object.keys(files).filter(isCompileInputPath).sort();
  if (paths.length === 0) return null;
  const h = createHash("sha256");
  for (const p of paths) h.update(p, "utf8").update("\u0000").update(files[p]!, "utf8").update("\u0000");
  return h.digest("hex").slice(0, 16);
}
