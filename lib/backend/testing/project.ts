// Un proyecto de prueba entero: la base (PGlite) montada como la de Supabase,
// sus claves, su configuración de auth con los valores por defecto de GoTrue
// y un buzón que guarda los correos en vez de mandarlos.

import type { PGlite } from "@electric-sql/pglite";

import { defaultAuthConfig, type AuthMail } from "../auth/config";
import { hashSecretKey, newJwtSecret, newPublishableKey, newSecretKey } from "../keys";
import type { BackendProject } from "../router";
import { CLUSTER_ROLES_SQL, initProjectDatabase } from "../schema";
import { asRole, newTestDatabase, pgliteProjectDatabase } from "./pglite";

export const TEST_REF = "abcdefghijklmnopqrst";
export const TEST_URL = `https://${TEST_REF}.openlen.app`;
export const TEST_SITE = "https://tienda.openlen.app";

export interface TestProject {
  readonly pg: PGlite;
  readonly project: BackendProject;
  readonly secretKey: string;
  readonly mails: AuthMail[];
}

export async function newTestProject(migration: string): Promise<TestProject> {
  const { pg, runner } = newTestDatabase();
  const dev = `ol_${TEST_REF}`;
  await runner.exec(CLUSTER_ROLES_SQL);
  await runner.exec(`create role ${dev} nologin noinherit`);
  await initProjectDatabase(runner, { devRole: dev });
  if (migration) {
    const r = await asRole(pg, dev, null, (q) => q(migration));
    if (r && typeof r === "object" && "error" in r) throw new Error(String(r.error));
  }
  const secretKey = newSecretKey();
  const mails: AuthMail[] = [];
  const project: BackendProject = {
    ref: TEST_REF,
    publishableKey: newPublishableKey(),
    secretKeyHash: hashSecretKey(secretKey),
    jwtSecret: newJwtSecret(),
    db: pgliteProjectDatabase(pg),
    auth: {
      config: { ...defaultAuthConfig(`${TEST_URL}/auth/v1`), siteUrl: TEST_SITE },
      sendMail: async (m) => {
        mails.push(m);
      },
    },
  };
  return { pg, project, secretKey, mails };
}
