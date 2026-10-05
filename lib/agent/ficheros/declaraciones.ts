/**
 * LAS CINCO HERRAMIENTAS DE FICHEROS, TAL COMO LAS VE EL MODELO (Len 2.0).
 *
 * Nombres y parámetros como los de Claude Code (Read, Edit, Write, Grep, Glob;
 * `file_path`, `old_string`, `replace_all`…): es la interfaz que el modelo ya
 * conoce, y cambiarla sería volver a enseñarle un vocabulario.
 *
 * Las DESCRIPCIONES son nuestras (2026-09-27): dicen las mismas reglas de uso
 * con palabras propias. El repo es público y un texto ajeno no puede ir en él.
 *
 * Lo que dicen es lo que hace ESTE sitio: cada fichero es una página, no hay
 * shell ni imágenes que leer, y la expresión de Grep es de JavaScript con los
 * nombres de opción de ripgrep.
 *
 * Tipos en MAYÚSCULAS, como el resto del catálogo: el puente los baja.
 */

// F4 (plans/len-agente-2026): la FORMA de DeepSeek (`packages/fs/tool-fs`
// @639ed01: «Read a UTF-8 text file and return line-numbered content.»): la
// herramienta en una o dos frases y el detalle en sus parámetros. Lo que se
// quitó lo dice otro sitio —el prompt, o el error en el momento en que importa
// («Read it before changing it»)—: regla por regla en
// plans/len-agente-2026/notas/f4-tabla-de-reglas.md (R, E, W, G, GL).

const READ = `Reads a file of this website and returns it with numbered lines. A file longer than about 25,000 tokens comes back in part, with a note saying how to read the rest.`;

const EDIT = `Changes a file of this website by replacing exact text. Read the file in this conversation first: an Edit to a file you have not read is refused.`;

const WRITE = `Creates a file of this website or replaces it whole; writing /<slug>/index.html creates that page. Keep it for a page the request needs and for full rewrites, and change part of a page with Edit. A file that already exists has to be read in this conversation first.`;

const GREP = `Searches the text of this website's files with a regular expression: JavaScript syntax, with ripgrep's option names. By default it lists the files that match; output_mode "content" returns the matching lines.`;

const GLOB = `Lists the files of this website whose path matches a glob pattern, most recently changed first, up to 100.`;

export const DECLARACIONES_DE_FICHEROS: readonly Record<string, unknown>[] = [
  {
    name: "Read",
    description: READ,
    parameters: {
      type: "OBJECT",
      properties: {
        file_path: { type: "STRING", description: "Absolute path of the file, e.g. /index.html or /menu/index.html" },
        offset: { type: "NUMBER", description: "First line to return, counting from 1. To read only part of a long file." },
        limit: { type: "NUMBER", description: "How many lines to return. To read only part of a long file." },
      },
      required: ["file_path"],
    },
  },
  {
    name: "Edit",
    description: EDIT,
    parameters: {
      type: "OBJECT",
      properties: {
        file_path: { type: "STRING", description: "Absolute path of the file to change" },
        old_string: {
          type: "STRING",
          description:
            "The text that is in the file now, character for character, spaces included, and never with the line number and tab that Read puts before each line. It must appear only once in the file, unless replace_all is true.",
        },
        new_string: {
          type: "STRING",
          description: "The text that takes its place (it must differ from old_string; empty deletes old_string)",
        },
        replace_all: { type: "BOOLEAN", description: "Change every copy of old_string instead of exactly one (default false)" },
      },
      required: ["file_path", "old_string", "new_string"],
    },
  },
  {
    name: "Write",
    description: WRITE,
    parameters: {
      type: "OBJECT",
      properties: {
        file_path: {
          type: "STRING",
          description: "Absolute path of the file to save, e.g. /contacto/index.html",
        },
        content: { type: "STRING", description: "The whole content of the file" },
      },
      required: ["file_path", "content"],
    },
  },
  {
    name: "Grep",
    description: GREP,
    parameters: {
      type: "OBJECT",
      properties: {
        pattern: { type: "STRING", description: "Regular expression to look for in the text of the files" },
        path: {
          type: "STRING",
          description: "File or folder to search; leave it out to search the whole site.",
        },
        glob: {
          type: "STRING",
          description: 'Only search files whose path matches this glob, e.g. "*.html" or "menu/*" (rg --glob)',
        },
        output_mode: {
          type: "STRING",
          enum: ["content", "files_with_matches", "count"],
          description:
            '"files_with_matches" (default): the paths of the files that match. "content": the matching lines, where -A/-B/-C, -n and head_limit apply. "count": the number of matches in each file.',
        },
        "-B": {
          type: "NUMBER",
          description: 'Lines of context to show before each match. Only with output_mode "content".',
        },
        "-A": {
          type: "NUMBER",
          description: 'Lines of context to show after each match. Only with output_mode "content".',
        },
        "-C": { type: "NUMBER", description: "Same as context." },
        context: {
          type: "NUMBER",
          description: 'Lines of context on both sides of each match. Only with output_mode "content".',
        },
        "-n": {
          type: "BOOLEAN",
          description: 'Put the line number before each matching line. Only with output_mode "content"; on unless set to false.',
        },
        "-i": { type: "BOOLEAN", description: "Ignore upper and lower case (rg -i)" },
        "-o": {
          type: "BOOLEAN",
          description:
            'Show only the part of each line that matched, one per output line (rg -o). Only with output_mode "content"; off unless set to true.',
        },
        type: {
          type: "STRING",
          description: "Only search files of this type (rg --type). Every file of this website is html.",
        },
        head_limit: {
          type: "NUMBER",
          description:
            "Return at most this many lines, files or counts, whatever the mode. 250 if you leave it out; 0 means no limit — use it sparingly, long results fill your context.",
        },
        offset: {
          type: "NUMBER",
          description: "Skip this many lines or entries before head_limit applies. 0 if you leave it out.",
        },
        multiline: {
          type: "BOOLEAN",
          description: "Let . match line breaks so a pattern can span several lines (rg -U --multiline-dotall). Off unless set to true.",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "Glob",
    description: GLOB,
    parameters: {
      type: "OBJECT",
      properties: {
        pattern: { type: "STRING", description: 'The glob pattern the paths have to match, e.g. "**/*.html" for every page' },
        path: {
          type: "STRING",
          description:
            'Folder to search in. Leave it out to search the whole site, and never send "undefined" or "null"; if you give one, it has to exist.',
        },
      },
      required: ["pattern"],
    },
  },
];
