// QUÉ SE LE DICE A QUIEN MIRA CUANDO LA PETICIÓN NI SIQUIERA ARRANCA (N44,
// plans/new-chat/). Un HTTP no-OK de `/api/agent` o de `/api/templates/ai-design`
// trae un `error` escrito para el desarrollador, en inglés —«unauthorized»,
// «page not found», «prompt must be 1–10000 chars»—, y el chat lo pintaba TAL
// CUAL en los 10 idiomas. Visto en el taller el 03/10.
//
// EL CÓDIGO GANA AL ESTADO, Y EL ESTADO A LA PROSA. Primero el `code` que manda
// el servidor para lo que un usuario puede provocar; si no hay, el estado HTTP;
// y si tampoco, «Error en la solicitud (N)». El `error` del cuerpo no se pinta
// nunca: no está en el idioma de nadie.
//
// Lista explícita y no `t("errors." + code)`: una clave dinámica convierte un
// código nuevo sin traducir en un fallo de next-intl en tiempo de ejecución, y
// además no se puede grepear.

export type HttpErrorKey =
  | "errors.pageTooLarge"
  | "errors.noTaggableElements"
  | "errors.scopeTooLarge"
  | "errors.promptLength"
  | "errors.sessionExpired"
  | "errors.notFound"
  | "errors.pageChanged"
  | "errors.serverError"
  | "errors.requestFailed";

export type HttpErrorText = { key: HttpErrorKey; values?: { status: number } };

const CODE_TO_KEY: Readonly<Record<string, HttpErrorKey>> = {
  pageTooLarge: "errors.pageTooLarge",
  noTaggableElements: "errors.noTaggableElements",
  scopeTooLarge: "errors.scopeTooLarge",
  promptLength: "errors.promptLength",
};

/** La clave de `panelsChat` (y sus valores) para un HTTP no-OK del chat. */
export function httpErrorText(status: number, code: unknown): HttpErrorText {
  if (typeof code === "string" && Object.prototype.hasOwnProperty.call(CODE_TO_KEY, code)) {
    return { key: CODE_TO_KEY[code]! };
  }
  if (status === 401) return { key: "errors.sessionExpired" };
  if (status === 404) return { key: "errors.notFound" };
  // ai-design: el documento que mandó la pestaña ya no es el de la página.
  if (status === 409) return { key: "errors.pageChanged" };
  if (status === 413) return { key: "errors.pageTooLarge" };
  if (status >= 500) return { key: "errors.serverError", values: { status } };
  return { key: "errors.requestFailed", values: { status } };
}
