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

/**
 * Vuelve a atar la cápsula al documento que se ACABA de guardar.
 *
 * EL PROBLEMA QUE RESUELVE. El hash ata `projectId + html + code`, y
 * `buildCapsule` sólo se llamaba al crear el proyecto. La primera edición del
 * titular cambiaba los bytes → la cápsula dejaba de cuadrar → al publicar el
 * runtime se omitía con un `console.log` como único aviso. Es decir: el
 * JavaScript del modelo duraba hasta que el usuario tocaba algo. Con el Chat y
 * el Agente dentro del alcance —que son superficies de EDICIÓN— eso deja de ser
 * un detalle y pasa a ser el modo de fallo principal.
 *
 * POR QUÉ ESTO NO DEBILITA NADA. El código NO se recibe por parámetro: sale de
 * la cápsula que ya estaba guardada. Re-sellar puede mover el documento al que
 * el código está atado, pero es incapaz de introducir código nuevo — que es lo
 * único de lo que el hash protege de verdad.
 *
 * DEVUELVE `null` PARA "NO TOQUES LA COLUMNA", nunca para "bórrala". Una cápsula
 * de una versión que no conocemos se deja intacta a propósito: interpretarla con
 * las reglas de hoy sería justo lo que `verifyCapsule` evita, y borrarla sería
 * destruir el trabajo del modelo por no saber leerlo.
 *
 * Se re-sella con el interruptor apagado también. Sin código que inyectar no
 * cambia nada hoy, y mantiene la cápsula utilizable el día que se encienda.
 */
export function resealRuntime(input: {
  readonly projectId: string;
  /** Los bytes EXACTOS que se van a guardar en `data.html`. */
  readonly html: string;
  /** `projects.generatedRuntime` tal cual se leyó. */
  readonly capsule: unknown;
}): ModelRuntimeCapsule | null {
  if (input.capsule === null || typeof input.capsule !== "object") return null;
  const c = input.capsule as Partial<ModelRuntimeCapsule>;
  if (typeof c.code !== "string" || c.code === "") return null;
  if (c.v !== RUNTIME_CAPSULE_VERSION) return null;
  return buildCapsule({ projectId: input.projectId, html: input.html, code: c.code });
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

/**
 * MUEVE una cápsula a otro proyecto —y opcionalmente a otro documento— sin
 * poder inventar código.
 *
 * La cápsula ata `projectId + html + code`. Copiar la columna tal cual a un
 * proyecto nuevo no sirve de nada: el id cambia y el hash deja de cuadrar, así
 * que la copia sale muda. Hay que volver a atarla.
 *
 * DOS COSAS QUE LA HACEN SEGURA, y las dos importan:
 *
 * 1. El código NO se recibe por parámetro: sale de `verifyCapsule`, es decir de
 *    la cápsula que ya estaba guardada. Esto puede mover a qué documento apunta
 *    un código; es incapaz de introducir uno nuevo, que es de lo único que el
 *    hash protege de verdad. Es el mismo argumento de `resealRuntime`.
 *
 * 2. Se VERIFICA contra el origen antes de re-atar, y ésa es la diferencia con
 *    `resealRuntime`. Si la cápsula de origen estaba desajustada, su página ya
 *    estaba muda: re-atarla a la copia RESUCITARÍA un código que el autor había
 *    perdido, y la copia se comportaría distinto del original sin que nadie lo
 *    pidiera. Una copia hereda lo que el original tenía, nunca más.
 *
 * `null` = no hay nada válido que llevar.
 */
export function rebindCapsule(input: {
  readonly fromProjectId: string;
  /** Los bytes contra los que se selló en el ORIGEN. */
  readonly fromHtml: string;
  readonly toProjectId: string;
  /** Los bytes que el DESTINO va a guardar. Iguales al copiar, distintos
   *  cuando el destino normaliza (el remix pasa por el born-canonical). */
  readonly toHtml: string;
  readonly capsule: unknown;
}): ModelRuntimeCapsule | null {
  const check = verifyCapsule(input.capsule, {
    projectId: input.fromProjectId,
    html: input.fromHtml,
  });
  if (!check.ok) return null;
  return buildCapsule({
    projectId: input.toProjectId,
    html: input.toHtml,
    code: check.code,
  });
}

/** Por qué una página con cápsula acabó publicándose SIN su runtime.
 *
 * `varias_paginas` y `dominio_propio` se retiraron el 2026-08-25: ya no hay
 * ninguna forma de que una página PIERDA su JavaScript por el sitio en el que
 * está o por el dominio que lo sirve. Lo único que queda es el interruptor y
 * que la cápsula cuadre con el documento.
 */
export type RuntimeSkip = CapsuleRejection | "apagado";

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
  /** El HTML guardado DE ESTA PÁGINA, sin pasar por ningún bake todavía.
   *  Para la Home es `data.html`; para una subpágina, `data.pages[slug].html`. */
  readonly html: string;
  /** La cápsula DE ESTA PÁGINA — ver lib/projects/page-runtimes.ts. */
  readonly capsule: unknown;
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

  // DOS PUERTAS RETIRADAS el 2026-08-25, por decisión de Jesús.
  //
  // `varias_paginas` no hacía lo que su nombre decía. No era «las subpáginas no
  // llevan JavaScript»: era **el sitio entero se queda sin él en cuanto añades
  // la segunda página**, la Home incluida. MEDIDO — con una subpágina, esta
  // misma función devolvía `skipped` para el documento raíz que sí tenía su
  // cápsula en regla. El usuario añadía una página de precios y su carrito
  // dejaba de funcionar, sin que nada se lo dijera.
  //
  // `dominio_propio` apagaba el JavaScript de una página que funcionaba, sólo
  // por conectarle un dominio. La preocupación de fondo era real —un dominio se
  // puede añadir DESPUÉS y serviría un release ya vivo— pero la respuesta era
  // desproporcionada: el release que sirve es el mismo documento con la misma
  // cápsula, y el hash lo autoriza igual bajo un dominio que bajo el subdominio.
  //
  // Formularios y módulos habían dejado de descalificar antes, por la misma
  // razón: tirar el JavaScript es una herramienta demasiado burda. Lo que
  // protege es la puerta de producción y el hash, no una lista de excusas.

  return { kind: "authorized", code: check.code };
}
