import { dic, isLang } from "@/i18n";

export default async function Portada({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) return null;
  return <h1>{dic(lang).meta.title}</h1>;
}
