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

// LA PORTADA TAMBIÉN ELIGE (la píldora del input, `hero-kind-picker.tsx`): su
// elección viaja en la URL de /new como `kind=app` y marca la tarjeta App del
// proyecto en blanco. Página no lleva nada: es lo de siempre.

/** El parámetro de /new con el que la portada pide nacer como app. */
export const KIND_PARAM = "kind";

/** Lo que dice la URL: sólo `app` es app. */
export function kindFromParam(v: string | null): "pagina" | "app" {
  return v === "app" ? "app" : "pagina";
}

/** El enlace de la portada a /new: el brief escrito y, si es una app, `kind=app`. */
export function newProjectHref(brief: string, kind: "pagina" | "app"): string {
  const base = `/new?brief=${encodeURIComponent(brief.trim())}`;
  return kind === "app" ? `${base}&${KIND_PARAM}=app` : base;
}
