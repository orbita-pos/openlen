// A dónde manda el navegador el código de un solo uso. Lista CERRADA: ningún
// parámetro decide el destino, para que esto no sea una redirección abierta.
//   app → openlen://entrar  (el esquema que registra la app Android)
//   dev → http://localhost:5173/  (Vite en el navegador de la PC; sólo fuera de producción)
export function urlDeRegreso(o: { retorno: "app" | "dev"; codigo: string; estado: string; produccion: boolean }): string | null {
  const q = new URLSearchParams({ codigo: o.codigo, estado: o.estado }).toString();
  if (o.retorno === "app") return `openlen://entrar?${q}`;
  return o.produccion ? null : `http://localhost:5173/?${q}`;
}
