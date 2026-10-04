// F1 agent tool runtime — the three tool bodies the model can call
// (leer_estado, editar_pagina, activar_modulo), all built on existing
// cores (settings-patch, html-ops, versions, chat/store).
// No new persistence logic here — this wires the model's function calls
// to the same read-modify-write paths the UI buttons already use.
//
// Deps are injected (AgentDeps) so the tool bodies are unit-testable with
// zero DB — realDeps() is the thin drizzle-backed implementation used at
// runtime, and is deliberately NOT unit-tested (the fakes are).
//
// Every tool error is DATA, not a thrown exception: the model gets
// {ok:false, error} back in its functionResponse and decides what to do
// next (retry, ask leer_estado, give up). runAgentTool wraps the whole
// dispatch in try/catch so a bug in one tool can never crash the agent
// loop mid-conversation.

import type { AlmacenDeclarado } from "@/lib/page-data/declaracion";
import type { FilaDeAlmacen, PlanDeAlmacen } from "@/lib/agent/ficheros/datos";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  editImage,
  realImageEditTransport,
  type ImageEditInput,
  type ImageEditResult,
} from "@/lib/ai/image-edit-core";
import { getOrCreateOwnerChatUser } from "@/lib/chat/store";
import { stripOpIds } from "@/lib/html-ops";
import type { Diagnostico } from "@/lib/agent/diagnosticos";
import { debitCredits } from "@/lib/credits";
import { deshacerSobreLoActual, ultimaEscrituraDeLen } from "@/lib/agent/deshacer-lo-de-len";
import { vistaParaMedir, type ContextoDeVista } from "@/lib/lienzo/documento";
import { validarPasos, type PasoDeUso } from "@/lib/agent/pasos-de-uso";
import type { OpDescrita } from "@/lib/agent/ops-descritas";
import { getUserMemory, rememberAboutUser } from "@/lib/agent/user-memory";
import { webDelServidor, type WebDeps } from "@/lib/agent/web/buscar";
import { NOMBRE_WEB_FETCH, NOMBRE_WEB_SEARCH, toolWebFetch, toolWebSearch } from "@/lib/agent/web/herramientas";
import { activeHtml } from "@/lib/page-engine/persist";
import { actualizarData } from "@/lib/projects/escribir-data";
import { leerCambiosSinPublicar, renameProject, setProjectUserBrief } from "@/lib/projects";
import { extForMime, getAssetStorage } from "@/lib/projects/assets";
import { validateUrl } from "@/lib/style-match/scrape/validate-url";
import { validateSubdomain } from "@/lib/subdomain/validate";
import {
  applySettingsPatch,
  validateSettingsPatch,
  type SettingsPatchBody,
  type SettingsPatchOutcome,
} from "@/lib/projects/settings-patch";
import type { ProjectData } from "@/lib/projects/types";
import { createVersion, type VersionSource } from "@/lib/projects/versions";
import { isPublishLocale } from "@/lib/publish/publish-locales";
import {
  AGENT_MODULES,
  MODULE_NOMBRE,
  type AgentModule,
} from "@/lib/agent/catalog";
import { searchCuratedPhotos } from "@/lib/agent/photo-search";
import type { Leidos } from "@/lib/agent/ficheros/read";
import {
  esHerramientaDeFicheros,
  guardarFichero,
  paginaPedida,
  toolEdit,
  toolGlob,
  toolGrep,
  toolRead,
  toolWrite,
} from "@/lib/agent/herramientas-de-ficheros";
import { ficherosDelSitio, leerFichero, rutaDePagina, rutaRelativa } from "@/lib/agent/ficheros/sitio";
import { CLAVE_TOOL_RESULT } from "@/lib/agent/ficheros/resultado";
import { NOMBRE_BASH } from "@/lib/agent/terminal/declaracion";
import { toolBash } from "@/lib/agent/terminal/herramienta";
import type { TerminalDeLen } from "@/lib/agent/terminal/terminal";
import type { AgentMode } from "@/lib/agent/dynamis";
import type { CambiosDelComando } from "@/lib/agent/terminal/cambios-del-comando";
import type { OwnerReason } from "@/lib/agent/owner-reason";
import {
  toolPrepararRespuesta,
  toolVerFormularios,
  toolVerMensajes,
  toolVerVisitas,
  type RespuestaPreparada,
  type ResultadosDeps,
} from "@/lib/agent/resultados";

// editar_imagen: the source image must decode as one of the formats Gemini's
// image edit accepts, and stays under the same 6MB cap the ai-edit-image route
// enforces on its decoded source.
const IMAGE_EDIT_ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const FETCH_IMAGE_MAX_BYTES = 6 * 1024 * 1024;

/** Bytes of an on-page image, fetched SSRF-guarded, as base64. */
export type FetchedImage =
  | { ok: true; base64: string; mimeType: string }
  | { ok: false; error: string };

export interface AgentDeps {
  /** El backend del proyecto (plans/pages-backend/design.md): sus ficheros de
   *  `/supabase/` (las migraciones), por ruta. Opcional: sin él no hay. */
  ficherosDeSupabase?(projectId: string): Promise<Record<string, string>>;
  /** Guardar uno de esos ficheros. */
  guardarFicheroDeSupabase?(projectId: string, ruta: string, contenido: string): Promise<void>;
  /** `supabase …` en la terminal de Len: la CLI de Supabase contra el backend
   *  del proyecto (`lib/backend/cli.ts`). `ficheros`: los de `/supabase/` tal
   *  como están en la terminal; `escribir`: los que crea (`migration new`). */
  supabaseCli?(
    projectId: string,
    args: readonly string[],
    ficheros: Readonly<Record<string, string>>,
  ): Promise<{ stdout: string; stderr: string; exitCode: number; escribir?: Record<string, string> }>;
  /** H3 — los almacenes que declara el BORRADOR, con sus filas y quién las
   *  escribió. Opcional: sin él no hay ficheros en /datos. */
  almacenesDelProyecto?(projectId: string): Promise<
    { nombre: string; declarado: AlmacenDeclarado; filas: FilaDeAlmacen[] }[]
  >;
  /** H3 — lo que Len sabe del DUEÑO (`users.agentMemory`), para leerlo como
   *  `/memoria/dueno.md`. Opcional: sin él, el fichero sale vacío. */
  leerMemoriaDelDueno?(userId: string): Promise<string | null>;
  /** H3 — un fichero de /datos editado, aplicado ENTERO con las reglas de
   *  siempre (`aplicarPlanDeAlmacen`): permisos, validación y cuota antes de
   *  tocar nada. */
  aplicarAlmacen?(args: {
    projectId: string;
    userId: string;
    almacen: string;
    plan: PlanDeAlmacen;
  }): Promise<{ ok: true; mensaje: string } | { ok: false; error: string }>;
  /** H3 — el aviso de cuota que daba `leer_estado`, o `null` con sitio de
   *  sobra. Se pide sólo al leer un fichero de /datos. */
  avisoDeCuota?(projectId: string, userId: string): Promise<string | null>;
  /** Len sabe de tus resultados (plans/len-resultados/): visitas, formularios y
   *  mensajes, contados por el servidor. Opcional: sin él las herramientas lo dicen. */
  resultados?: ResultadosDeps;
  /** F2 · buscar y leer en internet (`lib/agent/web/buscar.ts`). Opcional: sin
   *  él, `web_search` y `web_fetch` lo dicen. */
  web?: WebDeps;
  loadProject(projectId: string, userId: string): Promise<{
    data: ProjectData;
    title: string;
    subdomain: string | null;
    publishedAt: Date | null;
    userBrief: string | null;
    /** El brief con el que nació la página. Alimenta la etapa de IMÁGENES de
     *  `preparePage`, que sin él se salta entera. */
    brief?: string | null;
  } | null>;
  /** I4 — recibe una FUNCIÓN, que se corre sobre el `data` de la fila DENTRO
   *  del compare-and-swap y puede correrse dos veces. Ver
   *  `lib/projects/escribir-data.ts` y `PersistPageDeps.saveProjectData`, que
   *  es la misma forma: lo que antes viajaba era un blob leído antes de
   *  decidir, y escribirlo devolvía el resto del proyecto a aquella lectura. */
  saveProjectData(
    projectId: string,
    userId: string,
    aplicar: (actual: ProjectData) => ProjectData,
  ): Promise<void>;
  // ⚰️ `redesignDocument` — el rediseño con un segundo modelo — se fue con
  // `redisenar_pagina` (Len 2.0: un Write lo hace sin segundo modelo).
  /** Devuelve el id de la fila archivada, o `null` si no se archivó nada. Ese
   *  id es la dirección del Deshacer del Chat — ver `versionPrevia`. */
  snapshotVersion(args: {
    projectId: string;
    html: string;
    label: string;
    source: string;
    page: string | null;
    isBaseline?: boolean;
  }): Promise<string | null>;
  provisionOwnerChat(
    projectId: string,
    userId: string,
    opts: { email: string | null; displayName: string },
  ): Promise<void>;
  /** `hasUnpublishedChanges` del proyecto, leído DESPUÉS de escribir: la misma
   *  decisión que pinta la franja de la Bandeja. `activar_modulo` lo usa para
   *  no decir «ya lo ven» cuando la página publicada todavía no lo tiene. */
  cambiosSinPublicar(projectId: string, userId: string): Promise<boolean>;
  /** This project's uploaded audio assets — the only tracks poner_musica
   *  may point the page music player at (never external URLs). */
  listAudioAssets(projectId: string): Promise<{ url: string; name: string }[]>;
  /** The "Imágenes by OpenLen" curated-photo catalog manifest, raw and
   *  unvalidated — elegir_foto runs it through searchCuratedPhotos. */
  fetchImageManifest(): Promise<unknown>;
  /** EL DERECHO A PREGUNTAR — `mirar_pagina`. Contesta una pregunta sobre el
   *  documento con DATOS, no con un veredicto: `medir` desde Chromium (gratis)
   *  y `describir` desde el papel con visión (cuesta).
   *
   *  Opcional a propósito: sin ella la herramienta responde que no está
   *  disponible en vez de reventar, y un llamador que no la inyecte —los dobles
   *  de prueba, por ejemplo— no arranca un navegador por sorpresa. */
  observarPagina?(input: {
    html: string;
    tipo: "medir" | "describir";
    pregunta: string;
    zona?: string;
    /** El contexto con el que se hornea lo que se MIDE, para que sea el mismo
     *  documento que el lienzo le enseña al usuario. Ver `MiradaParams.vista`. */
    vista?: ContextoDeVista | null;
  }): Promise<{ respuesta: string } | null>;
  /** USAR LA PÁGINA — `usar_pagina` (H9). Una visita en Chromium con los pasos
   *  que da Len; devuelve HECHOS de cada paso, no un veredicto. Opcional por lo
   *  mismo que `observarPagina`: quien no la cablea no arranca un navegador por
   *  sorpresa, y la herramienta dice que no está disponible. */
  usarPagina?(input: {
    html: string;
    pasos: readonly PasoDeUso[];
    ruta: string;
    vista?: ContextoDeVista | null;
  }): Promise<{ informe: string }>;
  /** Download an on-page image as base64 — SSRF-guarded (validateUrl, same as
   *  the proxy-image route) + capped + MIME-allowlisted. editar_imagen only
   *  ever passes a URL it already found verbatim in the current document. */
  fetchImage(url: string): Promise<FetchedImage>;
  /** Store edited bytes as a project asset; returns the new asset URL to swap
   *  into the page. Reuses the same storage core as the assets upload route. */
  uploadAsset(
    projectId: string,
    bytes: Buffer,
    mime: string,
    name: string,
  ): Promise<{ url: string }>;
  /** Run the Nano Banana instruction edit — the extracted image-edit core,
   *  bound to the given userId for the debit-on-success charge. */
  editImage(userId: string, input: ImageEditInput): Promise<ImageEditResult>;
  /** Persist the project's userBrief verbatim (recordar_preferencia's only
   *  write path) — realDeps wires this to setProjectUserBrief. Returns false
   *  when the project isn't the caller's (mirrors that function's contract). */
  setUserBrief(projectId: string, userId: string, value: string): Promise<boolean>;
  /** F5 · el título del proyecto, con el mismo `renameProject` de
   *  `PATCH /api/projects/[id]`. Lo usa `/ajustes/proyecto.json` de la terminal. */
  renombrarProyecto?(projectId: string, userId: string, title: string): Promise<boolean>;
  // ⚰️ Aquí vivía `fetchSheetRows`, la lectura del Google Sheet de
  // `conectar_datos_vivos`. Se fue con «datos vivos» en Len 2.1 (2026-09-30).
  /** Memoria de la PERSONA, no del proyecto: sobrevive a cambiar de página y
   *  de proyecto. Ver lib/agent/user-memory.ts. */
  rememberAboutUser(
    userId: string,
    preferencia: string,
  ): Promise<{ ok: true; yaExistia: boolean } | { ok: false; reason: "llena" | "no_guardado" }>;
  /** Los puntos de guardado de ESTA página, del más nuevo al más viejo — el
   *  mismo `listVersions` que lee el panel de Versiones. `revertir_ultimo_cambio`
   *  es su único llamador aquí: los snapshots ya existían, lo que faltaba era
   *  que el Agente pudiera llegar a ellos. */
  listVersions(
    projectId: string,
    userId: string,
    page: string | null,
  ): Promise<{ id: string; label: string; source?: string }[]>;
  /** El documento guardado en ESA versión. Lo necesita `revertir_ultimo_cambio`
   *  para deshacer lo de Len sobre lo que hay ahora sin llevarse lo que el
   *  dueño editó después (H06). Opcional: sin ella, la herramienta restaura
   *  como antes. */
  versionHtml?(projectId: string, userId: string, versionId: string): Promise<string | null>;
  /** Devuelve la página a ese punto de guardado y escribe el proyecto. `null`
   *  cuando la versión no existe o no es del dueño.
   *
   *  `versionPrevia` es la fila que archiva el estado de ANTES de restaurar —la
   *  que hace que restaurar sea, a su vez, deshacible desde el Chat.
   *
   *  `escritura`: cuando Len deshace SU cambio, la restauración queda como
   *  escritura suya (`source: "chat"`). Ver `toolRevertirUltimoCambio`. */
  restoreVersion(
    projectId: string,
    userId: string,
    versionId: string,
    escritura?: { source: "chat"; label: string },
  ): Promise<{ html: string; versionPrevia: string | null } | null>;
}

// public/openlen-images/manifest.json is a build-committed static file (see
// scripts/openlen-images/process.ts) — its src.* URLs already point at R2
// (images.openlen.com), only the manifest JSON itself ships locally. deploy.ps1
// copies public/ into .next/standalone/public/ for the self-hosted runtime
// (infra/scripts/deploy.ps1 step 3), so process.cwd()-relative disk read
// resolves correctly in both dev and prod without an app base-URL env var. A
// network self-fetch would
// need one more moving part (the app's own origin) for zero benefit, since the
// file never changes per-request. Cached in-process for 10 min so a burst of
// elegir_foto calls in one chat turn doesn't re-read+re-parse the JSON.
const IMAGE_MANIFEST_TTL_MS = 10 * 60 * 1000;
let imageManifestCache: { data: unknown; expiresAt: number } | null = null;

async function readImageManifest(): Promise<unknown> {
  const now = Date.now();
  if (imageManifestCache && imageManifestCache.expiresAt > now) {
    return imageManifestCache.data;
  }
  const raw = await readFile(
    join(process.cwd(), "public", "openlen-images", "manifest.json"),
    "utf8",
  );
  const data = JSON.parse(raw) as unknown;
  imageManifestCache = { data, expiresAt: now + IMAGE_MANIFEST_TTL_MS };
  return data;
}

/** Lo que lanza el guardado cuando la fila se movió y no se pudo fusionar. Una
 *  constante y no una cadena en línea: el arnés de evals inyecta este MISMO
 *  fallo para medir qué hace Len cuando guardar choca (X5 de la auditoría del
 *  2026-09-22), y una copia de la frase dejaría de ser el mismo fallo en cuanto
 *  alguien tocara ésta. */
export const CONFLICTO_AL_GUARDAR =
  "the page changed while it was being saved and couldn't be merged; try again";

/**
 * 🔴 H12-a · EL MISMO CONFLICTO OTRA VEZ YA NO DICE «VUELVE A INTENTARLO».
 *
 * La primera vez el consejo es bueno: casi siempre es otra escritura que se
 * cruzó un instante. La segunda seguida ya no lo es, y el error lo seguía
 * diciendo: en la batería completa del 2026-09-22, C22 escribió cinco veces,
 * cambiando de herramienta en cada una —así que la guarda de repetición, que
 * exige argumentos idénticos, no la veía—, contra un conflicto que no iba a
 * ceder. El error dice qué ya se probó y qué hacer distinto, que es la forma
 * de Claude Code.
 *
 * Y NOMBRA LO QUE NO SIRVE. Con la primera redacción, C22 bajó de cinco
 * escrituras a tres, pero 2 de 3 corridas releían la página y probaban con otra
 * herramienta: el remedio de OTRO choque (el del documento que cambió entre la
 * lectura y la escritura, que sí se arregla releyendo). Éste no depende de lo
 * que se envía.
 *
 * 🔴 Y EL MENSAJE SOLO NO BASTÓ: nombrando lo que no sirve, C22 siguió en 2 de
 * 3. Así que aquí sí se corta, cosa que Claude Code no hace: cada vuelta de
 * este turno le cuesta créditos al dueño, y una escritura más no puede salir
 * bien. El resultado lleva `guardarSinSalida` y el bucle cierra (ver
 * `CONFLICTO_SIN_SALIDA` en loop.ts).
 *
 * ⚠️ Y NO AFIRMA LA CAUSA (revisión pre-deploy del 2026-09-22). Decía «otra
 * escritura está cambiando la página a la vez», y el único caso de producción
 * con choques seguidos (15/09) fue un fallo nuestro del compare-and-swap. Se
 * dice el hecho, las causas posibles y qué hacer; cuál fue, no se sabe.
 */
export const conflictoRepetido = (veces: number) =>
  `the page changed again while it was being saved: ${veces} attempts in a row in this turn collided, so retrying doesn't fix it — not rereading the page, not switching tools, not sending another change: the collision doesn't depend on what you send. Don't attempt another save during this turn: let the user know it couldn't be saved and what was left undone. We don't know the cause —the page open in another tab or in the editor, another save at the same time, or a fault of ours—: don't claim which.`;

/**
 * `debit` es el cobro de lo que las herramientas cobran APARTE del modelo
 * —buscar en la web, editar una imagen—. La ruta del Agente pasa uno que además
 * lo cuenta, para que el cierre del turno diga lo que de verdad se cobró (N42:
 * un turno con búsquedas decía «1,46 créditos» y costó 5,96).
 */
export function realDeps(
  debit: (userId: string, centicreditos: number) => Promise<unknown> = debitCredits,
): AgentDeps {
  return {
    // F2 · la web: la de prueba en Len-Bench, Exa y `fetchRaw` fuera de él.
    // Lo buscado de verdad se cobra aparte del turno, como editar una imagen.
    web: webDelServidor(debit),
    // El backend del proyecto (lib/backend): import perezoso, es server-only.
    async ficherosDeSupabase(projectId) {
      const { listProjectFiles } = await import("@/lib/backend/files");
      return listProjectFiles(projectId, "/supabase/");
    },
    async guardarFicheroDeSupabase(projectId, ruta, contenido) {
      const { saveProjectFile } = await import("@/lib/backend/files");
      await saveProjectFile(projectId, ruta, contenido);
    },
    async supabaseCli(projectId, args, ficheros) {
      const { runSupabaseCli } = await import("@/lib/backend/cli");
      return runSupabaseCli(projectId, args, ficheros);
    },
    // H3 — import perezoso por lo mismo que en los tools de almacén:
    // `lib/page-data/agente.ts` es server-only.
    async almacenesDelProyecto(projectId) {
      const { declaracionDelBorrador } = await import("@/lib/page-data/publicada");
      const { leerDatos } = await import("@/lib/page-data/agente");
      const declaracion = await declaracionDelBorrador(projectId);
      const out: { nombre: string; declarado: AlmacenDeclarado; filas: FilaDeAlmacen[] }[] = [];
      for (const [nombre, declarado] of Object.entries(declaracion)) {
        out.push({ nombre, declarado, filas: await leerDatos({ projectId, almacen: nombre }) });
      }
      return out;
    },
    async leerMemoriaDelDueno(userId) {
      return getUserMemory(userId);
    },
    async aplicarAlmacen(args) {
      const { aplicarPlanDeAlmacen } = await import("@/lib/page-data/agente");
      return aplicarPlanDeAlmacen(args);
    },
    // LA CUOTA, CUANDO APRIETA. El panel de Datos ya la enseña, pero eso sólo
    // ayuda a quien lo abre — y el 507 les ocurre a los visitantes mientras el
    // dueño no mira. Len habla con él, así que Len tiene que saberlo.
    async avisoDeCuota(projectId, userId) {
      const { cuotaDelProyecto } = await import("@/lib/page-data/agente");
      const { avisoDeCuotaParaElModelo } = await import("@/lib/page-data/cuota");
      const cuota = await cuotaDelProyecto({ projectId, userId });
      return cuota ? avisoDeCuotaParaElModelo(cuota) : null;
    },
    // Len sabe de tus resultados. Import perezoso: las consultas tiran de la
    // base y del chat, server-only.
    resultados: {
      async visitas(projectId, zona, rango) {
        const { resumirVisitas } = await import("@/lib/resultados/visitas");
        return resumirVisitas(projectId, zona, rango);
      },
      async formularios(projectId, userId, zona, filtro) {
        const { resumirFormularios } = await import("@/lib/resultados/formularios");
        return resumirFormularios(projectId, userId, zona, filtro);
      },
      async formulario(projectId, zona, id, opciones) {
        const { abrirFormulario } = await import("@/lib/resultados/formularios");
        return abrirFormulario(projectId, zona, id, opciones);
      },
      async mensajes(projectId, zona, filtro) {
        const { resumirMensajes } = await import("@/lib/resultados/mensajes");
        return resumirMensajes(projectId, zona, filtro);
      },
      async conversacion(projectId, zona, id) {
        const { leerConversacion } = await import("@/lib/resultados/mensajes");
        return leerConversacion(projectId, zona, id);
      },
    },
    async loadProject(projectId, userId) {
      const rows = await db
        .select({
          data: schema.projects.data,
          title: schema.projects.title,
          subdomain: schema.projects.subdomain,
          publishedAt: schema.projects.publishedAt,
          userBrief: schema.projects.userBrief,
          brief: schema.projects.brief,
        })
        .from(schema.projects)
        .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
        .limit(1);
      return rows[0] ?? null;
    },
    // I4 — la escritura pasa por `actualizarData`: lee, aplica y escribe SÓLO
    // si la fila no se ha movido, reintentando encima de quien se colara. Antes
    // esto era un `UPDATE … SET data = <blob>` con el blob que `persistPage`
    // había construido sobre una lectura anterior: un turno del Agente dura
    // minutos, y todo lo que el dueño guardara mientras tanto —sus ajustes, su
    // otra subpágina— volvía atrás sin que nadie fallara.
    //
    // LANZA si no pudo: un guardado que falla en silencio es la avería misma.
    async saveProjectData(projectId, userId, aplicar) {
      const r = await actualizarData({ projectId, userId, aplicar });
      if (!r.ok) {
        throw new Error(r.motivo === "conflicto" ? CONFLICTO_AL_GUARDAR : "project not found");
      }
    },
    async snapshotVersion(args) {
      // Best-effort, same as the ai-design route: a snapshot failure must
      // never break the tool call that produced real, saved output.
      //
      // EL ID SE DEVUELVE, no se tira. Es la dirección a la que vuelve el
      // Deshacer del Chat; el `.catch` lo convertía en `undefined` y dejaba al
      // botón sin más camino que mandar el documento, que se sanea y perdía el
      // JavaScript del modelo. Un fallo aquí sigue sin costar el turno: sale
      // `null` y ese turno simplemente no ofrece Deshacer.
      return await createVersion({
        projectId: args.projectId,
        html: args.html,
        label: args.label,
        source: args.source as VersionSource,
        page: args.page,
        isBaseline: args.isBaseline,
      }).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[agent] snapshot failed", err);
        return null;
      });
    },
    async provisionOwnerChat(projectId, userId, opts) {
      try {
        // Thread the email through so an agent-created owner chat_user carries
        // it — getOrCreateOwnerChatUser short-circuits on an existing row, so a
        // null here would strand the owner without an email forever.
        await getOrCreateOwnerChatUser(projectId, userId, {
          email: opts.email,
          displayName: opts.displayName,
        });
      } catch (err) {
        console.warn("[agent] owner chat provisioning failed (will retry lazily)", err);
      }
    },
    async cambiosSinPublicar(projectId, userId) {
      try {
        return await leerCambiosSinPublicar(projectId, userId);
      } catch (err) {
        // El ajuste YA se guardó; lo que falló es saber si la página publicada
        // lo refleja. Ante la duda, «todavía no»: decir «cuando publiques» de
        // más es el fallo seguro (el mismo que acepta la franja), decir «ya lo
        // ven» de más es la mentira que esto vino a quitar.
        console.warn("[agent] no se pudo leer la deriva de publicación", err);
        return true;
      }
    },
    async listAudioAssets(projectId) {
      const assets = await getAssetStorage().listAudio(projectId);
      return assets.map((a) => ({ url: a.url, name: a.filename }));
    },
    async fetchImageManifest() {
      return readImageManifest();
    },
    async fetchImage(url) {
      // Same SSRF guard as GET /api/projects/[id]/proxy-image: validateUrl
      // blocks loopback/RFC-1918/link-local + non-http(s) schemes, and a manual
      // redirect is refused (following one would bypass the validated host).
      const valid = await validateUrl(url);
      if (!valid.ok) return { ok: false, error: "url_blocked" };
      let res: Response;
      try {
        res = await fetch(valid.value.url, {
          redirect: "manual",
          headers: { accept: "image/*" },
        });
      } catch {
        return { ok: false, error: "fetch_failed" };
      }
      if (!res.ok) return { ok: false, error: "upstream_error" };
      const mime = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!IMAGE_EDIT_ALLOWED_MIME.has(mime)) return { ok: false, error: "unsupported_type" };
      const declared = Number(res.headers.get("content-length") || 0);
      if (declared && declared > FETCH_IMAGE_MAX_BYTES) return { ok: false, error: "too_large" };
      const buf = await res.arrayBuffer();
      if (buf.byteLength > FETCH_IMAGE_MAX_BYTES) return { ok: false, error: "too_large" };
      return { ok: true, base64: Buffer.from(buf).toString("base64"), mimeType: mime };
    },
    async uploadAsset(projectId, bytes, mime, _name) {
      // Same storage core as POST /api/projects/[id]/assets — hash-named, so
      // the filename is derived from the bytes (the display name is unused).
      const ext = extForMime(mime) ?? "png";
      const meta = await getAssetStorage().put(projectId, bytes, ext, mime);
      return { url: meta.url };
    },
    async editImage(userId, input) {
      return editImage(input, {
        callProvider: realImageEditTransport(),
        debit: async (cost) => {
          await debit(userId, cost);
        },
      });
    },
    async setUserBrief(projectId, userId, value) {
      return setProjectUserBrief(projectId, userId, value);
    },
    async renombrarProyecto(projectId, userId, title) {
      return renameProject(projectId, userId, title);
    },
    async rememberAboutUser(userId, preferencia) {
      return rememberAboutUser(userId, preferencia);
    },
    // Los mismos dos que usa el panel de Versiones. `listVersions` ya devuelve
    // del más nuevo al más viejo y comprueba la propiedad; `restoreVersion`
    // también, y devuelve null cuando la versión no es de este dueño.
    async listVersions(projectId, userId, page) {
      const { listVersions } = await import("@/lib/projects/versions");
      // 🔴 SE FILTRA AQUÍ. `listVersions` devuelve TODOS los ámbitos de página
      // —el panel de Versiones filtra en el cliente— así que sin este filtro
      // «deshaz» estando en /menu podía restaurar un snapshot de la Home sobre
      // la subpágina. El propio módulo lo dice en su cabecera: los snapshots
      // están separados por página justamente para que eso no pase.
      const todas = await listVersions({ projectId, userId });
      return todas
        .filter((v) => v.page === page)
        .map((v) => ({ id: v.id, label: v.label, source: v.source }));
    },
    async versionHtml(projectId, userId, versionId) {
      const { getVersionHtml } = await import("@/lib/projects/versions");
      return getVersionHtml({ projectId, userId, versionId });
    },
    async restoreVersion(projectId, userId, versionId, escritura) {
      const { restoreVersion } = await import("@/lib/projects/versions");
      return restoreVersion({ projectId, userId, versionId, ...(escritura ? { escritura } : {}) });
    },
  };
}

export interface AgentSession {
  projectId: string;
  userId: string;
  /**
   * QUIÉN ESCRIBE. Ausente = Len. `"usuario"` = la terminal del usuario (la #17
   * de plans/len-agente-2026/notas/fase-5-taller.md): lo que guarda no puede
   * meter código que el sitio no tenía (`javascript-del-usuario.ts`) y su versión
   * se etiqueta como suya, no como «Before AI edit».
   */
  autor?: "usuario";
  /** Con `autor: "usuario"`, DESDE DÓNDE: su terminal (ausente) o el editor de
   *  la lente «Código» (la #18). Sólo cambia cómo se llama su versión. */
  desde?: "editor";
  /** El modo del turno (`lib/agent/dynamis.ts`). Ausente = Len. Lo lee el
   *  /AGENTS.md que ve la terminal: en Dynamis no nombra Read, Edit ni Write. */
  mode?: AgentMode;
  // ⚰️ Aquí vivían `taggedHtml` (el documento activo con ids, contra el que se
  // aplicaban las ops) y `baseHtml` (contra qué comparar si otro escribió). Len
  // 2.0 edita ficheros (plans/len-2/ficheros-plan.md): cada herramienta lee la
  // fila, y «cambió desde que lo leíste» se decide contra `leidos`.
  /**
   * LO QUE EL USUARIO ESCRIBIÓ EN ESTE TURNO.
   *
   * La sesión no lo llevaba, y eso hacía estructuralmente imposible cualquier
   * guarda de PROCEDENCIA: ninguna herramienta podía contrastar lo que el modelo
   * pide con lo que el usuario dijo. Hoy lo usa la guarda de enlaces
   * inventados; es también la pieza que faltaba para las demás de esa familia.
   * Ausente ⇒ las guardas que dependen de él no opinan.
   */
  userPrompt?: string;
  /** F4 Task 1 — the slug of the page this turn is active on (route-validated
   *  against data.pages), or null for the home document (data.html). Threaded
   *  from the route's own validation, cloned from ai-design's page handling.
   *  Read-only in T1 — T2 makes tool writes respect it (the W1 pin). */
  page: string | null;
  /** Autoridad del turno para crear o borrar la cápsula. Se recalcula sólo
   * por página al mover el foco; un turno OFF nunca puede encenderse. */
  /** El brief del proyecto. Va en la sesión porque lo necesita
   *  `persistHtmlChange`, y enhebrarlo por los 6 llamadores sería ruido. Sin
   *  `brief`, `preparePage` se salta la etapa de imágenes y el modelo entrega
   *  cajas grises que nadie rellena. */
  brief?: string | null;
  /** Session email (session.user.email), threaded from the route so an
   *  agent-provisioned owner chat_user is created WITH an email — mirrors
   *  what the settings route passes to getOrCreateOwnerChatUser. */
  ownerEmail: string | null;
  /** Successful editar_imagen calls so far this request. The route inits it to
   *  0; the tool caps it at 1 per turn (each edit is a paid Gemini image op). */
  imageEditsThisTurn: number;
  /** Guardados SEGUIDOS que chocaron con `CONFLICTO_AL_GUARDAR` este turno;
   *  uno bueno la pone a cero. Opcional: ausente es 0.
   *  Ver `CONFLICTO_REPETIDO`. */
  conflictosAlGuardar?: number;
  // ⚰️ `behaviorJs` (la promesa de `prueba_js`) y `rechazoPrueba` se fueron con
  // `editar_runtime` en Len 2.0: ninguna herramienta los escribía ya.
  // ⚰️ `entroACiegas` e `idsVistos` eran del plano B (sólo el índice en el
  // contexto): se fueron con él (T8c).
  /** elegir_foto calls so far this request. Read-only + exempt from the action
   *  budget, but the curated catalog is finite: after the 2nd empty result the
   *  tool tells the model to pivot instead of retrying variants, and a hard
   *  per-turn ceiling refuses further searches — so a hunt for a genre the
   *  catalog lacks (e.g. terror/gore) can't loop until the turn cap. Route
   *  inits it to 0. */
  photoSearchesThisTurn: number;
  // ⚰️ AQUÍ VIVÍA `pidioSubdominioEsteTurno`: el flag que marcaba «ya le dije
  // este turno que preguntara» para cazar una SEGUNDA llamada a `publicar`.
  //
  // Se va el 2026-09-01 con `preguntar`. Era la mitad vigilante de un parche
  // cuya otra mitad era una orden en prosa («NO vuelvas a llamar…»), y su
  // propio comentario ya reconocía que «no se armaba jamás» en el caso que de
  // verdad pasa —el modelo manda UNA sola llamada con el nombre inventado, así
  // que nunca llegaba a leer la negativa que lo armaba—.
  //
  // Lo que SÍ para ese caso es la comprobación de `mensajeDelUsuario`, que
  // sigue en pie y no depende del turno: un nombre que el dueño no escribió se
  // rechaza en la primera llamada y en la quinta.
  /** Lo que el usuario escribió ESTE turno, tal cual. Sólo lo lee `publicar`,
   *  para distinguir un subdominio que dio el DUEÑO de uno que el modelo se
   *  inventó — ver su comentario. Opcional: sin él la comprobación no se aplica,
   *  así que un llamador que no lo pase no bloquea nada por sorpresa. */
  mensajeDelUsuario?: string;
  /** Búsquedas de foto SEGUIDAS que no devolvieron nada. Se reinicia con la
   *  primera que sí encuentra: lo que delata un callejón sin salida son las
   *  vacías CONSECUTIVAS, no el total. */
  busquedasVaciasSeguidas: number;
  /** Miradas `describir` de este turno — las que llaman al modelo con visión y
   *  CUESTAN. Tope propio, separado del de `medir`, que es gratis. */
  miradasDescribirEsteTurno?: number;
  /** Miradas `medir` de este turno — Chromium, sin modelo. Tienen tope igual,
   *  pero más alto: lo que acota es el tiempo de render, no el dinero. */
  miradasMedirEsteTurno?: number;
  /** F2 · consultas de `web_search` y páginas de `web_fetch` de este turno:
   *  sus topes (`lib/agent/web/herramientas.ts`) son para que «investiga esto»
   *  no se convierta en un rastreador. */
  consultasWebEsteTurno?: number;
  paginasWebEsteTurno?: number;
  /** LEN 2.0 · lo leído en este turno, por ruta, como lo apunta Claude
   *  Code. Sin leer no se edita, y «cambió desde que lo leíste» se decide
   *  contra esto. Empieza vacío en cada turno (plans/len-2/ficheros-plan.md, B3). */
  leidos?: Leidos;
  /** LEN 2.0 · las rutas escritas este turno, la más reciente primero: el
   *  «orden por fecha» de Grep y Glob (decisión B6). */
  escritos?: string[];
  /** Cómo estaba cada fichero antes de su PRIMERA escritura de este turno. Lo
   *  que la página ya decía sigue siendo de la página aunque un Edit anterior
   *  del mismo turno lo quitara: los avisos de procedencia lo cuentan como
   *  fuente (E del 26/09, oficina-y-whatsapp). */
  alEmpezar?: Map<string, string>;
  /** Todo el sitio como estaba al empezar el turno —cada página, sus almacenes
   *  y su memoria—, en un solo texto. Es fuente para los avisos de procedencia:
   *  un precio o un enlace que ya estaba en OTRA página no lo inventó Len al
   *  copiarlo (H13). Se toma en la primera escritura del turno. */
  sitioAlEmpezar?: string;
  /** F1 · la terminal de este turno (`lib/agent/terminal/`), si Len la usó, y
   *  cómo estaban sus ficheros tras el último comando: contra eso se decide
   *  qué cambió en el siguiente. Se cierra al acabar el turno. */
  terminal?: TerminalDeLen;
  fotoDeLaTerminal?: Record<string, string>;
  /** La zona del usuario (IANA). La manda el panel con cada turno; sin ella,
   *  la guardada; sin ninguna, `ZONA_SIN_DATO`. Las herramientas de resultados
   *  cuentan «hoy» en esta zona (plans/len-resultados/diseno.md §7). */
  zonaHoraria?: string;
}

export interface ToolOutcome {
  /** functionResponse.response que vuelve al modelo. Siempre presente. */
  response: Record<string, unknown>;
  /** H12-a · guardar ya chocó dos veces seguidas en este turno: el bucle no
   *  ejecuta más escrituras y cierra. Lo pone `contarConflictos`. */
  guardarSinSalida?: true;
  /** N41 · POR QUÉ FALLÓ, PARA EL DUEÑO: un código que el chat traduce. Sólo
   *  cuando el fallo es algo que el dueño entiende o puede resolver; sin él, la
   *  tarjeta dice «No pudo». Lo que lee el modelo (`response`) no va a la
   *  tarjeta. Ver `lib/agent/owner-reason.ts`. */
  ownerReason?: OwnerReason;
  /** Tarjeta para el stream (ausente en leer_estado). */
  action?: {
    tool: string;
    ok: boolean;
    summary: string;
    /**
     * ¿LA PÁGINA CAMBIÓ DE VERDAD? El servidor ya lo sabía y sólo se lo decía
     * al MODELO.
     *
     * `persistPage` compara el documento anterior con el nuevo por hash y
     * devuelve `cambio` / `sin_cambio` / `no_se` (`calcularCambio`,
     * lib/page-engine/persist.ts). Ese hecho se metía en la `response` de la
     * herramienta —que va al modelo— junto con la orden literal «NO le digas
     * al usuario que lo arreglaste», y NO salía por el cable. El cliente
     * recibía un evento `html` igualmente (`updatedHtml` se devuelve siempre
     * que `ok`) y pintaba «Aplicado · Deshacer» sobre un turno que no movió
     * un byte. Las dos superficies se contradecían —Versiones no dejaba fila,
     * porque `createVersion` deduplica— y sólo una se ve desde el Chat.
     *
     * Ausente ⇒ el cliente se comporta byte a byte como antes.
     */
    cambio?: "cambio" | "sin_cambio" | "no_se";
    /** Cuántas ediciones se aplicaron de verdad (`applied.appliedCount`). Ya
     *  viajaba a la etiqueta de la versión —«Agente (3 ops): …»— y no a la
     *  tarjeta que el usuario mira. Ausente ⇒ no se dice nada. */
    edits?: number;
    /**
     * QUÉ se cambió, no cuánto. Las ops ya resueltas a algo que sobrevive al
     * turno — ver `lib/agent/ops-descritas.ts` para por qué el `target` crudo
     * no vale (los op-id se estripan y se regeneran).
     *
     * Es la única fuente que SABE en vez de inferir: el diff que pinta el panel
     * compara dos HTML y no ve nada fuera de `<body>`, así que un cambio de CSS,
     * del <title> o del comportamiento le es invisible. Ausente ⇒ el cliente
     * cae a ese diff, como antes.
     */
    ops?: readonly OpDescrita[];
    /** Los valores que la llamada APLICÓ (el hex del acento, la fuente…),
     *  cuando la frase del modelo no los dice. No se pinta: lo lee el historial
     *  para que el modelo no los pierda (H08-b, `lib/agent/valores-de-tema.ts`). */
    valores?: string;
  };
  /** HTML nuevo (sin op-ids) para refrescar el iframe. */
  updatedHtml?: string;
  // ⚰️ Aquí viajaba `taggedHtml`, el gemelo con los `data-op-id` del motor, para
  // que los ojos y la medición señalaran nodos. Len 2.0 (T9) señala LÍNEAS: el
  // bucle hace el gemelo con posiciones (`etiquetarConPosiciones`) de
  // `updatedHtml`, en un solo sitio.
  /** LEN 2.0 · cómo estaba el fichero ANTES de esta escritura, tal como lo ve
   *  Read, o `null` si la escritura lo creó. El bucle guarda el primero de cada
   *  página: es la línea base de lo que mida el navegador (T9). Ausente ⇒ no se
   *  sabe, y lo medido en esa página se dice entero. */
  htmlPrevio?: string | null;
  /** LEN 2.0 · lo que esta escritura dejó mal, anclado a una línea de su
   *  fichero (`lib/agent/diagnosticos-de-la-escritura.ts`). El bucle lo junta
   *  con lo medido y lo manda en el `<new-diagnostics>` hermano. */
  diagnosticos?: readonly Diagnostico[];
  /** F4 Task 4 — which slot `updatedHtml` belongs to (session.page at the
   *  moment of the write), null for home. Required whenever `updatedHtml` is
   *  set: `trabajar_en_pagina` can move `session.page` mid-turn, so the html
   *  the loop is about to emit may target a DIFFERENT page than the one the
   *  turn started on — the panel needs this to paint the right canvas slot. */
  page?: string | null;
  /** LA DIRECCIÓN DEL DESHACER: la versión que guarda el documento de ANTES de
   *  esta escritura. Sube al evento `html` y de ahí al botón del Chat, que con
   *  ella pide «servidor, vuelve a esta fila» en vez de mandarle el documento
   *  —que se sanea, y por ahí se le perdía el JavaScript del modelo.
   *
   *  Sólo lo ponen las herramientas que escriben SOBRE un documento anterior.
   *  `crear_pagina` no lo trae: una página que acaba de nacer no tiene «antes»
   *  al que volver, y `restaurar_version` tampoco — ya es un viaje al pasado. */
  versionPrevia?: string | null;
  /** F1 · las OTRAS páginas que escribió la misma llamada (un `sed -i` de la
   *  terminal sobre varias): el bucle hace con cada una lo mismo que con
   *  `updatedHtml`/`page`/`htmlPrevio`/`versionPrevia`. */
  masPaginas?: readonly {
    readonly html: string;
    readonly page: string | null;
    readonly htmlPrevio?: string | null;
    readonly versionPrevia?: string | null;
  }[];
  /** F6a · el comando de la terminal y lo que imprimió, tal cual lo leyó el
   *  modelo: el bucle lo emite como evento `terminal` para la lente
   *  «Terminal» del lienzo. Sólo lo pone `bash`. `cambios`, lo que cambió por
   *  fichero (la #10), sólo para la pantalla. */
  terminal?: {
    readonly command: string;
    readonly salida: string;
    readonly exitCode: number;
    readonly cambios?: CambiosDelComando;
  };
  /** El gate de publicación (publicar). Presente ⇒ el loop emite un evento
   *  `confirm` y le pasa al modelo un estado "esperando_confirmacion". La
   *  herramienta JAMÁS publica: el tap del usuario en la tarjeta es la única
   *  vía que llama al endpoint real (spec §4.4). */
  confirm?:
    | { action: "publicar"; subdominio: string; idiomas: string[]; republicar: boolean }
    // El borrador de respuesta (plans/len-resultados/): la tarjeta sólo manda
    // si el usuario toca.
    | RespuestaPreparada;
  /** La herramienta ESCRIBIÓ en la base. No lo pone cada herramienta a mano:
   *  lo estampa `runAgentTool` contando las llamadas reales a
   *  `saveProjectData`, así que ninguna futura puede olvidarse.
   *
   *  Existe porque un turno que ya mutó de forma durable NO puede terminar
   *  como fallo puro: el bucle lo necesita para que el cliente cierre el turno
   *  «aplicado con aviso» —conservando Undo y transcripción— en vez de pintar
   *  un error rojo sobre una página que sí cambió. `updatedHtml` sólo cubre las
   *  que tocan el documento; los cambios de AJUSTES (hoy, los módulos) son
   *  igual de durables y no emiten html. */
  mutoDurable?: boolean;
  /**
   * CIERRA EL TURNO CON ESTA PREGUNTA. La escribe `preguntar`, y también las
   * herramientas que necesitan un dato que sólo el dueño puede dar.
   *
   * 🔴 POR QUÉ ES UN CAMPO Y NO UNA FRASE EN EL `error`. Hasta hoy, «esto lo
   * decide el usuario» viajaba como `ok:false` con una ORDEN DE COMPORTAMIENTO
   * dentro —«NO vuelvas a llamar a publicar en este turno, termina preguntándole
   * qué dirección quiere»—, y hacía falta además un flag de sesión para cazar al
   * modelo que la desobedecía. Las dos cosas son el mismo parche: pedirle al
   * modelo que se pare, y vigilar si obedeció.
   *
   * Está MEDIDO que no obedece. La primera versión traía un ejemplo y DeepSeek
   * reclamaba «mi-negocio» 3 de 3 veces; se quitó el ejemplo y el eval
   * `publicar-sin-subdominio` demostró que seguía recayendo — ahora inventando
   * el nombre del contexto. El flag por turno suponía dos llamadas y el modelo
   * hacía una sola, así que no se armaba jamás.
   *
   * Con esto la parada la EJECUTA el servidor: en cuanto el modelo llama a
   * `preguntar`, el bucle cierra el turno. No hay orden que obedecer ni flag que
   * vigilar, porque no queda turno en el que reincidir.
   *
   * 🔴 EL TEXTO LO ESCRIBE EL MODELO, y eso no es pereza. Esta frase la LEE el
   * usuario, y el usuario habla uno de diez idiomas. Una pregunta compuesta en
   * el servidor sale en español a un portugués — que es exactamente lo que
   * [[error-del-servidor-como-dato-no-prosa]] prohíbe. El servidor decide
   * CUÁNDO se para; el modelo, que ya escribe en el idioma del usuario, decide
   * QUÉ se dice.
   */
  pregunta?: string;
  /**
   * ¿ESTA EDICIÓN CAMBIÓ EL COMPORTAMIENTO de la página? Es la MISMA decisión
   * con la que se le pide `prueba` al modelo (`cambioConducta`, sin contar el
   * borrado del runtime, que no promete nada). No va al modelo ni a la tarjeta:
   * la lee el arnés, para exigir promesa sólo a los turnos que tocaron
   * comportamiento y no a los que cambiaron un texto.
   */
  cambioConducta?: boolean;
}

// AgentModule name -> the settings key it actually lives under. Identidad en
// todos: la excepción era "pedidos" (settings.orders), y ese módulo se retiró.
// Desde el 2026-08-29 queda Chat y Asistente: las colecciones se fueron con el hub.
const MODULE_SETTINGS_KEY: Record<AgentModule, "chat" | "assistant"> = {
  chat: "chat",
  assistant: "assistant",
};

/** Los tokens de los que depende que el Tema del editor haga algo. Exportada
 *  desde el 2026-09-04 para que `prompts-superficies.test.ts` pueda atar el
 *  vocabulario que el CONTRATO ordena a esta lista: derivaron en silencio una
 *  vez y el precio fue que toda página nueva naciera sorda al selector de Tema.
 *  (La leía también `cambiar_tema`, retirada con Len 2.0: el selector sigue.)
 *  Desde el 2026-09-29 sólo ata Crear y el Chat: el Tema escribe también en
 *  los nombres propios de la página, y a Len ya no se le ordena `--ol-*`. */
export const TOKENS_DEL_CONTRATO = [
  "--ol-bg",
  "--ol-fg",
  "--ol-accent",
  "--ol-font-display",
  "--ol-r-scale",
] as const;

export function summarizeProjectState(
  row: {
    data: ProjectData;
    title: string;
    subdomain: string | null;
    publishedAt: Date | null;
    /** La deriva entre el borrador y lo que sirve el disco. La calcula el que
     *  llama —`hasUnpublishedChanges` en la ruta, `deps.cambiosSinPublicar` en
     *  `leer_estado`— porque esto es una función pura y la respuesta vive en
     *  la fila. Ausente ⇒ el campo no se pinta. */
    cambiosSinPublicar?: boolean;
  },
  /** La página que el dueño tiene abierta en el editor; `null` es la Home. */
  page: string | null = null,
): Record<string, unknown> {
  const modulos = {} as Record<AgentModule, boolean>;
  for (const m of AGENT_MODULES) {
    modulos[m] = row.data.settings?.[MODULE_SETTINGS_KEY[m]]?.enabled === true;
  }
  // ⚰️ AQUÍ SE LEÍA UNA SEGUNDA HOJA: la de la COLECCIÓN
  // (`settings.collections.source.sheet`), que la dejaba de SOLO LECTURA.
  // Existía para que el Agente supiera por qué recibía un 409 al añadir un
  // producto.
  //
  // Se va el 2026-08-29 con el módulo: ya no hay `lib/collections/store.ts`
  // que devuelva ese 409, ni `sheet-sync` que escriba los ítems, ni la ruta
  // `/collections/source` que el propio comentario citaba para desconectarla.
  // Nada podía volver a poner ese campo, así que la rama nunca se tomaba.
  //
  // (Y la OTRA hoja, la de datos vivos —`settings.liveData`, que se leía aquí
  // al lado—, se retiró con su función en Len 2.1, el 2026-09-30.)
  const publicado = row.publishedAt !== null;
  return {
    titulo: row.title,
    publicado,
    // PUBLICADO NO QUIERE DECIR AL DÍA. `publicado` sólo dice que hay una
    // release en el disco; ésta es la única línea que dice si es la de ahora.
    // Sin ella, el dueño que enciende el asistente desde la franja y pregunta
    // «¿ya contesta?» podía llevarse un «sí» sacado del estado, sin una sola
    // herramienta de por medio, sobre una página que aún sirve la versión
    // vieja. Se omite sin publicar: ahí `publicado: false` ya lo dice, y un
    // `false` al lado se leería como «está al día».
    ...(publicado && row.cambiosSinPublicar !== undefined
      ? { cambios_sin_publicar: row.cambiosSinPublicar }
      : {}),
    subdominio: row.subdomain,
    // LEN 2.0: LAS PÁGINAS SON FICHEROS, con las mismas rutas que usan Read,
    // Edit, Write, Grep y Glob. Antes era «paginas» con "principal" para la
    // Home —el nombre que pedía `trabajar_en_pagina`, que ya no existe—. La
    // Home va en la lista: medido el 2026-08-26, sin ella el Agente contestaba
    // que un sitio de dos páginas tenía una.
    ficheros: ficherosDelSitio(row.data),
    // La que el dueño tiene abierta en el editor, como el «fichero abierto en
    // el IDE» de Claude Code: puede que la petición sea sobre ésa, o no.
    abierta_en_el_editor: rutaDePagina(page),
    modulos,
  };
}

// ⚰️ AQUÍ VIVÍA `toolLeerEstado` (H3, 2026-09-25). El estado del proyecto ya va en
// el contexto al empezar —como el `git status` de Claude Code— y los almacenes
// son ficheros de /datos (`lib/agent/ficheros/datos.ts`), con su aviso de
// visitantes.

function buildModulePatch(modulo: AgentModule, encender: boolean, numero?: string): SettingsPatchBody {
  switch (modulo) {
    case "chat":
      return { chat: { enabled: encender } };
    case "assistant":
      return { assistant: { enabled: encender } };
  }
}

// The settings write of activar_modulo (it was shared with
// conectar_datos_vivos, retired in Len 2.1). validate -> apply ->
// chat-provision-if-needed -> save, the
// SAME pipeline the button/route path uses (applySettingsPatch may do more
// than flip a boolean — e.g. members' auto-page birth, reconcileModuleSettings'
// cross-module cascade — so every settings write funnels through here rather
// than each caller re-deriving nextData by hand).
// ⚰️ Aquí vivía `esModuloDePagina`. Ya no hay ningún módulo que `crear_pagina`
// sepa inyectar: el último era `collections`, retirado el 2026-08-29.

async function activateModulePatch(
  session: AgentSession,
  deps: AgentDeps,
  row: { data: ProjectData; title: string },
  patchBody: SettingsPatchBody,
): Promise<{ ok: true; outcome: SettingsPatchOutcome } | { ok: false; error: string }> {
  const validation = validateSettingsPatch(patchBody, session.projectId);
  if (!validation.ok) {
    return { ok: false, error: validation.message ?? "invalid patch" };
  }

  // I4 — `applySettingsPatch` es pura, así que se vuelve a correr sobre el
  // `data` de la fila dentro del CAS. El `outcome` de aquí sirve para decidir y
  // para responder; el que se ESCRIBE es el de la vuelta que gane.
  const outcome = applySettingsPatch(row.data, validation.body);
  if ("error" in outcome) {
    return { ok: false, error: outcome.error };
  }

  if (outcome.chatJustEnabled) {
    await deps.provisionOwnerChat(session.projectId, session.userId, {
      email: session.ownerEmail,
      displayName: row.title,
    });
  }
  await deps.saveProjectData(session.projectId, session.userId, (actual) => {
    const fresco = applySettingsPatch(actual, validation.body);
    return "error" in fresco ? actual : fresco.nextData;
  });

  return { ok: true, outcome };
}

export async function toolActivarModulo(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const modulo = args.modulo;
  if (typeof modulo !== "string" || !(AGENT_MODULES as readonly string[]).includes(modulo)) {
    return { response: { ok: false, error: "unknown module" } };
  }
  const encender = args.encender !== false;

  // Loaded up-front (moved ahead of buildModulePatch) so the whatsapp case can
  // resolve its number-fallback chain from the existing row before the patch
  // is built — never a silent-dark { enabled: true } with no number to bake.
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "project not found" } };

  let numero: string | undefined;
  const patchBody = buildModulePatch(modulo as AgentModule, encender, numero);
  const activated = await activateModulePatch(session, deps, row, patchBody);
  if (!activated.ok) {
    return { response: { ok: false, error: activated.error } };
  }

  // ¿LO VEN YA LOS VISITANTES? Casi nunca. Las burbujas del chat y del
  // asistente se hornean AL PUBLICAR y guardar un ajuste no republica, así que
  // la página publicada sigue como estaba. Sin este dato Len contestaba «ya
  // responde a los visitantes» con la franja de la Bandeja diciendo, al lado,
  // «contestará la IA cuando publiques» — medido el 2026-09-16.
  //
  // Se lee DESPUÉS de escribir y con la MISMA decisión que la franja
  // (`computeUnpublishedChanges`), así que Len y la franja no se contradicen.
  // Heredan también su coste aceptado: si la página ya estaba en deriva por
  // otra edición, se dice «cuando vuelvas a publicar» aunque este módulo ya
  // coincidiera con lo publicado.
  const publicada = row.subdomain !== null;
  const sinPublicar =
    publicada && (await deps.cambiosSinPublicar(session.projectId, session.userId));
  // APAGAR TIENE EFECTO YA; ENCENDER NECESITA PUBLICAR. No es una simetría rota:
  // es dónde vive cada cosa. Al módulo apagado lo rechaza el SERVIDOR en la
  // siguiente petición del visitante —403 el asistente, 404 el chat— y desde el
  // 2026-09-17 la burbuja horneada pregunta el estado al cargar y se retira
  // sola. Encender, en cambio, no puede hacer aparecer una burbuja que no está
  // horneada en la release que el disco sirve.
  const visible = encender ? publicada && !sinPublicar : publicada;
  const nombre = MODULE_NOMBRE[modulo as AgentModule];
  let aviso: string | null = null;
  if (!encender && publicada) {
    // La salvedad de la release vieja va como CONDICIÓN, no como hecho: una
    // página publicada antes de que el widget supiera preguntar sigue con su
    // burbuja, y desde aquí no se sabe de qué fecha es la que hay en el disco.
    aviso = `Turning it off takes effect NOW: the ${nombre} stops serving visitors at once, and the bubble removes itself from the published page as soon as someone reloads it. DON'T say it has to be published to turn it off. If the user says they still see it, their page was published a long time ago: then yes, they should publish again.`;
  } else if (!visible && publicada) {
    aviso = `Saved, but the published page does NOT change by itself: visitors won't see it until the user publishes again. Tell them so ("the ${nombre} will show up on your page when you publish again") and DON'T claim it already appears or already answers.`;
  } else if (!publicada && encender) {
    aviso = `Saved. The page isn't published yet, so nobody sees it yet: it will show up when they publish it. Tell them so and DON'T claim it already appears or already answers visitors.`;
  }

  return {
    response: {
      ok: true,
      modulo,
      encendido: encender,
      // EL NOMBRE TIENE QUE VALER PARA LAS DOS DIRECCIONES. Se llamaba
      // `visible_para_visitantes`, y al APAGAR sale en `true` —el cambio ya
      // está en efecto—, que leído como «visible» dice justo lo contrario del
      // aviso de al lado. Len tenía delante un campo estructurado que
      // contradecía el texto; el campo era el equivocado, no el aviso.
      ya_en_efecto_para_visitantes: visible,
      ...(aviso ? { aviso } : {}),
    },
    action: { tool: "activar_modulo", ok: true, summary: modulo },
  };
}

// ⚰️ `preparar_marketing` se retiró en Len 2.1 (2026-09-30): 0 llamadas en toda
// la historia de producción. Fijaba el rubro del Marketing Kit, que la pestaña
// Marketing elige sola (`marketing-view.tsx`).

// Runaway backstop for a read-only tool: the loop exempts elegir_foto from the
// action budget AND (now) from the turn cap, so the ONLY thing bounding a
// search-only chain is ABSOLUTE_MAX_TOOL_CALLS — which surfaces a red error.
// This ceiling stops the tool returning fresh results well before that, so the
// model hits a wall (and pivots) instead of a crash.
const MAX_PHOTO_SEARCHES_PER_TURN = 6;

// EL TOPE QUE DE VERDAD MUERDE, y por qué no es el de arriba.
//
// Medido el 2026-08-28: `hero-terror-sin-fotos` («un hero tipo Fears to
// Fathom») quemó 272.308 tokens y murió en el tope de PASOS del bucle — sus 6
// vueltas se agotaron antes de que el techo de 6 búsquedas llegara a morder.
// El aviso de pivotar ya salía a la segunda búsqueda vacía y el modelo siguió
// igual: no le faltaba guía, le faltaba una pared.
//
// 🔴 Y BAJAR EL TECHO DE ARRIBA A 3 ARREGLARÍA ESE CASO ROMPIENDO OTRO: cuenta
// TODAS las búsquedas, encuentren o no, así que una galería de cuatro fotos
// distintas —cuatro búsquedas productivas y legítimas— se quedaría a medias.
//
// Lo que delata el callejón sin salida son las vacías CONSECUTIVAS: el
// catálogo ya dijo dos veces que no tiene ese género. Una búsqueda que SÍ
// encuentra reinicia la cuenta, así que trabajar bien nunca acerca a nadie al
// aviso.
//
// ⚠️ Y NO SE BLOQUEA LA BÚSQUEDA, sólo se endurece la respuesta. Se probó
// bloquearla y es peor negocio: buscar NO es una llamada al modelo, es un
// filtro local sobre el manifiesto, así que bloquearla no ahorra nada —la
// vuelta ya se gastó— y en cambio puede dejar al usuario sin una foto que
// existía, si el modelo pivotaba a otro tema. Pagar una página peor para
// ahorrar cero es el trato al revés.
const MAX_BUSQUEDAS_VACIAS_SEGUIDAS = 2;

// Steer the model off a dead-end photo hunt (the terror-hero bug): once the
// curated catalog clearly doesn't carry a genre, stop retrying variants and
// change approach. Named tools so the model has a concrete next move.
const PHOTO_PIVOT_NOTE =
  "The curated catalog \"Imágenes by OpenLen\" is limited and has no photos of this. DON'T keep searching for variants and NEVER make up a URL. "
  + "Leave the gap with a gradient from the palette — that is exactly what generation does when it finds no match, "
  + "and a neutral box is better than a photo that lies about the user's business. "
  + "Then GO ON with the rest of what they asked: running out of a photo doesn't cancel the rest or make you ask permission to continue. "
  + "In your answer say which photo there wasn't and what you put in its place.";

// ─── mirar_pagina: el derecho a preguntar ────────────────────────────────────
//
// TOPES SEPARADOS POR COSTE, y no por simetría: `describir` llama al modelo con
// visión y gasta; `medir` es Chromium y no gasta un crédito, así que no tiene
// por qué compartir techo con la cara. Misma doctrina que `elegir_foto`: pasado
// el tope se ENDURECE la respuesta, no se bloquea la llamada — bloquear no
// ahorra nada (la vuelta ya se gastó) y puede dejar al Agente sin un dato que
// existía.
const MAX_MIRADAS_DESCRIBIR = 2;
const MAX_MIRADAS_MEDIR = 4;

async function toolMirarPagina(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const tipo = args.tipo === "describir" ? "describir" : args.tipo === "medir" ? "medir" : null;
  if (!tipo) {
    return {
      response: {
        ok: false,
        error: '"tipo" has to be "medir" (the browser answers it, free) or "describir" (a model looks at it, it costs credits).',
      },
    };
  }
  const pregunta = typeof args.pregunta === "string" ? args.pregunta.trim() : "";
  if (!pregunta) {
    return { response: { ok: false, error: '"pregunta" is missing: say what you want to know about the page.' } };
  }
  const zona = typeof args.zona === "string" && args.zona.trim() ? args.zona.trim() : undefined;

  if (!deps.observarPagina) {
    return {
      response: {
        ok: false,
        error: "mirar_pagina isn't available in this environment. Go on with what the user asked you.",
      },
    };
  }

  const usadas =
    tipo === "describir"
      ? (session.miradasDescribirEsteTurno ?? 0)
      : (session.miradasMedirEsteTurno ?? 0);
  const tope = tipo === "describir" ? MAX_MIRADAS_DESCRIBIR : MAX_MIRADAS_MEDIR;
  if (usadas >= tope) {
    return {
      response: {
        ok: true,
        nota: `You already took too many looks of type "${tipo}" in this turn. Stop looking and decide with what you already know: you have the document, which is the half the screenshot is missing.`,
      },
    };
  }
  if (tipo === "describir") session.miradasDescribirEsteTurno = usadas + 1;
  else session.miradasMedirEsteTurno = usadas + 1;

  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "project not found" } };
  // Len 2.0: el fichero que se le dice, o la página que el dueño tiene abierta.
  const pedida = paginaPedida(session, row.data, args.file_path, { preferirLoEscrito: false });
  if (!pedida.ok) return { response: { ok: false, error: pedida.error } };
  const html = activeHtml(row.data, pedida.page) ?? "";
  if (!html) {
    return { response: { ok: false, error: "this page doesn't have a document to look at yet" } };
  }

  const visto = await deps
    .observarPagina({
      html,
      tipo,
      pregunta,
      ...(zona ? { zona } : {}),
      // LA VISTA, para que lo que se mide sea el documento que el usuario tiene
      // delante y no el pelado. La fila ya está leída aquí arriba, así que no
      // cuesta una consulta. Ver `MiradaParams.vista`.
      vista: vistaParaMedir(session.projectId, row, pedida.page),
    })
    .catch(() => null);
  if (!visto) {
    // Fail-open y DICIÉNDOLO: «no se pudo mirar» no puede leerse como «está
    // todo bien», que es exactamente el defecto que los ojos ya arreglaron.
    return {
      response: {
        ok: false,
        error: "the page couldn't be looked at this time. Don't take it as meaning it's fine or that it's wrong.",
      },
    };
  }

  // Read-only: sin tarjeta de acción y sin documento nuevo. La página no
  // cambió — preguntar no es editar.
  return { response: { ok: true, respuesta: visto.respuesta } };
}

// ─── usar_pagina: usarla como un visitante (H9) ──────────────────────────────
//
// SIN TOPE POR TURNO, a diferencia de `mirar_pagina`: no gasta créditos (es
// Chromium) y Claude Code no pone plazo a comprobar. Lo que la contiene es el
// tope de pasos por visita y el reloj de la visita, en el motor.
async function toolUsarPagina(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  // La entrada se comprueba ANTES de abrir nada, como el ejecutor de Claude Code.
  const v = validarPasos(args.pasos);
  if (!v.ok) return { response: { ok: false, error: v.error } };
  if (!deps.usarPagina) {
    return {
      response: {
        ok: false,
        error: "usar_pagina isn't available in this environment. Go on with what the user asked you, and when you close say you couldn't test it.",
      },
    };
  }
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "project not found" } };
  // Sin `file_path`: la última página que escribió en este turno —la que acaba
  // de cambiar y quiere probar— y si no escribió ninguna, la que el dueño tiene
  // abierta.
  const pedida = paginaPedida(session, row.data, args.file_path, { preferirLoEscrito: true });
  if (!pedida.ok) return { response: { ok: false, error: pedida.error } };
  const html = activeHtml(row.data, pedida.page) ?? "";
  if (!html) return { response: { ok: false, error: "this page doesn't have a document to use yet" } };

  const visto = await deps
    .usarPagina({ html, pasos: v.pasos, ruta: pedida.ruta, vista: vistaParaMedir(session.projectId, row, pedida.page) })
    .catch(() => null);
  if (!visto) {
    // No poder abrirla no es que funcione ni que no: se dice así, para que no
    // cierre dándola por buena.
    return {
      response: {
        ok: false,
        error: "the page couldn't be opened in the browser this time. Don't take it as meaning it works or that it doesn't; if you close without testing it, say so.",
      },
    };
  }
  return { response: { ok: true, visita: visto.informe } };
}

async function toolElegirFoto(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  session.photoSearchesThisTurn += 1;

  // Past the ceiling: stop handing back results (even for a matching query) so
  // a stubborn model can't spin toward the loop's absolute cap. Read-only, so
  // still no action card / no updatedHtml.
  if (session.photoSearchesThisTurn > MAX_PHOTO_SEARCHES_PER_TURN) {
    return {
      response: {
        ok: true,
        fotos: [],
        nota: `You already did too many photo searches in this turn. Stop searching: use the ones you already found or pivot. ${PHOTO_PIVOT_NOTE}`,
      },
    };
  }

  const busqueda = typeof args.busqueda === "string" ? args.busqueda : undefined;
  const estilo = typeof args.estilo === "string" ? args.estilo : undefined;

  const manifest = await deps.fetchImageManifest();
  const fotos = searchCuratedPhotos(manifest, { busqueda, estilo });

  if (fotos.length === 0) {
    session.busquedasVaciasSeguidas += 1;
    // First empty search: fine to try one more term. Second+ empty: the
    // catalog genuinely lacks it — pivot rather than burn turns hunting a
    // genre the curated set doesn't carry.
    const pivot = session.busquedasVaciasSeguidas >= MAX_BUSQUEDAS_VACIAS_SEGUIDAS;
    return {
      response: {
        ok: true,
        fotos: [],
        nota: pivot
          ? PHOTO_PIVOT_NOTE
          : "no results for that search — try ONE more time with another term or remove the style filter. If there's nothing then either, don't insist: the catalog is curated and limited.",
      },
    };
  }

  // ENCONTRÓ: la cuenta vuelve a cero. Lo que delata un callejón sin salida son
  // las vacías SEGUIDAS, no el total — sin este reinicio, una página con cuatro
  // fotos distintas acabaría contra la pared por hacer bien su trabajo.
  session.busquedasVaciasSeguidas = 0;

  // Read-only: no action card (nothing changed on the page) and no
  // updatedHtml — the model still has to call editar_pagina to actually use
  // one of these URLs as an <img src>.
  return {
    response: {
      ok: true,
      fotos: fotos.map((f) => ({ url: f.url, alt: f.alt, estilo: f.style })),
    },
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True iff `url` appears as the VALUE of an image-bearing attribute (src /
 *  content=og:image / href=preload), inside a CSS `url(...)`, or as a full
 *  candidate in a `srcset` — never merely as substring text nor as a prefix of
 *  a longer URL. editar_imagen's anti-injection gate uses this so a
 *  prompt-injected bare URL sitting in page copy can't be fetched+edited. */
export function urlIsPageImage(html: string, url: string): boolean {
  if (!url) return false;
  const u = escapeRegExp(url);
  // Quoted attribute value, exact — the closing quote must sit right after the
  // URL, so a prefix of a longer value can't match.
  if (new RegExp(`(?:src|content|href)\\s*=\\s*(["'])${u}\\1`, "i").test(html)) {
    return true;
  }
  // CSS url(...) in a style attribute/block — quotes optional but balanced.
  if (new RegExp(`url\\(\\s*(["']?)${u}\\1\\s*\\)`, "i").test(html)) {
    return true;
  }
  // srcset: split each candidate off its descriptor and compare exactly, so a
  // prefix of a longer candidate is rejected.
  const srcsetRe = /srcset\s*=\s*["']([^"']*)["']/gi;
  let sm: RegExpExecArray | null;
  while ((sm = srcsetRe.exec(html)) !== null) {
    for (const cand of sm[1].split(",")) {
      if (cand.trim().split(/\s+/)[0] === url) return true;
    }
  }
  return false;
}

async function toolEditarImagen(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const imagenUrl = typeof args.imagen_url === "string" ? args.imagen_url : "";
  const instruccion = typeof args.instruccion === "string" ? args.instruccion.trim() : "";
  if (!imagenUrl) return { response: { ok: false, error: "imagen_url is required" } };
  if (!instruccion) return { response: { ok: false, error: "instruccion is required" } };

  // Per-turn cap FIRST — a paid Gemini image op is expensive, so a second call
  // is refused before any fetch/edit/upload. Only successful edits count (a
  // failed one below leaves the counter untouched so the model can retry).
  if (session.imageEditsThisTurn >= 1) {
    return { response: { ok: false, error: "limit of one image edit per turn" }, ownerReason: { code: "image_edit_limit" } };
  }

  // Anti prompt-injection SSRF: only edit an image ALREADY on the site. The URL
  // must appear as an image-bearing attribute value in one of its files — a
  // bare URL sitting in body copy is NOT enough, so an attacker-supplied URL
  // can't reach fetchImage this way.
  //
  // Len 2.0: en TODOS los ficheros, no en «la página activa», que ya no existe.
  const inicial = await deps.loadProject(session.projectId, session.userId);
  if (!inicial) return { response: { ok: false, error: "project not found" } };
  const conLaImagen = ficherosDelSitio(inicial.data).filter((ruta) =>
    urlIsPageImage(leerFichero(inicial.data, ruta) ?? "", imagenUrl),
  );
  if (conLaImagen.length === 0) {
    return {
      response: {
        ok: false,
        error: "imagen_url must be the exact URL of an image that is ALREADY on the site (not an external or made-up URL)",
      },
    };
  }

  const fetched = await deps.fetchImage(imagenUrl);
  if (!fetched.ok) {
    return {
      response: { ok: false, error: `the image couldn't be downloaded: ${fetched.error}` },
      ownerReason: { code: "image_unreachable" },
    };
  }

  const edited = await deps.editImage(session.userId, {
    imageBase64: fetched.base64,
    mimeType: fetched.mimeType,
    prompt: instruccion,
  });
  if ("error" in edited) {
    return { response: { ok: false, error: `the image edit failed: ${edited.error}` }, ownerReason: { code: "image_edit_failed" } };
  }

  // Gemini returned an image and the credit was already charged inside the
  // core — consume the turn's single allowance now, so a later upload/persist
  // failure can't be retried into a second charge.
  session.imageEditsThisTurn += 1;

  const bytes = Buffer.from(edited.imageBase64, "base64");
  const uploaded = await deps.uploadAsset(
    session.projectId,
    bytes,
    edited.mimeType,
    `edit-${Date.now()}`,
  );
  const nuevaUrl = uploaded.url;

  // Cada fichero donde estaba, por el camino de guardado de los ficheros. Se
  // relee la fila en cada uno: el guardado anterior la acaba de cambiar.
  const cambiados: { ruta: string; html: string; page: string | null; versionPrevia: string | null }[] = [];
  for (const ruta of conLaImagen) {
    const row = await deps.loadProject(session.projectId, session.userId);
    if (!row) return { response: { ok: false, error: "project not found" } };
    const antes = leerFichero(row.data, ruta);
    if (antes === null) continue;
    const guardado = await guardarFichero(session, deps, row.data, ruta, antes.split(imagenUrl).join(nuevaUrl), {
      crea: false,
      etiqueta: `Imagen editada: ${instruccion.slice(0, 60)}`,
    });
    if (!guardado.ok) return { response: { ok: false, error: guardado.error } };
    cambiados.push({ ruta, html: guardado.html, page: guardado.page, versionPrevia: guardado.versionPrevia });
  }
  // El lienzo pinta UNA página por evento: la que el dueño tiene abierta si
  // cambió, y si no la primera.
  const pintada = cambiados.find((c) => c.page === session.page) ?? cambiados[0];

  return {
    response: {
      ok: true,
      nueva_url: nuevaUrl,
      // Qué ficheros cambiaron: lo que Len tenía leído de ellos ya no vale.
      ficheros: cambiados.map((c) => rutaRelativa(c.ruta)),
    },
    action: { tool: "editar_imagen", ok: true, summary: instruccion.slice(0, 60) },
    ...(pintada
      ? { updatedHtml: pintada.html, page: pintada.page, versionPrevia: pintada.versionPrevia }
      : {}),
  };
}

const MAX_PUBLISH_LOCALES = 9;

// publicar — the publish GATE. This tool NEVER calls publishProject; it only
// resolves which subdomain + languages a publish WOULD use and hands that back
// as a `confirm` payload. The panel turns that into a card whose button hits
// the real endpoint — the user's tap is the only thing that publishes.
async function toolPublicar(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "project not found" } };

  const current = row.subdomain; // string | null — the project's active claim
  const raw = typeof args.subdominio === "string" ? args.subdominio.trim().toLowerCase() : "";

  // Resolve the target subdomain. Final authority is always the endpoint (regex
  // / reserved / cap re-checked there); here we only decide republish vs claim.
  // A shape-invalid name (accents, spaces, punctuation…) is pre-validated with
  // the SAME rule the endpoint uses — same regex, so nothing can ride to the
  // confirm card that would only fail later at check-time with a generic
  // message. Invalid → ok:false as data, before any confirm is built.
  // 🔴 LA REGLA EN PROSA NO SUJETABA ESTO, y está medido dos veces.
  //
  // Cuando el proyecto no tiene subdominio, la rama de abajo devuelve ok:false
  // con una orden explícita: «NO vuelvas a llamar a publicar en este turno,
  // pregúntale al usuario». La primera versión traía un ejemplo con forma de
  // valor y DeepSeek reclamaba "mi-negocio" 3 de 3 veces; se quitó el ejemplo.
  // El eval `publicar-sin-subdominio` demuestra que sigue recayendo — ahora se
  // inventa el nombre del contexto en vez de copiarlo, y le enseña al usuario
  // una tarjeta de confirmación para una dirección que nunca pidió.
  //
  // Aquí la frontera es el SERVIDOR: dentro de UN turno el usuario no puede
  // haber contestado —su respuesta abre un turno nuevo, con otra sesión— así
  // que cualquier subdominio que llegue después de haberle preguntado es, por
  // construcción, inventado. No hace falta adivinar la intención del modelo.
  // ⚰️ AQUÍ VIVÍA `session.pidioSubdominioEsteTurno`, y con él la guarda que
  // paraba una SEGUNDA llamada a `publicar` en el mismo turno.
  //
  // Se va el 2026-09-01 porque ya no hay segunda llamada que parar: las dos
  // ramas de abajo CIERRAN EL TURNO con la pregunta (`pregunta` en el
  // ToolOutcome), así que el modelo no llega a tener otra oportunidad de
  // reincidir dentro de este turno. El flag existía para vigilar si obedecía
  // una orden en prosa; sin orden que obedecer, no hay nada que vigilar.
  //
  // Su comentario ya decía que «no se armaba jamás» en el caso que de verdad
  // pasa — el modelo manda UNA sola llamada con un nombre inventado, así que
  // nunca llegaba a leer la negativa que armaba el flag.

  // 🔴 EL CASO QUE DE VERDAD PASA: SE LO INVENTA A LA PRIMERA.
  //
  // MEDIDO el 2026-08-31 con el eval `publicar-sin-subdominio`: ante «ya
  // publícala» el modelo manda UNA sola llamada con un subdominio sacado del
  // título, y le enseña al usuario una tarjeta de confirmación para una
  // dirección que nunca pidió.
  //
  // Lo que distingue un nombre del DUEÑO de uno del modelo no es la intención:
  // es si el usuario lo escribió. Si el proyecto no tiene reclamo todavía, el
  // nombre tiene que aparecer en lo que el usuario acaba de decir. «publícala
  // como mi-negocio» pasa; «ya publícala» no. Y cuando el dueño contesta a la
  // pregunta —turno siguiente— su respuesta ES el mensaje, así que pasa sola.
  //
  // Sin `mensajeDelUsuario` no se comprueba nada: un llamador que no lo pase no
  // se encuentra un bloqueo que no pidió.
  if (raw && !current && typeof session.mensajeDelUsuario === "string") {
    const dicho = session.mensajeDelUsuario.toLowerCase();
    // Se compara sobre el texto SIN separadores: el dueño escribe «mi negocio»
    // y el subdominio válido es «mi-negocio». Exigir el guion sería rechazar al
    // usuario por la ortografía de una regla que es nuestra, no suya.
    const plano = dicho.replace(/[\s._-]/g, "");
    if (!dicho.includes(raw) && !plano.includes(raw.replace(/-/g, ""))) {
      return {
        response: {
          ok: false,
          error: `the user has never said "${raw}" — you made that name up, and you don't choose the address of their page. This project doesn't have a subdomain yet: ask them with \`preguntar\` what address they want.`,
        },
        // N41: al dueño, que la dirección la elige él — no «you made that name up».
        ownerReason: { code: "address_needed" },
      };
    }
  }

  let subdominio: string;
  let republicar: boolean;
  if (raw) {
    const check = validateSubdomain(raw);
    if (!check.ok) {
      return {
        response: {
          ok: false,
          error:
            check.reason === "reserved"
              ? `the subdomain "${raw}" is reserved — ask the user for another name`
              : `the subdomain "${raw}" isn't valid: the rule is only lowercase letters, numbers and hyphens, 1-63 characters, no spaces or accents. Explain it to the user and suggest a corrected version (e.g. removing spaces/accents and using hyphens).`,
        },
        ownerReason: { code: check.reason === "reserved" ? "address_reserved" : "address_invalid", address: raw },
      };
    }
    subdominio = check.value;
    republicar = current === check.value;
  } else if (current) {
    subdominio = current;
    republicar = true;
  } else {
    return {
      response: {
        ok: false,
        error:
          // Sin ejemplo con forma de valor: este texto entra al modelo como
          // resultado de herramienta, y un modelo que lo lee literalmente
          // re-llamaba publicar con el ejemplo de muestra — medido, DeepSeek
          // reclamaba "mi-negocio" 3 de 3 veces.
          //
          // Y sin ORDEN DE COMPORTAMIENTO. Aquí decía «NO vuelvas a llamar a
          // publicar en este turno. Termina tu turno preguntándole…», que es
          // pedirle al modelo que se pare — y está medido que no se para. Ahora
          // se le señala la herramienta que HACE eso, y llamarla cierra el turno
          // de verdad: la parada la ejecuta el servidor, no la buena voluntad
          // del modelo.
          "this project doesn't have a subdomain yet, and you don't choose the subdomain. Ask the user what address they want with `preguntar` — that tool closes the turn and their answer opens the next one; then, yes, call publicar with what they write.",
      },
      ownerReason: { code: "address_needed" },
    };
  }

  // idiomas: keep only real PUBLISH_LOCALES codes, cap at the endpoint's max
  // of 9. Everything dropped — invalid codes AND valid-but-over-cap overflow —
  // is noted back to the model, never silently vanished.
  const rawIdiomas = Array.isArray(args.idiomas) ? args.idiomas : [];
  const strIdiomas = rawIdiomas.filter((c): c is string => typeof c === "string");
  const validos = strIdiomas.filter((c) => isPublishLocale(c));
  const idiomas = validos.slice(0, MAX_PUBLISH_LOCALES);
  const ignorados = [
    ...strIdiomas.filter((c) => !isPublishLocale(c)),
    ...validos.slice(MAX_PUBLISH_LOCALES),
  ];

  return {
    response: {
      ok: true,
      estado: "esperando_confirmacion_del_usuario",
      subdominio,
      idiomas,
      republicar,
      ...(ignorados.length ? { idiomas_ignorados: ignorados } : {}),
    },
    action: { tool: "publicar", ok: true, summary: subdominio },
    confirm: { action: "publicar", subdominio, idiomas, republicar },
  };
}

// ⚰️ `recordar_preferencia` se retiró en H3 (2026-09-25): la memoria son
// ficheros (/memoria/dueno.md y /memoria/proyecto.md) y su mecánica vive en
// `lib/agent/preferencias.ts`.

// ⚰️ `guardar_dato`, `editar_dato` y `quitar_dato` se retiraron en H3
// (2026-09-25): cada almacén es el fichero /datos/<almacen>.json y se edita
// con Edit/Write (`guardarDatos` en `lib/agent/herramientas-de-ficheros.ts`).

// ⚰️ `conectar_datos_vivos` se retiró en Len 2.1 (2026-09-30) con la función
// entera de «datos vivos»: 0 llamadas en la historia de producción y 0 de 118
// proyectos con una hoja conectada. Era la única forma de encenderla.

/**
 * PREGUNTAR, y callarse hasta que conteste.
 *
 * Es la herramienta que le faltaba al Agente para hacer lo que ya le pedíamos
 * en prosa. Hasta hoy, «esto lo decide el usuario» se le comunicaba con un
 * `ok:false` que llevaba dentro una ORDEN —«NO vuelvas a llamar a publicar en
 * este turno; termina preguntándole»— y un flag de sesión para cazarle si la
 * desobedecía. Está medido que la desobedecía.
 *
 * El texto lo escribe él, en el idioma del usuario. La parada la ejecuta el
 * bucle. Ver `ToolOutcome.pregunta`.
 */
async function toolPreguntar(
  _session: AgentSession,
  _deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const texto = typeof args.texto === "string" ? args.texto.trim() : "";
  if (!texto) {
    return {
      response: { ok: false, error: '"texto" is the question the user will read, and it came empty.' },
    };
  }
  return {
    // `ok: true` de verdad: preguntar es una acción que sale bien. El turno
    // termina porque el dueño tiene la palabra, no porque algo haya fallado.
    response: { ok: true, preguntado: true },
    pregunta: texto.slice(0, PREGUNTA_MAX),
  };
}

/** Una pregunta, no un ensayo. Lo que no quepa aquí no es una pregunta: es el
 *  modelo pensando en voz alta, y eso va en su texto normal. */
const PREGUNTA_MAX = 600;

// ⚰️ Aquí vivía `leer_de_internet` (hasta 3 URLs, 4.000 caracteres de texto,
// 2 llamadas por turno). Lo sustituyen `web_search` y `web_fetch` (F2 de
// plans/len-agente-2026), en `lib/agent/web/`.

// ⚰️ Aquí vivía TodoWrite (H2, 2026-09-25), la lista de tareas de Claude Code.
// Retirada en F4 (plans/len-agente-2026): Claude Code se la quitó a los modelos
// nuevos y Len la usaba en el 1,4 % de los pasos.
/**
 * DESHACER LO DE LEN en una página.
 *
 * 🔴 H06 · SE DESHACE LO DE LEN, NO LO ÚLTIMO QUE HAYA. Restaurar la versión
 * anterior a ciegas deshacía lo último guardado FUERA DE QUIEN FUERA (C11 y
 * C11b de la auditoría del 2026-09-22). La vara es Claude Code, que no descarta
 * lo que no escribió: se invierte el cambio de Len bloque a bloque sobre el
 * documento de AHORA (`deshacerSobreLoActual`). Si el dueño tocó LO MISMO, no
 * hay forma correcta de elegir por él: no se toca nada y el modelo le pregunta.
 *
 * Len 2.0: la página sale de `file_path`, o de lo último que Len escribió en
 * este turno, o de la que el dueño tiene abierta. Ya no devuelve un documento
 * con ids: lo que Len tenía leído de ese fichero deja de valer, y el propio
 * Edit se lo dirá si intenta editarlo sin releer.
 */
async function toolRevertirUltimoCambio(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const inicial = await deps.loadProject(session.projectId, session.userId);
  if (!inicial) return { response: { ok: false, error: "project not found" } };
  const pedida = paginaPedida(session, inicial.data, args.file_path, { preferirLoEscrito: true });
  if (!pedida.ok) return { response: { ok: false, error: pedida.error } };
  const { page, ruta } = pedida;
  const versiones = await deps.listVersions(session.projectId, session.userId, page);

  const iLen = ultimaEscrituraDeLen(versiones);
  const delLenV = iLen >= 0 ? versiones[iLen] : undefined;
  const antesV = iLen >= 0 ? versiones[iLen + 1] : undefined;
  if (delLenV && antesV && deps.versionHtml) {
    const [row, delLen, antes] = await Promise.all([
      deps.loadProject(session.projectId, session.userId),
      deps.versionHtml(session.projectId, session.userId, delLenV.id),
      deps.versionHtml(session.projectId, session.userId, antesV.id),
    ]);
    const enDisco = row ? activeHtml(row.data, page) : null;
    if (row && enDisco !== null && delLen !== null && antes !== null && stripOpIds(enDisco) !== stripOpIds(delLen)) {
      const r = deshacerSobreLoActual({ antes, delLen, actual: stripOpIds(enDisco) });
      if (!r.ok) {
        return {
          response: {
            ok: false,
            error:
              r.motivo === "se_solapan"
                ? `After your last change («${delLenV.label}») the page was edited by hand, and that edit touches the same thing as yours: undoing would also take away the user's. DON'T undo it on your own: ask them with preguntar whether they want to undo their edit too or leave it as it is.`
                : `your last change («${delLenV.label}») didn't move anything on the page: there is nothing of yours to undo.`,
          },
        };
      }
      const guardado = await guardarFichero(session, deps, row.data, ruta, r.html, {
        crea: false,
        etiqueta: `Agente: deshacer «${delLenV.label}»`,
      });
      if (!guardado.ok) return { response: { ok: false, error: guardado.error } };
      return {
        response: {
          ok: true,
          fichero: rutaRelativa(ruta),
          revertido_a: antesV.label,
          conservado: "what the user edited by hand after your change is still on the page",
        },
        updatedHtml: guardado.html,
        page,
        versionPrevia: guardado.versionPrevia,
        action: { tool: "revertir_ultimo_cambio", ok: true, summary: antesV.label },
      };
    }
  }

  // Sin edición del dueño encima: se vuelve al «antes» de la última escritura
  // de Len. Sin ninguna escritura de Len en esta página, a la versión anterior
  // a la última, como siempre: la primera es el estado de AHORA.
  const destino = antesV ?? versiones[1];
  if (!destino) {
    return {
      response: {
        ok: false,
        error:
          versiones.length === 0
            ? `${rutaRelativa(ruta)} doesn't have any save point yet, so there is nothing to go back to.`
            : `${rutaRelativa(ruta)} has only one save point —the current state—, so there is no earlier change to undo. Tell the user there is nothing to revert.`,
      },
    };
  }

  // Se restaura EN CRUDO —sin pasar por el saneador, que podría tocar un
  // documento viejo—, pero si lo que se deshace es de Len, la restauración queda
  // como escritura SUYA: si no, el turno siguiente leería la diferencia como
  // una edición a mano del dueño (`cambios-del-dueno.ts`).
  const restaurado = await deps.restoreVersion(
    session.projectId,
    session.userId,
    destino.id,
    ...(delLenV && antesV ? [{ source: "chat" as const, label: `Agente: deshacer «${delLenV.label}»` }] : []),
  );
  if (!restaurado) {
    return { response: { ok: false, error: "that save point couldn't be restored" } };
  }

  return {
    response: { ok: true, fichero: rutaRelativa(ruta), revertido_a: destino.label },
    updatedHtml: restaurado.html,
    page,
    // Restaurar archiva el estado previo, así que este turno TAMBIÉN se
    // puede deshacer: sin esta línea el botón desaparecía justo aquí.
    versionPrevia: restaurado.versionPrevia,
    action: { tool: "revertir_ultimo_cambio", ok: true, summary: destino.label },
  };
}

export async function runAgentTool(
  session: AgentSession,
  deps: AgentDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  // ¿Escribió esta herramienta en la base? Se cuenta AQUÍ, envolviendo el único
  // camino de escritura, y no se le pide a cada herramienta que se acuerde de
  // declararlo. `persistPage` también escribe por este mismo `saveProjectData`,
  // así que el conteo cubre las que tocan el documento y las que sólo tocan
  // ajustes, hoy y las que vengan.
  let escrituras = 0;
  const vigilado: AgentDeps = {
    ...deps,
    async saveProjectData(projectId, userId, aplicar) {
      escrituras += 1;
      await deps.saveProjectData(projectId, userId, aplicar);
    },
  };
  const marcar = (out: ToolOutcome): ToolOutcome =>
    escrituras > 0 || out.updatedHtml ? { ...out, mutoDurable: true } : out;
  let out: ToolOutcome;
  try {
    out = marcar(await ejecutarHerramienta(session, vigilado, name, args));
  } catch (err) {
    // Aunque REVIENTE: si ya había escrito, la mutación es durable igual y el
    // turno no puede cerrarse como si no hubiera pasado nada.
    out = marcar({ response: { ok: false, error: String(err) } });
  }
  return contarConflictos(session, out, escrituras);
}

/** H12-a · lleva la cuenta de conflictos seguidos y, desde el segundo,
 *  cambia el consejo del error. Aquí y no en cada herramienta por lo mismo que
 *  `escrituras`: el conflicto llega por `persistPage` en unas y lanzado en
 *  otras, y ambos caminos pasan por este sitio. Ver `conflictoRepetido`. */
function contarConflictos(session: AgentSession, out: ToolOutcome, escrituras: number): ToolOutcome {
  const error = out.response.ok === false ? String(out.response.error ?? "") : "";
  if (error.includes(CONFLICTO_AL_GUARDAR)) {
    const veces = (session.conflictosAlGuardar ?? 0) + 1;
    session.conflictosAlGuardar = veces;
    // N41: al dueño, que la página cambió mientras se guardaba — sin la causa,
    // que tampoco se sabe (ver `conflictoRepetido`).
    const conMotivo: ToolOutcome = { ...out, ownerReason: { code: "page_changed" } };
    if (veces < 2) return conMotivo;
    const repetido = conflictoRepetido(veces);
    return {
      ...conMotivo,
      response: {
        ...out.response,
        error: repetido,
        // Las herramientas de ficheros le hablan al modelo por `tool_result`,
        // no por `error`: si sólo se corrigiera éste, el modelo seguiría leyendo
        // «vuelve a intentarlo».
        ...(typeof out.response[CLAVE_TOOL_RESULT] === "string"
          ? { [CLAVE_TOOL_RESULT]: `<tool_use_error>${repetido}</tool_use_error>` }
          : {}),
      },
      guardarSinSalida: true,
    };
  }
  if (escrituras > 0 && out.response.ok !== false) session.conflictosAlGuardar = 0;
  return out;
}

async function ejecutarHerramienta(
  session: AgentSession,
  deps: AgentDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  if (name === NOMBRE_BASH) return await toolBash(session, deps, args);
  if (esHerramientaDeFicheros(name)) {
    const out = await {
      Read: toolRead,
      Edit: toolEdit,
      Write: toolWrite,
      Grep: toolGrep,
      Glob: toolGlob,
    }[name](session, deps, args);
    return out;
  }
  {
    switch (name) {
      case "activar_modulo":
        return await toolActivarModulo(session, deps, args);
      case "elegir_foto":
        return await toolElegirFoto(session, deps, args);
      case "mirar_pagina":
        return await toolMirarPagina(session, deps, args);
      case "usar_pagina":
        return await toolUsarPagina(session, deps, args);
      case "editar_imagen":
        return await toolEditarImagen(session, deps, args);
      case "publicar":
        return await toolPublicar(session, deps, args);
      case "preguntar":
        return await toolPreguntar(session, deps, args);
      case NOMBRE_WEB_SEARCH:
        return await toolWebSearch(session, deps, args);
      case NOMBRE_WEB_FETCH:
        return await toolWebFetch(session, deps, args);
      case "revertir_ultimo_cambio":
        return await toolRevertirUltimoCambio(session, deps, args);
      case "ver_visitas":
        return await toolVerVisitas(session, deps, args);
      case "ver_formularios":
        return await toolVerFormularios(session, deps, args);
      case "ver_mensajes":
        return await toolVerMensajes(session, deps, args);
      case "preparar_respuesta":
        return await toolPrepararRespuesta(session, deps, args);
      default:
        return { response: { ok: false, error: "unknown tool" } };
    }
  }
}
