/**
 * EL CORREO DE LA INVITACIÓN a un proyecto (compartir el proyecto), en el
 * idioma de la interfaz de quien invita —no sabemos el de quien lo recibe—.
 * Puro: arma asunto, HTML y texto; lo manda `sendProjectInviteEmail`
 * (lib/email.ts). Los textos viven en `messages/<idioma>/topbar.json`
 * (`miembros.email`), con los demás de los miembros.
 */
import { createTranslator } from "next-intl";

import de from "@/messages/de/topbar.json";
import en from "@/messages/en/topbar.json";
import es from "@/messages/es/topbar.json";
import fr from "@/messages/fr/topbar.json";
import it from "@/messages/it/topbar.json";
import ja from "@/messages/ja/topbar.json";
import ko from "@/messages/ko/topbar.json";
import nl from "@/messages/nl/topbar.json";
import pt from "@/messages/pt/topbar.json";
import zh from "@/messages/zh/topbar.json";

const MENSAJES = { de, en, es, fr, it, ja, ko, nl, pt, zh } as const;
export type IdiomaDelCorreo = keyof typeof MENSAJES;

export function idiomaDelCorreo(x: unknown): IdiomaDelCorreo {
  return typeof x === "string" && Object.hasOwn(MENSAJES, x) ? (x as IdiomaDelCorreo) : "en";
}

export interface DatosDeLaInvitacion {
  readonly projectTitle: string;
  readonly inviterName: string | null;
  readonly rol: "editor" | "lector";
  readonly acceptUrl: string;
}

const escapar = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function correoDeInvitacion(
  datos: DatosDeLaInvitacion,
  idioma: IdiomaDelCorreo,
): { readonly subject: string; readonly html: string; readonly text: string } {
  const t = createTranslator({ locale: idioma, messages: MENSAJES[idioma], namespace: "miembros.email" });
  const titulo = datos.projectTitle.trim() || "OpenLen";
  const quien = datos.inviterName?.trim() || t("alguien");
  const subject = datos.rol === "editor" ? t("asuntoEditor", { quien, titulo }) : t("asuntoLector", { quien, titulo });
  const frase = datos.rol === "editor" ? t("fraseEditor", { quien, titulo }) : t("fraseLector", { quien, titulo });
  const url = escapar(datos.acceptUrl);
  const html = `<!doctype html>
<html lang="${idioma}">
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; background:#fafafa; margin:0; padding:32px; color:#0a0a0a;">
  <table align="center" style="max-width:480px; width:100%; background:#fff; border-radius:16px; padding:32px; border:1px solid #e5e5e5;">
    <tr><td>
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:24px;">
        <span style="display:inline-block; width:24px; height:24px; background:#FF5A36; border-radius:6px; color:#fff; font-weight:700; text-align:center; line-height:24px; font-size:15px;">O</span>
        <span style="font-weight:600; font-size:14px;">OpenLen</span>
      </div>
      <h1 style="font-size:20px; margin:0 0 12px; letter-spacing:-0.02em;">${escapar(t("titulo"))}</h1>
      <p style="font-size:14px; line-height:1.5; color:#525252; margin:0 0 12px;">${escapar(frase)}</p>
      <p style="font-size:13px; line-height:1.5; color:#737373; margin:0 0 24px;">${escapar(t("cuenta"))}</p>
      <p style="margin:0 0 24px;">
        <a href="${url}" style="display:inline-block; background:#FF5A36; color:#fff; padding:11px 18px; border-radius:8px; text-decoration:none; font-weight:500; font-size:14px;">${escapar(t("aceptar"))}</a>
      </p>
      <p style="font-size:12px; color:#737373; margin:0 0 8px;">${escapar(t("pegar"))}</p>
      <p style="font-size:12px; color:#525252; word-break:break-all; margin:0 0 24px;">${url}</p>
      <p style="font-size:12px; color:#a3a3a3; margin:0;">${escapar(t("ignorar"))}</p>
    </td></tr>
  </table>
</body>
</html>`;
  const text = [frase, "", t("cuenta"), "", datos.acceptUrl, "", t("ignorar")].join("\n");
  return { subject, html, text };
}
