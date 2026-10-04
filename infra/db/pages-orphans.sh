#!/usr/bin/env bash
#
# LAS BASES DE PÁGINAS QUE SE QUEDARON SIN DUEÑO.
#
# Borrar un proyecto desde la app ya se lleva la base de su página
# (lib/backend/teardown.ts). Esto es para lo que no pasa por ahí:
#   · una cuenta borrada a mano en SQL: la cascada se lleva la fila de
#     `projectBackends` (en la base de la app), pero no la base `ol_<ref>`,
#     que vive en el OTRO clúster;
#   · un borrado que falló en el clúster de las páginas: la app lo deja en el
#     registro («no se pudo borrar la base de la página <ref>»).
#
# SIN ARGUMENTOS SÓLO LISTA las bases `ol_<ref>` cuyo `ref` ya no está en
# `projectBackends`. Para borrar hay que nombrarlas, y un `ref` que no esté en
# esa lista (tiene dueño, o no existe) no se toca.
#
# Uso, como root en la caja:
#   scp infra/db/pages-orphans.sh openlen:/tmp/
#   ssh openlen "sudo bash /tmp/pages-orphans.sh"
#   ssh openlen "sudo bash /tmp/pages-orphans.sh --drop <ref> [<ref>…]"

set -euo pipefail

PAGES_PORT="${PAGES_PORT:-5433}"
APP_PORT="${APP_PORT:-5432}"
APP_DB="${APP_DB:-openlen}"

[[ $EUID -eq 0 ]] || { echo "error: hay que correrlo como root" >&2; exit 1; }

psql_pages() { sudo -u postgres psql -p "$PAGES_PORT" -d postgres -X -At -v ON_ERROR_STOP=1 "$@"; }
psql_app() { sudo -u postgres psql -p "$APP_PORT" -d "$APP_DB" -X -At -v ON_ERROR_STOP=1 "$@"; }

# Las dos listas AQUÍ ARRIBA y con su `||`, no dentro de una función llamada
# con $(…): ahí dentro bash no aplica `set -e`, y una lista de la app que
# fallaba salía VACÍA, con lo que todas las bases parecían huérfanas. Medido
# contra un Postgres de prueba el 2026-10-04: borró una base CON dueño.
vivos="$(psql_app -c 'select ref from "projectBackends"')" \
  || { echo "error: no se pudo leer projectBackends de la app; no se toca nada" >&2; exit 1; }
bases="$(psql_pages -c "select substr(datname, 4) from pg_database where datname ~ '^ol_[a-z]{20}\$'")" \
  || { echo "error: no se pudo leer el clúster de las páginas; no se toca nada" >&2; exit 1; }
sin_dueno="$(comm -23 <(printf '%s\n' "$bases" | sed '/^$/d' | LC_ALL=C sort) \
                      <(printf '%s\n' "$vivos" | sed '/^$/d' | LC_ALL=C sort))"

if [[ "${1:-}" == "--drop" ]]; then
  shift
  [[ $# -gt 0 ]] || { echo "error: --drop necesita los ref que borrar" >&2; exit 1; }
  for ref in "$@"; do
    [[ "$ref" =~ ^[a-z]{20}$ ]] || { echo "error: ref no válido: $ref" >&2; exit 1; }
    if ! grep -qx "$ref" <<<"$sin_dueno"; then
      echo "== $ref: no está entre las huérfanas (tiene dueño o no existe), no se toca"
      continue
    fi
    psql_pages -c "drop database if exists ol_$ref with (force)" -c "drop role if exists ol_$ref"
    echo "== ol_$ref: borrada, con su rol"
  done
  exit 0
fi

if [[ -z "$sin_dueno" ]]; then
  echo "== ninguna base de página sin dueño"
  exit 0
fi
echo "== bases de página sin dueño:"
while read -r ref; do
  echo "  $ref  ($(psql_pages -c "select pg_size_pretty(pg_database_size('ol_$ref'))"))"
done <<<"$sin_dueno"
echo "Para borrarlas: sudo bash $0 --drop <ref> [<ref>…]"
