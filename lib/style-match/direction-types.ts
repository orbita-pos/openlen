// La FORMA de una dirección visual, sin `server-only`.
//
// `direction.ts` monta el bloque que se antepone al brief y por eso es de
// servidor. Pero el compositor de /new necesita esta misma forma para enseñar
// la referencia y dejar quitarla antes de generar, y un componente de cliente
// que importa un módulo `server-only` rompe el build.
//
// Mismo patrón que `lib/templates/families.ts`: lo que cruza la frontera vive
// aparte y no importa nada de node.

export interface StyleDirection {
  readonly hostname: string;
  /** Hex EXACTOS del render, nunca aproximados por un modelo mirando una foto. */
  readonly palette: readonly { readonly role: string; readonly hex: string }[];
  readonly polarity: "light" | "dark";
  readonly fontFamily: string;
  readonly radius: "sharp" | "soft" | "rounded" | "pill";
  /** Lo que Qwen vio y el CSS no dice. Ausente si la visión falló o se apagó. */
  readonly character?: string;
}
