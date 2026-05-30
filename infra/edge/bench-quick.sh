#!/usr/bin/env bash
# Quick latency sanity check during the bake-off: the edge (:8443) vs the
# incumbent Caddy (:443) for a REAL published subdomain, hitting both
# loopback listeners on the box. Not a replacement for the full k6 bench
# (bench/) — a fast "is the edge in the same ballpark" gut-check that needs
# nothing installed but curl. Run it ON the box.
#
#   bash /root/bench-quick.sh                 # default sub = chetitpasteles
#   OPENLEN_SUB=mypage N=500 bash /root/bench-quick.sh
H="${OPENLEN_SUB:-chetitpasteles}.openlen.com"
N="${N:-300}"

run() {
  for _ in $(seq "$N"); do
    curl -kso /dev/null -w '%{time_total}\n' \
      --resolve "$H:$1:127.0.0.1" "https://$H:$1/" 2>/dev/null
  done | sort -n | awk -v n="$N" -v L="$L" '
    { a[NR] = $1 }
    END {
      printf "%-6s  p50=%.4fs  p95=%.4fs  p99=%.4fs  (n=%d)\n",
        L, a[int(n*0.50)], a[int(n*0.95)], a[int(n*0.99)], NR
    }'
}

echo "host=$H  samples=$N   (caddy=:443   edge=:8443)"
L=caddy run 443
L=edge  run 8443
