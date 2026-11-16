// lib/len-bench/fresh-cookie.ts — a cookie for EACH run, not one for the whole column.
//
// `acunarCookie` (sesion.ts) mints a session that lives 6 h; battery 1's columns run ~9 h. On 16/11 the base
// column's last 27 runs got 401 before Len saw a word: the runner had minted its one cookie at start. Minting is
// local (Auth.js `encode`, no request), so a fresh one per run costs nothing.
//
// Its own file on purpose: sesion.ts is part of the evaluator's fingerprint (evaluator-fingerprint.ts), and how
// long the runner's cookie lives decides nothing about how a run is graded — changing it there would make the
// base and candidate columns of the same battery incomparable.
import type { Entorno } from "./entorno";
import { acunarCookie } from "./sesion";

export function freshCookie(owner: { id: string; email: string }, env: Entorno = process.env): () => Promise<string> {
  return () => acunarCookie({ userId: owner.id, email: owner.email, entorno: env });
}
