/** Skills (spec local 2026-10-26-len-skills, §4.10): on by default, like the terminal; only the literal "0" turns them off. */
export function skillsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_SKILLS !== "0";
}
