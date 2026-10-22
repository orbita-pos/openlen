// lib/project-email/unsubscribe-page.ts — THE PAGE BEHIND AN EMAIL'S «UNSUBSCRIBE» (spec
// local 2026-10-22-email-integration, 6.7), hosted by OpenLen, in the reader's
// language (Accept-Language; English otherwise), like the sign-in emails'
// texts (lib/backend/auth/mail-texts.ts). No script: a form that posts to the
// same link, which is also the one-click POST of the headers (RFC 8058). Pure.

export type UnsubscribeState = "ask" | "done" | "invalid";

interface Copy {
  readonly askTitle: string;
  readonly ask: string;
  readonly button: string;
  readonly doneTitle: string;
  readonly done: string;
  readonly signIn: string;
  readonly invalidTitle: string;
  readonly invalid: string;
}

// `{sender}` and `{address}` are replaced; nothing else.
const COPY: Record<string, Copy> = {
  en: {
    askTitle: "Unsubscribe",
    ask: "Stop getting emails from {sender} at {address}?",
    button: "Unsubscribe",
    doneTitle: "You're unsubscribed",
    done: "{address} won't get more emails from {sender}.",
    signIn: "Emails you ask for to sign in to your account will still arrive.",
    invalidTitle: "This link doesn't work",
    invalid: "The unsubscribe link is incomplete or was changed. Open it again from the email.",
  },
  es: {
    askTitle: "Darse de baja",
    ask: "¿Dejar de recibir correos de {sender} en {address}?",
    button: "Darme de baja",
    doneTitle: "Te diste de baja",
    done: "{address} ya no recibirá correos de {sender}.",
    signIn: "Los correos que pidas para entrar a tu cuenta seguirán llegando.",
    invalidTitle: "Este enlace no funciona",
    invalid: "El enlace para darse de baja está incompleto o cambió. Ábrelo otra vez desde el correo.",
  },
  pt: {
    askTitle: "Cancelar inscrição",
    ask: "Deixar de receber e-mails de {sender} em {address}?",
    button: "Cancelar inscrição",
    doneTitle: "Inscrição cancelada",
    done: "{address} não receberá mais e-mails de {sender}.",
    signIn: "Os e-mails que você pedir para entrar na sua conta continuarão chegando.",
    invalidTitle: "Este link não funciona",
    invalid: "O link de cancelamento está incompleto ou foi alterado. Abra-o novamente a partir do e-mail.",
  },
  fr: {
    askTitle: "Se désabonner",
    ask: "Ne plus recevoir d'e-mails de {sender} à {address} ?",
    button: "Me désabonner",
    doneTitle: "Vous êtes désabonné",
    done: "{address} ne recevra plus d'e-mails de {sender}.",
    signIn: "Les e-mails que vous demandez pour vous connecter à votre compte continueront d'arriver.",
    invalidTitle: "Ce lien ne fonctionne pas",
    invalid: "Le lien de désabonnement est incomplet ou a été modifié. Ouvrez-le à nouveau depuis l'e-mail.",
  },
  de: {
    askTitle: "Abmelden",
    ask: "Keine E-Mails mehr von {sender} an {address} erhalten?",
    button: "Abmelden",
    doneTitle: "Du bist abgemeldet",
    done: "{address} erhält keine E-Mails mehr von {sender}.",
    signIn: "E-Mails, die du zum Anmelden in deinem Konto anforderst, kommen weiterhin an.",
    invalidTitle: "Dieser Link funktioniert nicht",
    invalid: "Der Abmeldelink ist unvollständig oder wurde verändert. Öffne ihn erneut aus der E-Mail.",
  },
  it: {
    askTitle: "Annulla iscrizione",
    ask: "Non ricevere più email da {sender} a {address}?",
    button: "Annulla iscrizione",
    doneTitle: "Iscrizione annullata",
    done: "{address} non riceverà più email da {sender}.",
    signIn: "Le email che richiedi per accedere al tuo account continueranno ad arrivare.",
    invalidTitle: "Questo link non funziona",
    invalid: "Il link per annullare l'iscrizione è incompleto o è stato modificato. Aprilo di nuovo dall'email.",
  },
  ja: {
    askTitle: "配信停止",
    ask: "{address} への {sender} からのメールを停止しますか？",
    button: "配信を停止する",
    doneTitle: "配信を停止しました",
    done: "{address} には今後 {sender} からのメールは届きません。",
    signIn: "アカウントへのログインのために依頼したメールは引き続き届きます。",
    invalidTitle: "このリンクは使えません",
    invalid: "配信停止のリンクが不完全か、変更されています。メールからもう一度開いてください。",
  },
  ko: {
    askTitle: "수신 거부",
    ask: "{address}(으)로 오는 {sender}의 이메일을 그만 받으시겠어요?",
    button: "수신 거부",
    doneTitle: "수신 거부되었습니다",
    done: "{address}(으)로 더 이상 {sender}의 이메일이 오지 않습니다.",
    signIn: "계정에 로그인하려고 요청한 이메일은 계속 받습니다.",
    invalidTitle: "이 링크는 작동하지 않습니다",
    invalid: "수신 거부 링크가 불완전하거나 변경되었습니다. 이메일에서 다시 열어 주세요.",
  },
  zh: {
    askTitle: "退订",
    ask: "不再在 {address} 接收来自 {sender} 的邮件？",
    button: "退订",
    doneTitle: "已退订",
    done: "{address} 将不再收到来自 {sender} 的邮件。",
    signIn: "你为登录账户而申请的邮件仍会照常发送。",
    invalidTitle: "此链接无效",
    invalid: "退订链接不完整或已被修改。请从邮件中重新打开。",
  },
  nl: {
    askTitle: "Afmelden",
    ask: "Geen e-mails meer van {sender} op {address} ontvangen?",
    button: "Afmelden",
    doneTitle: "Je bent afgemeld",
    done: "{address} krijgt geen e-mails meer van {sender}.",
    signIn: "E-mails die je aanvraagt om in te loggen op je account komen nog steeds aan.",
    invalidTitle: "Deze link werkt niet",
    invalid: "De afmeldlink is onvolledig of gewijzigd. Open hem opnieuw vanuit de e-mail.",
  },
};

/** The first language of Accept-Language we have; English otherwise. */
export function pageLanguage(acceptLanguage: string | null): string {
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0]!.trim().toLowerCase().split("-")[0]!;
    if (Object.hasOwn(COPY, tag)) return tag;
  }
  return "en";
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function unsubscribePageHtml(state: UnsubscribeState, v: { lang: string; sender: string; address: string }): string {
  const c = COPY[v.lang] ?? COPY.en!;
  const fill = (s: string) => escapeHtml(s).replace("{sender}", `<strong>${escapeHtml(v.sender)}</strong>`).replace("{address}", `<strong>${escapeHtml(v.address)}</strong>`);
  const [title, body] =
    state === "ask"
      ? [c.askTitle, `<p>${fill(c.ask)}</p><form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">${escapeHtml(c.button)}</button></form>`]
      : state === "done"
        ? [c.doneTitle, `<p>${fill(c.done)}</p><p class="muted">${escapeHtml(c.signIn)}</p>`]
        : [c.invalidTitle, `<p>${escapeHtml(c.invalid)}</p>`];
  return `<!doctype html>
<html lang="${escapeHtml(v.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#fafafa;--fg:#111827;--muted:#6b7280;--card:#fff;--bd:#e5e7eb;--btn:#111827;--btn-fg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0c;--fg:#f3f4f6;--muted:#9ca3af;--card:#151517;--bd:#26262a;--btn:#f3f4f6;--btn-fg:#111827}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px;box-sizing:border-box}
main{max-width:420px;width:100%;background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:28px}
h1{font-size:20px;margin:0 0 12px}p{margin:0 0 16px;overflow-wrap:anywhere}.muted{color:var(--muted);font-size:14px}
button{font:inherit;font-weight:600;border:0;border-radius:10px;padding:10px 18px;background:var(--btn);color:var(--btn-fg);cursor:pointer}
</style></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}
