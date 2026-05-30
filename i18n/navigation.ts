import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware replacements for next/link + next/navigation. Every internal
// link/redirect/router call in the app routes through these so the active
// locale prefix is preserved automatically. Import from "@/i18n/navigation"
// instead of "next/link" / "next/navigation".
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
