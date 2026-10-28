import { createPrivateKey, createSign } from "node:crypto";
import type { NotificationEvent } from "../types";

interface CuentaFcm { project_id: string; client_email: string; private_key: string }
export function configuracionFcm(valor: string | undefined): CuentaFcm | null {
  if (!valor) return null;
  try {
    const c = JSON.parse(valor) as CuentaFcm;
    if (!/^[a-z0-9-]{3,100}$/.test(c.project_id) || typeof c.client_email !== "string" || !c.client_email.includes("@") || typeof c.private_key !== "string") return null;
    if (createPrivateKey(c.private_key).asymmetricKeyType !== "rsa") return null;
    return c;
  } catch { return null; }
}

export const fcmDisponible = (): boolean => configuracionFcm(process.env.FCM_SERVICE_ACCOUNT_JSON) !== null;

/** Sólo datos propios; ninguna URL del mensaje se ejecuta en el teléfono. */
export function mensajeFcm(evento: NotificationEvent, token: string) {
  let title = "Len";
  let body: string;
  switch (evento.type) {
    case "len_turno": body = `${evento.pregunta ? "❓ " : ""}${evento.preview}`; break;
    case "mencion": title = `@ ${evento.quien}`; body = evento.preview; break;
    case "chat_message": title = evento.senderName; body = evento.preview; break;
    case "functions_quota": title = "Edge Functions"; body = `${evento.percent}% · ${evento.calls} / ${evento.limit}`; break;
    case "app_ai_cap": title = "Len · AI"; body = `${evento.percent}% · ${evento.spent} / ${evento.cap}`; break;
    case "email_domain": title = "Email"; body = `${evento.domain} · ${evento.status === "ready" ? "✓" : "✕"}`; break;
    case "email_quota": title = "Email"; body = `${evento.percent}% · ${evento.sent} / ${evento.included}`; break;
  }
  return { message: { token, notification: { title: title.slice(0, 100), body: body.slice(0, 500) }, data: { type: evento.type, projectId: evento.projectId, recipientUserId: evento.recipientUserId }, android: { priority: "normal", ttl: "3600s", notification: { channel_id: "len-avisos", tag: `len-${evento.projectId}` } } } };
}

/** FCM HTTP v1: JWT firmado localmente. Nunca se imprimen respuestas ni claves. */
export function crearTransporteFcm(cuenta: CuentaFcm, pedir: typeof fetch = fetch) {
  let acceso: { token: string; hasta: number } | null = null;
  async function tokenDeAcceso(): Promise<string> {
    if (acceso && acceso.hasta > Date.now()) return acceso.token;
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: cuenta.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(cuenta.private_key, "base64url");
    const res = await pedir("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }).toString(), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`FCM OAuth ${res.status}`);
    const b = await res.json() as { access_token?: string; expires_in?: number };
    if (!b.access_token) throw new Error("FCM OAuth invalid response");
    acceso = { token: b.access_token, hasta: Date.now() + Math.max(0, Math.min(Number(b.expires_in) || 3600, 3600) - 60) * 1000 };
    return acceso.token;
  }
  return async (token: string, evento: NotificationEvent): Promise<"sent" | "invalid"> => {
    const res = await pedir(`https://fcm.googleapis.com/v1/projects/${cuenta.project_id}/messages:send`, { method: "POST", headers: { authorization: `Bearer ${await tokenDeAcceso()}`, "content-type": "application/json" }, body: JSON.stringify(mensajeFcm(evento, token)), signal: AbortSignal.timeout(10_000) });
    if (res.ok) return "sent";
    if (res.status === 401) acceso = null;
    const b = await res.json().catch(() => null) as { error?: { details?: { errorCode?: string }[] } } | null;
    if (res.status === 404 && b?.error?.details?.some(d => d.errorCode === "UNREGISTERED")) return "invalid";
    throw new Error(`FCM ${res.status}`);
  };
}
