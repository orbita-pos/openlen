# DR runbook — resurrección del box de OpenLen

> **Último ensayo: NUNCA — RTO medido: n/a.**
> Un runbook sin fecha de ensayo es ficción. Actualiza esta línea en cada ensayo.

Escenario principal: el box de Hetzner (Ashburn) murió o es irrecuperable.
Objetivo: prod sirviendo de nuevo en ≤ 90 min, sin pérdida de datos más allá
del último backup nightly (03:17/03:47 UTC).

## 0 · Prerrequisitos (ANTES del desastre — verifica hoy)

- [ ] Passphrase de backup en el password manager (sin ella, `db/` y `etc/` de
      R2 son ilegibles — no hay recuperación alternativa).
- [ ] SSH key `openlen-admin` disponible en tu laptop (`~/.ssh/openlen-admin`).
- [ ] Acceso a: consola de Hetzner Cloud, dashboard de Cloudflare (DNS de
      openlen.com), repo git actualizado en la laptop.
- [ ] `openlen-backup.timer` Y `openlen-backup-system.timer` activos en el box
      (`systemctl list-timers 'openlen-*'`) y con objetos frescos en R2.

## 1 · Crear el box nuevo

Consola Hetzner → Add Server: Ashburn (ash), Ubuntu (misma major que el box
muerto — ver `manifest.txt` en R2), plan equivalente al actual. Anota la IP
nueva. **NO toques DNS todavía.**

## 2 · Bootstrap del sistema

Desde la laptop, repo root (sustituye <IP>):

    scp infra/scripts/setup-hetzner.sh root@<IP>:/root/
    ssh root@<IP> "bash /root/setup-hetzner.sh"
    scp infra/app/setup-node.sh root@<IP>:/root/
    ssh root@<IP> "bash /root/setup-node.sh"
    scp -r infra/caddy root@<IP>:/root/openlen-caddy
    ssh root@<IP> "bash /root/openlen-caddy/install.sh"

Chrome para los bakes (Puppeteer necesita el .deb + HOME=/tmp, ver memoria
puppeteer-hetzner-chrome):

    ssh root@<IP> 'wget -qO /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && apt-get install -y /tmp/chrome.deb'

## 3 · Restaurar /etc/openlen desde R2

En la laptop necesitas rclone con acceso a R2 (o hazlo en el box tras copiar
temporalmente tu rclone.conf local). En el box:

    mkdir -p /etc/openlen
    # copia rclone.conf desde tu copia local (push-env.sh es el camino usual del env)
    rclone --config /etc/openlen/rclone.conf lsf r2-published:openlen-backup/etc/ | sort | tail -n1
    rclone --config /etc/openlen/rclone.conf copyto "r2-published:openlen-backup/etc/<el-más-nuevo>" /tmp/etc.enc
    openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:<PASSPHRASE-del-password-manager> -in /tmp/etc.enc -out /tmp/etc.tar.gz
    tar -C /etc -xzf /tmp/etc.tar.gz
    printf '%s' '<PASSPHRASE>' > /etc/openlen/backup.pass
    chown -R root:openlen-deploy /etc/openlen && chmod 640 /etc/openlen/*

(Si tu laptop no tiene rclone: `winget install Rclone.Rclone`.)

## 4 · Deploy de la app

En la laptop: apunta el alias SSH del deploy a la IP nueva
(`~/.ssh/config`, host del deploy) y corre el deploy normal:

    npm run deploy:prod

(Primera vez en box nuevo: el rebuild de crates tarda ~5-15 min; NO pongas
OPENLEN_SKIP_CRATES_REBUILD.)

## 5 · Restaurar contenido publicado + uploads

En el box:

    bash /opt/openlen-app/infra/scripts/restore-from-r2.sh
    mkdir -p /var/openlen/uploads
    rclone --config /etc/openlen/rclone.conf sync r2-published:openlen-backup/uploads/ /var/openlen/uploads/
    chown -R openlen-deploy:www-data /var/openlen/uploads /var/www/openlen

## 6 · Re-activar units y timers

    bash /opt/openlen-app/infra/app/install-app.sh   # instala units (idempotente)
    # Consulta el manifiesto para saber QUÉ estaba activo:
    rclone --config /etc/openlen/rclone.conf cat r2-published:openlen-backup/manifest/manifest.txt
    # Actívalos según el manifiesto, p.ej.:
    systemctl enable --now openlen-backup.timer openlen-backup-system.timer
    systemctl enable --now openlen-analytics-rollup.timer openlen-bookings-remind.timer openlen-live-republish.timer

## 7 · Smoke SIN tocar DNS

Desde la laptop (sustituye <IP> y un subdominio publicado real):

    curl --resolve openlen.com:443:<IP> -s -o /dev/null -w "%{http_code}\n" https://openlen.com/en          # 200
    curl --resolve openlen.com:443:<IP> -s https://openlen.com/api/templates | head -c 80                    # JSON
    curl --resolve <sub>.openlen.com:443:<IP> -s -o /dev/null -w "%{http_code}\n" https://<sub>.openlen.com  # 200

Los certs: Caddy los emite vía DNS-01 (token de Cloudflare en el env
restaurado) — no requiere que el DNS apunte al box. Si el smoke da error TLS,
espera 1-2 min a la emisión y revisa `journalctl -u caddy`.

## 8 · Flip de DNS (SOLO en desastre real — JAMÁS en ensayo)

Cloudflare dashboard → DNS de openlen.com → actualizar los A records de origen
(`openlen.com`, `*.openlen.com` y los que apunten al box) a la IP nueva.
Proxy naranja = propagación efectiva en segundos. Re-correr el smoke sin
`--resolve`. Avisar en el status page si hubo ventana de caída.

## 9 · Solo si el desastre fue NEON (DB perdida)

El dump nightly NO se restaura en el DR normal (la DB vive fuera del box).
Si Neon se perdió: crear Postgres nuevo (Neon u otro), luego:

    rclone --config /etc/openlen/rclone.conf lsf r2-published:openlen-backup/db/ | sort | tail -n1
    rclone --config /etc/openlen/rclone.conf copyto "r2-published:openlen-backup/db/<el-más-nuevo>" /tmp/db.enc
    openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:<PASSPHRASE> -in /tmp/db.enc -out /tmp/db.dump
    pg_restore --list /tmp/db.dump | head        # sanity: inventario legible
    pg_restore --no-owner --dbname "<NUEVA_DATABASE_URL_DIRECT>" /tmp/db.dump

Actualizar `DATABASE_URL*` en `/etc/openlen/openlen.env` + `systemctl restart openlen-app`.
Pérdida máxima: desde el dump de las 03:47 UTC.

## 10 · Post-mortem

Anota: qué murió, cuánto tardó cada sección, qué fricción hubo. Actualiza la
línea "Último ensayo/RTO" de arriba y corrige este runbook donde mintió.
