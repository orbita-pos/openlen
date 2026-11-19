/**
 * MULTIEDIT — atomic batch of exact edits on one file (Claude Code's MultiEdit).
 *
 * Applies 1..MAX_MULTI_EDITS sequential edits in memory using `planearEdit`, so
 * it inherits every guard (read-before-edit, platform manual read-only, CRLF
 * preservation, curly quotes, `\uXXXX` escapes, deletion newline trimming).
 *
 * All-or-nothing: if edit #k fails, returns `{ ok: false }` naming edit #k and
 * its exact reason, and nothing is persisted.
 */
import {
  NOTA_CAMBIADO_EN_DISCO,
  NOTA_ESTADO_AL_DIA,
  coercerEntradaEdit,
  planearEdit,
  type PlanDeEdit,
} from "./edit";
import { normalizarFinales, type Leidos, type SitioLegible } from "./read";
import { fallo } from "./resultado";
import { resolverRuta } from "./sitio";

export const MAX_MULTI_EDITS = 20;

export interface EntradaMultiEditItem {
  readonly old_string: string;
  readonly new_string: string;
  readonly replace_all?: boolean;
}

export interface EntradaMultiEdit {
  readonly file_path: string;
  readonly edits: readonly EntradaMultiEditItem[];
  readonly editsInvalido?: string;
}

export function coercerEntradaMultiEdit(raw: Record<string, unknown>): EntradaMultiEdit {
  const file_path = typeof raw.file_path === "string" ? raw.file_path : typeof raw.path === "string" ? raw.path : "";
  if (!Array.isArray(raw.edits)) {
    return { file_path, edits: [], editsInvalido: "edits must be a non-empty array of { old_string, new_string } objects." };
  }
  const edits: EntradaMultiEditItem[] = [];
  for (let i = 0; i < raw.edits.length; i++) {
    const item = raw.edits[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return {
        file_path,
        edits: [],
        editsInvalido: `edits[${i}] must be an object with old_string and new_string.`,
      };
    }
    const coerced = coercerEntradaEdit({ ...(item as Record<string, unknown>), file_path });
    edits.push({
      old_string: coerced.old_string,
      new_string: coerced.new_string,
      ...(coerced.replace_all !== undefined ? { replace_all: coerced.replace_all } : {}),
    });
  }
  return { file_path, edits };
}

export function planearMultiEdit(entrada: EntradaMultiEdit, sitio: SitioLegible, leidos: Leidos): PlanDeEdit {
  const no = (mensaje: string): PlanDeEdit => ({ ok: false, resultado: fallo(mensaje) });

  if (entrada.editsInvalido) return no(entrada.editsInvalido);
  if (entrada.edits.length === 0) return no("edits must contain at least 1 edit.");
  if (entrada.edits.length > MAX_MULTI_EDITS) {
    return no(`MultiEdit accepts at most ${MAX_MULTI_EDITS} edits per call (received ${entrada.edits.length}). Split them or use Write for a full rewrite.`);
  }

  const ruta = resolverRuta(entrada.file_path);
  const crudoInicial = sitio.contenido(ruta);
  const lecturaInicial = leidos.get(ruta);
  const cambiadoEnDisco =
    crudoInicial !== null &&
    lecturaInicial !== undefined &&
    !lecturaInicial.vistaParcial &&
    lecturaInicial.instantanea !== normalizarFinales(crudoInicial);

  let contenidoActual: string | null = crudoInicial;
  let crea = false;

  for (let i = 0; i < entrada.edits.length; i++) {
    const paso = entrada.edits[i]!;
    const sitioPaso: SitioLegible =
      i === 0
        ? sitio
        : {
            ficheros: sitio.ficheros,
            contenido: (r) => (r === ruta ? contenidoActual : sitio.contenido(r)),
          };
    const leidosPaso: Leidos =
      i === 0
        ? leidos
        : new Map([
            [ruta, { instantanea: normalizarFinales(contenidoActual ?? ""), offset: undefined, limit: undefined }],
          ]);

    const resultado = planearEdit(
      {
        file_path: entrada.file_path,
        old_string: paso.old_string,
        new_string: paso.new_string,
        ...(paso.replace_all !== undefined ? { replace_all: paso.replace_all } : {}),
      },
      sitioPaso,
      leidosPaso,
    );

    if (!resultado.ok) {
      return no(
        `MultiEdit failed at edit #${i + 1} of ${entrada.edits.length} (no changes were saved): ${resultado.resultado.error}`,
      );
    }

    if (i === 0 && resultado.crea) crea = true;
    contenidoActual = resultado.contenido;
  }

  if (contenidoActual === null) return no("MultiEdit produced no content.");
  if (crudoInicial !== null && contenidoActual === crudoInicial) {
    return no("The edits cancel out and would leave the file unchanged: nothing was saved.");
  }

  const count = entrada.edits.length;
  const label = count === 1 ? "1 edit applied" : `${count} edits applied`;
  const nota = (guardadoIgual: boolean) =>
    cambiadoEnDisco ? NOTA_CAMBIADO_EN_DISCO : guardadoIgual ? NOTA_ESTADO_AL_DIA : "";

  return {
    ok: true,
    ruta,
    contenido: contenidoActual,
    crea,
    respuesta: ({ guardadoIgual }) => `Edited ${entrada.file_path} (${label}).${nota(guardadoIgual)}`,
  };
}
