// EL TURNO «✓ Publicada…» (el que añade `handlePublished` al publicar desde la
// tarjeta) no es un turno de Len: no corrió el modelo ni tocó la página, sólo
// apunta en la charla que se publicó. Por eso no lleva debajo «No cambió nada
// de la página»: es verdad, pero justo después de publicar suena a que algo
// falló (decidido por Jesús el 03/10, para los dos chats).
//
// La marca va en el ID y no en una columna: el id lo pone el navegador, se
// guarda tal cual (`projectChatMessages.id`, texto) y vuelve igual al recargar,
// sin migración y sin tocar lo que lee Len. Las notas guardadas antes de esto
// llevan un UUID sin prefijo y siguen enseñando la línea.

const PUBLISH_NOTE_PREFIX = "pub-";

export function publishNoteId(): string {
  const rest =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${PUBLISH_NOTE_PREFIX}${rest}`;
}

export function isPublishNote(turn: { id: string }): boolean {
  return turn.id.startsWith(PUBLISH_NOTE_PREFIX);
}
