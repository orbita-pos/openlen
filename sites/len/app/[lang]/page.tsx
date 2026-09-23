import Link from "next/link";
import { dic, fecha, isLang } from "@/i18n";
import { Nav } from "@/components/nav";
import { Pie } from "@/components/pie";
import { Imagen } from "@/components/imagen";
import { TarjetaLen } from "@/components/tarjeta-len";
import { CifraGrande, EstadoPrincipio, Fuente } from "@/components/contenido";
import { articulos } from "@/content/research";

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
              <a className="btn ghost" href="#oficio">
                {p.ctaSecundario}
              </a>
            </div>
          </div>
        </section>

        <div className="cielo">
          <Imagen nombre="primera" alt={p.altCielo} className="sky" prioridad />
          <div className="cielo-texto">
            <h2>{p.cielo.titulo}</h2>
            <p>{p.cielo.texto}</p>
            <a className="btn claro" href="#como">
              {p.cielo.cta}
            </a>
          </div>
        </div>

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

        <section className="sec">
          <div className="sec-head">
            <div>
              <div className="eyebrow">{p.cifras.antetitulo}</div>
              <h2>{p.cifras.titulo}</h2>
            </div>
            <Link className="btn ghost" href={`/${lang}/research/len-1-5/`}>
              {p.cifras.leer}
            </Link>
          </div>
          <div className="big">
            {p.cifras.items.map((c) => (
              <CifraGrande key={c.valor} valor={c.valor} commit={c.commit}>
                {c.texto}
              </CifraGrande>
            ))}
          </div>
          <p className="nota-cifras">
            {p.cifras.nota} <Fuente commit={p.cifras.notaCommit} />
          </p>
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
                <EstadoPrincipio estado={x.estado as "vigilado" | "construccion" | "medicion"}>{x.chip}</EstadoPrincipio>
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
