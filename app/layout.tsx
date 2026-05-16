import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "inari-pages — open-source landing page generator",
  description:
    "Generate production-grade landing pages with smart multi-model routing. Own your output, deploy anywhere.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
