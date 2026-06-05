import { redirect } from "@/i18n/navigation";

// /messages now lives inside the workspace as a section. Keep the URL working
// (bookmarks, old links) by redirecting to /new with the Messages section open.
export default async function MessagesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/new?view=messages", locale });
}
