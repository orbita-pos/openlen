// Magic-link email copy for the 10 publish locales. Constants on purpose —
// this renders on the visitor-facing auth path, not through next-intl.
// "{site}" interpolates the site title.

export interface MemberEmailStrings {
  subject: string;
  heading: string;
  body: string;
  button: string;
  linkHint: string;
  ignore: string;
}

const STRINGS: Record<string, MemberEmailStrings> = {
  en: {
    subject: "Your sign-in link — {site}",
    heading: "Sign in to {site}",
    body: "Tap the button to sign in. The link works once and expires in 15 minutes.",
    button: "Sign in",
    linkHint: "Or paste this link into your browser:",
    ignore: "If you didn't request this, you can safely ignore this email.",
  },
  es: {
    subject: "Tu enlace de acceso — {site}",
    heading: "Entra a {site}",
    body: "Toca el botón para entrar. El enlace funciona una sola vez y expira en 15 minutos.",
    button: "Entrar",
    linkHint: "O pega este enlace en tu navegador:",
    ignore: "Si no pediste este enlace, puedes ignorar este correo.",
  },
  pt: {
    subject: "Seu link de acesso — {site}",
    heading: "Entrar em {site}",
    body: "Toque no botão para entrar. O link funciona uma vez e expira em 15 minutos.",
    button: "Entrar",
    linkHint: "Ou cole este link no navegador:",
    ignore: "Se você não pediu este link, ignore este e-mail.",
  },
  fr: {
    subject: "Votre lien de connexion — {site}",
    heading: "Se connecter à {site}",
    body: "Appuyez sur le bouton pour vous connecter. Le lien est à usage unique et expire dans 15 minutes.",
    button: "Se connecter",
    linkHint: "Ou collez ce lien dans votre navigateur :",
    ignore: "Si vous n'avez pas demandé ce lien, ignorez cet e-mail.",
  },
  de: {
    subject: "Dein Anmeldelink — {site}",
    heading: "Bei {site} anmelden",
    body: "Tippe auf den Button, um dich anzumelden. Der Link funktioniert einmal und läuft in 15 Minuten ab.",
    button: "Anmelden",
    linkHint: "Oder füge diesen Link in deinen Browser ein:",
    ignore: "Wenn du das nicht angefordert hast, ignoriere diese E-Mail einfach.",
  },
  it: {
    subject: "Il tuo link di accesso — {site}",
    heading: "Accedi a {site}",
    body: "Tocca il pulsante per accedere. Il link vale una sola volta e scade tra 15 minuti.",
    button: "Accedi",
    linkHint: "Oppure incolla questo link nel browser:",
    ignore: "Se non hai richiesto questo link, ignora questa email.",
  },
  ja: {
    subject: "ログインリンク — {site}",
    heading: "{site} にログイン",
    body: "ボタンを押してログインしてください。リンクは1回限り有効で、15分で期限切れになります。",
    button: "ログイン",
    linkHint: "またはこのリンクをブラウザに貼り付けてください：",
    ignore: "心当たりがない場合は、このメールを無視してください。",
  },
  ko: {
    subject: "로그인 링크 — {site}",
    heading: "{site} 로그인",
    body: "버튼을 눌러 로그인하세요. 링크는 한 번만 사용할 수 있으며 15분 후 만료됩니다.",
    button: "로그인",
    linkHint: "또는 이 링크를 브라우저에 붙여넣으세요:",
    ignore: "요청하지 않았다면 이 메일을 무시하셔도 됩니다.",
  },
  zh: {
    subject: "你的登录链接 — {site}",
    heading: "登录 {site}",
    body: "点击按钮登录。链接仅可使用一次，15 分钟后失效。",
    button: "登录",
    linkHint: "或将此链接粘贴到浏览器：",
    ignore: "如果这不是你本人的操作，请忽略此邮件。",
  },
  nl: {
    subject: "Je inloglink — {site}",
    heading: "Inloggen bij {site}",
    body: "Tik op de knop om in te loggen. De link werkt één keer en verloopt over 15 minuten.",
    button: "Inloggen",
    linkHint: "Of plak deze link in je browser:",
    ignore: "Heb je dit niet aangevraagd? Negeer deze e-mail dan gewoon.",
  },
};

export function memberEmailStringsFor(
  locale?: string | null,
): MemberEmailStrings {
  return (locale && STRINGS[locale]) || STRINGS.en;
}
