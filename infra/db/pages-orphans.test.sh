#!/usr/bin/env bash
#
# Prueba de `huerfanas` (pages-orphans.sh): qué bases del clúster de las páginas
# se quedaron sin dueño, también las de los entornos `_d`/`_l` (spec local
# 2026-10-09-borrador-y-produccion-de-datos). Sin Postgres ni root: carga el
# script con `source`, que se corta antes de hacer nada.
#
# Uso: bash infra/db/pages-orphans.test.sh

set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=pages-orphans.sh
source "$here/pages-orphans.sh"

fallos=0
igual() { # igual <nombre> <esperado> <obtenido>
  if [[ "$2" == "$3" ]]; then
    echo "ok   $1"
  else
    echo "FAIL $1"
    echo "     esperado: $(printf '%s' "$2" | tr '\n' ' ')"
    echo "     obtenido: $(printf '%s' "$3" | tr '\n' ' ')"
    fallos=$((fallos + 1))
  fi
}

A=aaaaaaaaaaaaaaaaaaaa # vivo, de antes (sin entornos)
B=bbbbbbbbbbbbbbbbbbbb # vivo, con borrador y producción
C=cccccccccccccccccccc # su proyecto ya no existe
D=dddddddddddddddddddd # vivo, pero su producción quedó a medias (sin fila de entorno)

bases="$A
${B}_d
${B}_l
${C}
${C}_d
${D}_d
${D}_l"
refs="$A
$B
$D"
scopes="${B}_d
${B}_l
${D}_d"

igual "una base de antes con dueño no es huérfana" "" "$(huerfanas "$A" "$refs" "$scopes")"
igual "los entornos con fila no son huérfanos" "" "$(huerfanas "${B}_d
${B}_l" "$refs" "$scopes")"
igual "sin projectBackends: todas las de su ref" "$C
${C}_d" "$(huerfanas "$C
${C}_d" "$refs" "$scopes")"
igual "un entorno sin su fila, aunque el proyecto viva" "${D}_l" "$(huerfanas "${D}_d
${D}_l" "$refs" "$scopes")"
igual "todo junto" "$C
${C}_d
${D}_l" "$(huerfanas "$bases" "$refs" "$scopes")"
igual "sin tabla de entornos (antes de migrar): sólo cuenta el ref" "$C
${C}_d" "$(huerfanas "$A
$C
${C}_d" "$refs" "")"

[[ $fallos -eq 0 ]] && echo "== todo bien" || { echo "== $fallos fallos"; exit 1; }
