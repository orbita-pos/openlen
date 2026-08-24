#!/usr/bin/env bash
# Deja los certificados legibles para los servicios que los sirven, después de
# cada rotación. Va en /etc/letsencrypt/renewal-hooks/deploy/.
#
# POR QUÉ EXISTE. certbot recrea los enlaces de live/ apuntando a ficheros
# nuevos en archive/, con permisos 600 root:root. Los servicios que sirven TLS
# —caddy, openlen-edge— NO corren como root, así que el chgrp/chmod anterior no
# sobrevive a una renovación: hay que re-aplicarlo aquí.
#
# 🔴 POR QUÉ RECORRE TODOS LOS CERTIFICADOS Y NO UNA LISTA. La versión anterior
# tenía `openlen.com` escrito a mano. El 2026-08-23, al emitir el certificado de
# `openlen.app`, Caddy se negó a recargar:
#
#     open /etc/letsencrypt/live/openlen.app/privkey.pem: permission denied
#
# Producción no se cayó —Caddy rechazó la config nueva y siguió con la vieja,
# que es el fallo correcto— pero el modo de fallo importa: una lista escrita a
# mano convierte "emitir un certificado" en "emitir un certificado Y acordarse
# de editar un hook que vive fuera del repo". Nadie se acuerda. Recorriendo
# live/ el problema desaparece: un certificado nuevo queda cubierto por existir.
#
# El grupo `ssl-cert` es el que ya usan caddy, openlen-edge y postgres. Dar
# lectura de grupo a un certificado a los servicios que lo sirven es el patrón
# previsto, no una concesión.
set -euo pipefail

GROUP=ssl-cert

for live in /etc/letsencrypt/live/*/; do
  name=$(basename "$live")
  [[ "$name" == "README" ]] && continue
  archive="/etc/letsencrypt/archive/$name"

  for f in "$live"fullchain.pem "$live"privkey.pem \
           "$archive"/fullchain*.pem "$archive"/privkey*.pem; do
    [[ -e "$f" ]] || continue
    chgrp "$GROUP" "$f"
    chmod 640 "$f"
  done

  # Los directorios tienen que ser atravesables o el `open` falla aunque el
  # fichero esté bien: certbot los deja 755 (live) y 700 (archive).
  for d in "$live" "$archive"; do
    [[ -d "$d" ]] || continue
    chgrp "$GROUP" "$d"
    chmod 750 "$d"
  done
done

# El vigilante del edge detecta el cambio de inodo por su cuenta — no hace falta
# SIGHUP. Si algún día pasa a sondeo, el disparo de recarga iría aquí.
#
# Caddy lo recarga `reload-caddy.sh`, el otro hook de este directorio.
exit 0
