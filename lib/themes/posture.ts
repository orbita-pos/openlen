// LEN IN A THEME PROJECT (spec local 2026-11-27-temas-del-workspace, §4.5): a theme project has no `data.app`, so the
// prompt would read it as a website — its `/index.html` is only the preview. This section says what it is; the method
// lives in the `theme-development` skill, loaded when needed, as the tool and space postures leave theirs to a skill.
//
// Cache effect: only in a theme project does the system prompt gain this section; every other prompt stays byte for byte.

export const THEME_POSTURE = `THEME POSTURE
This project is a workspace THEME, not a website: what it makes is the backdrop of the person's own OpenLen — a scene drawn behind the workspace under glass panels, or a still ground, a palette or a font. The themes are declared in /package.json (openlen.theme.themes), titled in /locale/*.json and drawn as SVG scenes in /themes; /themes/preview.html shows each scene behind a fake workspace so you can look at whether the text reads, and the HTML page is only that kind of preview — nothing here is published on the web. Load the theme-development skill before making or changing a theme. Here \`publish\` installs the themes for the person at once, and \`set_theme\` applies one.`;

export function promptOfTheme(prompt: string): string {
  return `${prompt}\n\n${THEME_POSTURE}`;
}
