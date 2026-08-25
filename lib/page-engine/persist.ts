import "server-only";

import type { ProjectData } from "@/lib/projects/types";
import { buildCapsule, resealRuntime, type ModelRuntimeCapsule } from "@/lib/projects/model-runtime";
import { staleRuntimeDetail, staleRuntimeRefs } from "@/lib/projects/runtime-staleness";
import { readFormIds } from "@/lib/publish/form-identity";

/**
 * Guardar una página editada, en un solo sitio.
 *
 * El Agente ya había inventado este embudo (`persistHtmlChange`, antes en
 * lib/agent/tools.ts) y su comentario decía por qué: *"any tool that hands the
 * model a mutated document funnels its candidate HTML through this so
 * persistence semantics never drift between tools"*. Lo que no decía es que el
 * Chat tenía una copia — el propio código lo admitía, *"cloned from ai-design's
 * own page-branch"* — con los mismos dos snapshots y el mismo spread.
 *
 * Y ESTO es el sandbox que se pidió: mutar → validar → o se guarda entero, o no
 * se toca nada y la página del usuario queda byte-intacta. Aquí sólo vive la
 * mitad de guardar; la de validar es `preparePage`.
 */
export interface PersistPageInput {
  readonly projectId: string;
  readonly userId: string;
  /** Slug de la subpágina, o null para el documento de inicio. */
  readonly page: string | null;
  /** El HTML que ya pasó por `preparePage`. */
  readonly html: string;
  /** Etiqueta de la versión posterior ("Ops (3): …", "Rewrite: …"). */
  readonly label: string;
  /** Ajustes que el motor derivó de los huecos de módulo, si los hubo. */
  readonly settings?: ProjectData["settings"];
  /** Marca la versión como nueva línea base — una reescritura completa lo es. */
  readonly isBaseline?: boolean;
  /** Un `<script>` que el modelo acaba de escribir, sacado de su respuesta CRUDA
   *  (`extractModelRuntime`). Sólo llega desde superficies que producen un
   *  DOCUMENTO completo — una reescritura del Chat, un rediseño del Agente.
   *
   *  `undefined`/`null` NO borra nada: una edición por ops no trae script y lo
   *  que corresponde entonces es RE-SELLAR el que ya había, no tirarlo. Borrar
   *  el trabajo del modelo porque este turno no produjo uno sería el peor
   *  comportamiento posible. */
  readonly modelRuntime?: string | null;
}

export interface PersistPageDeps {
  readonly loadProject: (
    projectId: string,
    userId: string,
  ) => Promise<{ data: ProjectData; generatedRuntime?: unknown } | null>;
  /** `runtime` sólo llega cuando hay que RE-ATAR el JavaScript del modelo al
   *  documento nuevo. Viaja en el mismo UPDATE a propósito: hacerlo aparte
   *  costaría un SELECT en cada edición de cada proyecto, tenga cápsula o no. */
  readonly saveProjectData: (
    projectId: string,
    userId: string,
    data: ProjectData,
    runtime?: ModelRuntimeCapsule | null,
  ) => Promise<void>;
  /** Best-effort por contrato: perder un snapshot no puede costar la edición. */
  readonly snapshotVersion: (input: {
    projectId: string;
    html: string;
    label: string;
    source: "manual" | "chat";
    page: string | null;
    isBaseline?: boolean;
  }) => Promise<void>;
}

export type PersistPageResult =
  | {
      readonly ok: true;
      readonly html: string;
      /** El turno no cambió NADA: ni un byte del documento, ni el JavaScript.
       *
       *  POR QUÉ SE CUENTA. MEDIDO el 2026-08-22: el modelo diagnosticó un bug
       *  de comportamiento, escribió «I'll fix the runtime script», y emitió
       *  una op de Modo A que reproducía el marcado ORIGINAL carácter por
       *  carácter. Guardar eso devolvía «listo» con toda naturalidad y el
       *  usuario se quedaba con la página rota y la impresión de arreglada.
       *
       *  Esto no juzga la prosa del modelo —eso sería adivinar— sino un hecho
       *  del que no se discute: no hay diferencia que guardar. Quien llame
       *  DEBE decírselo al usuario.
       *
       *  Un turno que trae `modelRuntime` nunca cuenta como vacío, aunque el
       *  código venga idéntico: ahí el modelo sí intentó tocar comportamiento,
       *  y el silencio se lo debemos sólo a quien no intentó nada. */
      readonly sinCambios: boolean;
    }
  | { readonly ok: false; readonly error: string };

/** El documento activo de esta sesión: inicio o subpágina, nunca los dos. */
/**
 * ¿Puede ESTA página llevar el JavaScript del modelo?
 *
 * Sólo la Home. La cápsula ata `projectId + data.html + code`, así que una
 * subpágina no entra en el piloto — aquí abajo su runtime sale `null` pase lo
 * que pase.
 *
 * Vive exportado porque quien decide MANDAR el script tiene que saberlo antes
 * de mandarlo. Hasta hoy no lo sabía: el Agente pasaba el runtime de una
 * subpágina, esta función lo tiraba en silencio, y la herramienta seguía
 * contestando `comportamiento_actualizado: true`. El dueño leía que su carrito
 * estaba cableado sobre una página muda. Una regla escrita dos veces se
 * contradice; escrita aquí y leída desde el límite, no puede.
 */
export function paginaGuardaRuntime(page: string | null | undefined): boolean {
  return !page;
}

export function activeHtml(data: ProjectData, page: string | null): string | null {
  return page ? (data.pages?.[page]?.html ?? null) : (data.html ?? null);
}

export async function persistPage(
  input: PersistPageInput,
  deps: PersistPageDeps,
): Promise<PersistPageResult> {
  const row = await deps.loadProject(input.projectId, input.userId);
  if (!row) return { ok: false, error: "proyecto no encontrado" };

  // FUSIÓN, no reemplazo. Los dos llamadores de hoy pasan el resultado de
  // `applyModuleIntent`, que ya fusiona sobre lo existente, así que esto no
  // cambia nada AHORA. Es la trampa de mañana: un tercer llamador que pasara un
  // `settings` parcial borraba de una sentada los formularios, los idiomas, la
  // música y el motion del proyecto — y nada lo habría avisado.
  const withSettings =
    input.settings !== undefined
      ? { settings: { ...row.data.settings, ...input.settings } }
      : {};
  // Spread inmutable: escribir una subpágina NUNCA toca `data.html` ni una
  // página hermana, y escribir inicio NUNCA toca `data.pages`.
  const nextData: ProjectData = input.page
    ? {
        ...row.data,
        ...withSettings,
        pages: {
          ...row.data.pages,
          [input.page]: { ...row.data.pages?.[input.page], html: input.html },
        },
      }
    : { ...row.data, html: input.html, ...withSettings };

  // ¿Se corrió la numeración de los formularios?
  //
  // `settings.forms` se resuelve por la POSICIÓN del `<form>` en el documento
  // (`formConfigKey`), y el correo de aviso del endpoint de envío también
  // (`app/api/f/[sub]/route.ts`). Insertar o quitar un formulario recorre esa
  // numeración: lo que el dueño configuró para "contacto" pasa a aplicarse a
  // otro. Nadie lo notaba — los mensajes seguían llegando, a la bandeja
  // equivocada.
  //
  // ARREGLADO desde `lib/publish/form-identity.ts`: cada `<form>` lleva ahora un
  // `data-ol-form-id` propio y la configuración se guarda bajo ÉL, así que
  // moverlo de sitio ya no reenruta nada. Este aviso se queda para lo único que
  // la identidad no alcanza: las páginas ANTERIORES al estampado, cuya
  // configuración sigue bajo claves por índice hasta que su dueño la vuelva a
  // tocar. Ahí sí se avisa, porque adivinar el emparejamiento entre dos
  // versiones del documento manda el correo de alguien a otro sitio sin
  // decirlo.
  const claves = Object.keys(row.data.settings?.forms ?? {});
  const porIndice = claves.filter((k) => !k.startsWith("f"));
  const porIdentidad = claves.filter((k) => k.startsWith("f"));
  const antesHtml = activeHtml(row.data, input.page ?? null) ?? "";
  const cuenta = (h: string) => (h.match(/<form[\s>]/gi) ?? []).length;
  const derivaPorIndice =
    porIndice.length > 0 && cuenta(antesHtml) !== cuenta(input.html);

  // El otro modo de fallo, que la identidad NO cubre por sí sola: una
  // reescritura completa que no conserve el `data-ol-form-id` deja el ajuste
  // HUÉRFANO — la clave existe y ningún formulario responde a ella. No manda
  // el lead a otra persona (eso ya no puede pasar), pero el correo del dueño
  // deja de aplicarse y los mensajes caen al de la cuenta, en silencio.
  const idsAhora = new Set(readFormIds(input.html).filter(Boolean));
  const huerfanas = porIdentidad.filter((k) => !idsAhora.has(k));
  const derivaFormularios = derivaPorIndice || huerfanas.length > 0;
  const configuraciones = derivaPorIndice ? porIndice.length : huerfanas.length;
  if (derivaFormularios) {
    const previas = (nextData.degradations ?? []).filter((d) => d.code !== "form_routing_stale");
    nextData.degradations = [
      ...previas,
      {
        surface: "generate",
        stage: "publish",
        code: "form_routing_stale",
        count: configuraciones,
      },
    ];
    // Reaparece aunque el usuario ya hubiera cerrado un aviso anterior: esto es
    // nuevo y es sobre a dónde le llegan sus mensajes.
    nextData.degradationsDismissed = false;
  }

  // El "antes" se guarda ANTES de escribir: si el guardado falla, la versión
  // previa ya existe y el usuario puede volver.
  const preEditHtml = activeHtml(row.data, input.page);
  if (preEditHtml && preEditHtml !== input.html) {
    await deps.snapshotVersion({
      projectId: input.projectId,
      html: preEditHtml,
      label: "Before AI edit",
      source: "manual",
      page: input.page,
    });
  }

  // El JavaScript del modelo sobrevive a la edición. El hash ata
  // `projectId + html + code`, así que sin esto la primera edición del titular
  // dejaba la página publicada sin su script, avisando sólo por consola.
  //
  // Sólo el documento de inicio: la cápsula ata `data.html` y una subpágina no
  // entra en el piloto. Y el código sale de la cápsula guardada, nunca de aquí
  // — re-sellar puede mover el documento, jamás introducir código nuevo.
  //
  // Si este turno trajo un script NUEVO, manda ése y se sella sobre el documento
  // que se va a guardar. Si no, se re-sella el que ya había.
  const runtime = paginaGuardaRuntime(input.page)
    ? input.modelRuntime
      ? buildCapsule({
          projectId: input.projectId,
          html: input.html,
          code: input.modelRuntime,
        })
      : resealRuntime({
          projectId: input.projectId,
          html: input.html,
          capsule: row.generatedRuntime ?? null,
        })
    : null;

  // ¿El código re-sellado sigue hablando de ESTA página?
  //
  // `resealRuntime` re-ata a ciegas — correcto para lo que protege, pero deja
  // este hueco: si la edición quitó el elemento al que el script se
  // enganchaba, `getElementById(...)` LANZA en la página publicada y la
  // excepción aborta el script ENTERO. Un elemento borrado puede apagar toda
  // la interactividad, con el error viviendo en la consola del visitante.
  //
  // Se avisa, no se repara: reescribir el código del modelo sería inventar. Y
  // el aviso llega también al modelo en el turno siguiente, que ahora sí puede
  // arreglarlo porque el runtime es direccionable por ops.
  const codigoFinal = input.modelRuntime ?? (runtime ? runtime.code : "");
  const huerfanos = codigoFinal ? staleRuntimeRefs(codigoFinal, input.html) : [];
  if (huerfanos.length > 0) {
    const previas = (nextData.degradations ?? []).filter((d) => d.code !== "runtime_stale");
    nextData.degradations = [
      ...previas,
      {
        surface: "generate",
        stage: "publish",
        code: "runtime_stale",
        count: huerfanos.length,
        detail: staleRuntimeDetail(huerfanos),
      },
    ];
    nextData.degradationsDismissed = false;
  } else if ((nextData.degradations ?? []).some((d) => d.code === "runtime_stale")) {
    // Se arregló: el aviso se RETIRA. Un aviso que no sabe desaparecer enseña
    // al usuario a ignorarlos todos.
    nextData.degradations = (nextData.degradations ?? []).filter(
      (d) => d.code !== "runtime_stale",
    );
  }

  await deps.saveProjectData(input.projectId, input.userId, nextData, runtime);

  await deps.snapshotVersion({
    projectId: input.projectId,
    html: input.html,
    label: input.label,
    source: "chat",
    page: input.page,
    ...(input.isBaseline !== undefined ? { isBaseline: input.isBaseline } : {}),
  });

  return {
    ok: true,
    html: input.html,
    sinCambios: preEditHtml === input.html && !input.modelRuntime,
  };
}
