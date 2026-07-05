import type { ComponentType } from "react";
import {
  BarChart3, ChatIcon, Compass, FileText, HistoryIcon, ImageIcon, Inbox,
  Layers, ListTree, Megaphone, Package, Sparkles, Store,
} from "./icons";

// The account-wide sections, addressable independently of any loaded project
// (Navegar), vs. the tools that act on the currently loaded page (Editar).
// Canonical declaration — left-sidebar.tsx imports these from here (avoids a
// circular import between the rail and the sidebar).
export type SectionView =
  | "page" | "projects" | "templates" | "analytics" | "messages"
  | "modulos" | "marketing" | "business" | "explore";

export type SidebarMode =
  | "site" | "chat" | "templates" | "images" | "library" | "pages"
  | "assistant" | "members" | "broadcast" | "comments" | "bookings"
  | "collections" | "modulos" | "insights" | "versions" | "3d";

export type RailMode = "navegar" | "editar";
type Icon = ComponentType<{ size?: number }>;

/** The two views the "Explorar" surface tabs between (templates = curated, explore = community). */
export const BROWSE_VIEWS = ["templates", "explore"] as const;
export type BrowseView = (typeof BROWSE_VIEWS)[number];

// Navegar: app-level sections. Order = importance for a non-tech creator.
export const NAVEGAR_ITEMS: ReadonlyArray<{ view: SectionView; icon: Icon; key: string }> = [
  { view: "projects", icon: FileText, key: "nav.myPages" },
  { view: "templates", icon: Compass, key: "nav.explore" },   // "Explorar" — opens the browse surface (Plantillas tab default)
  { view: "marketing", icon: Megaphone, key: "nav.marketing" },
  { view: "modulos", icon: Package, key: "nav.modulos" },
  { view: "analytics", icon: BarChart3, key: "nav.analytics" },
  { view: "messages", icon: Inbox, key: "nav.messages" },
  { view: "business", icon: Store, key: "nav.myBusiness" },
];

// Editar: tools that act on the loaded page.
export const EDITAR_ITEMS: ReadonlyArray<{ id: SidebarMode; icon: Icon }> = [
  { id: "site", icon: ListTree },
  { id: "chat", icon: ChatIcon },
  { id: "images", icon: ImageIcon },
  { id: "library", icon: Layers },
  { id: "3d", icon: Sparkles },
  { id: "insights", icon: BarChart3 },
  { id: "versions", icon: HistoryIcon },
];

export function railModeFor(input: {
  hasProject: boolean;
  navigating: boolean;
}): RailMode {
  if (input.hasProject && !input.navigating) return "editar";
  return "navegar";
}
