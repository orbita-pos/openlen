import Link from "next/link";
import { dic, type Lang } from "@/i18n";
import { REPO } from "@/lib/seo";
import { Marca } from "./marca";

export function Pie({ lang }: { lang: Lang }) {
  const d = dic(lang);
  return (
    <footer className="pie">
      <div>
        <div className="brand">
          <Marca size={18} />
          {d.pie.marca}
        </div>
        <p className="fine">{d.pie.abierto}</p>
      </div>
      <div>
        <h2>{d.pie.len}</h2>
        <Link href={`/${lang}/research/`}>{d.nav.research}</Link>
        <Link href={`/${lang}/principles/`}>{d.nav.principios}</Link>
        <a href={d.pruebaUrl}>{d.nav.prueba}</a>
      </div>
      <div>
        <h2>{d.pie.openlen}</h2>
        <a href={`https://openlen.com/${lang}`}>openlen.com</a>
        <a href="https://status.openlen.com">{d.pie.status}</a>
        <a href={REPO}>{d.pie.github}</a>
      </div>
      <div>
        <h2>{d.pie.idioma}</h2>
        <Link href="/es/" hrefLang="es">
          Español
        </Link>
        <Link href="/en/" hrefLang="en">
          English
        </Link>
      </div>
    </footer>
  );
}
