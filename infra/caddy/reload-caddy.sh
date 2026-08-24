#!/usr/bin/env bash
# Recarga Caddy tras una rotación de certificado. Va en
# /etc/letsencrypt/renewal-hooks/deploy/, junto a letsencrypt-deploy-hook.sh
# (que en el box se llama openlen-edge-cert.sh).
#
# POR QUÉ ESTÁ AQUÍ. Hasta el 2026-08-24 este fichero existía SÓLO en el box.
# Dos líneas, ninguna copia en control de versiones: si la máquina se pierde,
# los certificados rotan y Caddy sigue sirviendo el viejo hasta que caduque.
# El plan de recuperación en frío no lo habría restaurado porque nadie sabía
# que existía.
systemctl reload caddy 2>/dev/null || true
