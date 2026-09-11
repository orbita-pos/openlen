import type { ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Newsreader, Inter, JetBrains_Mono } from "next/font/google";
import { LANGS, dic, isLang } from "@/i18n";
import { SITE, alternates } from "@/lib/seo";
import "../globals.css";

// display: "optional" y no "swap", y esto está MEDIDO, no elegido por gusto.
// Con "swap" el titular se pinta primero en la tipografía de reserva y reflowa
// al llegar Newsreader: en móvil eso daba CLS 0,30 y 0,33 en tres corridas
// seguidas —todo lo que hay debajo del héroe da un salto— y hundía la
// puntuación a 80. Los fallbacks que genera next/font igualan las métricas
// VERTICALES pero no el ancho, así que el titular envuelve en distinto número
// de líneas. Con "optional" no hay intercambio: CLS 0, y la fuente se sigue
// viendo (comprobado en captura). El precio es que un visitante que llegue con
// la caché vacía y una conexión muy lenta verá la de reserva en esa primera
// página; desde la segunda, ya no.
const titular = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500"],
  variable: "--f-titular",
  display: "optional",
});
// El 700 es el de los titulares: la dirección visual pasó a negra pesada.
const texto = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--f-texto",
  display: "optional",
});
// Sin preload: la mono sólo sale en las pastillas de commit y en los <code>,
// nunca en el primer pintado. Precargarla le robaba ancho de banda al héroe.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--f-mono",
  display: "optional",
  preload: false,
});

export const dynamicParams = false;

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const d = dic(lang);
  return {
    metadataBase: new URL(SITE),
    title: d.meta.title,
    description: d.meta.description,
    alternates: alternates("/", lang),
    openGraph: {
      type: "website",
      title: d.meta.title,
      description: d.meta.description,
      images: ["/img/og/primera.jpg"],
      locale: lang === "es" ? "es_ES" : "en_US",
    },
  };
}

export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <html lang={lang} className={`${titular.variable} ${texto.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
