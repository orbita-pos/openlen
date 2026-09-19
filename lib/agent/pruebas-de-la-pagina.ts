// ─────────────────────────────────────────────────────────────────────────────
// LA SUITE DE LA PÁGINA — las promesas que ya se cumplieron una vez.
//
// 🔴 POR QUÉ EXISTE. `session.behaviorSpec` vive en la sesión y se muere con el
// turno, así que OpenLen no detecta REGRESIONES de comportamiento: el turno 3
// construye el carrito y lo comprueba, el turno 9 reescribe el runtime —que va
// entero, no por parches— y si se lo lleva por delante no se entera nadie. Con
// veinte turnos encima de una página eso no es un riesgo, es cuestión de cuándo.
//
// Y es lo que Claude Code da por supuesto sin decirlo: allí el modelo no se
// inventa las expectativas porque el proyecto YA tiene su suite, escrita antes
// por una persona. Aquí esa suite no existe. Esto la construye, con lo único
// que hay a mano: las promesas que el propio modelo declaró y que se cumplieron.
//
// 🔴 NACE EN VERDE, y esta regla es el diseño entero. `verify.ts` anotó el
// 2026-09-04 por qué una prueba que falla NO puede acusar a la página: «de los 3
// fallos de `prueba` de la corrida de 16 páginas, CERO eran de la página… un
// comprobador que acierta 0 de 3 no puede declarar rota la página de nadie».
// Aquellas tres nunca pasaron —faltaba un verbo, y dos pulsaban «enviar» sin
// rellenar campos `required`—, así que ninguna entraría aquí.
//
// Una promesa que se cumplió sobre una página que funcionaba, y que falla
// DESPUÉS de otra edición, ya no es la opinión del modelo que escribió el
// código: es un cambio en la página. Cambia quién es el testigo, que es la
// frase con la que ese mismo fichero separa lo que puede acusar de lo que no.
//
// PURO A PROPÓSITO: sin base, sin red, sin navegador. Lo que decide quién corre
// y quién guarda vive fuera.
// ─────────────────────────────────────────────────────────────────────────────

import type { FalloSpec, PasoSpec } from "./behavior-spec";

/** Una promesa que YA se cumplió una vez, guardada con la página. */
export interface PruebaGuardada {
  readonly id: string;
  readonly pasos: readonly PasoSpec[];
  /** El slug de la página. `null` es la home (`data.html`). */
  readonly pagina: string | null;
  /** ms-epoch. Sólo desempata cuando el tope se llena. */
  readonly creada: number;
  /** MS-EPOCH DE CUÁNDO DEJÓ DE CUMPLIRSE, si es que dejó.
   *
   *  La memoria del contador vive AQUÍ y no en la sesión, que se muere con el
   *  turno: para saber si el turno siguiente arregló la regresión hace falta
   *  algo que cruce turnos, y lo único que cruza es la propia promesa.
   *
   *  Se pone cuando se rompe y se quita cuando vuelve a cumplirse. Conserva la
   *  marca ORIGINAL mientras sigue rota: dice cuándo se rompió, no cuándo se
   *  miró por última vez. */
  readonly rota?: number;
}

/** Por PÁGINA, no por proyecto: cada promesa cuesta interacción en el render
 *  que los ojos ya hacen, y una página vieja no puede pagar el turno entero. */
export const TOPE_PRUEBAS_POR_PAGINA = 8;

/**
 * TODOS los selectores que una promesa toca: los que pulsa, los que rellena y
 * los que mira. Es lo que decide si la promesa sigue teniendo sentido.
 */
export function selectoresDe(pasos: readonly PasoSpec[]): string[] {
  const salida: string[] = [];
  for (const paso of pasos) {
    if (paso.clic) salida.push(paso.clic);
    if (paso.escribe) salida.push(...Object.keys(paso.escribe));
    for (const e of paso.entonces ?? []) salida.push(e.donde);
  }
  return salida;
}

/** La firma de una promesa: qué toca, en orden. Dos pruebas con la misma firma
 *  son la misma promesa reescrita, no dos — si no, cada turno que repitiera su
 *  comprobación llenaría el tope él solo. */
function firma(pasos: readonly PasoSpec[]): string {
  return pasos
    .map((p) => `${p.clic ?? ""}>${Object.keys(p.escribe ?? {}).join(",")}>${(p.entonces ?? []).map((e) => e.donde).join(",")}`)
    .join("·");
}

/**
 * Guarda la promesa de ESTE turno, y sólo si nació en verde.
 *
 * `fallos.length > 0` la descarta, incluidos los `deLaPrueba` —un selector que
 * no señalaba a nada—: una promesa que no se cumplió ni una vez no puede servir
 * de testigo de nada después.
 */
export function guardarSiNaceEnVerde(
  guardadas: readonly PruebaGuardada[],
  turno: {
    readonly pasos: readonly PasoSpec[];
    readonly fallos: readonly FalloSpec[];
    readonly pagina: string | null;
    /** Inyectable para que las pruebas no dependan del reloj. */
    readonly ahora?: number;
  },
): PruebaGuardada[] {
  if (turno.pasos.length === 0 || turno.fallos.length > 0) return [...guardadas];

  const suya = firma(turno.pasos);
  const cuando = turno.ahora ?? Date.now();
  const sinLaVieja = guardadas.filter(
    (p) => !(p.pagina === turno.pagina && firma(p.pasos) === suya),
  );
  const nueva: PruebaGuardada = {
    id: `p${cuando}`,
    pasos: turno.pasos,
    pagina: turno.pagina,
    creada: cuando,
  };

  // El tope se aplica DENTRO de su página: llenar la home no puede tirar las
  // promesas del menú.
  const deOtras = sinLaVieja.filter((p) => p.pagina !== turno.pagina);
  const deEsta = sinLaVieja.filter((p) => p.pagina === turno.pagina);
  const recortadas = [...deEsta, nueva]
    .sort((a, b) => a.creada - b.creada)
    .slice(-TOPE_PRUEBAS_POR_PAGINA);
  return [...deOtras, ...recortadas];
}

/**
 * CÓMO QUEDA LA SUITE AL CERRAR EL TURNO — las dos cosas, en un solo sitio.
 *
 * La ruta tiene que retirar las promesas que el navegador declaró sin sentido y
 * guardar la que acaba de nacer en verde. Hacerlo en dos pasos sueltos dentro
 * de un fichero de 1.500 líneas es como se pierde uno de los dos, así que el
 * orden y la decisión viven aquí, probados sin ruta y sin base.
 *
 * Primero se retira y después se guarda, y no al revés: una promesa que el
 * turno reescribe entera —mismo selector, otra expectativa— no puede
 * retirarse después de entrar.
 */
export function actualizarSuite(
  guardadas: readonly PruebaGuardada[],
  cambios: {
    readonly turno?: {
      readonly pasos: readonly PasoSpec[];
      readonly fallos: readonly FalloSpec[];
      readonly pagina: string | null;
      readonly ahora?: number;
    };
    readonly retirar?: readonly string[];
    /** El documento que de verdad quedó guardado. Con él, la muerte por
     *  selector deja de ser un filtro de lectura y se hace DURADERA: sin esto
     *  una promesa muerta seguía en la base para siempre —invisible, pero
     *  ocupando una de las 8 plazas de su página—. Ausente ⇒ no se limpia:
     *  un turno que no sabe qué documento quedó no puede vaciar por si acaso. */
    readonly documento?: string;
    /** De qué página es `documento`. Las promesas de otras no se juzgan. */
    readonly pagina?: string | null;
  },
): PruebaGuardada[] {
  const retirar = cambios.retirar ?? [];
  const sinRetiradas = retirar.length > 0
    ? guardadas.filter((p) => !retirar.includes(p.id))
    : [...guardadas];
  // Se limpia ANTES de añadir: la promesa del turno acaba de cumplirse sobre
  // ese mismo documento, así que pasarla otra vez por el filtro no aporta —y
  // si el llamador se equivoca de página, la mataría recién nacida.
  const limpias =
    cambios.documento !== undefined
      ? vivas(sinRetiradas, cambios.documento, cambios.pagina ?? null)
      : sinRetiradas;
  return cambios.turno ? guardarSiNaceEnVerde(limpias, cambios.turno) : limpias;
}

/** Una promesa guardada que dejó de cumplirse. Lleva el id para poder nombrarla
 *  —«al pulsar #agregar, #total ya no cambia»— en vez de decir «algo falló». */
export interface Regresion {
  readonly id: string;
  /** El paso DENTRO de su prueba, en base 1. */
  readonly paso: number;
  readonly mensaje: string;
}

/** Lo que este turno le hizo a la suite, para el registro. */
export interface CuentaDeRegresiones {
  /** Promesas que se han roto AHORA y no lo estaban. */
  readonly nuevas: number;
  /** Ya estaban rotas y siguen. */
  readonly siguenRotas: number;
  /** Estaban rotas y han vuelto a cumplirse. */
  readonly arregladas: number;
}

/**
 * MARCA LAS QUE SE ROMPIERON Y DESMARCA LAS QUE VOLVIERON, y las cuenta.
 *
 * Es el peldaño 2 de Claude Code otra vez —`…` con
 * `…` / `…`: el aviso no se manda a ciegas, se
 * mide si sirvió. Aquí decide lo único que el plan de la suite dejó abierto a
 * propósito: si una regresión puede llegar a declarar rota la página. Esa
 * promoción se hace con el número delante, no con ganas — esta casa ya degradó
 * el canal de las pruebas una vez por medirlo.
 *
 * 🔴 SÓLO SE TOCA LO QUE SE COMPROBÓ. Una promesa que este turno no corrió
 * —otra página, o fuera del tope— conserva su marca y no se cuenta. Sin eso,
 * un turno en la home «arreglaría» todas las promesas rotas del menú sin
 * haberlas mirado, que es exactamente la clase de afirmación sin testigo que
 * este repo persigue.
 */
export function marcarRegresiones(
  guardadas: readonly PruebaGuardada[],
  turno: {
    /** Ids de las promesas que este turno llegó a correr. */
    readonly comprobadas: readonly string[];
    /** Ids de las que fallaron. */
    readonly rotas: readonly string[];
    readonly ahora?: number;
  },
): { readonly suite: PruebaGuardada[]; readonly cuenta: CuentaDeRegresiones } {
  const cuando = turno.ahora ?? Date.now();
  let nuevas = 0;
  let siguenRotas = 0;
  let arregladas = 0;

  const suite = guardadas.map((prueba) => {
    if (!turno.comprobadas.includes(prueba.id)) return prueba;
    if (turno.rotas.includes(prueba.id)) {
      if (prueba.rota) {
        siguenRotas += 1;
        return prueba;
      }
      nuevas += 1;
      return { ...prueba, rota: cuando };
    }
    if (prueba.rota) {
      arregladas += 1;
      const { rota: _ya, ...sana } = prueba;
      return sana;
    }
    return prueba;
  });

  return { suite, cuenta: { nuevas, siguenRotas, arregladas } };
}

/**
 * LO QUE SE DICE CUANDO UNA PROMESA SE ROMPE.
 *
 * Las tres piezas de Claude Code, en orden: QUÉ dejó de cumplirse, POR QUÉ lo
 * sabemos —se cumplió antes, sobre esta misma página— y QUÉ hacer. Allí eso es
 * «…»; aquí es esto.
 *
 * 🔴 QUIÉN ACTÚA: el dueño. Los ojos corren al CERRAR el turno, así que el
 * modelo no puede arreglarlo sobre la marcha — lo leerá en el historial del
 * turno siguiente, que es exactamente lo que ya hace la rama `observado`.
 * Prometer «lo arregla en el mismo turno» sería prometer un bucle que hoy no
 * existe.
 *
 * Los mensajes vienen del navegador y ya nombran el elemento («#total ya no
 * cambia al pulsar #agregar»), así que no se reescriben: se enumeran.
 */
export function avisoDeRegresion(regresiones: readonly Regresion[]): string {
  if (regresiones.length === 0) return "";
  const lista = regresiones.map((r) => `· ${r.mensaje}`).join("\n");
  return (
    `Algo que esta página YA hacía ha dejado de funcionar:\n${lista}\n` +
    `Lo comprobamos porque se cumplió antes, en esta misma página. Compruébalo antes de publicar.`
  );
}

/**
 * REPARTE lo que devolvió el navegador entre quien tiene que responder.
 *
 * Los ojos corren un solo programa: los pasos de la prueba de ESTE turno y
 * detrás los de cada promesa guardada, en orden. Lo que vuelve es una lista
 * plana con el paso en base 1 (`leerFallos`), así que aquí se deshace esa suma.
 *
 * Tres destinos, y la diferencia importa:
 *  · `delTurno` — la promesa que el modelo acaba de declarar. Sigue SIN acusar
 *    a la página: es el canal que esta casa degradó a observación el 04/09 tras
 *    medir que acertaba 0 de 3.
 *  · `regresiones` — una promesa que YA se cumplió y ha dejado de cumplirse.
 *    Otro testigo, otro peso.
 *  · `retirar` — 🔴 `deLaPrueba`: el navegador dice que el selector no señala a
 *    nada. Eso no es la página rota, es una promesa que ya no tiene sentido; se
 *    retira sin acusar a nadie. Es la red que caza lo que `vivas()` no sabe
 *    leer en el servidor, porque allí sólo se juzgan los selectores por id.
 *
 * Un paso fuera de rango no se le cuelga a la última por descarte: mandar al
 * modelo a arreglar la promesa equivocada es peor que callarse.
 */
export function repartirFallos(
  fallos: readonly FalloSpec[],
  pasosDelTurno: number,
  guardadas: readonly PruebaGuardada[],
): {
  readonly delTurno: FalloSpec[];
  readonly regresiones: Regresion[];
  readonly retirar: string[];
} {
  const delTurno: FalloSpec[] = [];
  const regresiones: Regresion[] = [];
  const retirar: string[] = [];

  for (const fallo of fallos) {
    if (fallo.paso <= pasosDelTurno) {
      delTurno.push(fallo);
      continue;
    }
    // Cuántos pasos han pasado ya, para encontrar a cuál de las guardadas
    // pertenece este número.
    let desde = pasosDelTurno;
    let encontrada: PruebaGuardada | undefined;
    let dentro = 0;
    for (const prueba of guardadas) {
      const hasta = desde + prueba.pasos.length;
      if (fallo.paso > desde && fallo.paso <= hasta) {
        encontrada = prueba;
        dentro = fallo.paso - desde;
        break;
      }
      desde = hasta;
    }
    if (!encontrada) continue;
    if (fallo.deLaPrueba) {
      if (!retirar.includes(encontrada.id)) retirar.push(encontrada.id);
      continue;
    }
    regresiones.push({ id: encontrada.id, paso: dentro, mensaje: fallo.mensaje });
  }

  return { delTurno, regresiones, retirar };
}

/**
 * Las promesas que siguen teniendo sentido sobre ESTE documento.
 *
 * 🔴 UNA PROMESA MUERE CON SU SELECTOR. Si el dueño pidió quitar el carrito, el
 * `#agregar` desaparece y su promesa se va con él, sin que nadie declare nada.
 * Sin esto la suite se queda roja para siempre y el dueño aprende a ignorarla —
 * que es el fallo que este repo lleva el día entero cerrando: un aviso que nadie
 * lee es peor que no tener aviso.
 *
 * Basta con que falte UNO: media promesa no se puede comprobar.
 *
 * Sólo juzga los selectores por id, que son los que la receta manda usar
 * (`DONDE_SE_DECLARA_UN_ALMACEN` y la ficha de `prueba`). Cualquier otro se deja
 * VIVO: retirar una promesa por no saber leer su selector sería perder una
 * comprobación en silencio. Si de verdad ya no señala a nada, lo dirá el
 * navegador con `deLaPrueba`, que es el testigo bueno para eso.
 *
 * Las de otras páginas pasan intactas: este documento no dice nada de ellas.
 */
export function vivas(
  guardadas: readonly PruebaGuardada[],
  html: string,
  pagina: string | null = null,
): PruebaGuardada[] {
  return guardadas.filter((prueba) => {
    if (prueba.pagina !== pagina) return true;
    return selectoresDe(prueba.pasos).every((selector) => {
      const id = /^#([A-Za-z0-9_-]+)$/.exec(selector)?.[1];
      if (!id) return true;
      return new RegExp(`id=["']${id}["']`).test(html);
    });
  });
}
