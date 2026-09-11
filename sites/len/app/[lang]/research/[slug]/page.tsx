import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LANGS, dic, fecha, isLang } from "@/i18n";
import { SITE, alternates } from "@/lib/seo";
import { Nav } from "@/components/nav";
import { Pie } from "@/components/pie";
import { Imagen } from "@/components/imagen";
import { articulo, articulos } from "@/content/research";

export const dynamicParams = false;

export function generateStaticParams() {
  return LANGS.flatMap((lang) => articulos(lang).map((a) => ({ lang, slug: a.meta.slug })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; slug: string }>;
}): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLang(lang)) return {};
  const a = articulo(lang, slug);
  if (!a) return {};
  return {
    title: `${a.meta.title} · Len`,
    description: a.meta.dek,
    alternates: alternates(`/research/${slug}/`, lang),
    openGraph: {
      type: "article",
      title: a.meta.title,
      description: a.meta.dek,
      images: [`/img/og/${a.meta.cover}.jpg`],
      publishedTime: a.meta.date,
    },
  };
}

export default async function Pagina({ params }: { params: Promise<{ lang: string; slug: string }> }) {
  const { lang, slug } = await params;
  if (!isLang(lang)) notFound();
  const a = articulo(lang, slug);
  if (!a) notFound();
  const { meta: m, Cuerpo } = a;
  const r = dic(lang).research;
  const ld = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: m.title,
    description: m.dek,
    datePublished: m.date,
    inLanguage: lang,
    author: { "@type": "Organization", name: m.author },
    image: `${SITE}/img/og/${m.cover}.jpg`,
    url: `${SITE}/${lang}/research/${slug}/`,
  };
  return (
    <div className="wrap">
      <Nav lang={lang} ruta={`/research/${slug}/`} />
      <header className="art-head">
        <div className="eyebrow">
          {m.category} · {m.topic}
        </div>
        <h1>{m.title}</h1>
        <p className="dek">{m.dek}</p>
        <div className="meta">
          <span>
            <b>{fecha(m.date, lang)}</b>
          </span>
          <span>{m.author}</span>
          <span>
            {m.readingMinutes} {r.leer}
          </span>
        </div>
      </header>
      <Imagen nombre={m.cover} alt="" className="cover" prioridad />
      <div className="body">
        <nav className="toc" aria-label={r.titulo}>
          {m.indice.map((i) => (
            <a key={i.id} href={`#${i.id}`}>
              {i.texto}
            </a>
          ))}
        </nav>
        <article className="prose">
          <Cuerpo />
        </article>
      </div>
      <div className="foot">
        <Link href={`/${lang}/research/`}>{r.volver}</Link>
        <Link href={`/${dic(lang).nav.otroLang}/research/${slug}/`}>{r.otroIdioma}</Link>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <Pie lang={lang} />
    </div>
  );
}
