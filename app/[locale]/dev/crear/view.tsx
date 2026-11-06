"use client";

// /dev/crear (ver page.tsx): el input de Crear —desde el 06/11 hay UNO, el de la
// portada (Jesús: «¿para qué tener 2 inputs?»)— montado tal cual, debajo del
// compositor del chat nuevo para compararlos.

import "../../new/tokens.css";

import { useEffect, useRef, useState } from "react";

import { HeroPromptInput } from "@/components/marketing/hero-prompt-input";
import "@/components/workspace-v2/chat/new-chat.css";
import { ChatComposer } from "@/components/workspace-v2/chat/chat-composer";
import type { EsfuerzoAgente } from "@/lib/agent/esfuerzo";

export function CreateSandbox({ dark }: { dark: boolean }) {
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const [chatText, setChatText] = useState("");
  const [chatEffort, setChatEffort] = useState<EsfuerzoAgente>("auto");
  const chatRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="min-h-screen bg-white px-4 py-10 dark:bg-zinc-950">
      {/* LA REFERENCIA: el compositor del chat nuevo, tal cual (no se toca). */}
      <div className="workspace-v2 mx-auto mb-14 max-w-2xl rounded-2xl bg-app p-6" data-sandbox="chat">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] fg-faint">Chat nuevo (referencia)</p>
        <div className="nc">
          <ChatComposer
            value={chatText}
            onChange={setChatText}
            onSubmit={() => {}}
            onStop={() => {}}
            busy={false}
            textareaRef={chatRef}
            comments={[]}
            onRemoveComment={() => {}}
            scopedSelection={null}
            sectionSelectMode={false}
            attachedImage={null}
            onAttachImage={() => {}}
            onClearAttachedImage={() => {}}
            effort={chatEffort}
            effortLevels={["low", "medium", "high"]}
            effortResolvesTo="medium"
            onEffortChange={setChatEffort}
            mode="len"
          />
        </div>
      </div>
      <section className="mx-auto max-w-2xl" data-sandbox="portada">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Portada</p>
        <HeroPromptInput />
      </section>
    </div>
  );
}
