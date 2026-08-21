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

/** Por qué una página con cápsula acabó publicándose SIN su runtime. */
export type RuntimeSkip =
  | CapsuleRejection
  | "apagado"
  | "pagina_no_elegible"
  | "modulos_activos"
  | "varias_paginas"
  | "dominio_propio";

export type PublishAuthorization =
  | { readonly kind: "authorized"; readonly code: string }
  | { readonly kind: "skipped"; readonly reason: RuntimeSkip };

/**
 * ¿Se inyecta el runtime en esta publicación?
 *
 * SE APARTA DEL PLAN DE LA AUDITORÍA EN UN PUNTO, a propósito: allí una cápsula
 * que no cuadra ABORTA la publicación. Aquí sólo se omite el runtime.
 *
 * El motivo es que abortar no protege de nada. Si la cápsula no cuadra no se
 * inyecta código, y una página sin código no puede hacer daño — el resultado
 * seguro se obtiene igual por las dos vías. Lo que sí cambia es quién lo paga:
 * el caso corriente de "no cuadra" no es un ataque, es un usuario que editó su
 * titular después de generar. Bloquearle la publicación entera por eso sería
 * hostil, y además enseñaría a la gente a desconfiar de un mecanismo que está
 * haciendo su trabajo.
 *
 * Abortar sigue siendo lo correcto donde SÍ vamos a inyectar y el sellado falla
 * — eso es `OPENLEN_CSP_SEAL=strict`, y vive en el publicador.
 *
 * Se verifica contra `data.html` TAL CUAL está guardado, antes de que la
 * tubería de publicación lo transforme: el hash se calculó sobre esos bytes.
 */
export function authorizeRuntimeForPublish(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly projectId: string;
  /** El HTML guardado, sin pasar por ningún bake todavía. */
  readonly html: string;
  readonly capsule: unknown;
  /** Subpáginas del sitio. El piloto es UN documento. */
  readonly pageCount: number;
  readonly hasCustomDomain: boolean;
  /** `pageAllowsRuntime` del módulo de ingestión — formularios y módulos
   *  presentes en el MARCADO. */
  readonly pageEligible: boolean;
  /** `moduleSurfacesActive` sobre los settings del proyecto. Va aparte
   *  porque un módulo puede estar encendido sin dejar rastro en el HTML. */
  readonly modulesActive: boolean;
}): PublishAuthorization {
  const check = verifyCapsule(input.capsule, {
    projectId: input.projectId,
    html: input.html,
  });
  if (!check.ok) return { kind: "skipped", reason: check.reason };

  // El interruptor se comprueba DESPUÉS de verificar, no antes: así el motivo
  // que se registra distingue "está apagado" de "la cápsula no cuadraba", y no
  // se pierde la única señal que dice si el mecanismo funciona.
  if (input.env.OPENLEN_MODEL_JS !== "1") return { kind: "skipped", reason: "apagado" };

  // Un dominio propio puede añadirse DESPUÉS y serviría el release ya vivo, así
  // que se comprueba aquí y se volverá a comprobar al activarlo.
  if (input.hasCustomDomain) return { kind: "skipped", reason: "dominio_propio" };
  if (input.pageCount > 0) return { kind: "skipped", reason: "varias_paginas" };
  if (!input.pageEligible) return { kind: "skipped", reason: "pagina_no_elegible" };
  // Los settings se miran SIEMPRE, aunque el marcado esté limpio.
  if (input.modulesActive) return { kind: "skipped", reason: "modulos_activos" };

  return { kind: "authorized", code: check.code };
}

/**
 * TODAS las superficies que descalifican a una página, no sólo las del marcado.
 *
 * `pageAllowsRuntime` mira el HTML, y con eso no basta: los módulos se activan
 * por `PATCH /api/projects/[id]/settings`, que NO toca el documento. El HTML no
 * cambia → la cápsula sigue cuadrando → y la publicación hornea el widget desde
 * los settings igual. Una página podía acabar con el chat y con el JavaScript
 * del modelo a la vez, que es justo lo que el piloto existe para impedir.
 *
 * Lo señaló una auditoría externa y estaba en lo cierto. Por eso la elegibilidad
 * se calcula sobre el ESTADO REAL en el momento de publicar —marcado, settings,
 * páginas y dominio— y no sobre una sola de sus mitades.
 *
 * Los settings NO entran en el hash de la cápsula a propósito: el hash ata el
 * documento, y la elegibilidad se vuelve a evaluar en cada publicación. Meterlos
 * dentro obligaría a re-sellar la cápsula cada vez que alguien cambia un color.
 */
export function moduleSurfacesActive(settings: unknown): boolean {
  if (settings === null || typeof settings !== "object") return false;
  const s = settings as Record<string, { enabled?: unknown } | undefined>;
  // Cada uno de estos hornea un widget que habla con una API del mismo origen,
  // y varias de esas APIs llevan la sesión del visitante.
  for (const clave of [
    "assistant",
    "chat",
    "members",
    "comments",
    "bookings",
    "collections",
    "orders",
    "whatsapp",
  ]) {
    if (s[clave]?.enabled === true) return true;
  }
  // `forms` no es un interruptor: es un mapa con la configuración de cada
  // formulario del documento. Que exista una entrada significa que hay
  // formulario, aunque el marcado haya cambiado desde entonces.
  const forms = (settings as { forms?: Record<string, unknown> }).forms;
  if (forms && Object.keys(forms).length > 0) return true;
  // Datos vivos: la página consulta una hoja a través de nuestra API.
  if ((settings as { liveData?: unknown }).liveData) return true;
  return false;
}
