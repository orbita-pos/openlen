# DR runbook — resurrección del box de OpenLen

> **Último ensayo: NUNCA — RTO medido: n/a.**
> Un runbook sin fecha de ensayo es ficción. Actualiza esta línea en cada ensayo.

Escenario principal: el box de Hetzner (Ashburn) murió o es irrecuperable.
Objetivo: prod sirviendo de nuevo en ≤ 90 min, sin pérdida de datos más allá
del último backup nightly (03:17/03:47 UTC).

## 0 · Prerrequisitos (ANTES del desastre — verifica hoy)

- [ ] Passphrase de backup en el password manager (sin ella, `db/` y `etc/` de
      R2 son ilegibles — no hay recuperación alternativa).
- [ ] Copia de `/etc/openlen/rclone.conf` fuera del box (password manager o
      laptop) — el backup nightly nunca puede restaurar su propio rclone.conf
      (vive DENTRO de lo que respalda: chicken-and-egg).
- [ ] Token DNS-01 de Cloudflare (`cloudflare.ini`) en el password manager. El
      backup NO lo respalda: es root-only (600 root:root) y el backup corre como
      openlen-deploy, que no puede leerlo. Si lo pierdes se regenera en el
      dashboard de Cloudflare (Custom Token, Zone:DNS:Edit + Zone:Read sobre
      openlen.com — ver `infra/dns/CLOUDFLARE_TOKEN.md`).
- [ ] SSH key `openlen-admin` en tu laptop (`~/.ssh/openlen-admin`). Box nuevo =
      IP nueva; el alias de `~/.ssh/config` sigue apuntando al box viejo — por
      eso cada comando ssh/scp de este runbook lleva `-i ~/.ssh/openlen-admin`.
- [ ] Acceso a: consola de Hetzner Cloud, dashboard de Cloudflare (DNS de
      openlen.com), repo git actualizado en la laptop.
- [ ] `openlen-backup.timer` Y `openlen-backup-system.timer` activos en el box
      (`systemctl list-timers 'openlen-*'`) y con objetos frescos en R2.

## 1 · Crear el box nuevo

Consola Hetzner → Add Server: Ashburn (ash), Ubuntu 24.04 (misma major que el
box muerto — ver `manifest.txt` en R2), plan equivalente al actual. En "SSH
keys" **selecciona `openlen-admin`** (la clave pública que corresponde a tu
`~/.ssh/openlen-admin`) — todo este runbook entra por ella; un box que arranca
sin la clave inyectada no tiene arreglo fácil (rescate o recrear). Anota la IP
nueva. **NO toques DNS todavía.**

## 2 · Bootstrap del sistema

Desde la laptop, repo root (sustituye `<IP>`). Una sola copia de `infra/` al
box; el resto del runbook reutiliza `/root/infra`:

    scp -i ~/.ssh/openlen-admin -r infra root@<IP>:/root/infra
    ssh -i ~/.ssh/openlen-admin root@<IP> "bash /root/infra/scripts/setup-hetzner.sh"
    ssh -i ~/.ssh/openlen-admin root@<IP> "bash /root/infra/app/setup-node.sh"

`setup-hetzner.sh` instala nginx/certbot/rclone/ufw/fail2ban + el usuario
openlen-deploy + el webroot. En el paso [7/8] intenta emitir el cert wildcard
pero **lo salta** porque `cloudflare.ini` aún no existe — es esperado; §3 lo
crea y re-corre la emisión.

Chrome para los bakes (Puppeteer necesita el .deb + HOME=/tmp, ver memoria
puppeteer-hetzner-chrome):

    ssh -i ~/.ssh/openlen-admin root@<IP> 'wget -qO /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && apt-get install -y /tmp/chrome.deb'

## 3 · Secrets + restaurar /etc/openlen + emitir el cert

Todo en el box: `ssh -i ~/.ssh/openlen-admin root@<IP>`.

**3a — rclone.conf** (no puede venir del backup: está dentro de lo que cifra).
Pégalo desde el password manager:

    mkdir -p /etc/openlen
    cat > /etc/openlen/rclone.conf << 'EOF'
    <PEGAR CONTENIDO DE rclone.conf DESDE EL PASSWORD MANAGER>
    EOF
    chmod 600 /etc/openlen/rclone.conf

**3b — restaurar /etc/openlen desde R2** (env, secrets de módulos, el propio
rclone.conf "de verdad"). El tar excluye `backup.pass`, así que se recrea aparte:

    rclone --config /etc/openlen/rclone.conf lsf r2-published:openlen-backup/etc/ | sort | tail -n1
    rclone --config /etc/openlen/rclone.conf copyto "r2-published:openlen-backup/etc/<el-más-nuevo>" /tmp/etc.enc
    openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:'<PASSPHRASE>' -in /tmp/etc.enc -out /tmp/etc.tar.gz
    tar -C /etc -xzf /tmp/etc.tar.gz
    printf '%s' '<PASSPHRASE>' > /etc/openlen/backup.pass
    chown -R root:openlen-deploy /etc/openlen && chmod 640 /etc/openlen/*

**3c — cloudflare.ini + emitir el cert wildcard.** Pega el token DNS-01 desde el
password manager y re-corre setup-hetzner (idempotente; ahora sí emite):

    cat > /etc/letsencrypt/cloudflare.ini << 'EOF'
    dns_cloudflare_api_token = <PEGAR_TOKEN_DESDE_PASSWORD_MANAGER>
    EOF
    chmod 600 /etc/letsencrypt/cloudflare.ini && chown root:root /etc/letsencrypt/cloudflare.ini
    bash /root/infra/scripts/setup-hetzner.sh   # el paso [7/8] ahora emite *.openlen.com

Verifica que el cert quedó antes de seguir (Caddy y su install.sh lo necesitan):

    ls /etc/letsencrypt/live/openlen.com/fullchain.pem   # debe existir

(Si perdiste el token, genera uno nuevo en Cloudflare — Zone:DNS:Edit +
Zone:Read sobre openlen.com, ver `infra/dns/CLOUDFLARE_TOKEN.md`.)

## 4 · Caddy (stack web real)

setup-hetzner deja nginx activo; producción es Caddy. Instálalo **DESPUÉS** de
que el cert exista (§3c): `install.sh` valida el Caddyfile (que pinea
`/etc/letsencrypt/live/openlen.com/`) y solo entonces da al usuario `caddy`
lectura de los certs (`chgrp ssl-cert` guardado por `[[ -d live ]]`). Correrlo
antes de emitir dejaría a Caddy sin poder leer el cert.

    ssh -i ~/.ssh/openlen-admin root@<IP> "bash /root/infra/caddy/install.sh"
    ssh -i ~/.ssh/openlen-admin root@<IP> "systemctl stop nginx || true && systemctl disable nginx || true && systemctl enable --now caddy"

(`install.sh` calcula `REPO_DIR` como `$0/../..`; corriendo desde
`/root/infra/caddy/install.sh` resuelve a `/root` y encuentra el Caddyfile en
`/root/infra/caddy/Caddyfile` — por eso copiamos `infra/` entero a `/root/infra`
en §2.)

## 5 · Instalar la app + units

En el box:

    bash /root/infra/app/install-app.sh

Idempotente. Crea `/opt/openlen-app` e instala los units systemd. Debe correr
ANTES del deploy — el swap de `deploy:prod` falla si `/opt/openlen-app` y
`openlen-app.service` no existen todavía. No arranca `openlen-app` (eso es el
deploy, §6).

## 6 · Deploy de la app

En la laptop: apunta el alias SSH del deploy a la IP nueva (`~/.ssh/config`,
host del deploy) y corre el deploy normal:

    npm run deploy:prod

(Primera vez en box nuevo: el rebuild de crates tarda ~5-15 min; NO pongas
OPENLEN_SKIP_CRATES_REBUILD.) Si el deploy no dejó `openlen-app` corriendo:

    ssh -i ~/.ssh/openlen-admin root@<IP> "systemctl start openlen-app"

## 7 · Restaurar contenido publicado + uploads

En el box:

    bash /root/infra/scripts/restore-from-r2.sh
    mkdir -p /var/openlen/uploads
    rclone --config /etc/openlen/rclone.conf sync r2-published:openlen-backup/uploads/ /var/openlen/uploads/
    chown -R openlen-deploy:www-data /var/openlen/uploads /var/www/openlen

## 8 · Re-activar timers según manifiesto

En el box. El manifiesto es la fuente de verdad de qué estaba activo:

    rclone --config /etc/openlen/rclone.conf cat r2-published:openlen-backup/manifest/manifest.txt
    # Actívalos según lo que liste, p.ej.:
    systemctl enable --now openlen-backup.timer openlen-backup-system.timer
    systemctl enable --now openlen-analytics-rollup.timer openlen-bookings-remind.timer openlen-live-republish.timer openlen-notifications-drain.timer

## 9 · Smoke SIN tocar DNS

Desde la laptop (sustituye `<IP>` y un subdominio publicado real):

    curl --resolve openlen.com:443:<IP> -s -o /dev/null -w "%{http_code}\n" https://openlen.com/en          # 200
    curl --resolve openlen.com:443:<IP> -s https://openlen.com/api/templates | head -c 80                    # JSON
    curl --resolve <sub>.openlen.com:443:<IP> -s -o /dev/null -w "%{http_code}\n" https://<sub>.openlen.com  # 200

El wildcard cert lo emitió certbot en §3c (vía DNS-01, no necesita que el DNS
apunte al box); Caddy lo pinea desde `/etc/letsencrypt/live/openlen.com/`. Si el
smoke da error TLS: confirma que §3c emitió el cert
(`ls /etc/letsencrypt/live/openlen.com/`) y revisa `journalctl -u caddy`.

## 10 · Flip de DNS (SOLO en desastre real — JAMÁS en ensayo)

Cloudflare dashboard → DNS de openlen.com → actualizar los A records de origen
(`openlen.com`, `*.openlen.com` y los que apunten al box) a la IP nueva.
Proxy naranja = propagación efectiva en segundos. Re-correr el smoke sin
`--resolve`. Avisar en el status page si hubo ventana de caída.

## 11 · Solo si el desastre fue NEON (DB perdida)

El dump nightly NO se restaura en el DR normal (la DB vive fuera del box).
Si Neon se perdió: crear Postgres nuevo (Neon u otro), luego, en el box
(rclone.conf ya vive ahí desde §3):

    rclone --config /etc/openlen/rclone.conf lsf r2-published:openlen-backup/db/ | sort | tail -n1
    rclone --config /etc/openlen/rclone.conf copyto "r2-published:openlen-backup/db/<el-más-nuevo>" /tmp/db.enc
    openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:'<PASSPHRASE>' -in /tmp/db.enc -out /tmp/db.dump
    pg_restore --list /tmp/db.dump | head        # sanity: inventario legible
    pg_restore --no-owner --dbname "<NUEVA_DATABASE_URL_DIRECT>" /tmp/db.dump

Actualizar `DATABASE_URL*` en `/etc/openlen/openlen.env` + `systemctl restart openlen-app`.
Pérdida máxima: desde el dump de las 03:47 UTC.

## 12 · Post-mortem

Anota: qué murió, cuánto tardó cada sección, qué fricción hubo. Actualiza la
línea "Último ensayo/RTO" de arriba y corrige este runbook donde mintió.
