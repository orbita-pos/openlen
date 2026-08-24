// Qué fichero del repo corresponde a qué fichero del box.
//
// POR QUÉ EXISTE. El 2026-08-23 Caddy se negó a recargar con el certificado
// nuevo de openlen.app: el hook que da permisos a los certificados tenía
// `openlen.com` escrito a mano y vivía FUERA del repo. Al ir a comprobarlo un
// día después apareció algo peor: el hook sí estaba en el repo, pero en el box
// se llama de OTRA MANERA — `openlen-edge-cert.sh` — así que nadie podía
// compararlos ni con un `diff`. Y `reload-caddy.sh` sólo existía en el box:
// dos líneas, cero copias en control de versiones. Si la máquina se pierde,
// la recuperación en frío no lo restaura porque nadie sabe que existe.
//
// Esta tabla es lo único que sabe que esos pares son pares. `npm run
// infra:drift` la recorre y compara sha256 contra el box.
//
// NO despliega nada. Sólo dice la verdad. Desplegar configuración del box
// sigue siendo un acto deliberado y a mano.

export const BOX_FILES = [
  {
    repo: "infra/caddy/Caddyfile",
    box: "/etc/caddy/Caddyfile",
    nota: "el comodín que sirve *.openlen.com y *.openlen.app",
  },
  {
    repo: "infra/caddy/letsencrypt-deploy-hook.sh",
    box: "/etc/letsencrypt/renewal-hooks/deploy/openlen-edge-cert.sh",
    nota: "OJO: nombre distinto en el box. Ésta es la única línea que lo dice.",
  },
  {
    repo: "infra/caddy/reload-caddy.sh",
    box: "/etc/letsencrypt/renewal-hooks/deploy/reload-caddy.sh",
    nota: "vivió sólo en el box hasta el 2026-08-24",
  },
  {
    repo: "infra/app/openlen-app.service",
    box: "/etc/systemd/system/openlen-app.service",
    nota: "la unidad que corre la app",
  },
];
