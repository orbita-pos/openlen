// THE GAME MODE (spec local 2026-11-05-modo-juego-design, §8.1): what makes a project a game. Client-safe: no
// server imports.

/** Present on `ProjectData.game` = the project is a GAME: an app (`data.app`) whose turns carry Len's game
 *  posture. The engine isn't kept here: it is in the project's /package.json, as in any npm project. */
export interface GameOfProject {
  readonly bornAt: string;
}
