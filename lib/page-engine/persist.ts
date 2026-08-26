import "server-only";

import type { ProjectData } from "@/lib/projects/types";
import {
  capsulaDePagina,
  columnasDeRuntime,
  type FilaConRuntimes,
} from "@/lib/projects/page-runtimes";
import {
  runtimeMutationDeniedMessage,
  type RuntimeMutationCapability,
} from "@/lib/ai/runtime-capability";
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
  /** Qué hacer con el JavaScript del modelo en este guardado. Ausente =
   *  `preservar`, que es lo correcto por defecto: la inmensa mayoría de los
   *  turnos no tocan el comportamiento. */
  readonly runtimeIntent?: RuntimeIntent;
  /** Autoridad calculada por la ruta. Ausente deniega toda mutación nueva;
   * preservar/re-sellar no crea ni borra autoridad y sigue permitido. */
  readonly runtimeCapability?: RuntimeMutationCapability;
}

/**
 * Los TRES estados del JavaScript del modelo al guardar.
 *
 * Antes esto era un `modelRuntime?: string | null` y la diferencia entre «no
 * traigo script» y «quítalo» no se podía expresar: `null` y `undefined`
 * significaban los dos «preservar», y preservar RE-SELLA el código anterior
 * sobre el documento nuevo. El resultado era que a una página con JavaScript
 * del modelo no había NINGUNA forma de quitárselo — ni «quita el carrito», ni
 * «déjala sin animaciones», ni una reescritura entera sin script.
 *
 * `preservar` sigue siendo el defecto y no cambia: borrar el trabajo del modelo
 * porque este turno no produjo uno sería el peor comportamiento posible.
 * Borrar exige pedirlo.
 */
export type RuntimeIntent =
  /** Re-sellar el código que ya había sobre el documento nuevo. */
  | { readonly kind: "preservar" }
  /** Un `<script>` nuevo, del turno actual. */
  | { readonly kind: "reemplazar"; readonly code: string }
  /** Vaciar `projects.generatedRuntime`. La página se queda sin JavaScript. */
  | { readonly kind: "borrar" };

export interface PersistPageDeps {
  readonly loadProject: (
    projectId: string,
    userId: string,
  ) => Promise<
    // Las DOS columnas de cápsula, obligatorias. Eran opcionales, y con
    // `capsulaDePagina` leyendo de aquí eso significaba que un `loadProject`
    // que se dejara `pageRuntimes` en su `select` haría que toda edición de
    // subpágina perdiera su JavaScript, sin error de tipos ni de ejecución.
    // Ver la nota en lib/projects/page-runtimes.ts.
    | ({ data: ProjectData } & FilaConRuntimes)
    | null
  >;
  /** `runtime` viaja en el mismo UPDATE a propósito: hacerlo aparte costaría un
   *  SELECT en cada edición de cada proyecto, tenga cápsula o no.
   *
   *  TRES estados, y la diferencia entre los dos últimos es la que faltaba:
   *  `undefined` = no toques la columna · una cápsula = escríbela ·
   *  **`null` = VACÍALA**. Quien lo implemente tiene que mirar
   *  `runtime !== undefined`, nunca la veracidad — con `runtime ? …` un borrado
   *  se pierde en silencio y la página se queda con el script para siempre. */
  readonly saveProjectData: (
    projectId: string,
    userId: string,
    data: ProjectData,
    runtime?: ModelRuntimeCapsule | null,
    /** A QUÉ PÁGINA pertenece esa cápsula. Sin esto el escritor sólo podía
     *  guardarla en la columna de la Home, y una escritura desde /menu se
     *  llevaba por delante el JavaScript del inicio. Ver
     *  `columnasDeRuntime` en lib/projects/page-runtimes.ts. */
    page?: string | null,
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

/**
 * El fragmento del `.set()` que decide qué le pasa a `projects.generatedRuntime`.
 *
 * Existe para que los DOS escritores (el Agente y el Chat) no puedan divergir en
 * esto, que es donde el defecto vivía: los dos hacían `runtime ? { … } : {}`, y
 * con esa condición un borrado —que viaja como `null`— se perdía en silencio.
 * `undefined` = no toques la columna · cápsula = escríbela · `null` = vacíala.
 */
/** @deprecated Usa `columnasDeRuntime` — ésta sólo sabe de la Home. Se queda
 *  porque el escritor de versiones (lib/projects/versions.ts) restaura el
 *  documento raíz y nada más. */
export function columnaRuntime(
  runtime: ModelRuntimeCapsule | null | undefined,
): { generatedRuntime?: ModelRuntimeCapsule | null } {
  return runtime !== undefined ? { generatedRuntime: runtime } : {};
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
  const intent: RuntimeIntent = input.runtimeIntent ?? { kind: "preservar" };
  if (intent.kind !== "preservar") {
    // Esta última barrera sólo puede RESTRINGIR autoridad, nunca fabricarla.
    // Una capability falsa o ausente sigue falsa aunque el caller diga Home;
    // y una capability true tampoco salta la regla estructural de subpáginas.
    // La barrera sólo puede RESTRINGIR autoridad, nunca fabricarla: una
    // capacidad ausente cuenta como denegada. Lo que YA NO comprueba es la
    // página — desde el 2026-08-25 cada una guarda su propia cápsula, así que
    // una subpágina es un destino legítimo y no una excepción que tapar.
    if (!(input.runtimeCapability ?? { allowed: false }).allowed) {
      return { ok: false, error: `${runtimeMutationDeniedMessage()}; no se guardó nada` };
    }
  }
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
  // CADA PÁGINA guarda la suya. Hasta el 2026-08-25 esto era `undefined` para
  // toda subpágina —«la cápsula ata data.html»—, y eso no era una regla de
  // producto sino una de almacenamiento: sólo había UNA columna. Ahora la Home
  // sigue en `generatedRuntime` y las subpáginas van a `pageRuntimes[slug]`, y
  // el hash ata cada código al HTML de SU documento, que es lo que siempre hizo.
  //
  // El código sale de la cápsula guardada, nunca de aquí: re-sellar puede mover
  // el documento, jamás introducir código nuevo. Si este turno trajo un script
  // NUEVO, manda ése. Si no, se re-sella el que ya había PARA ESTA PÁGINA. Y si
  // pidió BORRARLO, se manda `null`.
  //
  // `undefined` y `null` NO son lo mismo: `undefined` = no toques nada,
  // `null` = vacía la de esta página. Confundirlas hacía imposible «quítame el
  // carrito», y ahora además tiene una segunda trampa — un `null` mal dirigido
  // desde /menu se llevaría el JavaScript de la Home. Por eso el destino lo
  // decide `columnasDeRuntime`, en un solo sitio.
  const capsulaPrevia = capsulaDePagina(row, input.page);
  const runtime: ModelRuntimeCapsule | null | undefined =
    intent.kind === "borrar"
      ? null
      : intent.kind === "reemplazar"
        ? buildCapsule({
            projectId: input.projectId,
            html: input.html,
            code: intent.code,
          })
        : (resealRuntime({
            projectId: input.projectId,
            html: input.html,
            capsule: capsulaPrevia ?? null,
          }) ?? undefined);

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
  // Tras un borrado no queda código, así que no hay huérfanos que denunciar y
  // el aviso `runtime_stale` que hubiera se RETIRA en la rama de abajo: quitar
  // el JavaScript arregla, por definición, todas sus referencias muertas.
  const codigoFinal = runtime ? runtime.code : "";
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

  await deps.saveProjectData(input.projectId, input.userId, nextData, runtime, input.page);

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
    // Un turno que RETIRA el JavaScript sí cambió la página aunque el HTML
    // salga idéntico: lo que cambia vive en `generatedRuntime`.
    sinCambios: preEditHtml === input.html && intent.kind === "preservar",
  };
}
