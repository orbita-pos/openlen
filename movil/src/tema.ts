// El tema de la app: naranja (claro) por defecto, como el prototipo, y el
// oscuro se elige a mano en «Tus páginas» y se recuerda. No sigue al teléfono:
// con el teléfono en oscuro la app salía negra y Jesús quería la naranja
// (01/10, probándola en su Galaxy). El prototipo pinta el oscuro con
// :root[data-theme="dark"].
export type Tema = "light" | "dark";
const CLAVE = "len-tema";

export function temaGuardado(): Tema {
  try {
    return localStorage.getItem(CLAVE) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function aplicarTema(t: Tema): void {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(CLAVE, t);
  } catch {
    /* sin almacenamiento: vale para esta vez */
  }
}
