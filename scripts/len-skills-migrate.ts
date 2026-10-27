// LAS SKILLS DE LEN (spec local 2026-10-26-len-skills): la tabla de las skills que un proyecto y
// una persona guardan en /.len/skills y ~/.len/skills. Idempotente (IF NOT EXISTS). Sin clave
// foránea: `ownerId` es un proyecto o una persona, según `scope`.
//
// 🔴 OBLIGATORIA en el mismo deploy que el código: sin la tabla, Len no puede guardar skills
// (fail-soft: la lectura devuelve ninguna y las de OpenLen siguen).
//
// Run: npm run len-skills:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";
import { CREATE_LEN_SKILLS } from "./len-skills-migrate-sql";

async function main() {
  for (const statement of CREATE_LEN_SKILLS) await db.execute(sql.raw(statement));
  console.log("[len-skills:migrate] lenSkills lista.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[len-skills:migrate] falló", err);
  process.exit(1);
});
