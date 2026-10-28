import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { configuracionFcm, crearTransporteFcm } from "./fcm-transporte";
import { enviarAvisosNativos } from "./fcm-envio";
import type { NotificationChannel } from "../types";

const t = schema.movilAvisos;
let transporte: ReturnType<typeof crearTransporteFcm> | null = null;
let configuracionAnterior: string | undefined;
export const fcmChannel: NotificationChannel = {
  id: "fcm",
  isEnabled: prefs => prefs.webPushEnabled,
  async send(evento) {
    const valor = process.env.FCM_SERVICE_ACCOUNT_JSON;
    if (!transporte || valor !== configuracionAnterior) {
      const c = configuracionFcm(valor);
      if (!c) return "skipped";
      transporte = crearTransporteFcm(c);
      configuracionAnterior = valor;
    }
    return enviarAvisosNativos(evento, {
      tokens: async userId => (await db.select({ token: t.token }).from(t).where(eq(t.userId, userId))).map(r => r.token),
      enviar: transporte,
      borrar: async (token, userId) => { await db.delete(t).where(and(eq(t.token, token), eq(t.userId, userId))); },
    });
  },
};
