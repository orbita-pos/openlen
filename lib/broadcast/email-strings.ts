// Broadcast email footer copy for the 10 publish locales — the legally
// required bits: who sent it + why you got it + how to stop. Constants on
// purpose (the send path doesn't use next-intl). "{site}" interpolates the
// site title. The postal address line is appended separately from
// BROADCAST_POSTAL_ADDRESS (CAN-SPAM); OpenLen is the sender of record on the
// shared domain, so its operating-entity address satisfies the requirement.

export interface BroadcastFooterStrings {
  sentVia: string; // "Sent via OpenLen on behalf of {site}."
  why: string; // "You're getting this because you're a member of {site}."
  unsubscribe: string; // "Unsubscribe"
}

const STRINGS: Record<string, BroadcastFooterStrings> = {
  en: {
    sentVia: "Sent via OpenLen on behalf of {site}.",
    why: "You're receiving this because you're a member of {site}.",
    unsubscribe: "Unsubscribe",
  },
  es: {
    sentVia: "Enviado vía OpenLen en nombre de {site}.",
    why: "Recibes esto porque eres miembro de {site}.",
    unsubscribe: "Darse de baja",
  },
  pt: {
    sentVia: "Enviado via OpenLen em nome de {site}.",
    why: "Você recebe isto porque é membro de {site}.",
    unsubscribe: "Cancelar inscrição",
  },
  fr: {
    sentVia: "Envoyé via OpenLen au nom de {site}.",
    why: "Vous recevez ceci car vous êtes membre de {site}.",
    unsubscribe: "Se désabonner",
  },
  de: {
    sentVia: "Gesendet über OpenLen im Namen von {site}.",
    why: "Du erhältst dies, weil du Mitglied von {site} bist.",
    unsubscribe: "Abmelden",
  },
  it: {
    sentVia: "Inviato tramite OpenLen per conto di {site}.",
    why: "Ricevi questo perché sei membro di {site}.",
    unsubscribe: "Annulla iscrizione",
  },
  ja: {
    sentVia: "{site} に代わって OpenLen 経由で送信されました。",
    why: "{site} のメンバーであるため、このメールを受信しています。",
    unsubscribe: "配信停止",
  },
  ko: {
    sentVia: "{site}을(를) 대신하여 OpenLen을 통해 발송되었습니다.",
    why: "{site}의 멤버이기 때문에 이 메일을 받았습니다.",
    unsubscribe: "수신 거부",
  },
  zh: {
    sentVia: "由 OpenLen 代表 {site} 发送。",
    why: "你收到此邮件是因为你是 {site} 的会员。",
    unsubscribe: "取消订阅",
  },
  nl: {
    sentVia: "Verzonden via OpenLen namens {site}.",
    why: "Je ontvangt dit omdat je lid bent van {site}.",
    unsubscribe: "Uitschrijven",
  },
};

export function broadcastFooterStringsFor(
  locale?: string | null,
): BroadcastFooterStrings {
  return (locale && STRINGS[locale]) || STRINGS.en;
}
