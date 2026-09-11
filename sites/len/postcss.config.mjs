// Sin este fichero, postcss-load-config sube por el árbol y encuentra el
// postcss.config.mjs de la app (Tailwind + autoprefixer). No rompía nada
// —Tailwind con `content` vacío no emite ni un byte— pero acopla esta web a la
// configuración de la app y llena cada build de avisos. Aquí no hay Tailwind:
// el CSS está escrito a mano, y el único prefijo que hace falta
// (-webkit-backdrop-filter) va puesto en globals.css.
export default { plugins: {} };
