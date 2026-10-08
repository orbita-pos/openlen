// LO QUE UNA APP QUE NACE AÑADE AL PRIMER MENSAJE a `/api/agent`: la tarjeta
// App del estado vacío (`tarjetas-nace-como.tsx`). Un sitio para la forma del
// campo, que la usan dos: el borrador que se manda solo y el cuerpo del turno.

/** Lo que pide nacer como app: la tarjeta, y el idioma de la interfaz. */
export interface PideNacer {
  readonly naceComo?: "app";
  readonly idioma?: string;
}

/** Los campos del cuerpo: `{ naceComo: "app", idioma }`, o nada si es una página. */
export function camposDeNacer(o: PideNacer | null | undefined): PideNacer {
  if (o?.naceComo !== "app") return {};
  return { naceComo: "app", ...(o.idioma ? { idioma: o.idioma } : {}) };
}
