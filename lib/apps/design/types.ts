// EL MODO DISEÑO DE LAS APPS: los tipos que comparten el lienzo, el panel y el
// servidor (spec 2026-10-11-modo-diseno-de-apps). Sin imports de Node: lo usa
// el cliente.

/** Las propiedades CSS del panel, en el orden en que se leen y se mandan. */
export const DESIGN_PROPERTIES = [
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration-line",
  "color",
  "background-color",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-color",
  "border-style",
  "border-width",
  "border-radius",
  "opacity",
  "box-shadow",
] as const;

export const DESIGN_LIMITS = { elements: 20, bytes: 64 * 1024, note: 2000, chain: 6, text: 200, screenshots: 4 } as const;

export interface SourceLink {
  readonly path: string;
  readonly line: number;
  readonly component: string | null;
  /** El sitio de la llamada en el paquete del lienzo (`línea:columna`): distingue dos
   *  etiquetas iguales en la misma línea. Sólo vale dentro del mismo documento. */
  readonly site?: string;
}
export type DesignProperty = (typeof DESIGN_PROPERTIES)[number];
export type EditableField = DesignProperty | "text" | "alt";

/** Lo que el lienzo dice del elemento elegido (`openlen:design-selected`). */
export interface DesignSelection {
  /** Pantalla + eslabón principal + etiqueta; sin cadena, `id:<designId>`. */
  readonly key: string;
  /** De dentro afuera: la etiqueta, luego los componentes que la usan. */
  readonly chain: readonly SourceLink[];
  /** Índice en `chain` del USO (el primero fuera de components/ui); -1 sin cadena. */
  readonly primary: number;
  readonly tag: string;
  readonly text: string;
  /** Sólo texto, sin hijos: el panel deja cambiarlo. */
  readonly textEditable: boolean;
  readonly copies: number;
  /** `#/paquetes`; `#/` en el principio. */
  readonly screen: string;
  readonly styles: Readonly<Record<DesignProperty, string>>;
  readonly image: { readonly src: string; readonly alt: string } | null;
  /** Marca de sólo-lienzo para un elemento sin cadena. */
  readonly designId: string | null;
  /** Las familias que la app ya tiene cargadas (`document.fonts`), sin repetir. */
  readonly fonts: readonly string[];
}

export interface DesignChange {
  readonly property: EditableField;
  readonly before: string;
  readonly after: string;
}

export interface DesignElementRequest {
  readonly chain: readonly SourceLink[];
  readonly primary: number;
  readonly tag: string;
  readonly text: string;
  readonly copies: number;
  readonly screen: string;
  readonly changes: readonly DesignChange[];
  readonly photo?: { readonly url: string; readonly alt?: string };
  readonly note?: string;
}

/** El campo `design` de un turno de `/api/agent`. */
export interface DesignRequest {
  readonly elements: readonly DesignElementRequest[];
  readonly note?: string;
}

/** ¿Lo que manda el lienzo tiene la forma de una selección? (cliente) */
export function isDesignSelection(x: unknown): x is DesignSelection {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return (
    typeof s.key === "string" &&
    Array.isArray(s.chain) &&
    typeof s.primary === "number" &&
    typeof s.tag === "string" &&
    typeof s.text === "string" &&
    typeof s.textEditable === "boolean" &&
    typeof s.copies === "number" &&
    typeof s.screen === "string" &&
    !!s.styles &&
    typeof s.styles === "object" &&
    Array.isArray(s.fonts)
  );
}
