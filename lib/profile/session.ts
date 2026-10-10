// EL NOMBRE Y LA FOTO DEL TOKEN JWT (Auth.js). Se leen de la base al entrar y
// cuando el navegador pide `update({ refresh: true })` (el perfil, al guardar):
// sin esto, el botón de cuenta seguía con la foto de Google hasta volver a
// entrar. 🔴 Si la base falla, el token sigue como venía: esto nunca tumba el
// login. Puro (la lectura llega inyectada): lo prueba vitest.

export interface TokenIdentity {
  readonly name: string | null;
  readonly picture: string | null;
}

export async function refreshTokenIdentity<T extends { sub?: string; name?: string | null; picture?: string | null }>(
  token: T,
  opts: {
    readonly signingIn: boolean;
    readonly trigger?: string;
    readonly read: (userId: string) => Promise<TokenIdentity | null>;
    readonly warn?: (err: unknown) => void;
  },
): Promise<T> {
  if (!opts.signingIn && opts.trigger !== "update") return token;
  if (!token.sub) return token;
  try {
    const identity = await opts.read(token.sub);
    return identity ? { ...token, name: identity.name, picture: identity.picture } : token;
  } catch (err) {
    opts.warn?.(err);
    return token;
  }
}
