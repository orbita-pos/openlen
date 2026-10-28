type Catalogo = { HEAD: Record<string, string>; FACE: Record<string, string> };
export type Look = { cabeza: string; cara: string };
const CLAVE = "len-movil-look";
export function sanearLook(look: unknown, catalogo: Catalogo): Look {
  const objeto = look && typeof look === "object" ? look as Record<string, unknown> : {};
  const valido = (v: unknown, lista: Record<string, string>) => typeof v === "string" && Object.hasOwn(lista, v) ? v : "";
  return { cabeza: valido(objeto.cabeza, catalogo.HEAD), cara: valido(objeto.cara, catalogo.FACE) };
}
export function leerLook(catalogo: Catalogo): Look {
  try { return sanearLook(JSON.parse(localStorage.getItem(CLAVE) || "null"), catalogo); }
  catch { return { cabeza: "", cara: "" }; }
}
export function aplicarLook(look: unknown, catalogo: Catalogo): void {
  localStorage.setItem(CLAVE, JSON.stringify(sanearLook(look, catalogo)));
  window.dispatchEvent(new Event("len-look"));
}
export function escucharLook(cambiar: () => void): () => void {
  const externo = (e: StorageEvent) => { if (!e.key || e.key === CLAVE) cambiar(); };
  window.addEventListener("len-look", cambiar);
  window.addEventListener("storage", externo);
  return () => { window.removeEventListener("len-look", cambiar); window.removeEventListener("storage", externo); };
}
