/**
 * LOS CORREOS DE UN PROYECTO COMPARTIDO —la invitación y «te mencionaron»—,
 * en el idioma de la interfaz de quien los provoca (no sabemos el de quien los
 * recibe). Puros: arman asunto, HTML y texto; los manda `lib/email.ts`. Los
 * textos viven en `messages/<idioma>/topbar.json` (`miembros.email` y
 * `miembros.mencion`), con los demás de los miembros.
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
  const html = marco(idioma, {
    titulo: t("titulo"),
    parrafos: [frase, t("cuenta")],
    boton: t("aceptar"),
    url: datos.acceptUrl,
    pegar: t("pegar"),
    pie: t("ignorar"),
  });
  const text = [frase, "", t("cuenta"), "", datos.acceptUrl, "", t("ignorar")].join("\n");
  return { subject, html, text };
}

/** El marco de los correos del proyecto: la marca, un título, párrafos, un botón y su enlace. */
function marco(
  idioma: IdiomaDelCorreo,
  c: { titulo: string; parrafos: readonly string[]; cita?: string; boton: string; url: string; pegar: string; pie?: string },
): string {
  const url = escapar(c.url);
  const parrafos = c.parrafos
    .map((p, i) => `<p style="font-size:${i === 0 ? 14 : 13}px; line-height:1.5; color:${i === 0 ? "#525252" : "#737373"}; margin:0 0 12px;">${escapar(p)}</p>`)
    .join("\n      ");
  const cita = c.cita
    ? `<pre style="font-family:ui-monospace,Menlo,monospace; font-size:12px; background:#f5f5f5; border-radius:8px; padding:10px 12px; margin:0 0 20px; white-space:pre-wrap; word-break:break-word;">${escapar(c.cita)}</pre>`
    : "";
  return `<!doctype html>
<html lang="${idioma}">
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; background:#fafafa; margin:0; padding:32px; color:#0a0a0a;">
  <table align="center" style="max-width:480px; width:100%; background:#fff; border-radius:16px; padding:32px; border:1px solid #e5e5e5;">
    <tr><td>
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:24px;">
        <span style="display:inline-block; width:24px; height:24px; background:#FF5A36; border-radius:6px; color:#fff; font-weight:700; text-align:center; line-height:24px; font-size:15px;">O</span>
        <span style="font-weight:600; font-size:14px;">OpenLen</span>
      </div>
      <h1 style="font-size:20px; margin:0 0 12px; letter-spacing:-0.02em;">${escapar(c.titulo)}</h1>
      ${parrafos}
      ${cita}
      <p style="margin:12px 0 24px;">
        <a href="${url}" style="display:inline-block; background:#FF5A36; color:#fff; padding:11px 18px; border-radius:8px; text-decoration:none; font-weight:500; font-size:14px;">${escapar(c.boton)}</a>
      </p>
      <p style="font-size:12px; color:#737373; margin:0 0 8px;">${escapar(c.pegar)}</p>
      <p style="font-size:12px; color:#525252; word-break:break-all; margin:0 0 24px;">${url}</p>
      ${c.pie ? `<p style="font-size:12px; color:#a3a3a3; margin:0;">${escapar(c.pie)}</p>` : ""}
    </td></tr>
  </table>
</body>
</html>`;
}

export interface DatosDeLaMencion {
  readonly projectTitle: string;
  readonly quien: string;
  /** Desde un hilo del código: el fichero y la línea. Desde el chat: `donde: "chat"`. */
  readonly ruta?: string;
  readonly linea?: number;
  readonly donde?: "chat";
  readonly texto: string;
  readonly url: string;
}

export function correoDeMencion(
  datos: DatosDeLaMencion,
  idioma: IdiomaDelCorreo,
): { readonly subject: string; readonly html: string; readonly text: string } {
  const t = createTranslator({ locale: idioma, messages: MENSAJES[idioma], namespace: "miembros" });
  const titulo = datos.projectTitle.trim() || "OpenLen";
  const subject = t("mencion.asunto", { quien: datos.quien, titulo });
  const enElChat = datos.donde === "chat" || !datos.ruta;
  const donde = enElChat ? t("mencion.dondeChat") : t("mencion.donde", { ruta: datos.ruta!.replace(/^\/+/, ""), linea: datos.linea ?? 1 });
  const html = marco(idioma, {
    titulo: subject,
    parrafos: [donde],
    cita: datos.texto,
    boton: enElChat ? t("mencion.verChat") : t("mencion.ver"),
    url: datos.url,
    pegar: t("email.pegar"),
  });
  const text = [subject, "", donde, datos.texto, "", datos.url].join("\n");
  return { subject, html, text };
}

/** La frase de Len en un hilo cuando el turno no llegó a contestar. Los fallos
 *  conocidos (el tope de los miembros, sin créditos) se dicen en el idioma de
 *  quien escribió; los demás, con la frase que dio el servidor. */
export function fraseDeFalloDelHilo(idioma: IdiomaDelCorreo, fallo: { motivo: string; code?: string } | null): string {
  const t = createTranslator({ locale: idioma, messages: MENSAJES[idioma], namespace: "miembros.hilo" });
  if (!fallo) return t("falloSinMotivo");
  const motivo =
    fallo.code === "tope_de_miembros" ? t("topeAgotado") : fallo.code === "no_credits" ? t("sinCreditos") : fallo.motivo.slice(0, 300);
  return t("fallo", { motivo });
}

/** La frase de Len en un hilo cuando un reinicio del servidor le cortó el
 *  turno a medias: pudo dejar cambios hechos, así que no se repite solo. */
export function fraseDeInterrupcionDelHilo(idioma: IdiomaDelCorreo): string {
  const t = createTranslator({ locale: idioma, messages: MENSAJES[idioma], namespace: "miembros.hilo" });
  return t("interrumpido");
}
