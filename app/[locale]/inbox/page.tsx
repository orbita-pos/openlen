import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/auth";
import { InboxHub } from "@/components/inbox/inbox-hub";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "inbox" });
  return { title: t("title") };
}

// Owner Desk — the project owner reads + replies to visitor chats here.
// Auth-gated: middleware already redirects logged-out visitors, this is the
// defense-in-depth gate that also yields the session.
export default async function InboxPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await auth();
  if (!session?.user?.id) redirect({ href: "/login?next=/inbox", locale });
  return (
    <div className="flex h-dvh flex-col bg-white dark:bg-[#0a0a0a]">
      <InboxHub />
    </div>
  );
}
