import { createHash, timingSafeEqual } from "node:crypto";

// lib/projects/model-runtime.ts — la cápsula que autoriza el JavaScript del
// modelo, y el hash que la ata a UN documento exacto.
//
// POR QUÉ UN HASH Y NO UNA BANDERA DE PROCEDENCIA.
//
// Una columna `source = "deepseek"` parece bastar y no basta: depende de que
// TODOS los escritores presentes y futuros se acuerden de limpiarla. Hoy
// reemplazan el HTML el PATCH de `/api/projects/[id]/html`, el guardado del
// Agente, el restore de versiones y algún helper más. Si uno se olvida, el
// publicador ve la bandera encendida y NO TIENE FORMA de saber si autoriza el
// documento original o uno distinto — y el fallo es silencioso.
//
// Peor: ningún test puede demostrar "no existe ningún escritor olvidado".
// Sólo puede probar los que conoce hoy.
//
// El hash no depende de que nadie recuerde nada. Cambiar un byte del HTML, del
// código, del proyecto o de la política produce un desajuste, y el publicador
// decide LOCALMENTE sin saber qué ruta tocó el documento.

/** La versión de la política. Va DENTRO del hash: cambiar las reglas del piloto
 *  invalida todas las cápsulas viejas por construcción, en vez de dejarlas
 *  autorizadas bajo unas reglas que ya no existen. */
export const RUNTIME_POLICY = "classic-inline:body-end";

/** El prefijo de dominio. Impide que un hash calculado para otra cosa en este
 *  mismo sistema pueda valer aquí por casualidad. */
const DOMAIN = "openlen:model-js:v1";

export const RUNTIME_CAPSULE_VERSION = "deepseek-generate-v1";

export interface ModelRuntimeCapsule {
  readonly v: typeof RUNTIME_CAPSULE_VERSION;
  /** El script, byte a byte como lo escribió el modelo. */
  readonly code: string;
  /** SHA-256 COMPLETO en hex, 64 caracteres. Sin truncar: un hash recortado
   *  deja de ser una prueba y pasa a ser un indicio. */
  readonly digest: string;
}

/**
 * El hash que ata código, documento, proyecto y política.
 *
 * Cada parte va precedida de su LONGITUD. Sin eso, dos triples distintos
 * podrían concatenarse igual —mover un carácter del final del HTML al principio
 * del código— y colisionar sin que nadie hubiera roto SHA-256.
 *
 * Se calcula sobre los bytes UTF-8 EXACTOS que se van a guardar. Nada de trim,
 * de normalización Unicode, de parsear y reserializar el DOM ni de tocar los
 * saltos de línea: cualquiera de esas cosas hace que el hash de la escritura y
 * el de la lectura dejen de coincidir, y el síntoma sería "la publicación falla
 * a veces", que es el peor síntoma posible.
 */
export function runtimeDigest(input: {
  readonly projectId: string;
  readonly html: string;
  readonly code: string;
}): string {
  const h = createHash("sha256");
  h.update(DOMAIN, "utf8");
  for (const parte of [input.projectId, input.html, input.code]) {
    const bytes = Buffer.from(parte, "utf8");
    h.update(String(bytes.length), "utf8");
    h.update(bytes);
  }
  h.update(RUNTIME_POLICY, "utf8");
  return h.digest("hex");
}

export function buildCapsule(input: {
  readonly projectId: string;
  readonly html: string;
  readonly code: string;
}): ModelRuntimeCapsule {
  return {
    v: RUNTIME_CAPSULE_VERSION,
    code: input.code,
    digest: runtimeDigest(input),
  };
}

export type CapsuleRejection =
  | "ausente"
  | "malformada"
  | "version_desconocida"
  | "desajuste";

export type CapsuleCheck =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly reason: CapsuleRejection };

/**
 * ¿Autoriza esta cápsula a ESTE documento?
 *
 * Se le pasa lo que se acaba de leer de Postgres, sin tocar. La comparación es
 * de tiempo constante — no porque un atacante vaya a medir microsegundos contra
 * un publicador, sino porque un `===` sobre un valor de seguridad es la clase de
 * detalle que se copia a sitios donde sí importa.
 */
export function verifyCapsule(
  capsule: unknown,
  doc: { readonly projectId: string; readonly html: string },
): CapsuleCheck {
  if (capsule === null || capsule === undefined) return { ok: false, reason: "ausente" };
  if (typeof capsule !== "object") return { ok: false, reason: "malformada" };

  const c = capsule as Partial<ModelRuntimeCapsule>;
  if (typeof c.code !== "string" || typeof c.digest !== "string" || typeof c.v !== "string") {
    return { ok: false, reason: "malformada" };
  }
  if (!/^[0-9a-f]{64}$/.test(c.digest)) return { ok: false, reason: "malformada" };
  // Una versión que no conocemos NO se interpreta con las reglas de hoy.
  if (c.v !== RUNTIME_CAPSULE_VERSION) return { ok: false, reason: "version_desconocida" };

  const esperado = runtimeDigest({ projectId: doc.projectId, html: doc.html, code: c.code });
  const a = Buffer.from(esperado, "hex");
  const b = Buffer.from(c.digest, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "desajuste" };
  }
  return { ok: true, code: c.code };
}
