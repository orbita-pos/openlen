// EL ESTADO QUE DICE EL SERVIDOR DE UN TURNO QUE ESTA PESTAÑA YA TIENE, al
// converger (`fusionarConversacion`, la opción `conEstado`). Los dos chats.
//
// Se toma para enterarse de que OTRA pestaña lo deshizo («reverted»). Pero el
// servidor registra con «applied» también un turno que falló después de que Len
// escribiera algo (`registro.fila` en lib/agent/registro-del-turno.ts), y
// copiarle eso a un turno que aquí acabó en error borraba el rojo y su
// Reintentar y pintaba un «Aplicado» falso (plans/new-chat/, 03/10). Un error de
// esta pestaña es definitivo: el servidor no puede convertirlo en éxito.

export function withServerStatus<T extends { readonly status: string }>(
  local: T,
  server: { readonly status: T["status"] },
): T {
  if (local.status === "error") return local;
  return { ...local, status: server.status };
}
