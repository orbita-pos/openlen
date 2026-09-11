import type { Metadata } from "next";
import { dic, isLang } from "@/i18n";
import { alternates } from "@/lib/seo";
import { Nav } from "@/components/nav";
import { Pie } from "@/components/pie";
import PrincipiosEn from "@/content/principles.en.mdx";
import PrincipiosEs from "@/content/principles.es.mdx";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  return {
    title: `${dic(lang).principiosPagina.titulo} · Len`,
    description: dic(lang).principiosPagina.intro,
    alternates: alternates("/principles/", lang),
  };
}

export default async function Principios({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) return null;
  const Cuerpo = lang === "es" ? PrincipiosEs : PrincipiosEn;
  const t = dic(lang).principiosPagina;
  return (
    <div className="wrap">
      <Nav lang={lang} ruta="/principles/" />
      <header className="art-head">
        <h1>{t.titulo}</h1>
        <p className="dek">{t.intro}</p>
      </header>
      <article className="prose principios">
        <Cuerpo />
      </article>
      <Pie lang={lang} />
    </div>
  );
}
