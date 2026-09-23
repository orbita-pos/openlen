import type { ComponentType } from "react";
import type { Lang } from "@/i18n";
import type { MetaArticulo } from "../tipos";
import Hecho_en, { meta as hecho_en } from "./when-the-agent-said-done.en.mdx";
import Hecho_es, { meta as hecho_es } from "./when-the-agent-said-done.es.mdx";
import Evidencia_en, { meta as evidencia_en } from "./evidence-not-verdicts.en.mdx";
import Evidencia_es, { meta as evidencia_es } from "./evidence-not-verdicts.es.mdx";
import Exito_en, { meta as exito_en } from "./the-success-that-never-happened.en.mdx";
import Exito_es, { meta as exito_es } from "./the-success-that-never-happened.es.mdx";
import Oscuro_en, { meta as oscuro_en } from "./the-mode-we-never-measured.en.mdx";
import Oscuro_es, { meta as oscuro_es } from "./the-mode-we-never-measured.es.mdx";
import Version15_en, { meta as version15_en } from "./len-1-5.en.mdx";
import Version15_es, { meta as version15_es } from "./len-1-5.es.mdx";

export type Articulo = { meta: MetaArticulo; Cuerpo: ComponentType };

const TODOS: Record<Lang, Articulo[]> = {
  en: [
    { meta: hecho_en, Cuerpo: Hecho_en },
    { meta: evidencia_en, Cuerpo: Evidencia_en },
    { meta: exito_en, Cuerpo: Exito_en },
    { meta: oscuro_en, Cuerpo: Oscuro_en },
    { meta: version15_en, Cuerpo: Version15_en },
  ],
  es: [
    { meta: hecho_es, Cuerpo: Hecho_es },
    { meta: evidencia_es, Cuerpo: Evidencia_es },
    { meta: exito_es, Cuerpo: Exito_es },
    { meta: oscuro_es, Cuerpo: Oscuro_es },
    { meta: version15_es, Cuerpo: Version15_es },
  ],
};

export function articulos(lang: Lang): Articulo[] {
  return [...TODOS[lang]].sort((a, b) => b.meta.date.localeCompare(a.meta.date));
}

export function articulo(lang: Lang, slug: string): Articulo | undefined {
  return TODOS[lang].find((a) => a.meta.slug === slug);
}
