import { OG_IMAGE } from "@/lib/seo/og-image";
import type { Metadata } from "next";
import { Hero } from "@/components/marketing/hero";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";
import { HomeHashRouter } from "@/components/marketing/home-hash-router";
import { countTemplates } from "@/lib/templates/store";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://openlen.com";

// Revalidate every 60s. The page reads the template count (metadata) and the
// live-pages count (hero) from the DB — without ISR they wouldn't move until
// the next full deploy. 60s gives sub-minute freshness without making every
// visitor pay the SSR cost.
export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const es = locale === "es";
  const count = await countTemplates().catch(() => 0);
  // Brand name leads the title — the strongest on-page signal for the
  // branded query "openlen" (the layout's title.template doesn't apply
  // to its own segment, so it must be inline here).
  const title = es
    ? "OpenLen — Len, tu propio desarrollador web. Código abierto."
    : "OpenLen — Len, your own web developer. Open source.";
  const description = es
    ? `Len es tu propio desarrollador web: le cuentas qué necesitas y construye tu página —textos, fotos y formularios— y la publica en tu dominio. ${count} diseños hechos a mano, analítica sin cookies y tu HTML — AGPLv3.`
    : `Len is your own web developer: tell it what you need and it builds your page — copy, photos and forms — and publishes it on your domain. ${count} hand-made designs, cookieless analytics and your HTML — AGPLv3.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/${locale}` },
    openGraph: {
      type: "website",
      locale: es ? "es_ES" : "en_US",
      url: `${SITE_URL}/${locale}`,
      siteName: "OpenLen",
      title,
      description,
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [OG_IMAGE],
    },
  };
}

// LA PORTADA ES SÓLO EL INPUT (Jesús, 06/11: «OpenLen sea solo un input y
// toda la info como pricing la moveremos a páginas propias»; spec local
// 2026-11-06-portada-solo-input). Una pantalla: el menú, el héroe de siempre
// y su luz. Lo que había debajo vive ahora en /features y /pricing.
//
// `dark` FIJO: la luz está hecha para negro, así que la portada es oscura
// aunque la persona tenga el sitio en claro. Tailwind (`darkMode: "class"`)
// aplica `dark:` a todo lo que cuelga de un `.dark`, sin tocar la preferencia
// guardada; por eso el menú de aquí no lleva el botón de tema.
//
// `overflow-x-clip` (2026-09-02): recorta sin crear un contenedor de scroll,
// que rompería el `position: sticky` de la nav.
export default function HomePage() {
  return (
    <div className="dark relative flex min-h-[100svh] flex-col overflow-x-clip bg-[#100d0c] text-zinc-50">
      <MarketingChrome variant="home">
        <Hero />
        <HomeHashRouter />
      </MarketingChrome>
    </div>
  );
}
