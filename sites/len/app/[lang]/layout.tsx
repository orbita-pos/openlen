import type { ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Newsreader, Inter, JetBrains_Mono } from "next/font/google";
import { LANGS, dic, isLang } from "@/i18n";
import { SITE, alternates } from "@/lib/seo";
import "../globals.css";

const titular = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500"],
  variable: "--f-titular",
  display: "swap",
});
const texto = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--f-texto", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400"], variable: "--f-mono", display: "swap" });

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
