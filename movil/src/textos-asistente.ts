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
  // Her app (spec local 2026-11-16-movil-es-tu-asistente, §5.3): Len's work in her sheet, and the sheet's button.
  lenTrabajando: "Len está trabajando",
  pedirCambio: "Pídele un cambio a {name}",
};
type Texts = Record<keyof typeof es, string>;

export const textosAsistente: Record<Idioma, Texts> = {
  es,
  en: { hablarCon: "Talk to {name}", cerrar: "Close", reintentar: "Try again", noEsta: "{name} is no longer here.", lenTrabajando: "Len is working", pedirCambio: "Ask {name} for a change" },
  pt: { hablarCon: "Falar com {name}", cerrar: "Fechar", reintentar: "Tentar de novo", noEsta: "{name} não está mais aqui.", lenTrabajando: "Len está trabalhando", pedirCambio: "Peça uma mudança a {name}" },
  fr: { hablarCon: "Parler à {name}", cerrar: "Fermer", reintentar: "Réessayer", noEsta: "{name} n’est plus là.", lenTrabajando: "Len travaille", pedirCambio: "Demander un changement à {name}" },
  de: { hablarCon: "Mit {name} sprechen", cerrar: "Schließen", reintentar: "Erneut versuchen", noEsta: "{name} gibt es nicht mehr.", lenTrabajando: "Len arbeitet", pedirCambio: "{name} um eine Änderung bitten" },
  it: { hablarCon: "Parla con {name}", cerrar: "Chiudi", reintentar: "Riprova", noEsta: "{name} non c’è più.", lenTrabajando: "Len sta lavorando", pedirCambio: "Chiedi una modifica a {name}" },
  ja: { hablarCon: "{name}と話す", cerrar: "閉じる", reintentar: "もう一度", noEsta: "{name}はもういません。", lenTrabajando: "Lenが作業中", pedirCambio: "{name}に変更を頼む" },
  ko: { hablarCon: "{name}에게 말하기", cerrar: "닫기", reintentar: "다시 시도", noEsta: "{name}: 더 이상 없어요.", lenTrabajando: "Len이 작업 중", pedirCambio: "{name}에게 변경 요청하기" },
  zh: { hablarCon: "和{name}聊聊", cerrar: "关闭", reintentar: "重试", noEsta: "{name}已不在。", lenTrabajando: "Len 正在工作", pedirCambio: "请{name}做个修改" },
  nl: { hablarCon: "Praat met {name}", cerrar: "Sluiten", reintentar: "Opnieuw proberen", noEsta: "{name} is er niet meer.", lenTrabajando: "Len is aan het werk", pedirCambio: "Vraag {name} om een wijziging" },
};
