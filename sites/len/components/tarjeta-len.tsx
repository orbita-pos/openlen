import grupos from "@/data/herramientas.json";
import { dic, type Lang } from "@/i18n";

type GrupoId = keyof ReturnType<typeof dic>["portada"]["tarjeta"]["grupos"];

export function TarjetaLen({ lang }: { lang: Lang }) {
  const t = dic(lang).portada.tarjeta;
  const total = grupos.reduce((n, g) => n + g.herramientas.length, 0);
  return (
    <section className="model img" aria-labelledby="tarjeta-len">
      <div className="l">
        <div>
          <div className="eyebrow">{t.antetitulo}</div>
          <h2 id="tarjeta-len">{t.titulo}</h2>
          <p>{t.texto}</p>
        </div>
        <div>
          <a className="btn" href={dic(lang).pruebaUrl}>
            {dic(lang).nav.prueba}
          </a>
          <a href="#como" className="como">
            {t.como}
          </a>
        </div>
      </div>
      <div className="r" data-total={total}>
        {grupos.map((g) => {
          const c = t.grupos[g.id as GrupoId] as { titulo: string; texto: string; nota?: string };
          return (
            <div key={g.id} className={`cap${g.id === "mirar" ? " cap-ancha" : ""}`}>
              <h3>
                {c.titulo}
                <span className="n">{c.nota ?? g.herramientas.length}</span>
              </h3>
              <p>{c.texto}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
