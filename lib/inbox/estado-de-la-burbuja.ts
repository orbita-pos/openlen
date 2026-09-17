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
  /** Tiene subdominio: hay una página viva. */
  publicada: boolean;
  /** `hasUnpublishedChanges` del proyecto. Su huella YA incluye los ajustes
   *  (`hashHomeDoc` en `lib/projects.ts`), así que voltear un interruptor lo
   *  enciende aunque el html no se mueva un byte. */
  cambiosSinPublicar: boolean;
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
  //
  // 🔴 Y CON CAMBIOS SIN PUBLICAR, TAMPOCO ESTÁ LO QUE DICEN LOS AJUSTES. Las
  // burbujas se hornean al publicar (`lib/publish/filesystem.ts`) y guardar un
  // ajuste no republica: ENCENDER el asistente sobre una página publicada no
  // pone la burbuja, porque no está en la release que sirve el disco. Por eso
  // las frases «sin publicar» dicen «cuando publiques», que vale igual para la
  // primera vez que para volver a publicar.
  //
  // El coste, aceptado: tras una edición SÓLO de html, la franja dice
  // «contestará la IA cuando publiques» aunque ya conteste. Sobre-reportar es
  // el fallo seguro — el mismo que declara `hashHomeDoc` —; lo contrario sería
  // afirmar una burbuja que no está.
  if (input.publicada && !input.cambiosSinPublicar) return base;

  // 🔴 PERO APAGAR NO ESPERA A PUBLICAR, y esta línea es la mitad que faltaba.
  // Este comentario decía que apagar «no la quita — el visitante la sigue
  // viendo y la ruta le contesta 403»: era verdad hasta el 2026-09-17. Hoy al
  // módulo apagado lo rechaza el servidor en la siguiente petición (403 el
  // asistente, 404 el chat) Y la burbuja horneada pregunta su estado al cargar
  // y se retira sola. Así que con TODO apagado sobre una página viva no hay
  // nada que esperar: ya no contesta nadie, y pedir un «cuando publiques» es
  // pedir un trámite que no cambia nada.
  //
  // Sólo este estado. Los otros tres describen algo que hay que ENCENDER, y eso
  // sigue necesitando una publicación. Y con `publicada: false` la frase «sin
  // publicar» sigue siendo la exacta: ahí no hay página viva todavía.
  if (input.publicada && base === "nadie") return "nadie";

  return `${base}SinPublicar` as ClaveDeEstado;
}
