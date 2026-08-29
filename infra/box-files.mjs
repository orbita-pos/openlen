// Qué fichero del repo corresponde a qué fichero del box.
//
// POR QUÉ EXISTE. El 2026-08-23 Caddy se negó a recargar con el certificado
// nuevo de openlen.app: el hook que da permisos tenía `openlen.com` escrito a
// mano y vivía FUERA del repo. Al ir a comprobarlo apareció algo peor: el hook
// sí estaba en el repo, pero en el box se llama de OTRA MANERA
// —`openlen-edge-cert.sh`— así que nadie podía compararlos ni con un `diff`.
//
// POR QUÉ ESTÁN TODAS LAS UNIDADES Y NO SÓLO LAS INTERESANTES. La primera
// versión de esta tabla listaba cuatro ficheros. Horas después, un barrido a
// mano encontró que `openlen-edge.service` había DERIVADO: el repo llevaba el
// arreglo del límite de reintentos —con un comentario explicando la trampa— y
// el box seguía con la versión rota. La tabla no lo vio porque el fichero no
// estaba en ella. Un guardián con un punto ciego da la tranquilidad de un
// guardián sin darla.
//
// La regla, entonces: si un fichero de configuración existe en el repo Y en el
// box, va en esta lista. Sin excepciones "porque ése no cambia nunca".
//
// `npm run infra:drift` la recorre y compara sha256 contra el box. Sólo lee:
// desplegar configuración del box sigue siendo un acto deliberado y a mano.

export const BOX_FILES = [
  // ── Caddy y los hooks de certificados ────────────────────────────────────
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

  // ── Unidades y temporizadores de systemd ─────────────────────────────────
  { repo: "infra/app/openlen-analytics-rollup.service", box: "/etc/systemd/system/openlen-analytics-rollup.service" },
  { repo: "infra/app/openlen-analytics-rollup.timer", box: "/etc/systemd/system/openlen-analytics-rollup.timer" },
  { repo: "infra/app/openlen-app.service", box: "/etc/systemd/system/openlen-app.service" },
  { repo: "infra/app/openlen-backup-system.service", box: "/etc/systemd/system/openlen-backup-system.service" },
  { repo: "infra/app/openlen-backup-system.timer", box: "/etc/systemd/system/openlen-backup-system.timer" },
  { repo: "infra/app/openlen-backup.service", box: "/etc/systemd/system/openlen-backup.service" },
  { repo: "infra/app/openlen-backup.timer", box: "/etc/systemd/system/openlen-backup.timer" },
  // Reservas salió el 2026-08-29 (su timer llevaba 8 días fallando). Las dos
  // unidades se borraron del repo Y de la caja; dejarlas aquí hacía que
  // `infra:drift` reventara con ENOENT en vez de comparar nada — una guarda
  // que revienta no vigila.
  { repo: "infra/edge/openlen-edge.service", box: "/etc/systemd/system/openlen-edge.service" },
  { repo: "infra/app/openlen-live-republish.service", box: "/etc/systemd/system/openlen-live-republish.service" },
  { repo: "infra/app/openlen-live-republish.timer", box: "/etc/systemd/system/openlen-live-republish.timer" },
  { repo: "infra/app/openlen-notifications-drain.service", box: "/etc/systemd/system/openlen-notifications-drain.service" },
  { repo: "infra/app/openlen-notifications-drain.timer", box: "/etc/systemd/system/openlen-notifications-drain.timer" },
];
