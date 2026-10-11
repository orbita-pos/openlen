// LA VERSIÓN DE UN FICHERO: la huella de su contenido. La enseña read_file y
// la piden las escrituras para no pisar lo que otro cambió entre medias (el
// `sha` de GitHub). No hay columna que mantener: el contenido ES la versión.
import crypto from "node:crypto";

export function fileVersion(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex").slice(0, 12);
}
