// lib/agent/accounts-doc.ts — /.openlen/docs/accounts.md: lo que lee Len para
// construir una página donde la gente ENTRA Y SALE (plans/page-accounts/design.md).
//
// Es DOCUMENTACIÓN de nuestra API, no una regla: qué papeles hay, quién entra y
// cómo se ve lo decide Len según lo que pida el dueño (memoria
// `openlen-se-adapta-a-len`). Lo único que manda es lo que la seguridad exige y
// el modelo no puede adivinar: la forma de los bloques, las rutas y que lo que
// escribió un extraño no se pinta con innerHTML.
//
// En inglés, como todo lo que lee Len. Cada dato sale del código y tiene que
// seguir siéndolo: las rutas de app/api/a/, `permite()` de
// lib/page-data/permisos.ts, `MAX_ROWS_SIGNED_IN` de lib/page-data/cuota.ts y
// `isValidPassword` de lib/auth/visitor-password.ts. Lo sujeta
// accounts-doc.test.ts.

import { MAX_FILAS_VISITANTE, MAX_ROWS_SIGNED_IN } from "@/lib/page-data/cuota";

const miles = (n: number) => n.toLocaleString("en-US");

export const ACCOUNTS_DOC = `# Accounts: people who sign in to the page

ACCOUNTS let people come in and leave with an email and a password —the cashiers of a till, the members of a club, the staff of a clinic— and let a store be reached only by them. The page's owner, your user, always exists and can do everything: they are not declared.

DECLARE THEM in /index.html (the home page; a block on another page doesn't count), next to the data-ol-stores block and with the same care —inside the <body>, outside any section that could be deleted—:
<script type="application/json" data-ol-accounts>{"registro":"cerrado","papeles":["cajero"]}</script>
- "registro": "cerrado" means only the owner creates accounts. It is the only kind that works today.
- "papeles": the role names this page uses, in lowercase (letters, digits, - and _). A role gives nothing by itself: each store says what it gives.
The server reads the block from the PUBLISHED page. Until it is published, and on any page without it, the routes below answer 404 {"error":"accounts_not_declared"}; taking the block out signs everyone out.

WHAT EACH ROLE MAY DO is written in each store, under "papeles":
{"ventas":{"visitante":"privado","papeles":{"cajero":{"leer":"propios","crear":"propios"}},"campos":{"total":"numero","fecha":"fecha"}},"productos":{"visitante":"lectura","papeles":{"cajero":["modificar"]},"campos":{"nombre":"texto","precio":"numero","existencias":"numero"}}}
- "visitante":"privado": whoever has not signed in reaches NOTHING in that store, not even to read it.
- For each role, the actions "leer", "crear", "modificar" and "borrar", each one "todos" (every row) or "propios" (only the rows that same account wrote). ["leer","crear"] is short for both with "todos".
- Someone signed in can always do what an anonymous visitor can, plus what their role adds. The owner reaches every row of every store.
- A role or an action the store doesn't recognise discards the WHOLE store, so check the spelling.
- To change one row —the stock after a sale— send PATCH /api/d/<store>?id=<id> with only the fields that change; the rest of the row stays as it was. Without ?id=, PATCH saves the same as POST.
- A GET returns up to ${miles(MAX_ROWS_SIGNED_IN)} rows to someone signed in and ${miles(MAX_FILAS_VISITANTE)} to an anonymous visitor, newest first.

THE ROUTES are relative and carry no subdomain, like /api/d: the server knows which page is asking. They all answer JSON.
- GET /api/a/me → {"account":{"id","email","name","role"} or null, "owner":true or false}. Ask it when the page loads and show what fits: the sign-in form, the till, the owner's screen.
- POST /api/a/login with {"email","password"} → {"account":{…}}, and from then on the browser keeps the session by itself. A wrong email and a wrong password get the same 401 {"error":"invalid_credentials"}; too many attempts, 429.
- POST /api/a/logout ends the session.
- POST /api/a/password with {"current","next"} changes the password of whoever is signed in; "next" needs 8 characters or more, and the current one is asked for on purpose.
- The owner comes in with their OpenLen account, never with a password of this page: an ordinary link to /api/a/owner-start?back=/<path> takes them through OpenLen and back to that path, already in.
- With the owner signed in, the page can look after the accounts: GET /api/a/accounts lists them; POST /api/a/accounts with {"email","password","name","role"} creates one (409 "email_taken" if that email already has one, 422 "unknown_role" if the page doesn't declare that role); PATCH /api/a/accounts/<id> with "role", "name" or "password" changes it; DELETE /api/a/accounts/<id> removes it. Anyone else gets 403 "owner_only".
- The session lives in a cookie only the browser can see: a fetch from the page sends it on its own. Don't keep a token in localStorage or send one yourself.

TEXT SOMEONE ELSE WROTE —a review, a comment, a customer's name— goes into the page with textContent, never with innerHTML: on a page with accounts, HTML written by a stranger would run with the session of whoever is looking at it.`;
