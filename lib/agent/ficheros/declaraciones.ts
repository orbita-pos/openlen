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

const EL_SITIO =
  "- This website's files are its pages: /index.html is the home page and /<slug>/index.html is each other page.";

const READ = `Returns one file of this website as numbered lines: each line starts with its number (counting from 1) and a tab, followed by the text of that line. Any file of the site can be read directly with it.

${EL_SITIO}
- Give file_path as an absolute path, such as /index.html. When the user names a path, take it as right and read it.
- With no offset or limit you get the whole file, up to about 25,000 tokens; a longer one comes back in part, with a note saying how to read the rest. offset is the first line to return and limit how many lines.
- If only one part of the file matters for what you are doing, ask for just that part with offset and limit: on a long page it saves a lot.
- Asking for a file that does not exist just returns an error, so you can try a path you are unsure of.
- Folders cannot be read; Glob tells you which files exist.
- An empty file comes back as a warning instead of contents.
- Do NOT Read a file again to check an Edit or a Write you just made: a change that did not apply returns an error, and the saved state of the file is tracked for you.`;

const EDIT = `Changes one exact piece of text in a file of this website: old_string is what is there now, new_string is what should be there instead.

- You MUST Read the file at least once in this conversation before editing it. Editing a file you have not read is refused.
- old_string must match the file character for character, spaces and tabs included. When you copy it from what Read showed you, leave out the number and the tab at the start of each line: they only mark the line and are not part of the file. NEVER put any of that number or tab in old_string or new_string.
- old_string has to point at a single place. If the same text appears more than once the edit is refused: add a little of the surrounding text until it is unique, or set replace_all to true to change every copy (for example a phone number repeated in the header and the footer, or a name to rename all over the page).
- ALWAYS change the pages that already exist with Edit. NEVER create a new file unless the request really needs a new page.
- No emojis in the files unless the user asks for them.`;

const WRITE = `Saves a whole file of this website with the content you give it: a new page, or a page rewritten from top to bottom.

- If the path already exists, that file is replaced. You MUST have read it in this conversation first; replacing a file you have not read is refused.
- To change part of a page that exists, ALWAYS use Edit instead, which sends only what changes. Keep Write for new pages and for full rewrites.
${EL_SITIO} Writing a new /<slug>/index.html creates that page.
- No emojis in the files unless the user asks for them.`;

const GREP = `Searches the text of this website's files with a regular expression. The expression is JavaScript's, with its full syntax; the options keep ripgrep's names.

- ALWAYS use Grep when you need to find something across the site: a phone number, a price, a class name, every link to a page.
- Example patterns: "wa\\.me/\\d+", "precio.*€".
- output_mode decides what comes back: "files_with_matches" (the default) lists the files that contain a match, "content" the matching lines themselves, "count" how many matches each file has.
- Limit which files are searched with glob (e.g. "*.html", "menu/*") or type (e.g. "html").
- A match stays within one line unless multiline is true, which you need for something like \`<form[\\s\\S]*?</form>\`.`;

const GLOB = `Lists the files of this website whose path matches a glob pattern, the most recently changed first: "**/*.html" gives every page, "*/index.html" every page except the home page. At most 100 paths come back; if there are more, the result says so. Use it to find out which pages and files exist.`;

export const DECLARACIONES_DE_FICHEROS: readonly Record<string, unknown>[] = [
  {
    name: "Read",
    description: READ,
    parameters: {
      type: "OBJECT",
      properties: {
        file_path: { type: "STRING", description: "Absolute path of the file, e.g. /index.html or /menu/index.html" },
        offset: {
          type: "NUMBER",
          description: "Line to start from. Use it only when the file is too long to read in one go.",
        },
        limit: {
          type: "NUMBER",
          description: "How many lines to return. Use it only when the file is too long to read in one go.",
        },
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
        old_string: { type: "STRING", description: "The exact text that is in the file now" },
        new_string: {
          type: "STRING",
          description: "The text that takes its place (it must differ from old_string)",
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
          description: 'Lines of context to show before and after each match. Only with output_mode "content".',
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
        pattern: { type: "STRING", description: "The glob pattern the file paths have to match" },
        path: {
          type: "STRING",
          description:
            'Folder to search in. IMPORTANT: to search the whole site, leave the field out entirely; NEVER send "undefined" or "null" as a value. If you give it, it has to be a folder that exists.',
        },
      },
      required: ["pattern"],
    },
  },
];
