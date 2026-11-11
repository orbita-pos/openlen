// The phone's own texts for the person's own assistant (spec local 2026-11-06-asistente-propio, §4.6.3, phase 5), in
// the 10 languages (namespace `movil.asistente`). What her place on the web already says — Hablar, Conversaciones,
// Pedidos, a request card — the phone reads from the web's own messages (`own`, the web's `ownAssistant`, see
// textos.tsx), so both say the same thing; only what exists on the phone alone is here. No gender for her: her name.
import type { Idioma } from "./config";

const es = {
  hablarCon: "Hablar con {name}",
  cerrar: "Cerrar",
  reintentar: "Reintentar",
  noEsta: "{name} ya no está.",
};
type Texts = Record<keyof typeof es, string>;

export const textosAsistente: Record<Idioma, Texts> = {
  es,
  en: { hablarCon: "Talk to {name}", cerrar: "Close", reintentar: "Try again", noEsta: "{name} is no longer here." },
  pt: { hablarCon: "Falar com {name}", cerrar: "Fechar", reintentar: "Tentar de novo", noEsta: "{name} não está mais aqui." },
  fr: { hablarCon: "Parler à {name}", cerrar: "Fermer", reintentar: "Réessayer", noEsta: "{name} n’est plus là." },
  de: { hablarCon: "Mit {name} sprechen", cerrar: "Schließen", reintentar: "Erneut versuchen", noEsta: "{name} gibt es nicht mehr." },
  it: { hablarCon: "Parla con {name}", cerrar: "Chiudi", reintentar: "Riprova", noEsta: "{name} non c’è più." },
  ja: { hablarCon: "{name}と話す", cerrar: "閉じる", reintentar: "もう一度", noEsta: "{name}はもういません。" },
  ko: { hablarCon: "{name}에게 말하기", cerrar: "닫기", reintentar: "다시 시도", noEsta: "{name}: 더 이상 없어요." },
  zh: { hablarCon: "和{name}聊聊", cerrar: "关闭", reintentar: "重试", noEsta: "{name}已不在。" },
  nl: { hablarCon: "Praat met {name}", cerrar: "Sluiten", reintentar: "Opnieuw proberen", noEsta: "{name} is er niet meer." },
};
