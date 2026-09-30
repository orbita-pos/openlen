export interface ChatMessageEvent {
  type: "chat_message";
  projectId: string;
  conversationId: string;
  recipientUserId: string;
  senderName: string;
  preview: string;
}

// ⚰️ Aquí vivía `LiveSheetBrokenEvent` (`live_sheet_broken`, «tu Sheet dejó de
// leerse»), el aviso de datos vivos. Se retiró con la función en Len 2.1
// (2026-09-30); en producción quedaban 17 avisos, todos ya enviados.

/** LEN 2.1 · un turno de Len terminó SIN NADIE MIRANDO: el cliente se fue y
 *  el turno siguió (ver `lib/agent/aviso-del-turno.ts`). Sólo push: un correo
 *  por cada turno terminado sería ruido. */
export interface LenTurnoEvent {
  type: "len_turno";
  projectId: string;
  recipientUserId: string;
  /** Lo último que dijo Len, recortado. Va en SU idioma, que es el del
   *  usuario: el servidor no sabe el de quien lo lee. */
  preview: string;
  /** Terminó preguntando (`preguntar`): sin respuesta, Len no sigue. */
  pregunta: boolean;
}

export type NotificationEvent = ChatMessageEvent | LenTurnoEvent;

export interface NotificationPrefs {
  webPushEnabled: boolean;
  emailEnabled: boolean;
  quietFrom: string | null;
  quietUntil: string | null;
  timezone: string;
}

export type DeliveryResult = "sent" | "skipped" | "failed";

export interface NotificationChannel {
  id: "webpush" | "email";
  isEnabled(prefs: NotificationPrefs): boolean;
  send(event: NotificationEvent): Promise<DeliveryResult>;
}
