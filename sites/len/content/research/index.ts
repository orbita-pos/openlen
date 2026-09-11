import type { ComponentType } from "react";
import type { Lang } from "@/i18n";
import type { MetaArticulo } from "../tipos";

export type Articulo = { meta: MetaArticulo; Cuerpo: ComponentType };

const TODOS: Record<Lang, Articulo[]> = { en: [], es: [] };

export function articulos(lang: Lang): Articulo[] {
  return [...TODOS[lang]].sort((a, b) => b.meta.date.localeCompare(a.meta.date));
}

export function articulo(lang: Lang, slug: string): Articulo | undefined {
  return TODOS[lang].find((a) => a.meta.slug === slug);
}
