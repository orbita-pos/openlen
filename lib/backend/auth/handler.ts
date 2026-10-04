// /auth/v1: lo que hace GoTrue (supabase/auth @ ce9a8eee, internal/api) para
// correo y contraseña, sobre el esquema `auth` real del proyecto
// (plans/pages-backend/design.md). Mismas rutas, mismos cuerpos, mismos
// errores; el algoritmo 1 de refresh tokens (rotación con intervalo de reuso).
//
// Todavía no: teléfono, MFA, OAuth/SSO, PKCE, enlace mágico (`/otp`) y cambio
// de correo en `PUT /user` (dice que no, no lo ignora).

import crypto from "node:crypto";
import bcrypt from "bcryptjs";

import type { ProjectDatabase, TxQuery } from "../db";
import { signJwt, verifyJwt } from "../keys";
import type { AuthConfig, AuthMail, SendAuthMail } from "./config";
import { AuthError, authErrorResponse, badRequest, forbidden, OAuthError, unprocessable } from "./errors";
import {
  activeRefreshToken,
  clearRecovery,
  confirmUser,
  createSession,
  deleteSessions,
  deleteUser,
  findRefreshToken,
  findUserByEmail,
  findUserByEmailToken,
  findUserById,
  insertIdentity,
  insertUser,
  listIdentities,
  listUsers,
  mergeAppMetaData,
  mergeUserMetaData,
  revokeSessionTokens,
  sessionAmr,
  sessionExists,
  setPassword,
  storeEmailToken,
  swapRefreshToken,
  type AuthUserRow,
  type IdentityRow,
  type OneTimeTokenType,
} from "./store";

export interface AuthContext {
  readonly db: ProjectDatabase;
  readonly config: AuthConfig;
  readonly sendMail: SendAuthMail;
  readonly jwtSecret: string;
  /** El rol de la clave de la petición: la publicable es `anon`, la secreta
   *  `service_role`; `null` en las rutas abiertas (el enlace del correo). */
  readonly keyRole: "anon" | "service_role" | null;
  /** El valor de la clave, para reconocerla si viene también como Bearer. */
  readonly apikey: string | null;
}

const AUD = "authenticated";
/** bcrypt.DefaultCost, el de GoTrue (`crypto.GenerateFromPassword`). */
const BCRYPT_COST = 10;

// ─── Serializar como GoTrue ─────────────────────────────────────────────────

function ts(v: Date | string | null | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function identityJson(i: IdentityRow) {
  return {
    identity_id: i.id,
    id: i.provider_id,
    user_id: i.user_id,
    identity_data: i.identity_data,
    provider: i.provider,
    ...(i.last_sign_in_at ? { last_sign_in_at: ts(i.last_sign_in_at) } : {}),
    created_at: ts(i.created_at),
    updated_at: ts(i.updated_at),
    ...(i.email ? { email: i.email } : {}),
  };
}

/** `models.User` en JSON: los `omitempty` se omiten cuando son nulos. */
function userJson(u: AuthUserRow, identities: readonly IdentityRow[]) {
  const opt = (k: string, v: Date | string | null | undefined) => (v ? { [k]: ts(v) } : {});
  return {
    id: u.id,
    aud: u.aud,
    role: u.role,
    email: u.email ?? "",
    ...opt("email_confirmed_at", u.email_confirmed_at),
    ...opt("invited_at", u.invited_at),
    phone: u.phone ?? "",
    ...opt("phone_confirmed_at", u.phone_confirmed_at),
    ...opt("confirmation_sent_at", u.confirmation_sent_at),
    ...opt("confirmed_at", u.confirmed_at),
    ...opt("recovery_sent_at", u.recovery_sent_at),
    ...(u.email_change ? { new_email: u.email_change } : {}),
    ...opt("email_change_sent_at", u.email_change_sent_at),
    ...opt("last_sign_in_at", u.last_sign_in_at),
    app_metadata: u.raw_app_meta_data ?? {},
    user_metadata: u.raw_user_meta_data ?? {},
    identities: identities.map(identityJson),
    created_at: ts(u.created_at),
    updated_at: ts(u.updated_at),
    ...opt("banned_until", u.banned_until),
    ...opt("deleted_at", u.deleted_at),
    is_anonymous: u.is_anonymous,
  };
}

async function loadUserJson(q: TxQuery, id: string) {
  const u = await findUserById(q, id);
  if (!u) throw new AuthError(404, "user_not_found", "User not found");
  return userJson(u, await listIdentities(q, id));
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

// ─── Validaciones de GoTrue ─────────────────────────────────────────────────

/** `validateEmail` (checkmail.ValidateFormat, en minúsculas). */
function validateEmail(raw: unknown): string {
  const email = typeof raw === "string" ? raw : "";
  if (email === "") throw badRequest("validation_failed", "An email address is required");
  if (email.length > 255) throw badRequest("validation_failed", "An email address is too long");
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(email)) {
    throw badRequest("validation_failed", "Unable to validate email address: invalid format");
  }
  return email.toLowerCase();
}

/** `checkPasswordStrength` con la configuración por defecto (sólo longitud). */
function checkPasswordStrength(password: string, config: AuthConfig): void {
  if (password.length < config.passwordMinLength) {
    throw new AuthError(422, "weak_password", `Password should be at least ${config.passwordMinLength} characters.`, ["length"]);
  }
}

function frequencyLimit(sentAt: Date | string | null, config: AuthConfig): void {
  if (!sentAt) return;
  const until = new Date(sentAt).getTime() + config.maxFrequency * 1000;
  const left = Math.floor((until - Date.now()) / 1000);
  if (until > Date.now()) {
    throw new AuthError(429, "over_email_send_rate_limit", `For security purposes, you can only request this after ${left} seconds.`);
  }
}

/** `IsRedirectURLValid`: el host de la Site URL, o la lista permitida (globs
 *  con `*` dentro de un segmento y `**` para cualquier cosa). */
function isRedirectValid(target: string, config: AuthConfig): boolean {
  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  try {
    if (config.siteUrl && new URL(config.siteUrl).hostname === u.hostname) return true;
  } catch {
    /* Site URL mal puesta: sólo cuenta la lista */
  }
  return config.uriAllowList.some((pattern) => {
    const re = new RegExp(
      `^${pattern
        .split("**")
        .map((part) => part.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^./]*"))
        .join(".*")}$`,
    );
    return re.test(target);
  });
}

/** `utilities.GetReferrer`: `redirect_to` si vale; si no, el Referer; si no, la Site URL. */
function referrer(req: Request, config: AuthConfig, bodyRedirect?: unknown): string {
  const url = new URL(req.url);
  const candidates = [url.searchParams.get("redirect_to"), typeof bodyRedirect === "string" ? bodyRedirect : null, req.headers.get("referer")];
  for (const c of candidates) if (c && isRedirectValid(c, config)) return c;
  return config.siteUrl;
}

// ─── Correos y fichas ───────────────────────────────────────────────────────

/** `crypto.GenerateOtp(6)` y `GenerateTokenHash(email, otp)` (sha224). */
function newOtp(): { otp: string; hash: (email: string) => string } {
  const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  return { otp, hash: (email) => crypto.createHash("sha224").update(email + otp).digest("hex") };
}

/** `getPath` de su mailer: `<externalUrl>/verify?token=…&type=…&redirect_to=…`. */
function verifyLink(config: AuthConfig, tokenHash: string, type: string, redirectTo: string): string {
  return `${config.externalUrl}/verify?token=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(type)}&redirect_to=${encodeRedirect(redirectTo)}`;
}

/** `encodeRedirectURL`: si trae `&`, `=` o `#` no venía codificada y se codifica. */
function encodeRedirect(u: string): string {
  return /[&=#]/.test(u) ? encodeURIComponent(u) : u;
}

async function sendEmailToken(
  ctx: AuthContext,
  q: TxQuery,
  user: AuthUserRow,
  kind: AuthMail["kind"],
  redirectTo: string,
): Promise<void> {
  const tokenType: OneTimeTokenType = kind === "recovery" || kind === "magiclink" ? "recovery_token" : "confirmation_token";
  frequencyLimit(tokenType === "recovery_token" ? user.recovery_sent_at : user.confirmation_sent_at, ctx.config);
  const email = user.email ?? "";
  const { otp, hash } = newOtp();
  const tokenHash = hash(email);
  await storeEmailToken(q, { id: user.id, email }, tokenType, tokenHash, { invited: kind === "invite" });
  try {
    await ctx.sendMail({ to: email, kind, link: verifyLink(ctx.config, tokenHash, kind, redirectTo), otp, redirectTo });
  } catch {
    const what = kind === "signup" ? "confirmation" : kind;
    throw new AuthError(500, "unexpected_failure", `Error sending ${what} email`);
  }
}

// ─── Sesiones ───────────────────────────────────────────────────────────────

function requestMeta(req: Request) {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = fwd && /^[0-9a-fA-F:.]+$/.test(fwd) ? fwd : null;
  return { userAgent: req.headers.get("user-agent"), ip };
}

async function accessToken(ctx: AuthContext, q: TxQuery, user: AuthUserRow, sessionId: string): Promise<{ token: string; expiresAt: number }> {
  const amr = await sessionAmr(q, sessionId);
  const token = await signJwt(
    ctx.jwtSecret,
    {
      iss: ctx.config.externalUrl,
      sub: user.id,
      aud: user.aud,
      email: user.email ?? "",
      phone: user.phone ?? "",
      app_metadata: user.raw_app_meta_data ?? {},
      user_metadata: user.raw_user_meta_data ?? {},
      role: user.role,
      aal: "aal1",
      amr,
      session_id: sessionId,
      is_anonymous: user.is_anonymous,
    },
    ctx.config.jwtExp,
  );
  return { token, expiresAt: Math.floor(Date.now() / 1000) + ctx.config.jwtExp };
}

/** `issueRefreshToken` → `AccessTokenResponse`. */
async function issueSession(ctx: AuthContext, q: TxQuery, req: Request, userId: string, method: string) {
  const { sessionId, refreshToken } = await createSession(q, userId, method, requestMeta(req));
  const user = (await findUserById(q, userId))!;
  const { token, expiresAt } = await accessToken(ctx, q, user, sessionId);
  return {
    access_token: token,
    token_type: "bearer",
    expires_in: ctx.config.jwtExp,
    expires_at: expiresAt,
    refresh_token: refreshToken,
    user: userJson(user, await listIdentities(q, userId)),
  };
}

/** `requireAuthentication` + la sesión del claim `session_id`. */
async function authenticate(ctx: AuthContext, q: TxQuery, req: Request): Promise<{ user: AuthUserRow; sessionId: string }> {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim();
  if (!bearer) throw new AuthError(401, "no_authorization", "This endpoint requires a valid Bearer token");
  if (bearer === ctx.apikey) throw forbidden("bad_jwt", "invalid claim: missing sub claim");
  const v = await verifyJwt(ctx.jwtSecret, bearer);
  if (!v.ok) {
    const why =
      v.reason === "expired"
        ? "token has invalid claims: token is expired"
        : v.reason === "bad_signature"
          ? "token signature is invalid: signature is invalid"
          : "token is malformed: could not JSON decode header";
    throw forbidden("bad_jwt", `invalid JWT: unable to parse or verify signature, ${why}`);
  }
  const sub = v.claims.sub;
  if (typeof sub !== "string" || sub === "") throw forbidden("bad_jwt", "invalid claim: missing sub claim");
  if (!/^[0-9a-f-]{36}$/i.test(sub)) throw badRequest("bad_jwt", "invalid claim: sub claim must be a UUID");
  const user = await findUserById(q, sub);
  if (!user) throw forbidden("user_not_found", "User from sub claim in JWT does not exist");
  const sid = v.claims.session_id;
  if (typeof sid !== "string" || !/^[0-9a-f-]{36}$/i.test(sid)) throw forbidden("bad_jwt", "invalid claim: session_id claim must be a UUID");
  if (!(await sessionExists(q, sid))) throw forbidden("session_not_found", "Session from session_id claim in JWT does not exist");
  return { user, sessionId: sid };
}

/** `requireAdmin`: el rol de la petición tiene que ser `service_role`. */
async function requireAdmin(ctx: AuthContext, req: Request): Promise<void> {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim();
  if (bearer && bearer !== ctx.apikey) {
    const v = await verifyJwt(ctx.jwtSecret, bearer);
    if (v.ok && v.claims.role === "service_role") return;
    if (!v.ok) throw forbidden("bad_jwt", "Invalid token");
    throw forbidden("not_admin", "User not allowed");
  }
  if (ctx.keyRole !== "service_role") throw forbidden("not_admin", "User not allowed");
}

// ─── Rutas ──────────────────────────────────────────────────────────────────

async function body(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* abajo */
  }
  throw badRequest("bad_json", "Could not parse request body as JSON");
}

const data = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

async function signup(ctx: AuthContext, req: Request): Promise<Response> {
  const p = await body(req);
  if (ctx.config.disableSignup) throw unprocessable("signup_disabled", "Signups not allowed for this instance");
  const password = typeof p.password === "string" ? p.password : "";
  if (password === "") throw badRequest("validation_failed", "Signup requires a valid password");
  checkPasswordStrength(password, ctx.config);
  if (typeof p.phone === "string" && p.phone !== "") throw badRequest("phone_provider_disabled", "Phone signups are disabled");
  const email = validateEmail(p.email);
  const userData = data(p.data);
  const redirectTo = referrer(req, ctx.config);
  // El bcrypt, fuera de la transacción (como GoTrue: es caro).
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  return ctx.db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    const existing = await findUserByEmail(q, email, AUD);
    if (existing && existing.email_confirmed_at) {
      if (ctx.config.mailerAutoconfirm) throw unprocessable("user_already_exists", "User already registered");
      // `sanitizeUser`: no se dice que existe.
      const now = new Date().toISOString();
      return json({
        id: crypto.randomUUID(),
        aud: AUD,
        role: "",
        email,
        phone: "",
        confirmation_sent_at: now,
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: userData,
        identities: [],
        created_at: now,
        updated_at: now,
        is_anonymous: false,
      });
    }
    let userId: string;
    if (existing) {
      // Sin confirmar: no se le cambia nada («we can't be sure of their claimed identity»).
      userId = existing.id;
    } else {
      userId = crypto.randomUUID();
      await insertUser(q, {
        id: userId,
        aud: AUD,
        email,
        passwordHash,
        appMetaData: { provider: "email", providers: ["email"] },
        userMetaData: userData,
        emailConfirmed: false,
        invited: false,
      });
      const identityData: Record<string, unknown> = { sub: userId, email, email_verified: false, phone_verified: false };
      for (const [k, v] of Object.entries(userData)) if (!(k in identityData)) identityData[k] = v;
      await insertIdentity(q, userId, "email", identityData);
    }
    const user = (await findUserById(q, userId))!;
    if (ctx.config.mailerAutoconfirm) {
      await confirmUser(q, userId);
      return json(await issueSession(ctx, q, req, userId, "password"));
    }
    await sendEmailToken(ctx, q, user, "signup", redirectTo);
    return json(await loadUserJson(q, userId));
  });
}

async function passwordGrant(ctx: AuthContext, req: Request): Promise<Response> {
  const p = await body(req);
  const email = typeof p.email === "string" ? p.email : "";
  const password = typeof p.password === "string" ? p.password : "";
  if (email === "" && !(typeof p.phone === "string" && p.phone)) throw badRequest("validation_failed", "missing email or phone");
  if (email === "") throw unprocessable("phone_provider_disabled", "Phone logins are disabled");
  return ctx.db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    const user = await findUserByEmail(q, email, AUD);
    if (!user) throw badRequest("invalid_credentials", "Invalid login credentials");
    if (user.banned_until && new Date(user.banned_until).getTime() > Date.now()) throw badRequest("user_banned", "User is banned");
    const ok = user.encrypted_password ? await bcrypt.compare(password, user.encrypted_password) : false;
    if (!ok) throw badRequest("invalid_credentials", "Invalid login credentials");
    if (!user.email_confirmed_at) throw badRequest("email_not_confirmed", "Email not confirmed");
    return json(await issueSession(ctx, q, req, user.id, "password"));
  });
}

async function refreshGrant(ctx: AuthContext, req: Request): Promise<Response> {
  const p = await body(req);
  const token = typeof p.refresh_token === "string" ? p.refresh_token : "";
  if (!token) throw new OAuthError("invalid_request", "refresh_token required");
  // El reuso fuera de plazo revoca la familia y TIENE que quedarse aunque la
  // respuesta sea un error (`NewCommitWithError` en GoTrue).
  const outcome = await ctx.db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    const rt = await findRefreshToken(q, token);
    if (!rt) return { error: badRequest("refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found") };
    const user = await findUserById(q, rt.user_id);
    if (!user) return { error: badRequest("refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found") };
    if (user.banned_until && new Date(user.banned_until).getTime() > Date.now()) {
      return { error: badRequest("user_banned", "Invalid Refresh Token: User Banned") };
    }
    if (!rt.session_id || !(await sessionExists(q, rt.session_id))) {
      return { error: badRequest("session_not_found", "Invalid Refresh Token: No Valid Session Found") };
    }
    let issued: string | null = null;
    if (rt.revoked) {
      const active = await activeRefreshToken(q, rt.session_id);
      if (active && active.parent === rt.token) issued = active.token;
      else if (Date.now() > new Date(rt.updated_at).getTime() + ctx.config.refreshTokenReuseInterval * 1000) {
        await revokeSessionTokens(q, rt.session_id);
        return { error: badRequest("refresh_token_already_used", "Invalid Refresh Token: Already Used") };
      }
    }
    if (issued === null) issued = await swapRefreshToken(q, rt);
    const fresh = (await findUserById(q, user.id))!;
    const { token: at, expiresAt } = await accessToken(ctx, q, fresh, rt.session_id);
    return {
      ok: {
        access_token: at,
        token_type: "bearer",
        expires_in: ctx.config.jwtExp,
        expires_at: expiresAt,
        refresh_token: issued,
        user: userJson(fresh, await listIdentities(q, user.id)),
      },
    };
  });
  if ("error" in outcome) throw outcome.error;
  return json(outcome.ok);
}

async function getUser(ctx: AuthContext, req: Request): Promise<Response> {
  return ctx.db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    const { user } = await authenticate(ctx, q, req);
    return json(await loadUserJson(q, user.id));
  });
}

async function updateUser(ctx: AuthContext, req: Request): Promise<Response> {
  const p = await body(req);
  const password = typeof p.password === "string" ? p.password : undefined;
  if (password !== undefined) checkPasswordStrength(password, ctx.config);
  const newHash = password !== undefined ? await bcrypt.hash(password, BCRYPT_COST) : null;
  return ctx.db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    const { user } = await authenticate(ctx, q, req);
    if (typeof p.email === "string" && p.email !== "" && p.email.toLowerCase() !== (user.email ?? "")) {
      throw badRequest("feature_disabled", "Changing the email address is not available yet");
    }
    if (p.data !== undefined) await mergeUserMetaData(q, user.id, data(p.data));
    if (password !== undefined && newHash) {
      if (user.encrypted_password && (await bcrypt.compare(password, user.encrypted_password))) {
        throw unprocessable("same_password", "New password should be different from the old password.");
      }
      await setPassword(q, user.id, newHash);
    }
    return json(await loadUserJson(q, user.id));
  });
}

async function logout(ctx: AuthContext, req: Request): Promise<Response> {
  const scopeRaw = new URL(req.url).searchParams.get("scope") ?? "global";
  if (!["global", "local", "others"].includes(scopeRaw)) {
    throw badRequest("validation_failed", `Unsupported logout scope "${scopeRaw}"`);
  }
  await ctx.db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    const { user, sessionId } = await authenticate(ctx, q, req);
    await deleteSessions(q, user.id, sessionId, scopeRaw as "global" | "local" | "others");
  });
  return new Response(null, { status: 204 });
}

async function recover(ctx: AuthContext, req: Request): Promise<Response> {
  const p = await body(req);
  const email = validateEmail(p.email);
  const redirectTo = referrer(req, ctx.config);
  return ctx.db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    const user = await findUserByEmail(q, email, AUD);
    // Sin cuenta: lo mismo que con ella. No se dice qué correos existen.
    if (user) await sendEmailToken(ctx, q, user, "recovery", redirectTo);
    return json({});
  });
}

async function resend(ctx: AuthContext, req: Request): Promise<Response> {
  const p = await body(req);
  if (p.type !== "signup") throw badRequest("validation_failed", "Missing one of these types: signup, email_change, sms, phone_change");
  const email = validateEmail(p.email);
  const redirectTo = referrer(req, ctx.config, data(p.options).emailRedirectTo);
  return ctx.db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    const user = await findUserByEmail(q, email, AUD);
    if (user && !user.email_confirmed_at) await sendEmailToken(ctx, q, user, "signup", redirectTo);
    return json({});
  });
}

const VERIFY_TYPES = new Set(["signup", "invite", "recovery", "magiclink", "email"]);

/** Lo común a GET y POST de `/verify`: encuentra al usuario por la ficha, la
 *  gasta, y abre su sesión. */
async function verifyToken(ctx: AuthContext, q: TxQuery, req: Request, tokenHash: string, type: string) {
  const types: OneTimeTokenType[] =
    type === "signup" || type === "invite" ? ["confirmation_token"] : type === "email" ? ["confirmation_token", "recovery_token"] : ["recovery_token"];
  const user = await findUserByEmailToken(q, tokenHash, types);
  if (!user) throw forbidden("otp_expired", "Email link is invalid or has expired");
  if (user.banned_until && new Date(user.banned_until).getTime() > Date.now()) throw forbidden("user_banned", "User is banned");
  // La ficha tiene que ser la vigente de SU columna (`confirmation_token` o
  // `recovery_token`): confirmar o recuperar la vacía, y con eso el enlace deja
  // de valer aunque quedara su fila en `one_time_tokens`.
  const isConfirmation = user.confirmation_token === tokenHash;
  const isRecovery = user.recovery_token === tokenHash;
  if (!(isConfirmation && types.includes("confirmation_token")) && !(isRecovery && types.includes("recovery_token"))) {
    throw forbidden("otp_expired", "Email link is invalid or has expired");
  }
  const sentAt = isConfirmation ? user.confirmation_sent_at : user.recovery_sent_at;
  if (!sentAt || Date.now() > new Date(sentAt).getTime() + ctx.config.otpExp * 1000) {
    throw forbidden("otp_expired", "Email link is invalid or has expired");
  }
  if (isConfirmation) {
    // `signupVerify`: al invitado sin contraseña se le pone una al azar, y la
    // página le pide la suya (updateUser).
    if (!user.encrypted_password && user.invited_at) {
      await setPassword(q, user.id, await bcrypt.hash(crypto.randomBytes(48).toString("base64url"), BCRYPT_COST));
    }
    await confirmUser(q, user.id);
  } else {
    await clearRecovery(q, user.id);
    if (!user.email_confirmed_at) await confirmUser(q, user.id);
  }
  return issueSession(ctx, q, req, user.id, "otp");
}

async function verifyGet(ctx: AuthContext, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const type = url.searchParams.get("type") ?? "";
  if (type === "") throw badRequest("validation_failed", "Verify requires a verification type");
  if (token === "") throw badRequest("validation_failed", "Verify requires a token or a token hash");
  const redirectTo = referrer(req, ctx.config);
  let location: string;
  try {
    if (!VERIFY_TYPES.has(type)) throw badRequest("validation_failed", "Unsupported verification type");
    const session = await ctx.db.transaction(async (q) => {
      await q(`select set_config('role', 'supabase_auth_admin', true)`);
      return verifyToken(ctx, q, req, token, type);
    });
    // `AsRedirectURL`: url.Values.Encode() ordena las claves.
    const frag = new URLSearchParams(
      Object.entries({
        access_token: session.access_token,
        expires_at: String(session.expires_at),
        expires_in: String(session.expires_in),
        refresh_token: session.refresh_token,
        sb: "",
        token_type: session.token_type,
        type,
      }).sort(([a], [b]) => a.localeCompare(b)),
    );
    location = `${redirectTo}#${frag.toString()}`;
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    // `prepErrorRedirectURL`: el error, en el fragmento.
    const oauth: Record<number, string> = { 400: "invalid_request", 401: "unauthorized_client", 403: "access_denied", 500: "server_error", 503: "temporarily_unavailable" };
    const frag = new URLSearchParams();
    if (oauth[err.status]) frag.set("error", oauth[err.status]!);
    frag.set("error_code", err.errorCode);
    frag.set("error_description", err.message);
    frag.set("sb", "");
    // Como `url.URL.String()` de Go: la URL tal cual, con su fragmento
    // sustituido (el `URL` de JS añadiría una «/» a un host sin ruta).
    location = `${redirectTo.split("#")[0]}#${frag.toString()}`;
  }
  return new Response(null, { status: 303, headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

async function verifyPost(ctx: AuthContext, req: Request): Promise<Response> {
  const p = await body(req);
  const type = typeof p.type === "string" ? p.type : "";
  if (type === "") throw badRequest("validation_failed", "Verify requires a verification type");
  const token = typeof p.token === "string" ? p.token : "";
  const tokenHashIn = typeof p.token_hash === "string" ? p.token_hash : "";
  if ((token === "" && tokenHashIn === "") || (token !== "" && tokenHashIn !== "")) {
    throw badRequest("validation_failed", "Verify requires either a token or a token hash");
  }
  let tokenHash = tokenHashIn;
  if (token !== "") {
    let email: string;
    try {
      email = validateEmail(p.email);
    } catch {
      throw unprocessable("validation_failed", "Invalid email format");
    }
    tokenHash = crypto.createHash("sha224").update(email + token).digest("hex");
  }
  if (!VERIFY_TYPES.has(type)) throw badRequest("validation_failed", "Unsupported verification type");
  return ctx.db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    return json(await verifyToken(ctx, q, req, tokenHash, type));
  });
}

// ─── Admin (clave secreta) ──────────────────────────────────────────────────

async function invite(ctx: AuthContext, req: Request): Promise<Response> {
  await requireAdmin(ctx, req);
  const p = await body(req);
  const email = validateEmail(p.email);
  const redirectTo = referrer(req, ctx.config);
  return ctx.db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    let user = await findUserByEmail(q, email, AUD);
    if (user && user.email_confirmed_at) {
      throw unprocessable("email_exists", "A user with this email address has already been registered");
    }
    if (!user) {
      const id = crypto.randomUUID();
      await insertUser(q, {
        id,
        aud: AUD,
        email,
        passwordHash: null,
        appMetaData: { provider: "email", providers: ["email"] },
        userMetaData: data(p.data),
        emailConfirmed: false,
        invited: true,
      });
      await insertIdentity(q, id, "email", { sub: id, email, email_verified: false, phone_verified: false });
      user = (await findUserById(q, id))!;
    }
    await sendEmailToken(ctx, q, user, "invite", redirectTo);
    return json(await loadUserJson(q, user.id));
  });
}

async function adminCreateUser(ctx: AuthContext, req: Request): Promise<Response> {
  await requireAdmin(ctx, req);
  const p = await body(req);
  const email = validateEmail(p.email);
  const password = typeof p.password === "string" ? p.password : null;
  if (password !== null) checkPasswordStrength(password, ctx.config);
  const hash = password !== null ? await bcrypt.hash(password, BCRYPT_COST) : null;
  return ctx.db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    if (await findUserByEmail(q, email, AUD)) {
      throw unprocessable("email_exists", "A user with this email address has already been registered");
    }
    const id = crypto.randomUUID();
    await insertUser(q, {
      id,
      aud: AUD,
      email,
      passwordHash: hash,
      appMetaData: { provider: "email", providers: ["email"], ...data(p.app_metadata) },
      userMetaData: data(p.user_metadata),
      emailConfirmed: p.email_confirm === true,
      invited: false,
    });
    await insertIdentity(q, id, "email", { sub: id, email, email_verified: p.email_confirm === true, phone_verified: false });
    return json(await loadUserJson(q, id));
  });
}

async function adminUpdateUser(ctx: AuthContext, req: Request, id: string): Promise<Response> {
  await requireAdmin(ctx, req);
  const p = await body(req);
  const password = typeof p.password === "string" ? p.password : null;
  if (password !== null) checkPasswordStrength(password, ctx.config);
  const hash = password !== null ? await bcrypt.hash(password, BCRYPT_COST) : null;
  return ctx.db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    const user = await findUserById(q, id);
    if (!user) throw new AuthError(404, "user_not_found", "User not found");
    if (hash) await setPassword(q, id, hash);
    if (p.email_confirm === true && !user.email_confirmed_at) await confirmUser(q, id);
    if (p.user_metadata !== undefined) await mergeUserMetaData(q, id, data(p.user_metadata));
    if (p.app_metadata !== undefined) await mergeAppMetaData(q, id, data(p.app_metadata));
    if (typeof p.ban_duration === "string") {
      if (p.ban_duration === "none") await q(`update auth.users set banned_until = null where id = $1`, [id]);
      else {
        const m = /^(\d+)h$/.exec(p.ban_duration);
        if (!m) throw badRequest("validation_failed", "invalid format for ban duration");
        await q(`update auth.users set banned_until = now() + ($2 || ' hours')::interval where id = $1`, [id, m[1]]);
      }
    }
    return json(await loadUserJson(q, id));
  });
}

async function adminListUsers(ctx: AuthContext, req: Request): Promise<Response> {
  await requireAdmin(ctx, req);
  const url = new URL(req.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const perPage = Math.min(1000, Math.max(1, Number.parseInt(url.searchParams.get("per_page") ?? "50", 10) || 50));
  return ctx.db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    const { users, total } = await listUsers(q, AUD, page, perPage);
    const out = [];
    for (const u of users) out.push(userJson(u, await listIdentities(q, u.id)));
    return json({ users: out, aud: AUD }, 200, { "x-total-count": String(total) });
  });
}

async function adminGetUser(ctx: AuthContext, req: Request, id: string): Promise<Response> {
  await requireAdmin(ctx, req);
  return ctx.db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    return json(await loadUserJson(q, id));
  });
}

async function adminDeleteUser(ctx: AuthContext, req: Request, id: string): Promise<Response> {
  await requireAdmin(ctx, req);
  return ctx.db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    if (!(await deleteUser(q, id))) throw new AuthError(404, "user_not_found", "User not found");
    return json({});
  });
}

function settings(ctx: AuthContext): Response {
  const providers = [
    "anonymous_users", "apple", "azure", "bitbucket", "discord", "facebook", "figma", "fly", "github", "gitlab", "google",
    "keycloak", "kakao", "linkedin", "linkedin_oidc", "notion", "spotify", "slack", "slack_oidc", "workos", "twitch",
    "twitter", "x", "zoom", "phone",
  ];
  return json({
    external: { ...Object.fromEntries(providers.map((p) => [p, false])), email: true },
    disable_signup: ctx.config.disableSignup,
    mailer_autoconfirm: ctx.config.mailerAutoconfirm,
    phone_autoconfirm: false,
    sms_provider: "",
    saml_enabled: false,
  });
}

/** Las rutas que la pasarela de Supabase deja sin `apikey`: los enlaces de
 *  los correos se abren en un navegador, que no la lleva. */
export function isOpenAuthPath(subpath: string, method: string): boolean {
  const p = subpath.replace(/^\/+/, "");
  return (p === "verify" && method === "GET") || p === ".well-known/jwks.json" || p === "health";
}

export async function handleAuth(req: Request, subpath: string, ctx: AuthContext): Promise<Response> {
  const p = subpath.replace(/^\/+/, "").replace(/\/+$/, "");
  const method = req.method.toUpperCase();
  try {
    if (p === "settings" && method === "GET") return settings(ctx);
    if (p === "health" && method === "GET") return json({ version: "openlen", name: "GoTrue", description: "GoTrue is a user registration and authentication API" });
    if (p === ".well-known/jwks.json" && method === "GET") return json({ keys: [] });
    if (p === "signup" && method === "POST") return await signup(ctx, req);
    if (p === "token" && method === "POST") {
      const grant = new URL(req.url).searchParams.get("grant_type");
      if (grant === "password") return await passwordGrant(ctx, req);
      if (grant === "refresh_token") return await refreshGrant(ctx, req);
      throw new OAuthError("unsupported_grant_type", "");
    }
    if (p === "user" && method === "GET") return await getUser(ctx, req);
    if (p === "user" && method === "PUT") return await updateUser(ctx, req);
    if (p === "logout" && method === "POST") return await logout(ctx, req);
    if (p === "recover" && method === "POST") return await recover(ctx, req);
    if (p === "resend" && method === "POST") return await resend(ctx, req);
    if (p === "verify" && method === "GET") return await verifyGet(ctx, req);
    if (p === "verify" && method === "POST") return await verifyPost(ctx, req);
    if (p === "invite" && method === "POST") return await invite(ctx, req);
    if (p === "admin/users" && method === "GET") return await adminListUsers(ctx, req);
    if (p === "admin/users" && method === "POST") return await adminCreateUser(ctx, req);
    const adminUser = /^admin\/users\/([0-9a-f-]{36})$/i.exec(p);
    if (adminUser) {
      const id = adminUser[1]!;
      if (method === "GET") return await adminGetUser(ctx, req, id);
      if (method === "PUT") return await adminUpdateUser(ctx, req, id);
      if (method === "DELETE") return await adminDeleteUser(ctx, req, id);
    }
    return json({ code: 404, error_code: "not_found", msg: "Not Found" }, 404);
  } catch (err) {
    if (err instanceof AuthError || err instanceof OAuthError) return authErrorResponse(err, req);
    // Un error de Postgres sin tratar: GoTrue lo da como 500 «Database error…».
    console.error("[backend/auth] error inesperado", err);
    return authErrorResponse(new AuthError(500, "unexpected_failure", "Internal Server Error"), req);
  }
}
