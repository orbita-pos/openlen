// QUÉ MINIATURA SE ESTÁ RENDERIZANDO AHORA MISMO, por proyecto.
//
// POR QUÉ EXISTE. `publishProject` termina con `void renderProjectThumbnail(…)`
// —fuego y olvido— y ese render abre SU PROPIO Chromium con un tope de 35 s. Si
// llega otra publicación del mismo proyecto mientras tanto, la que está
// corriendo retrata unos bytes QUE YA NO SON LOS PUBLICADOS: aunque terminara,
// la sobrescribiría el render que la publicación nueva lanza al final.
//
// O sea que es trabajo tirado POR CONSTRUCCIÓN, no por mala suerte de
// concurrencia. Un Chromium entero, una codificación AVIF y una subida al
// almacenamiento, por una imagen que nadie va a ver. Y el gesto que lo produce
// es el más común del producto: publicar, mirar, retocar y republicar.
//
// ⚰️ ESTE FICHERO NACIÓ CON OTRA JUSTIFICACIÓN Y ERA FALSA. Queda escrita porque
// el número anda suelto en el commit `e6f796cf`. Se midieron cuatro
// publicaciones seguidas —«8.840 · 57.765 · 2.833 · 2.774 ms»— y se concluyó
// que la segunda chocaba con la miniatura de la primera. NO ERA ESO:
//
//   · Con la miniatura APAGADA del todo, la segunda seguía en 55.441 ms.
//   · Es 98% CPU de este proceso, y el perfil lo atribuye entero a
//     `internalModuleStat` — resolución de módulos, no trabajo de publicar.
//   · Con el grafo de módulos CALENTADO (dos publicaciones sin cronometrar
//     antes de medir), cuatro seguidas dan 3,1 · 3,1 · 3,2 · 4,6 s con la
//     miniatura encendida y 2,3 · 2,2 · 2,5 · 4,9 s apagada. No hay choque.
//
// El pico era del cargador de `tsx` en la sonda, no del producto. Lo que
// justifica este registro es el trabajo tirado, que sí es real y no necesita
// cronómetro. NO es un arreglo de rendimiento y no debe venderse como tal.
//
// 🔴 VIVE APARTE DE `thumbnail.ts` A PROPÓSITO, y no por gusto de fichero
// pequeño: ahí dentro todo pasa por Puppeteer, así que una prueba de esta
// contabilidad tendría que levantar Chrome para comprobar un `Map`. Aquí son
// funciones puras sobre un registro, y se comprueban en milisegundos — que es
// la diferencia entre tener prueba y no tenerla.

/** Un render en curso. `cerrar` lo aborta de verdad (cierra su navegador);
 *  hasta que el navegador existe es un no-op y basta con la bandera. */
export interface Vuelo {
  /** Lo puso a `true` una publicación posterior. Quien lo lleve debe rendirse
   *  en el siguiente punto de control y NO escribir en la base. */
  cancelado: boolean;
  /** Cierra el navegador de este vuelo, si ya lo abrió. */
  cerrar: () => void;
}

const enVuelo = new Map<string, Vuelo>();

/**
 * Registra un vuelo para `projectId`, cancelando el que hubiera.
 *
 * Devuelve el vuelo nuevo. Quien lo reciba tiene que mirar `cancelado` en cada
 * punto de control: puede cancelarse ANTES de abrir el navegador —esperando
 * turno en el semáforo, que es donde más se ahorra porque ni se lanza Chrome— o
 * DESPUÉS, y entonces se le cierra por debajo.
 */
export function tomarVuelo(projectId: string): Vuelo {
  cancelarVuelo(projectId);
  const vuelo: Vuelo = { cancelado: false, cerrar: () => {} };
  enVuelo.set(projectId, vuelo);
  return vuelo;
}

/** Cancela la miniatura en vuelo de `projectId`, si la hay. `true` si canceló
 *  alguna. Hoy su único llamador es `tomarVuelo`: quien invalida una miniatura
 *  es la miniatura siguiente del mismo proyecto. */
export function cancelarVuelo(projectId: string): boolean {
  const previo = enVuelo.get(projectId);
  if (!previo) return false;
  previo.cancelado = true;
  previo.cerrar();
  enVuelo.delete(projectId);
  return true;
}

/**
 * Da por terminado un vuelo.
 *
 * Sólo borra si el registro sigue siendo ESTE vuelo: si otra publicación ya
 * tomó el relevo, borrar aquí dejaría al nuevo sin poder ser cancelado por el
 * siguiente. Es la comprobación que convierte esto en correcto bajo carrera.
 */
export function soltarVuelo(projectId: string, vuelo: Vuelo): void {
  if (enVuelo.get(projectId) === vuelo) enVuelo.delete(projectId);
}

/** Cuántos vuelos hay. Sólo para pruebas y para no dejar fugas silenciosas. */
export function vuelosEnCurso(): number {
  return enVuelo.size;
}
