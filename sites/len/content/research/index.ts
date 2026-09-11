import type { ComponentType } from "react";
import type { Lang } from "@/i18n";
import type { MetaArticulo } from "../tipos";
import Hecho_en, { meta as hecho_en } from "./when-the-agent-said-done.en.mdx";
import Hecho_es, { meta as hecho_es } from "./when-the-agent-said-done.es.mdx";

export type Articulo = { meta: MetaArticulo; Cuerpo: ComponentType };

const TODOS: Record<Lang, Articulo[]> = {
  en: [{ meta: hecho_en, Cuerpo: Hecho_en }],
  es: [{ meta: hecho_es, Cuerpo: Hecho_es }],
};

export function articulos(lang: Lang): Articulo[] {
  return [...TODOS[lang]].sort((a, b) => b.meta.date.localeCompare(a.meta.date));
}

export function articulo(lang: Lang, slug: string): Articulo | undefined {
  return TODOS[lang].find((a) => a.meta.slug === slug);
}
