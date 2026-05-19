import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AuthSessionProvider } from "@/components/auth/session-provider";
import "./globals.css";

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
    default: "OpenLen — Beautiful landing pages. AI-built. Open source.",
    template: "%s | OpenLen",
  },
  description:
    "Open-source AI landing-page generator. Lovable quality, your code, $19/month. 15 curated templates ready to publish to your subdomain.",
  keywords: [
    "landing page generator",
    "AI landing page",
    "open source",
    "Next.js",
    "templates",
    "no-code",
    "Latam",
  ],
  authors: [{ name: "OpenLen" }],
  openGraph: {
    type: "website",
    locale: "es_MX",
    alternateLocale: ["en_US"],
    url: SITE_URL,
    siteName: "OpenLen",
    title: "OpenLen — Beautiful landing pages. AI-built. Open source.",
    description:
      "Generate beautiful landing pages with AI, or pick from 15 curated templates. Publish to your own subdomain in seconds.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "OpenLen — AI landing page generator",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenLen — Beautiful landing pages",
    description:
      "Open-source AI landing-page generator + 15 curated templates.",
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen bg-white text-zinc-900 dark:bg-[#0a0a0a] dark:text-zinc-100 antialiased font-sans">
        <AuthSessionProvider>{children}</AuthSessionProvider>
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
              sameAs: [
                "https://github.com/jesusbernalrj/inari-pages",
              ],
            }),
          }}
        />
      </body>
    </html>
  );
}
