// Los textos de los correos de /auth/v1 (confirmar el registro, recuperar la
// contraseña, invitar), en los 10 idiomas, en el de la página y si no, en
// inglés. Puros: el envío es lib/backend/auth/mail.ts.
//
// Se escribieron para las cuentas de la página (data-ol-accounts, 03/10), que
// se retiraron sin llegar a desplegarse; los textos se MUDARON tal cual, sin el
// «papel» del invitado, que en Supabase Auth no existe.

export type AuthEmailKind = "confirm" | "recovery" | "invite";

interface Copy {
  readonly subject: string;
  readonly lead: string;
  readonly button: string;
  readonly ignore: string;
}

// `{host}` se sustituye; nada más.
const COPY: Record<string, Record<AuthEmailKind, Copy>> = {
  en: {
    confirm: {
      subject: "Confirm your account on {host}",
      lead: "Open this link to confirm your email and finish creating your account on {host}.",
      button: "Confirm my account",
      ignore: "If you didn't create an account, you can ignore this email.",
    },
    recovery: {
      subject: "Reset your password on {host}",
      lead: "Open this link to choose a new password for your account on {host}.",
      button: "Choose a new password",
      ignore: "If you didn't ask for this, you can ignore this email. Your password stays the same.",
    },
    invite: {
      subject: "You're invited to {host}",
      lead: "You've been invited to join {host}. Open this link to choose your password.",
      button: "Accept and choose a password",
      ignore: "If you weren't expecting this invitation, you can ignore this email.",
    },
  },
  es: {
    confirm: {
      subject: "Confirma tu cuenta en {host}",
      lead: "Abre este enlace para confirmar tu correo y terminar de crear tu cuenta en {host}.",
      button: "Confirmar mi cuenta",
      ignore: "Si no creaste una cuenta, puedes ignorar este correo.",
    },
    recovery: {
      subject: "Restablece tu contraseña en {host}",
      lead: "Abre este enlace para elegir una contraseña nueva para tu cuenta en {host}.",
      button: "Elegir contraseña nueva",
      ignore: "Si no lo pediste tú, puedes ignorar este correo: tu contraseña no cambia.",
    },
    invite: {
      subject: "Te invitaron a {host}",
      lead: "Te invitaron a entrar en {host}. Abre este enlace para elegir tu contraseña.",
      button: "Aceptar y elegir contraseña",
      ignore: "Si no esperabas esta invitación, puedes ignorar este correo.",
    },
  },
  pt: {
    confirm: {
      subject: "Confirme sua conta em {host}",
      lead: "Abra este link para confirmar seu e-mail e concluir a criação da sua conta em {host}.",
      button: "Confirmar minha conta",
      ignore: "Se você não criou uma conta, pode ignorar este e-mail.",
    },
    recovery: {
      subject: "Redefina sua senha em {host}",
      lead: "Abra este link para escolher uma nova senha para sua conta em {host}.",
      button: "Escolher nova senha",
      ignore: "Se não foi você que pediu, pode ignorar este e-mail: sua senha continua a mesma.",
    },
    invite: {
      subject: "Convite para {host}",
      lead: "Você recebeu um convite para entrar em {host}. Abra este link para escolher sua senha.",
      button: "Aceitar e escolher senha",
      ignore: "Se você não esperava este convite, pode ignorar este e-mail.",
    },
  },
  fr: {
    confirm: {
      subject: "Confirmez votre compte sur {host}",
      lead: "Ouvrez ce lien pour confirmer votre adresse e-mail et finaliser la création de votre compte sur {host}.",
      button: "Confirmer mon compte",
      ignore: "Si vous n'avez pas créé de compte, vous pouvez ignorer cet e-mail.",
    },
    recovery: {
      subject: "Réinitialisez votre mot de passe sur {host}",
      lead: "Ouvrez ce lien pour choisir un nouveau mot de passe pour votre compte sur {host}.",
      button: "Choisir un nouveau mot de passe",
      ignore: "Si vous n'avez rien demandé, vous pouvez ignorer cet e-mail : votre mot de passe ne change pas.",
    },
    invite: {
      subject: "Invitation à rejoindre {host}",
      lead: "Vous avez reçu une invitation à rejoindre {host}. Ouvrez ce lien pour choisir votre mot de passe.",
      button: "Accepter et choisir un mot de passe",
      ignore: "Si vous n'attendiez pas cette invitation, vous pouvez ignorer cet e-mail.",
    },
  },
  de: {
    confirm: {
      subject: "Bestätige dein Konto auf {host}",
      lead: "Öffne diesen Link, um deine E-Mail-Adresse zu bestätigen und dein Konto auf {host} fertig einzurichten.",
      button: "Konto bestätigen",
      ignore: "Wenn du kein Konto erstellt hast, kannst du diese E-Mail ignorieren.",
    },
    recovery: {
      subject: "Setze dein Passwort auf {host} zurück",
      lead: "Öffne diesen Link, um ein neues Passwort für dein Konto auf {host} zu wählen.",
      button: "Neues Passwort wählen",
      ignore: "Wenn du das nicht angefordert hast, kannst du diese E-Mail ignorieren – dein Passwort bleibt gleich.",
    },
    invite: {
      subject: "Einladung zu {host}",
      lead: "Du wurdest zu {host} eingeladen. Öffne diesen Link, um dein Passwort zu wählen.",
      button: "Annehmen und Passwort wählen",
      ignore: "Wenn du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.",
    },
  },
  it: {
    confirm: {
      subject: "Conferma il tuo account su {host}",
      lead: "Apri questo link per confermare la tua email e completare la creazione del tuo account su {host}.",
      button: "Conferma il mio account",
      ignore: "Se non hai creato un account, puoi ignorare questa email.",
    },
    recovery: {
      subject: "Reimposta la tua password su {host}",
      lead: "Apri questo link per scegliere una nuova password per il tuo account su {host}.",
      button: "Scegli una nuova password",
      ignore: "Se non l'hai richiesto tu, puoi ignorare questa email: la tua password resta la stessa.",
    },
    invite: {
      subject: "Invito a {host}",
      lead: "Hai ricevuto un invito a entrare in {host}. Apri questo link per scegliere la tua password.",
      button: "Accetta e scegli la password",
      ignore: "Se non aspettavi questo invito, puoi ignorare questa email.",
    },
  },
  ja: {
    confirm: {
      subject: "{host} のアカウントを確認してください",
      lead: "このリンクを開いてメールアドレスを確認し、{host} のアカウント作成を完了してください。",
      button: "アカウントを確認する",
      ignore: "心当たりがない場合は、このメールを無視してください。",
    },
    recovery: {
      subject: "{host} のパスワードを再設定",
      lead: "このリンクを開いて、{host} のアカウントの新しいパスワードを設定してください。",
      button: "新しいパスワードを設定する",
      ignore: "心当たりがない場合は、このメールを無視してください。パスワードは変わりません。",
    },
    invite: {
      subject: "{host} への招待",
      lead: "{host} に招待されました。このリンクを開いてパスワードを設定してください。",
      button: "招待を受けてパスワードを設定する",
      ignore: "心当たりがない場合は、このメールを無視してください。",
    },
  },
  ko: {
    confirm: {
      subject: "{host} 계정을 확인해 주세요",
      lead: "이 링크를 열어 이메일을 확인하고 {host} 계정 만들기를 완료하세요.",
      button: "계정 확인하기",
      ignore: "계정을 만든 적이 없다면 이 이메일을 무시하셔도 됩니다.",
    },
    recovery: {
      subject: "{host} 비밀번호 재설정",
      lead: "이 링크를 열어 {host} 계정의 새 비밀번호를 설정하세요.",
      button: "새 비밀번호 설정하기",
      ignore: "요청하지 않으셨다면 이 이메일을 무시하셔도 됩니다. 비밀번호는 바뀌지 않습니다.",
    },
    invite: {
      subject: "{host} 초대",
      lead: "{host}에 초대되었습니다. 이 링크를 열어 비밀번호를 설정하세요.",
      button: "초대 수락하고 비밀번호 설정하기",
      ignore: "예상하지 못한 초대라면 이 이메일을 무시하셔도 됩니다.",
    },
  },
  zh: {
    confirm: {
      subject: "确认你在 {host} 的账户",
      lead: "打开此链接以确认你的邮箱，并完成在 {host} 创建账户。",
      button: "确认我的账户",
      ignore: "如果你没有创建账户，可以忽略这封邮件。",
    },
    recovery: {
      subject: "重置你在 {host} 的密码",
      lead: "打开此链接，为你在 {host} 的账户设置新密码。",
      button: "设置新密码",
      ignore: "如果不是你本人操作，可以忽略这封邮件，你的密码不会改变。",
    },
    invite: {
      subject: "{host} 的邀请",
      lead: "你受邀加入 {host}。打开此链接设置你的密码。",
      button: "接受邀请并设置密码",
      ignore: "如果你没有预料到这份邀请，可以忽略这封邮件。",
    },
  },
  nl: {
    confirm: {
      subject: "Bevestig je account op {host}",
      lead: "Open deze link om je e-mailadres te bevestigen en je account op {host} af te maken.",
      button: "Mijn account bevestigen",
      ignore: "Heb je geen account aangemaakt? Dan kun je deze e-mail negeren.",
    },
    recovery: {
      subject: "Stel je wachtwoord opnieuw in op {host}",
      lead: "Open deze link om een nieuw wachtwoord te kiezen voor je account op {host}.",
      button: "Nieuw wachtwoord kiezen",
      ignore: "Heb je dit niet aangevraagd? Dan kun je deze e-mail negeren; je wachtwoord blijft hetzelfde.",
    },
    invite: {
      subject: "Uitnodiging voor {host}",
      lead: "Je bent uitgenodigd voor {host}. Open deze link om je wachtwoord te kiezen.",
      button: "Accepteren en wachtwoord kiezen",
      ignore: "Had je deze uitnodiging niet verwacht? Dan kun je deze e-mail negeren.",
    },
  },
};

/** «es-MX» → «es», «PT_br» → «pt»; lo que no tenemos, inglés. */
function languageOf(lang: string | null | undefined): string {
  const primary = (lang ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return primary in COPY ? primary : "en";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface AuthEmailInput {
  readonly kind: AuthEmailKind;
  readonly link: string;
  /** El host de la página (`tienda.openlen.app` o su dominio propio). */
  readonly host: string;
  readonly lang?: string | null;
}

export function authEmailContent(input: AuthEmailInput): { subject: string; html: string; text: string } {
  const lang = languageOf(input.lang);
  const copy = COPY[lang]![input.kind];
  // Con función, no con cadena: un `$&` en el host no es un patrón de replace.
  const fill = (s: string, esc: (v: string) => string) => s.replace(/\{host\}/g, () => esc(input.host));
  const plain = (v: string) => v;

  const subject = fill(copy.subject, plain);
  const text = [fill(copy.lead, plain), "", input.link, "", fill(copy.ignore, plain)].join("\n");
  const html = `<!doctype html>
<html lang="${lang}">
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; background:#fafafa; margin:0; padding:32px; color:#0a0a0a;">
  <table align="center" style="max-width:480px; width:100%; background:#fff; border-radius:16px; padding:32px; border:1px solid #e5e5e5;">
    <tr><td>
      <p style="font-size:13px; font-weight:600; color:#525252; margin:0 0 20px;">${escapeHtml(input.host)}</p>
      <p style="font-size:15px; line-height:1.5; margin:0 0 24px;">${fill(copy.lead, escapeHtml)}</p>
      <p style="margin:0 0 24px;">
        <a href="${escapeHtml(input.link)}" style="display:inline-block; background:#0a0a0a; color:#fff; padding:11px 18px; border-radius:8px; text-decoration:none; font-weight:500; font-size:14px;">${escapeHtml(copy.button)}</a>
      </p>
      <p style="font-size:12px; color:#525252; word-break:break-all; margin:0 0 24px;">${escapeHtml(input.link)}</p>
      <p style="font-size:12px; color:#737373; margin:0;">${fill(copy.ignore, escapeHtml)}</p>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, html, text };
}
