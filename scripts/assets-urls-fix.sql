-- LAS URLS DE localhost QUE QUEDARON DENTRO DE LAS PÁGINAS — 2026-08-30.
--
-- Acompaña a `a80deb82` (que arregló las subidas NUEVAS) y a `npm run assets:r2`
-- (que subió a R2 los 97 ficheros que ya estaban en el disco del servidor).
-- Esto es el tercer paso: las páginas guardadas siguen apuntando a localhost.
--
-- DOS CLASES, y se descubrió que eran dos al mirar:
--
--   ·  /api/projects/<id>/assets/<f>  → la foto que subió el DUEÑO.
--      Vive en R2 con la clave <id>/<f> — la misma forma que tenía en disco,
--      así que la reescritura es mecánica.
--   ·  /openlen-images/<n>            → el catálogo curado NUESTRO.
--      Su casa es images.openlen.com. Verificadas las 4: HTTP 200.
--
-- SE REESCRIBE EL `data` ENTERO COMO TEXTO, no `data->>'html'`: una de las
-- páginas tiene la URL rota en `data.pages` (una subpágina), y recorriendo sólo
-- la Home se habría quedado fuera. Es seguro porque la sustitución sólo toca el
-- PREFIJO —el nombre del fichero y cualquier entidad HTML pegada detrás
-- (`&quot;`) se quedan como están— y las URLs no llevan comillas, que es lo
-- único que el escapado de JSON cambiaría. Comprobado antes de aplicar: el JSON
-- vuelve a parsear y la clave `html` sigue existiendo en las 7 filas.
--
-- SE INCLUYE EL HISTORIAL (`projectVersions`, 107 filas). No es reescribir el
-- pasado: esas URLs no funcionaron NUNCA para nadie. Dejarlas significaría que
-- «Volver a esta versión» devuelve la foto rota.
--
-- NO SE TOCA `publishedHtml` — se comprobó y no tiene ninguna (0 filas), porque
-- publicar hornea las imágenes.
--
-- IDEMPOTENTE: al terminar no queda un solo `localhost:3000`, así que una
-- segunda pasada no encuentra nada que cambiar.
--
--   ssh openlen "sudo -u postgres psql -d openlen -f -" < scripts/assets-urls-fix.sql

\set ON_ERROR_STOP on

BEGIN;

-- Antes.
SELECT 'ANTES' AS cuando,
       (SELECT count(*) FROM projects WHERE data::text LIKE '%localhost:3000%') AS proyectos,
       (SELECT count(*) FROM "projectVersions" WHERE html LIKE '%localhost:3000%') AS versiones;

UPDATE projects
SET data = regexp_replace(
             regexp_replace(
               data::text,
               'https?://localhost:[0-9]+/api/projects/([^/]+)/assets/',
               'https://uploads.openlen.com/\1/',
               'g'),
             'https?://localhost:[0-9]+/openlen-images/',
             'https://images.openlen.com/',
             'g')::jsonb
WHERE data::text LIKE '%localhost:3000%';

UPDATE "projectVersions"
SET html = regexp_replace(
             regexp_replace(
               html,
               'https?://localhost:[0-9]+/api/projects/([^/]+)/assets/',
               'https://uploads.openlen.com/\1/',
               'g'),
             'https?://localhost:[0-9]+/openlen-images/',
             'https://images.openlen.com/',
             'g')
WHERE html LIKE '%localhost:3000%';

-- Después. Las dos cifras tienen que ser 0.
SELECT 'DESPUES' AS cuando,
       (SELECT count(*) FROM projects WHERE data::text LIKE '%localhost:3000%') AS proyectos,
       (SELECT count(*) FROM "projectVersions" WHERE html LIKE '%localhost:3000%') AS versiones;

COMMIT;
