/** Header policy is enforced by the separate preview origin as well as by
 * exported documents. Authored meta tags cannot loosen the response header. */
export const ARTIFACT_CSP = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'";
