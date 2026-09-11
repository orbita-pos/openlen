import Link from "next/link";
import { dic, type Lang } from "@/i18n";
import { Marca } from "./marca";

export function Nav({ lang, ruta }: { lang: Lang; ruta: string }) {
  const d = dic(lang).nav;
  return (
    <nav className="nav">
      <Link href={`/${lang}/`} className="brand">
        <Marca />
        Len
      </Link>
      <div className="links">
        <Link href={`/${lang}/research/`}>{d.research}</Link>
        <Link href={`/${lang}/principles/`}>{d.principios}</Link>
        <a href={`https://openlen.com/${lang}`}>{d.openlen}</a>
        <Link href={`/${d.otroLang}${ruta}`} hrefLang={d.otroLang} className="lang">
          {d.otroIdioma}
        </Link>
        <a href={dic(lang).pruebaUrl} className="btn">
          {d.prueba}
        </a>
      </div>
    </nav>
  );
}
