import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { AuthSessionProvider } from "@/components/auth/session-provider";
import { routing } from "@/i18n/routing";
import "../globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://openlen.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "OpenLen — Landing pages you own. AI-built. Open source.",
    template: "%s | OpenLen",
  },
  description:
    "An open lens on your landing pages. Open-source builder with AI generation, 165 templates including 30 link-in-bio creator hubs, privacy-first analytics, your HTML — AGPLv3.",
  keywords: [
    "landing page builder",
    "AI landing page",
    "open source",
    "link in bio",
    "creator templates",
    "self-host",
    "AGPL",
  ],
  authors: [{ name: "OpenLen" }],
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "OpenLen",
    title: "OpenLen — Landing pages you own. AI-built. Open source.",
    description:
      "Generate landing pages or pick from 165 templates. Publish to your subdomain with privacy-first analytics built in.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "OpenLen — open-source landing-page builder",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenLen — Landing pages you own",
    description:
      "Open-source landing-page builder. 165 templates, AI generation, privacy-first analytics, AGPLv3.",
    images: ["/og.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: SITE_URL,
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // Enable static rendering for this locale.
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        {/* Preconnect to the templates CDN — every TemplateCard on the
            homepage + gallery fetches its thumbnail from here. Saves the
            TCP + TLS handshake on the first image request (~100-300ms). */}
        <link rel="preconnect" href="https://templates.openlen.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://templates.openlen.com" />
      </head>
      <body className="min-h-screen bg-white text-zinc-900 dark:bg-[#0a0a0a] dark:text-zinc-100 antialiased font-sans">
        {/* Apply the saved theme before first paint — kills the flash and the
            light/dark flip when navigating between routes. Storage key mirrors
            useDarkMode (lib/use-dark-mode.ts). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('inari:dark');var d=s===null?window.matchMedia('(prefers-color-scheme: dark)').matches:s==='1';if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
        <NextIntlClientProvider>
          <AuthSessionProvider>{children}</AuthSessionProvider>
        </NextIntlClientProvider>
        {/* Schema.org Organization — site-wide marker so Google associates
            every page with the OpenLen brand entity. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "OpenLen",
              url: SITE_URL,
              logo: `${SITE_URL}/logo.png`,
              sameAs: ["https://github.com/orbita-pos/openlen"],
            }),
          }}
        />
      </body>
    </html>
  );
}
