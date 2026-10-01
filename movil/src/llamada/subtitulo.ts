// El subtítulo de la llamada como el prototipo: palabras sueltas, y lo
// importante (los números) en pastilla blanca con el texto naranja oscuro.
const NUMERO = /\d/;

export function palabrasDelSubtitulo(linea: string): { texto: string; clave: boolean }[] {
  return linea.split(/\s+/).filter(Boolean).map((texto) => ({ texto, clave: NUMERO.test(texto) }));
}
