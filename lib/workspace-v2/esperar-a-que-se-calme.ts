// ESPERAR A QUE SE CALME, en vez de rendirse a la primera.
//
// Existe por un fallo concreto del taller: crear una subpágina y aterrizar en
// la Home.
//
// `refetchProject` lleva una guarda —`editingLocally()`— que existe para que
// una CONVERGENCIA (el refetch al recuperar el foco, el de la otra pestaña) no
// pise ediciones que el servidor aún no ha visto. Esa guarda está bien para
// ese llamador. El problema es que se aplicaba también al otro tipo de
// llamador: el refetch DELIBERADO que va justo detrás de una escritura
// estructural —crear o borrar una página—, donde el que llama ya vació lo
// pendiente y NECESITA el estado nuevo.
//
// Ahí la guarda no protege nada: se salta el refetch en silencio, la página
// recién creada no entra en `loadedProject.pages`, y lo que pasa después es que
// `activeSitePage` no encuentra el slug y cae a la Home sin decir nada.
//
// La respuesta no es forzar el refetch —una escritura de verdad en vuelo sí
// merece respeto— sino ESPERAR a que la guarda se apague, con un tope, y decir
// si se apagó o no. Es la técnica de esperar por condición en vez de por un
// número de milisegundos inventado.

export interface OpcionesDeEspera {
  /** Cuánto se está dispuesto a esperar en total. Es un presupuesto, no una
   *  sugerencia: no se lo pasa ni por un milisegundo. */
  readonly topeMs: number;
  /** Cada cuánto se vuelve a preguntar. */
  readonly pasoMs: number;
  /** Inyectables para poder probar esto sin esperar de verdad. */
  readonly ahora?: () => number;
  readonly dormir?: (ms: number) => Promise<void>;
}

const dormirDeVerdad = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Pregunta por `sigueOcupado` hasta que diga que no, o hasta agotar `topeMs`.
 *
 * Devuelve `true` si se calmó y `false` si se agotó el tope — y esa diferencia
 * es la mitad del valor: el llamador tiene que poder distinguir «ya puedo» de
 * «me rendí», que es justo lo que la guarda original no dejaba saber.
 */
export async function esperarAQueSeCalme(
  sigueOcupado: () => boolean,
  opts: OpcionesDeEspera,
): Promise<boolean> {
  const ahora = opts.ahora ?? (() => Date.now());
  const dormir = opts.dormir ?? dormirDeVerdad;
  const limite = ahora() + Math.max(0, opts.topeMs);
  const paso = Math.max(1, opts.pasoMs);
  // Se pregunta SIEMPRE una vez antes de dormir: el caso normal es que ya esté
  // tranquilo, y ése no debe costar ni un tick.
  while (sigueOcupado()) {
    if (ahora() + paso > limite) return false;
    await dormir(paso);
  }
  return true;
}
