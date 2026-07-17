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
      laptop) — el backup nightly nunca puede restaurar su propio
      rclone.conf (vive DENTRO de lo que respalda: chicken-and-egg).
- [ ] SSH key `openlen-admin` disponible en tu laptop (`~/.ssh/openlen-admin`).
      Box nuevo = IP nueva; el alias de `~/.ssh/config` sigue apuntando al
      box viejo — por eso cada comando ssh/scp de este runbook lleva
      `-i ~/.ssh/openlen-admin` explícito (desde §2).
- [ ] Acceso a: consola de Hetzner Cloud, dashboard de Cloudflare (DNS de
      openlen.com), repo git actualizado en la laptop.
- [ ] `openlen-backup.timer` Y `openlen-backup-system.timer` activos en el box
      (`systemctl list-timers 'openlen-*'`) y con objetos frescos en R2.
- [ ] Gate A debe confirmar si `/opt/openlen-app/infra` existe en el box (los
      ExecStart de los timers de backup apuntan ahí — lo crea el deploy, no
      install-app.sh).

## 1 · Crear el box nuevo

Consola Hetzner → Add Server: Ashburn (ash), Ubuntu (misma major que el box
muerto — ver `manifest.txt` en R2), plan equivalente al actual. Anota la IP
nueva. **NO toques DNS todavía.**

## 2 · Bootstrap del sistema

Desde la laptop, repo root (sustituye <IP>). Box nuevo = IP nueva, así que el
alias de `~/.ssh/config` no aplica todavía — todo comando ssh/scp de este
runbook lleva `-i ~/.ssh/openlen-admin` explícito.

Una sola copia de `infra/` completo al box — el resto del runbook reutiliza
`/root/infra` (setup-hetzner, setup-node, caddy install, restores):

    scp -i ~/.ssh/openlen-admin -r infra root@<IP>:/root/infra
    ssh -i ~/.ssh/openlen-admin root@<IP> "bash /root/infra/scripts/setup-hetzner.sh"
    ssh -i ~/.ssh/openlen-admin root@<IP> "bash /root/infra/app/setup-node.sh"

Caddy — instalar y hacer el cutover (setup-hetzner.sh deja nginx activo por
default; el stack real de producción es Caddy, ver `infra/caddy/CUTOVER.md`):

    ssh -i ~/.ssh/openlen-admin root@<IP> "bash /root/infra/caddy/install.sh"
    ssh -i ~/.ssh/openlen-admin root@<IP> "systemctl stop nginx || true && systemctl disable nginx || true && systemctl enable --now caddy"

(`install.sh` calcula `REPO_DIR` como `$0/../..`; corriendo desde
`/root/infra/caddy/install.sh` eso resuelve a `/root`, y el Caddyfile en
`/root/infra/caddy/Caddyfile` — correcto porque copiamos `infra/` entero a
`/root/infra` arriba.)

Caddy puede fallar a arrancar aquí si el Caddyfile pide el cert de
`/etc/letsencrypt/live/openlen.com/` y todavía no existe — es esperado, §3 lo
restaura; si hace falta, `systemctl restart caddy` al terminar §3.

Chrome para los bakes (Puppeteer necesita el .deb + HOME=/tmp, ver memoria
puppeteer-hetzner-chrome):

    ssh -i ~/.ssh/openlen-admin root@<IP> 'wget -qO /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && apt-get install -y /tmp/chrome.deb'

## 3 · Restaurar /etc/openlen + /etc/letsencrypt desde R2

`rclone.conf` no puede venir del propio backup — está DENTRO de lo que cifra
(chicken-and-egg). Por eso vive fuera del box (§0). En el box, pégalo desde
el password manager:

    mkdir -p /etc/openlen
    cat > /etc/openlen/rclone.conf << 'EOF'
    <PEGAR CONTENIDO DE rclone.conf DESDE EL PASSWORD MANAGER>
    EOF
    chmod 600 /etc/openlen/rclone.conf

Con eso ya puedes traer el resto:

    rclone --config /etc/openlen/rclone.conf lsf r2-published:openlen-backup/etc/ | sort | tail -n1
    rclone --config /etc/openlen/rclone.conf copyto "r2-published:openlen-backup/etc/<el-más-nuevo>" /tmp/etc.enc
    openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:<PASSPHRASE-del-password-manager> -in /tmp/etc.enc -out /tmp/etc.tar.gz
    tar -C /etc -xzf /tmp/etc.tar.gz
    printf '%s' '<PASSPHRASE>' > /etc/openlen/backup.pass
    chown -R root:openlen-deploy /etc/openlen && chmod 640 /etc/openlen/*
    systemctl restart caddy   # si ya había arrancado en §2 sin estos certs

El tar de `etc/` ahora trae `/etc/letsencrypt` (token DNS-01 de Cloudflare +
certs) además de `/etc/openlen` — pero solo en backups tomados DESPUÉS de
este cambio. Si el objeto más nuevo en R2 es de antes, `cloudflare.ini` no
viene incluido: pégalo a mano desde el dashboard de Cloudflare (API token
con Zone:DNS:Edit) en `/etc/letsencrypt/cloudflare.ini` antes de reintentar
la emisión de certs.

(Si tu laptop no tiene rclone: `winget install Rclone.Rclone`.)

## 4 · Instalar la app + units

En el box:

    bash /root/infra/app/install-app.sh

Idempotente. Crea `/opt/openlen-app`, `/var/openlen/{uploads,witness}`,
`/etc/openlen/openlen.env` (si no existe) e instala + habilita los units
systemd. Debe correr ANTES del deploy — el swap de `deploy:prod` falla si
`/opt/openlen-app` y `openlen-app.service` no existen todavía. No arranca
`openlen-app` (eso es el deploy, §5).

## 5 · Deploy de la app

En la laptop: apunta el alias SSH del deploy a la IP nueva
(`~/.ssh/config`, host del deploy) y corre el deploy normal:

    npm run deploy:prod

(Primera vez en box nuevo: el rebuild de crates tarda ~5-15 min; NO pongas
OPENLEN_SKIP_CRATES_REBUILD.)

Si el deploy no dejó `openlen-app` corriendo:

    ssh -i ~/.ssh/openlen-admin root@<IP> "systemctl start openlen-app"

## 6 · Restaurar contenido publicado + uploads

En el box:

    bash /root/infra/scripts/restore-from-r2.sh
    mkdir -p /var/openlen/uploads
    rclone --config /etc/openlen/rclone.conf sync r2-published:openlen-backup/uploads/ /var/openlen/uploads/
    chown -R openlen-deploy:www-data /var/openlen/uploads /var/www/openlen

## 7 · Re-activar timers según manifiesto

En el box. El manifiesto es la fuente de verdad de qué estaba activo:

    rclone --config /etc/openlen/rclone.conf cat r2-published:openlen-backup/manifest/manifest.txt
    # Actívalos según lo que liste, p.ej.:
    systemctl enable --now openlen-backup.timer openlen-backup-system.timer
    systemctl enable --now openlen-analytics-rollup.timer openlen-bookings-remind.timer openlen-live-republish.timer openlen-notifications-drain.timer

## 8 · Smoke SIN tocar DNS

Desde la laptop (sustituye <IP> y un subdominio publicado real):

    curl --resolve openlen.com:443:<IP> -s -o /dev/null -w "%{http_code}\n" https://openlen.com/en          # 200
    curl --resolve openlen.com:443:<IP> -s https://openlen.com/api/templates | head -c 80                    # JSON
    curl --resolve <sub>.openlen.com:443:<IP> -s -o /dev/null -w "%{http_code}\n" https://<sub>.openlen.com  # 200

Los certs: Caddy pinea el wildcard cert de certbot en
`/etc/letsencrypt/live/openlen.com/` (restaurado en §3) — no emite el suyo
propio para `openlen.com`/`*.openlen.com`. Si el smoke da error TLS, confirma
que §3 restauró los certs y que `systemctl restart caddy` corrió después;
revisa `journalctl -u caddy`.

## 9 · Flip de DNS (SOLO en desastre real — JAMÁS en ensayo)

Cloudflare dashboard → DNS de openlen.com → actualizar los A records de origen
(`openlen.com`, `*.openlen.com` y los que apunten al box) a la IP nueva.
Proxy naranja = propagación efectiva en segundos. Re-correr el smoke sin
`--resolve`. Avisar en el status page si hubo ventana de caída.

## 10 · Solo si el desastre fue NEON (DB perdida)

El dump nightly NO se restaura en el DR normal (la DB vive fuera del box).
Si Neon se perdió: crear Postgres nuevo (Neon u otro), luego, en el box
(rclone.conf ya vive ahí desde §3):

    rclone --config /etc/openlen/rclone.conf lsf r2-published:openlen-backup/db/ | sort | tail -n1
    rclone --config /etc/openlen/rclone.conf copyto "r2-published:openlen-backup/db/<el-más-nuevo>" /tmp/db.enc
    openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:<PASSPHRASE> -in /tmp/db.enc -out /tmp/db.dump
    pg_restore --list /tmp/db.dump | head        # sanity: inventario legible
    pg_restore --no-owner --dbname "<NUEVA_DATABASE_URL_DIRECT>" /tmp/db.dump

Actualizar `DATABASE_URL*` en `/etc/openlen/openlen.env` + `systemctl restart openlen-app`.
Pérdida máxima: desde el dump de las 03:47 UTC.

## 11 · Post-mortem

Anota: qué murió, cuánto tardó cada sección, qué fricción hubo. Actualiza la
línea "Último ensayo/RTO" de arriba y corrige este runbook donde mintió.
