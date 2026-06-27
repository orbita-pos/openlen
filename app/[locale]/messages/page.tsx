import { redirect } from "@/i18n/navigation";

// Form leads now live as the Formularios tab of the unified /inbox hub. Keep
// the old URL working (bookmarks, old links) by redirecting there.
export default async function MessagesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/inbox?tab=forms", locale });
}
