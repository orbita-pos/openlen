// QUIÉN LE CONTESTA A LA GENTE QUE ENTRA EN TU PÁGINA.
//
// Función pura, sin React y sin i18n: devuelve una CLAVE, y quien la pinte
// decide el idioma. Separado así porque la decisión es lo que hay que poder
// probar en milisegundos, y la traducción es otro problema.
//
// Spec: docs/superpowers/specs/2026-09-16-casa-de-asistente-y-chat-design.md §2

export type ClaveDeEstado =
  | "nadie"
  | "soloIA"
  | "soloTu"
  | "ambos"
  | "nadieSinPublicar"
  | "soloIASinPublicar"
  | "soloTuSinPublicar"
  | "ambosSinPublicar";

export function estadoDeLaBurbuja(input: {
  asistente: boolean;
  chat: boolean;
  publicada: boolean;
}): ClaveDeEstado {
  const base: ClaveDeEstado = input.asistente
    ? input.chat
      ? "ambos"
      : "soloIA"
    : input.chat
      ? "soloTu"
      : "nadie";
  // 🔴 SIN PUBLICAR, LA BURBUJA NO EXISTE PARA NADIE. Decirlo no es un adorno:
  // sin esta rama la franja afirma que algo funciona cuando todavía no lo ve
  // ni una persona.
  if (input.publicada) return base;
  return `${base}SinPublicar` as ClaveDeEstado;
}
