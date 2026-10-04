import type { Metadata } from "next";
import { Hero } from "@/components/marketing/hero";
import { MosaicWall } from "@/components/marketing/mosaic-wall";
import { AnalyticsLeads } from "@/components/marketing/analytics-leads";
import { Trust } from "@/components/marketing/trust";
import { Pricing } from "@/components/marketing/pricing";
import { FinalCta } from "@/components/marketing/final-cta";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";
import { LenCompanion } from "@/components/marketing/len-companion";
import { countTemplates } from "@/lib/templates/store";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://openlen.com";

// Revalidate every 60s. The page reads template thumbnails + counts from
// DB at build time — without ISR, generating new thumbnails via
// `templates:thumbnails` wouldn't propagate to the homepage until the
// next full deploy. 60s gives sub-minute freshness without making every
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
      images: ["/og.png"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
    },
  };
}

// `overflow-x-clip` — LA PORTADA TENIA BARRA HORIZONTAL.
//
// Medido el 2026-09-02 a 889px de ancho: 43px de desborde, 28 elementos
// asomando por la derecha. Todos decorativos y todos por lo mismo — manchas
// de color colocadas con insets NEGATIVOS (`hero-mesh__blob--b`,
// `-right-24`, `-inset-x-20`) para que el difuminado sangre por el borde.
// Sangrar es lo que se les pide; lo que faltaba era recortarlas.
//
// `clip` Y NO `hidden`: los dos hacen lo mismo a la vista, pero `hidden`
// crea un contenedor de scroll y eso ROMPE `position: sticky` en todo lo
// que cuelga — aqui, la nav (`sticky top-3`) y la primera columna de la
// tabla comparativa (`sticky left-0`). `clip` recorta sin crear scroller,
// que es exactamente para lo que existe.
//
// Va en el envoltorio y no en el <body>: los 28 cuelgan de aqui, y clipar
// el body es un martillo global que afecta a rutas que no tienen el fallo.
export default function HomePage() {
  return (
    <div className="relative min-h-screen flex flex-col overflow-x-clip">
      {/* Dawn atmosphere from the very first pixel — sits behind the sticky
          glass nav so there is no white band above the hero. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[900px] aurora-dawn"
        aria-hidden
      />
      <MarketingChrome>
        {/* 04/10: de ocho secciones a seis. Se fueron Funciones (vendía
            plantillas y HTML, lo de antes de Len; la analítica ya la cuenta
            AnalyticsLeads y lo de «tuya» Trust) y la Comparativa (precios de
            Carrd y Linktree «a mayo de 2026»: con Len ya no compite ahí). El
            ancla `#features` de la nav y el pie vive ahora en la maqueta del
            taller, en el héroe. */}
        <Hero />
        <MosaicWall />
        <AnalyticsLeads />
        <Trust />
        <Pricing />
        <FinalCta />
        <LenCompanion />
      </MarketingChrome>
    </div>
  );
}
