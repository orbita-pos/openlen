import type { ComponentType } from "react";
import {
  BarChart3, ChatIcon, HistoryIcon, Inbox,
  ListTree, Megaphone,
} from "./icons";

// The account-wide sections, addressable independently of any loaded project,
// vs. SidebarMode — the tools that act on the currently loaded page.
// Canonical declaration — left-sidebar.tsx imports these from here (avoids a
// circular import between the rail and the sidebar).
export type SectionView =
  | "page" | "projects" | "templates" | "analytics" | "messages"
  // `modulos` sigue siendo una vista alcanzable por URL, pero YA NO TIENE
  // ICONO EN EL RAIL (2026-08-29): es la casa temporal de Chat y Plataformas
  // hasta que se decida dónde viven de verdad, no un sitio al que se invite a
  // ir. Colecciones se fue de ella con el resto del módulo.
  // ⚰️ `business` —la sección «Mi negocio»— salió de aquí el 2026-08-31 con el
  // perfil entero. Era la única vista del rail que pedía RELLENAR una ficha en
  // vez de mirar la página.
  | "modulos" | "marketing" | "explore" | "resultados";

export type SidebarMode =
  | "site" | "chat" | "templates" | "pages"
  | "assistant" | "members" | "broadcast" | "comments" | "bookings"
  | "versions";

type Icon = ComponentType<{ size?: number }>;

// ── Rail único (2026-07-22, spec un-rail-navegacion-unificada) ──────────────
// One permanent, site-scoped rail. Two groups: CREAR (tools that edit the
// page) and OPERAR (the site's operations).

// ⚰️ AQUÍ HABÍA UNA TERCERA VARIANTE, `{ kind: "action"; key: "pagina" }`, y
// su único miembro era la CASITA que coronaba el rail. Se fue el 2026-08-31.
//
// Su trabajo —volver al lienzo desde Resultados, Mensajes o Marketing— no
// desaparece: lo hacen ahora los propios paneles. Chat y Versiones actúan SOBRE
// la página, así que abrir uno trae la página consigo; pedir un icono aparte
// para eso era cobrar un sitio permanente por un gesto que ya estaba implicado.
export type RailItemDef =
  | { kind: "panel"; id: SidebarMode; icon: Icon }
  | { kind: "view"; view: SectionView; icon: Icon; badge?: "leads" | "chat" };

export const RAIL_CREAR: ReadonlyArray<RailItemDef> = [
  // LAS PÁGINAS DEL SITIO SE NAVEGAN DESDE LA BARRA DE DIRECCIÓN, no desde
  // aquí (2026-08-27). Estaban escondidas tras un icono que había que
  // descubrir, mientras la respuesta a «¿en qué página estoy?» vivía en tres
  // sitios que no se hablaban. Arriba del lienzo se ve sin buscarla, y es la
  // misma forma en que la lee un visitante: la RUTA.
  //
  // El panel no se borró: `SitePagesPanel` se monta dentro del desplegable de
  // la barra, con su alta y su borrado. Lo que cambió es dónde vive.
  // IMÁGENES SALIÓ DEL RAIL el 2026-08-29. El panel enseñaba las mismas tres
  // bibliotecas que el diálogo de sustituir —OpenLen, Unsplash, las fotos del
  // negocio—, así que el icono cobraba un sitio permanente por una tercera
  // copia. Lo que sólo tenía él se fue al diálogo: «Tus subidas» (que allí
  // faltaba, y por eso había que venir aquí para reusar una foto propia) y
  // Motion. Se perdió a sabiendas arrastrar desde nuestras bibliotecas al
  // lienzo; arrastrar un fichero del escritorio sigue igual.
  { kind: "panel", id: "chat", icon: ChatIcon },
];

export const RAIL_OPERAR: ReadonlyArray<RailItemDef> = [
  { kind: "view", view: "resultados", icon: BarChart3, badge: "leads" },
  { kind: "view", view: "messages", icon: Inbox, badge: "chat" },
  { kind: "view", view: "marketing", icon: Megaphone },
  { kind: "panel", id: "versions", icon: HistoryIcon },
];

export function railItemKey(item: RailItemDef): string {
  return item.kind === "panel" ? item.id : item.view;
}

/**
 * Qué icono del rail se pinta activo.
 *
 * `collapsed` entró el 2026-08-31 con el botón de plegar: desde que un segundo
 * clic en el panel abierto lo cierra, el icono TIENE que apagarse al cerrarse —
 * si no, queda encendido sobre un panel que no está, y el mismo clic parece no
 * haber hecho nada.
 */
export function railActiveKey(
  centerView: SectionView,
  mode: SidebarMode,
  collapsed = false,
): string {
  if (centerView === "page") return collapsed ? "" : mode;
  if (centerView === "analytics") return "resultados";
  return centerView;
}
