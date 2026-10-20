/** Len 3.0's switch, alone so a route can read it without loading the runtime. */
export const artifactsEnabled = (env: Readonly<Record<string, string | undefined>> = process.env): boolean => env.OPENLEN_ARTIFACTS === "1";
