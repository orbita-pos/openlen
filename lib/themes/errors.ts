// A THEME IS INSTALLED, NOT PUBLISHED (spec local 2026-11-27-temas-del-workspace, §4.5; ruling R22): `publishProject`
// throws this for a theme project — its /locale, /themes and preview page would ship as a website —; the gates answer it
// as 409 `project_is_theme`. It holds with themes off too: off, a theme is not installed, and still never a site.
export class ProjectIsThemeError extends Error {
  constructor() {
    super("A theme project is installed, not published.");
    this.name = "ProjectIsThemeError";
  }
}
