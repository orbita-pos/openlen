"use client";

// /me SIN @ TODAVÍA: la ventana del @ de siempre (HandleDialog). Guardado, al
// perfil nuevo; cerrado sin guardar, de vuelta al editor. HandleDialog llama a
// onSaved y LUEGO a onClose: sin el ref, la segunda navegación pisaba a la primera.

import { useRef } from "react";

import HandleDialog from "@/components/community/handle-dialog";
import { useRouter } from "@/i18n/navigation";

export default function ChooseHandle() {
  const router = useRouter();
  const saved = useRef(false);
  return (
    <main className="min-h-dvh bg-[#0a0a0b]">
      <HandleDialog
        open
        onClose={() => {
          if (!saved.current) router.replace("/new");
        }}
        onSaved={(h) => {
          saved.current = true;
          router.replace(`/@${h}`);
        }}
      />
    </main>
  );
}
