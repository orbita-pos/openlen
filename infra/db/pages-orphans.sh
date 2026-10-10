#!/usr/bin/env bash
#
# LAS BASES DE PÁGINAS QUE SE QUEDARON SIN DUEÑO.
#
# Borrar un proyecto desde la app ya se lleva sus bases (lib/backend/teardown.ts).
# Esto es para lo que no pasa por ahí:
#   · una cuenta borrada a mano en SQL: la cascada se lleva las filas de
#     `projectBackends` y `projectBackendEnvironments` (en la base de la app),
#     pero no las bases, que viven en el OTRO clúster;
#   · un borrado que falló en el clúster de las páginas: la app lo deja en el
#     registro («no se pudo borrar la base de la página <scope>»);
#   · una primera publicación que falló y no pudo deshacer su producción.
#
# Desde el 2026-10-09 (spec local 2026-10-09-borrador-y-produccion-de-datos) un
# proyecto tiene hasta DOS bases: `ol_<scope>`, donde el scope es `<ref>` (la
# base de antes), `<ref>_d` (pruebas) o `<ref>_l` (producción). Una es huérfana
# si su `ref` ya no está en `projectBackends`, o si es de un entorno (`_d`/`_l`)
# que ya no figura en `projectBackendEnvironments`.
#
# SIN ARGUMENTOS SÓLO LISTA las huérfanas. Para borrar hay que nombrarlas por su
# scope, y uno que no esté en esa lista (tiene dueño, o no existe) no se toca.
#
# Uso, como root en la caja:
#   scp infra/db/pages-orphans.sh openlen:/tmp/
#   ssh openlen "sudo bash /tmp/pages-orphans.sh"
#   ssh openlen "sudo bash /tmp/pages-orphans.sh --drop <scope> [<scope>…]"
# Prueba (sin Postgres): bash infra/db/pages-orphans.test.sh

# Los scopes sin dueño, uno por línea. Pura: la prueba la carga con `source`.
#   huerfanas <scopes de las bases> <refs vivos> <scopes vivos>
huerfanas() {
  local bases="$1" refs="$2" scopes="$3" s ref
  while read -r s; do
    [[ -n "$s" ]] || continue
    ref="${s:0:20}"
    if ! grep -qx "$ref" <<<"$refs"; then
      echo "$s"
      continue
    fi
    if [[ "$s" != "$ref" ]] && ! grep -qx "$s" <<<"$scopes"; then
      echo "$s"
    fi
  done <<<"$bases"
}

# Cargado con `source` (la prueba): sólo la función.
[[ "${BASH_SOURCE[0]}" == "$0" ]] || return 0

set -euo pipefail

PAGES_PORT="${PAGES_PORT:-5433}"
APP_PORT="${APP_PORT:-5432}"
APP_DB="${APP_DB:-openlen}"

[[ $EUID -eq 0 ]] || { echo "error: hay que correrlo como root" >&2; exit 1; }

psql_pages() { sudo -u postgres psql -p "$PAGES_PORT" -d postgres -X -At -v ON_ERROR_STOP=1 "$@"; }
psql_app() { sudo -u postgres psql -p "$APP_PORT" -d "$APP_DB" -X -At -v ON_ERROR_STOP=1 "$@"; }

# Las listas AQUÍ ARRIBA y con su `||`, no dentro de una función llamada con
# $(…): ahí dentro bash no aplica `set -e`, y una lista de la app que fallaba
# salía VACÍA, con lo que todas las bases parecían huérfanas. Medido contra un
# Postgres de prueba el 2026-10-04: borró una base CON dueño.
vivos="$(psql_app -c 'select ref from "projectBackends"')" \
  || { echo "error: no se pudo leer projectBackends de la app; no se toca nada" >&2; exit 1; }
hay_entornos="$(psql_app -c "select to_regclass('public.\"projectBackendEnvironments\"') is not null")" \
  || { echo "error: no se pudo mirar la app; no se toca nada" >&2; exit 1; }
scopes_vivos=""
if [[ "$hay_entornos" == "t" ]]; then
  scopes_vivos="$(psql_app -c 'select scope from "projectBackendEnvironments"')" \
    || { echo "error: no se pudo leer projectBackendEnvironments de la app; no se toca nada" >&2; exit 1; }
fi
bases="$(psql_pages -c "select substr(datname, 4) from pg_database where datname ~ '^ol_[a-z]{20}(_[dl])?\$' order by 1")" \
  || { echo "error: no se pudo leer el clúster de las páginas; no se toca nada" >&2; exit 1; }
sin_dueno="$(huerfanas "$bases" "$vivos" "$scopes_vivos")"

if [[ "${1:-}" == "--drop" ]]; then
  shift
  [[ $# -gt 0 ]] || { echo "error: --drop necesita los scope que borrar" >&2; exit 1; }
  for s in "$@"; do
    [[ "$s" =~ ^[a-z]{20}(_[dl])?$ ]] || { echo "error: scope no válido: $s" >&2; exit 1; }
    if ! grep -qx "$s" <<<"$sin_dueno"; then
      echo "== $s: no está entre las huérfanas (tiene dueño o no existe), no se toca"
      continue
    fi
    psql_pages -c "drop database if exists ol_$s with (force)" -c "drop role if exists ol_${s}_ro"
    echo "== ol_$s: borrada, con su rol de lectura"
    # El rol de desarrollador es uno por PROYECTO: sólo cuando su ref ya no
    # existe y no le queda ninguna base.
    ref="${s:0:20}"
    if ! grep -qx "$ref" <<<"$vivos"; then
      quedan="$(psql_pages -c "select count(*) from pg_database where datname ~ '^ol_${ref}(_[dl])?\$'")"
      if [[ "$quedan" == "0" ]]; then
        psql_pages -c "drop role if exists ol_$ref"
        echo "== ol_$ref: rol del proyecto borrado"
      fi
    fi
  done
  exit 0
fi

if [[ -z "$sin_dueno" ]]; then
  echo "== ninguna base de página sin dueño"
  exit 0
fi
echo "== bases de página sin dueño:"
while read -r s; do
  echo "  $s  ($(psql_pages -c "select pg_size_pretty(pg_database_size('ol_$s'))"))"
done <<<"$sin_dueno"
echo "Para borrarlas: sudo bash $0 --drop <scope> [<scope>…]"
