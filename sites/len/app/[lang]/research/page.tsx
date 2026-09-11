import type { Metadata } from "next";
import Link from "next/link";
import { dic, fecha, isLang } from "@/i18n";
import { alternates } from "@/lib/seo";
import { Nav } from "@/components/nav";
import { Pie } from "@/components/pie";
import { articulos } from "@/content/research";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  return {
    title: `${dic(lang).research.titulo} · Len`,
    description: dic(lang).research.intro,
    alternates: alternates("/research/", lang),
  };
}

export default async function Research({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) return null;
  const r = dic(lang).research;
  return (
    <div className="wrap">
      <Nav lang={lang} ruta="/research/" />
      <header className="art-head">
        <h1>{r.titulo}</h1>
        <p className="dek">{r.intro}</p>
      </header>
      <div className="list">
        {articulos(lang).map(({ meta: m }) => (
          <div className="row" key={m.slug}>
            <div>
              <div className="date">{fecha(m.date, lang)}</div>
              <span className="tagx">{m.topic}</span>
            </div>
            <div>
              <h3>
                <Link href={`/${lang}/research/${m.slug}/`}>{m.title}</Link>
              </h3>
              <p>{m.dek}</p>
            </div>
            <div className="num">
              {m.cifra.valor}
              <small>{m.cifra.nota}</small>
            </div>
          </div>
        ))}
      </div>
      <Pie lang={lang} />
    </div>
  );
}
