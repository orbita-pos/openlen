"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

// Thin client-only wrapper so the root layout (a Server Component) can mount
// the Auth.js session provider without itself becoming a client component.
export function AuthSessionProvider({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
