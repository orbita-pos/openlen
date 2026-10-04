import type { ReactNode } from "react";
import { LenFace } from "@/components/workspace-v2/chat/len-face";
import { cn } from "@/lib/cn";

// LEN PRESENTA CADA SECCIÓN (04/10). Antes cada una abría con la misma
// pastilla de icono + etiqueta («Analítica y leads», «Verifícalo», «Precios»),
// la fórmula de cualquier landing de SaaS. Ahora habla Len, con su cara y una
// burbuja como las del chat: la portada es de él, y se nota en cada pantalla.
export function LenSays({
  children,
  dark = false,
  className,
}: {
  children: ReactNode;
  /** Sobre la tarjeta oscura del cierre. */
  dark?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-end gap-2.5", className)}>
      <LenFace size={36} className="shrink-0" />
      <p
        className={cn(
          "rounded-2xl rounded-bl-md px-3.5 py-2 text-[14px] leading-snug",
          dark
            ? "bg-white/10 text-white ring-1 ring-white/15"
            : "bg-white text-zinc-800 shadow-[0_1px_2px_rgb(0_0_0/0.05)] ring-1 ring-zinc-200/80 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10",
        )}
      >
        {children}
      </p>
    </div>
  );
}
