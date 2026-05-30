// Passthrough root layout. The real <html>/<body> shell lives in
// app/[locale]/layout.tsx so the `lang` attribute can be set per locale.
// Every page route is nested under app/[locale], so this layout only ever
// wraps the locale layout (which provides html/body) or the global
// not-found page (which renders its own html).
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
