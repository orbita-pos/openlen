import "server-only";

import { createHash } from "node:crypto";

import type { ProjectData } from "@/lib/projects/types";
import {
  aplicarIntentDeScript,
  scriptDelDocumento,
} from "@/lib/page-engine/conservar-scripts";
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
  /**
   * Etiqueta para la versión del ANTES, en lugar de «Before AI edit».
   *
   * Existe para un solo caso y merece la pena: cuando el llamador ha detectado
   * que este guardado PISA una edición que hizo otro escritor mientras él
   * pensaba, la fila del «antes» es lo único que le queda al usuario — y con la
   * etiqueta de siempre queda indistinguible de las decenas que deja un día de
   * trabajo normal. Ausente ⇒ «Before AI edit», como siempre.
   */
  readonly etiquetaPrevia?: string;
  /** Qué hacer con el JavaScript del modelo en este guardado. Ausente =
   *  `preservar`, que es lo correcto por defecto: la inmensa mayoría de los
   *  turnos no tocan el comportamiento. */
  readonly runtimeIntent?: RuntimeIntent;
  /** Autoridad calculada por la ruta. Ausente deniega toda mutación nueva;
   * preservar/re-sellar no crea ni borra autoridad y sigue permitido. */
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
  /** Quitar el `<script>` del documento. La página se queda sin JavaScript. */
  | { readonly kind: "borrar" };

export interface PersistPageDeps {
  readonly loadProject: (
    projectId: string,
    userId: string,
  ) => Promise<
    // ⚰️ Aquí se exigían «las DOS columnas de cápsula, obligatorias» para que un
    // `loadProject` que se dejara `pageRuntimes` en su `select` no hiciera que
    // toda edición de subpágina perdiera su JavaScript en silencio. Ya no hay
    // columnas que exigir: se fueron con la cápsula el 26/08/2026 (`933acc9d`),
    // y el script viaja dentro de `data.html`. Corregido el 2026-09-05.
    | { data: ProjectData }
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
  ) => Promise<void>;
  /** Best-effort por contrato: perder un snapshot no puede costar la edición.
   *
   *  DEVUELVE EL ID DE LA FILA, y eso no es un adorno: es lo único con lo que
   *  el Deshacer del Chat puede pedirle al servidor que restaure DESDE SU BASE
   *  en vez de mandarle el documento (que se sanea, y con él se iba el
   *  JavaScript del modelo — ver components/workspace-v2/panels/undo-turn.ts).
   *
   *  `null` = no se archivó nada: el snapshot falló, o `createVersion` lo
   *  rechazó por vacío. Quien lo reciba tiene que tratarlo como «este turno no
   *  se puede deshacer», nunca caer al camino viejo. */
  readonly snapshotVersion: (input: {
    projectId: string;
    html: string;
    label: string;
    source: "manual" | "chat";
    page: string | null;
    isBaseline?: boolean;
  }) => Promise<string | null>;
}

/**
 * Lo que devuelve una escritura de página: el documento final y qué le pasó.
 *
 * ⚰️ Este bloque describía «el fragmento del `.set()` que decide qué le pasa a
 * `projects.generatedRuntime`» y su tabla de tres estados (`undefined` = no
 * toques la columna · cápsula = escríbela · `null` = vacíala). Nada de eso
 * existe: la cápsula se retiró el 2026-08-26 y las dos columnas no se escriben
 * ni se leen —cero apariciones en código, comprobado el 2026-09-05—. Además el
 * texto ni siquiera describía este tipo: era la documentación de otra cosa que
 * se quedó pegada encima cuando aquélla se fue.
 */
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
      /** LO MISMO, pero sin obligar a nadie a inferirlo — ver
       *  `CambioDelDocumento`. `sinCambios` se deriva de aquí. */
      readonly cambio: CambioDelDocumento;
      /** La versión que guarda el documento de ANTES de esta escritura, o
       *  `null` si no hubo nada que archivar.
       *
       *  ES LA DIRECCIÓN DEL DESHACER. Viaja hasta el botón del Chat (evento
       *  `html` del Agente · `done` del Chat clásico) para que restaurar sea
       *  «servidor, vuelve a ESTA fila» y no «servidor, toma este documento».
       *  Lo segundo pasa por el saneador, y por ahí se perdía el JavaScript del
       *  modelo. Ver components/workspace-v2/panels/undo-turn.ts. */
      readonly versionPrevia: string | null;
    }
  | { readonly ok: false; readonly error: string };

/**
 * QUÉ LE PASÓ AL DOCUMENTO en esta escritura. Tres variantes, y la tercera es
 * la que faltaba.
 *
 * 🔴 POR QUÉ TRES. `sinCambios` era un booleano, así que sólo sabía decir «no
 * cambió» y «lo demás». Y «lo demás» metía en el mismo saco dos cosas que no se
 * parecen: **cambió** y **no lo sé**. Cuando `activeHtml` devolvía null —la
 * página aún no existía, o el documento no se pudo leer— la comparación
 * `null === input.html` salía `false` y quien preguntaba leía «sí cambió». Una
 * afirmación con toda naturalidad sobre algo que nadie había mirado.
 *
 * Y quien pregunta es el Agente, que con esa respuesta cierra el turno
 * diciéndole al usuario lo que hizo. Es la misma familia que el fallo medido el
 * 2026-08-22: el modelo reproducía el marcado original carácter por carácter,
 * guardaba, y contaba que lo había arreglado.
 *
 * Los hashes van en la variante que cambió porque son la EVIDENCIA: dos
 * etiquetas cortas que dicen «este documento» y «aquél». Pueden salir iguales
 * en un `cambio` legítimo — un turno que sólo retira el JavaScript deja el HTML
 * idéntico y la página distinta.
 */
export type CambioDelDocumento =
  | {
      readonly estado: "cambio";
      readonly hashAntes: string;
      readonly hashDespues: string;
    }
  | { readonly estado: "sin_cambio"; readonly hash: string }
  | { readonly estado: "no_se"; readonly motivo: string };

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
  const row = await deps.loadProject(input.projectId, input.userId);
  if (!row) return { ok: false, error: "proyecto no encontrado" };

  // EL JAVASCRIPT ES PARTE DEL DOCUMENTO, así que el intent es una operación
  // sobre el HTML y no sobre una columna. `preservar` deja de ser una acción:
  // el `<script>` sobrevive a las ops del turno igual que sobrevive un
  // `<footer>` que nadie tocó. Ver lib/page-engine/conservar-scripts.ts.
  input = { ...input, html: aplicarIntentDeScript(input.html, intent) };
  // ¿El código re-sellado sigue hablando de ESTA página?

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
  //
  // Y SE GUARDA SU ID. Es la fila a la que apunta el Deshacer del Chat: sin
  // ella el botón sólo sabía mandar el documento por `PATCH /html`, que lo
  // sanea y le quitaba el JavaScript del modelo. `null` cuando no hubo nada que
  // archivar (el turno no cambió el documento) — ahí tampoco hay nada que
  // deshacer.
  const preEditHtml = activeHtml(row.data, input.page);
  let versionPrevia: string | null = null;
  if (preEditHtml && preEditHtml !== input.html) {
    versionPrevia = await deps.snapshotVersion({
      projectId: input.projectId,
      html: preEditHtml,
      label: input.etiquetaPrevia ?? "Before AI edit",
      source: "manual",
      page: input.page,
    });
  }

  // EL HUECO QUE SE DENUNCIA AQUÍ. Si la edición quitó el elemento al que el
  // script se enganchaba, `getElementById(...)` LANZA en la página publicada y
  // la excepción aborta el script ENTERO. Un elemento borrado puede apagar toda
  // la interactividad, con el error viviendo en la consola del visitante. Por
  // eso se buscan huérfanos abajo.
  //
  // ⚰️ Antes de esto había tres párrafos sobre la cápsula: el hash que ataba
  // `projectId + html + code`, la Home en `generatedRuntime` y las subpáginas
  // en `pageRuntimes[slug]`, y un `resealRuntime` que «re-ata a ciegas».
  // Corregido el 2026-09-05: la cápsula murió el 2026-08-26 —el JavaScript vive
  // dentro de `data.html`, y por eso la línea de abajo lo saca con
  // `scriptDelDocumento(input.html)`—, las dos columnas no se tocan, y
  // `resealRuntime` no existe como símbolo en ningún fichero: sólo se nombra en
  // tres comentarios, éste incluido. El párrafo del medio además se cortaba a
  // mitad de frase, en «Si este turno trajo un script».
  //
  // Se avisa, no se repara: reescribir el código del modelo sería inventar. Y
  // el aviso llega también al modelo en el turno siguiente, que ahora sí puede
  // arreglarlo porque el runtime es direccionable por ops.
  // Tras un borrado no queda código, así que no hay huérfanos que denunciar y
  // el aviso `runtime_stale` que hubiera se RETIRA en la rama de abajo: quitar
  // el JavaScript arregla, por definición, todas sus referencias muertas.
  const codigoFinal = scriptDelDocumento(input.html);
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

  await deps.saveProjectData(input.projectId, input.userId, nextData);

  await deps.snapshotVersion({
    projectId: input.projectId,
    html: input.html,
    label: input.label,
    source: "chat",
    page: input.page,
    ...(input.isBaseline !== undefined ? { isBaseline: input.isBaseline } : {}),
  });

  const cambio = calcularCambio(preEditHtml, input.html, intent.kind);
  return {
    ok: true,
    html: input.html,
    cambio,
    versionPrevia,
    // Se conserva DERIVADO del campo de arriba, no calculado aparte: dos
    // cuentas de la misma cosa es como se separan.
    sinCambios: cambio.estado === "sin_cambio",
  };
}

/** Los 16 primeros hex de un sha256. No es criptografía: es una etiqueta corta
 *  que permite decir «este documento» y «aquél» sin arrastrar dos documentos. */
function hashDocumento(html: string): string {
  return createHash("sha256").update(html).digest("hex").slice(0, 16);
}

function calcularCambio(
  antes: string | null | undefined,
  despues: string,
  intent: RuntimeIntent["kind"],
): CambioDelDocumento {
  // NO SÉ. `activeHtml` devuelve null cuando la página no existe todavía o el
  // documento no se pudo leer. Hasta hoy eso caía en la comparación
  // `null === input.html`, salía `false`, y quien preguntaba leía «sí cambió» —
  // una afirmación sobre algo que nadie miró.
  if (antes === null || antes === undefined) {
    return { estado: "no_se", motivo: "no habia documento anterior que comparar" };
  }
  // Un turno que RETIRA o REEMPLAZA el JavaScript sí cambió la página aunque el
  // HTML salga idéntico. (⚰️ Esto decía «lo que cambia vive en
  // `generatedRuntime`»; desde el 2026-08-26 vive dentro del propio `data.html`.
  // Corregido el 2026-09-05.) Por eso los dos hashes pueden salir IGUALES en un
  // `cambio` legítimo — el documento es el mismo, la página no.
  if (antes === despues && intent === "preservar") {
    return { estado: "sin_cambio", hash: hashDocumento(despues) };
  }
  return {
    estado: "cambio",
    hashAntes: hashDocumento(antes),
    hashDespues: hashDocumento(despues),
  };
}
