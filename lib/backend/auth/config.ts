// La configuración de /auth/v1 de un proyecto: los mismos nombres y los mismos
// valores por defecto que GoTrue (internal/conf, `GOTRUE_*`), para que lo que
// Len lea de Supabase valga aquí.

export interface AuthConfig {
  /** `GOTRUE_SITE_URL`: a dónde vuelven los enlaces sin `redirect_to` (o con
   *  uno que no está permitido). La página publicada del proyecto. */
  readonly siteUrl: string;
  /** `GOTRUE_URI_ALLOW_LIST`: otros destinos permitidos para `redirect_to`. */
  readonly uriAllowList: readonly string[];
  /** `API_EXTERNAL_URL`: la base de los enlaces de los correos. */
  readonly externalUrl: string;
  /** `GOTRUE_DISABLE_SIGNUP`. */
  readonly disableSignup: boolean;
  /** `GOTRUE_MAILER_AUTOCONFIRM`: false = hay que confirmar el correo. */
  readonly mailerAutoconfirm: boolean;
  /** `GOTRUE_JWT_EXP`, segundos. */
  readonly jwtExp: number;
  /** `GOTRUE_MAILER_OTP_EXP`, segundos: lo que vale un enlace de correo. */
  readonly otpExp: number;
  /** `GOTRUE_SMTP_MAX_FREQUENCY`, segundos entre dos correos a la misma cuenta. */
  readonly maxFrequency: number;
  /** `GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL`, segundos. */
  readonly refreshTokenReuseInterval: number;
  /** `GOTRUE_PASSWORD_MIN_LENGTH`. */
  readonly passwordMinLength: number;
}

export function defaultAuthConfig(externalUrl: string): AuthConfig {
  return {
    siteUrl: "",
    uriAllowList: [],
    externalUrl,
    disableSignup: false,
    mailerAutoconfirm: false,
    jwtExp: 3600,
    otpExp: 86400,
    maxFrequency: 60,
    refreshTokenReuseInterval: 10,
    passwordMinLength: 6,
  };
}

/** Los correos de GoTrue (internal/mailer): `signup` (confirmar), `recovery`,
 *  `invite` y `magiclink`. `link` es el `{{ .ConfirmationURL }}` y `otp` el
 *  `{{ .Token }}` de sus plantillas. */
export interface AuthMail {
  readonly to: string;
  readonly kind: "signup" | "recovery" | "invite" | "magiclink";
  readonly link: string;
  readonly otp: string;
  readonly redirectTo: string;
  /** El idioma del navegador de quien lo pidió (`Accept-Language`): el correo
   *  va en el suyo. */
  readonly lang?: string;
}

export type SendAuthMail = (mail: AuthMail) => Promise<void>;
