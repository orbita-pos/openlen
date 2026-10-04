// lib/agent/stores-doc.ts — /.openlen/docs/api-d.md: `data-ol-stores`, la forma
// de guardar datos de ANTES del backend de Supabase (plans/pages-backend/design.md).
//
// Sólo para las páginas que ya declaran un bloque: siguen funcionando con
// /api/d mientras existan. Lo nuevo va al backend del proyecto (THE BACKEND, en
// el manual). El texto se MUDÓ, no se reescribió: los dos párrafos de la sección
// STORES del manual, la frase del almacén de WHAT EXISTS AND WHAT DOESN'T y las
// dos líneas del JavaScript de la cláusula `agente` (lib/ai/js-clause.ts), tal
// como los leía Len hasta el 2026-10-04. Lo que
// decía la cláusula sobre la línea de /api/d viene con ella:
//
// 🔴 `/api/d/<almacén>`, SIN subdominio (2026-09-18). Decía
// `/api/d/<sub>/<almacén>`, y un borrador no sabe con qué subdominio se
// publicará: en producción Len puso «carrito» en ese hueco y el carrito
// no guardó nada. La ruta sin subdominio lo saca del host
// (`app/api/d/[sub]/route.ts`). Y lo de `propio` es el otro medio fallo
// de ese día: un POST por producto, que se reemplazaban entre sí.

export const STORES_DOC = `# data-ol-stores: the older way a page keeps data

ONLY for a page that already declares a \`<script type="application/json" data-ol-stores>\` block: it keeps working. Anything new goes in the project's Supabase backend (THE BACKEND, in /AGENTS.md).

A STORE keeps real data on the server —a dish on the menu, a product in the catalog, a review— and survives reloads and republishing. It is DECLARED in the page, with Edit: a \`<script type="application/json" data-ol-stores>\` block inside the <body>, outside any section that could be deleted, which says what fields it has and who may touch them. Its shape: {"menu":{"visitante":"lectura","campos":{"plato":"texto","precio":"numero"}}}. \`visitante\` is "lectura" (you maintain it, the visitor only reads it — the normal case for a menu or a catalog), "propio" (each visitor writes and reads THEIR OWN — a cart), "publico" (anyone writes and EVERYONE reads it — REVIEWS, comments, a wall: it is published at once and everybody sees it, as on Mercado Libre) or "añadir" (the visitor creates and does NOT read what others left — a sign-up form, where what each one leaves is private). The types are texto, numero, booleano, fecha and lista.
What is saved in a store lives on the server: in "propio" mode each visitor sees their own, and the user sees all of it in the editor, in the "Data" view (not in the Inbox, which is for forms).
Once declared, each store is a FILE: /datos/<store>.json, the list of its rows with their id. Read it with Read and change it with Edit or Write like any file: a row without an id is new, the one you change gets updated and the one you remove gets deleted. Everything is checked before anything is saved —a field the store doesn't declare, or a value of the wrong type, comes back to you as an error—. If the store doesn't exist yet, declare the block with Edit and write its file in the SAME turn. For the content of a "lectura" store to show on the published page, leave a container with data-ol-datos="<name>" where you want it to appear.

SAVING TOO: declare a store in the page (the data-ol-stores block) and your JavaScript writes and reads with fetch to /api/d/<store> —relative and WITHOUT a subdomain: the server knows which page it comes from— — a cart that survives reloads, a menu the user maintains, reviews that visitors leave. GET returns {documentos:[{id,doc}]}; a POST with the document as JSON saves it. In a "propio" store each visitor has ONE single document and every POST REPLACES it: the cart goes WHOLE in a field of type lista, with one POST per change —never one per product, since they overwrite each other and only the last one stays—, and it is read with GET when the page loads.
CHECK THE SERVER'S RESPONSE: the POST can say NO —507 if the user has filled their quota, 413 if the document is over 16 KB, and the network can fail—. If it doesn't come back \`ok\`, tell the visitor ON THE PAGE and don't leave the change painted as saved (undo it, or paint it only once the server answers well). Painting first and not looking at the response is how someone loses their cart without noticing.
`;
