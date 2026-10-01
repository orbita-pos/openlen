// Provisional: la Task 10 la sustituye por la llamada con el diseño del prototipo.
import type { ReactNode } from "react";

export interface TarjetaGuardada {
  clave: string;
  nodo: ReactNode;
}

export function Llamada(_: { cliente: unknown; projectId: string; idioma: string; onTerminar: (g: TarjetaGuardada[]) => void }) {
  return null;
}
