import Link from "next/link";
import { dic, fecha, isLang } from "@/i18n";
import { Nav } from "@/components/nav";
import { Pie } from "@/components/pie";
import { Imagen } from "@/components/imagen";
import { TarjetaLen } from "@/components/tarjeta-len";
import { EstadoPrincipio, Fuente } from "@/components/contenido";
import { articulos } from "@/content/research";
import { ResultadosModelo } from "@/components/resultados-modelo";

export default async function Portada({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) return null;
  const d = dic(lang);
  const p = d.portada;
  return (
    <div className="wrap">
      <Nav lang={lang} ruta="/" />
      <main>
        <section className="hero">
          <div>
            <div className="eyebrow">{p.antetitulo}</div>
            <h1>
              {p.titular[0]}
              <em>{p.titular[1]}</em>
              {p.titular[2]}
            </h1>
          </div>
          <div>
            <p>{p.parrafo}</p>
            <div className="acciones">
              <a className="btn" href={d.pruebaUrl}>
                {p.cta}
              </a>
              <a className="btn ghost" href={`/${lang}/research/len-3-0/`}>
                {p.ctaSecundario}
              </a>
            </div>
          </div>
        </section>

        <figure className="launch-art">
          <Imagen nombre="len3" alt={p.altCielo} className="release-art" prioridad />
          <figcaption><span>Len 3.0</span><Link href={`/${lang}/research/len-3-0/`}>{p.novedades.leer}</Link></figcaption>
        </figure>

        <section className="sec release-thinking" aria-labelledby="release-thinking-title">
          <h2 id="release-thinking-title">{p.criterio.titulo}</h2>
          <p className="release-intro">{p.criterio.intro}</p>
          <div className="release-thinking-list">
            {p.criterio.items.map(x => (
              <div className="release-thinking-item" key={x.titulo}>
                <h3>{x.titulo}</h3>
                <p>{x.texto}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="sec release-performance" aria-labelledby="release-performance-title">
          <h2 id="release-performance-title">{p.rendimiento.titulo}</h2>
          <p className="release-intro">{p.rendimiento.intro}</p>
          <ResultadosModelo lang={lang} />
        </section>

        <section className="sec release-features" id="novedades" aria-labelledby="release-features-title">
          <div className="sec-head"><div><h2 id="release-features-title">{p.novedades.titulo}</h2><p className="release-intro">{p.novedades.intro}</p></div></div>
          {p.novedades.items.map(x=><div className="release-feature" key={x.titulo}><div><h3>{x.titulo}</h3><span className="release-formats">{x.formatos}</span></div><p>{x.texto}</p></div>)}
          <Link className="btn ghost" href={`/${lang}/research/len-3-0/`}>{p.novedades.leer}</Link>
        </section>
        <section className="sec release-resources" aria-labelledby="release-resources-title">
          <h2 id="release-resources-title">{p.recursos.titulo}</h2>
          <div className="release-resource-list">{p.recursos.items.map(x=><div key={x.titulo}><h3>{x.titulo}</h3><p>{x.texto}</p></div>)}</div>
          <Fuente commit="8a690189" />
        </section>

        <section className="sec" id="oficio">
          <div className="sec-head">
            <div>
              <div className="eyebrow">{p.oficio.antetitulo}</div>
              <h2>{p.oficio.titulo}</h2>
            </div>
          </div>
          <div className="pr oficio">
            {p.oficio.tarjetas.map((x) => (
              <div className="pcard" key={x.k}>
                <h3>{x.t}</h3>
                <p>{x.p}</p>
                {x.commit ? <Fuente commit={x.commit} /> : null}
              </div>
            ))}
          </div>
        </section>

        <TarjetaLen lang={lang} />

        <section className="sec" id="como">
          <div className="sec-head">
            <div>
              <div className="eyebrow">{p.como.antetitulo}</div>
              <h2>{p.como.titulo}</h2>
            </div>
          </div>
          <div className="steps">
            {p.como.pasos.map((s) => (
              <div className="step" key={s.k}>
                <span className="k">{s.k}</span>
                <h3>{s.t}</h3>
                <p>{s.p}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="sec">
          <div className="sec-head">
            <div>
              <div className="eyebrow">{p.ultimo.antetitulo}</div>
              <h2>{p.ultimo.titulo}</h2>
            </div>
            <Link className="btn ghost" href={`/${lang}/research/`}>
              {p.ultimo.todo}
            </Link>
          </div>
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
                  <Fuente commit={m.cifra.commit} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="sec">
          <div className="sec-head">
            <div>
              <div className="eyebrow">{p.principios.antetitulo}</div>
              <h2>{p.principios.titulo}</h2>
            </div>
            <Link className="btn ghost" href={`/${lang}/principles/`}>
              {p.principios.leer}
            </Link>
          </div>
          <div className="pr">
            {p.principios.tres.map((x) => (
              <div className="pcard" key={x.k}>
                <span className="k">{x.k}</span>
                <h3>{x.t}</h3>
                <p>{x.p}</p>
                <EstadoPrincipio estado={x.estado as "vigilado" | "construccion" | "medicion" | "decision" | "retirado"}>{x.chip}</EstadoPrincipio>
              </div>
            ))}
          </div>
        </section>

        <section className="disponible">
          <div>
            <div className="eyebrow">{p.disponible.antetitulo}</div>
            <h2>{p.disponible.titulo}</h2>
            <p>{p.disponible.texto}</p>
          </div>
          <a className="btn" href={d.pruebaUrl}>
            {p.disponible.cta}
          </a>
        </section>

        <section className="mission img">
          <div className="eyebrow">{p.mision.antetitulo}</div>
          <p>
            {p.mision.frase[0]}
            <em>{p.mision.frase[1]}</em>
            {p.mision.frase[2]}
          </p>
        </section>
      </main>
      <Pie lang={lang} />
    </div>
  );
}
