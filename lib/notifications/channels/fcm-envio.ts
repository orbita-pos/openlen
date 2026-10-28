import type { DeliveryResult, NotificationEvent } from "../types";

export async function enviarAvisosNativos(evento: NotificationEvent, d: {
  tokens(userId: string): Promise<string[]>;
  enviar(token: string, evento: NotificationEvent): Promise<"sent" | "invalid">;
  borrar(token: string, userId: string): Promise<void>;
}): Promise<DeliveryResult> {
  let enviados = 0;
  let fallidos = 0;
  for (const token of await d.tokens(evento.recipientUserId)) {
    try {
      if (await d.enviar(token, evento) === "invalid") await d.borrar(token, evento.recipientUserId);
      else enviados++;
    } catch { fallidos++; }
  }
  if (enviados) return "sent";
  if (fallidos) throw new Error("FCM delivery failed; retry");
  return "skipped";
}
