#!/usr/bin/env bash
# Read-only measurement: Len's prompt-cache hit rate in production, from the
# journal. app/api/agent/route.ts prints one line per CHARGED turn:
#
#   [agent] <model> — in 244012 (cached 238100, 98%) / out 3120 / pensados 900 / vueltas=4 llamadas=6
#
# `in` / `cached` / `out` are the sums over every model call of the turn, so the
# weighted rate (sum cached / sum in) is what the bill sees. Turns stopped by the
# spend cap, by the owner's stop button, or ended on an error print a different
# line without tokens: they are only counted, by `motivo=`.
#
# It also prices the same tokens at the rates in
# reports/Economía de planes como OpenCode Go.md (USD per 1M tokens,
# 2026-10-16) to get r = real cost / Fireworks list:
#   Fireworks serverless   0.30 in / 0.006 cached / 1.20 out
#   DeepSeek direct        same at peak (01-04, 06-10 UTC Mon-Fri), half off-peak
#   DeepInfra (promo)      0.14 / 0.0042 / 0.42
#   DeepInfra (list)       0.20 / 0.006 / 0.60
#
# Usage on the box (it only reads the journal):
#   bash /tmp/len-cache-from-journal.sh                         # since the fix: 2026-10-11 22:38 UTC
#   bash /tmp/len-cache-from-journal.sh "2026-10-05 00:00:00 UTC" "2026-10-11 22:38:00 UTC"   # before it
# To test it off the box, point JOURNAL_FILE at a saved `journalctl -o short-iso --utc` output.

set -u

since="${1:-2026-10-11 22:38:00 UTC}"
until_time="${2:-}"

read_journal() {
  if [ -n "${JOURNAL_FILE:-}" ]; then
    cat "$JOURNAL_FILE"
  elif [ -n "$until_time" ]; then
    journalctl -u openlen-app --since "$since" --until "$until_time" --no-pager -o short-iso --utc
  else
    journalctl -u openlen-app --since "$since" --no-pager -o short-iso --utc
  fi
}

journal="$(read_journal)"

echo "== Window: since $since${until_time:+, until $until_time} =="
if [ -z "${JOURNAL_FILE:-}" ]; then
  echo "-- oldest entry the journal still has for openlen-app (the window cannot start before it):"
  journalctl -u openlen-app --no-pager -o short-iso --utc 2>/dev/null | grep -v '^-- ' | head -n 1
  echo "-- app (re)starts inside the window:"
  printf '%s\n' "$journal" | grep -E 'Started|Stopped' | grep -iE 'openlen' || echo "   none"
fi

echo
echo "== Model ids in the charged-turn lines =="
printf '%s\n' "$journal" \
  | grep -F '[agent] ' | grep -F ' (cached ' \
  | sed -nE 's/.*\[agent\] ([^ ]+) [^ ]+ in [0-9]+ \(cached .*/\1/p' \
  | sort | uniq -c | sort -rn
[ -n "$(printf '%s\n' "$journal" | grep -F ' (cached ')" ] || echo "   none"

echo
echo "== Turns that print no tokens, by motivo =="
printf '%s\n' "$journal" | grep -F '[agent] ' | grep -oE 'motivo=[a-z_]+' | sort | uniq -c | sort -rn
printf '%s\n' "$journal" | grep -F '[agent] turno sin cobro' | wc -l | sed 's/^ */   closed without charge (turno sin cobro): /'

echo
printf '%s\n' "$journal" \
  | grep -F '[agent] ' | grep -F ' (cached ' \
  | sed -nE 's/^([0-9T:+-]+) .* in ([0-9]+) \(cached ([0-9]+), [0-9]+%\) \/ out ([0-9]+)( \/ pensados ([0-9]+))? \/ vueltas=([0-9]+) llamadas=([0-9]+).*$/\1;\2;\3;\4;\6;\7;\8/p' \
  | awk -F';' '
    BEGIN { split("0 3 2 5 0 3 5 1 4 6 2 4", SAKAMOTO, " ") }
    # Day of week, 0 = Sunday (Sakamoto). POSIX awk has no strftime.
    function dow(y, m, d) { if (m < 3) y -= 1; return (y + int(y / 4) - int(y / 100) + int(y / 400) + SAKAMOTO[m] + d) % 7 }
    function cost(uncached, cached, out, pin, pcached, pout) { return (uncached * pin + cached * pcached + out * pout) / 1000000 }
    function pct(a, b) { return b > 0 ? 100 * a / b : 0 }
    {
      ts = $1; inp = $2 + 0; cached = $3 + 0; out = $4 + 0; thought = ($5 == "" ? 0 : $5 + 0); rounds = $6 + 0
      if (cached > inp) cached = inp
      uncached = inp - cached
      n++; IN += inp; CACHED += cached; OUT += out; THOUGHT += thought
      rate[n] = pct(cached, inp)
      if (rounds == 1) { n1++; IN1 += inp; CACHED1 += cached }

      r = rate[n]
      if (r < 50) b50++; else if (r < 80) b80++; else if (r < 90) b90++; else if (r < 95) b95++; else b100++

      fw = cost(uncached, cached, out, 0.30, 0.006, 1.20)
      y = substr(ts, 1, 4) + 0; mo = substr(ts, 6, 2) + 0; d = substr(ts, 9, 2) + 0; h = substr(ts, 12, 2) + 0
      w = dow(y, mo, d)
      peak = (w >= 1 && w <= 5 && ((h >= 1 && h <= 3) || (h >= 6 && h <= 9)))
      FW += fw
      DS += peak ? fw : fw / 2
      if (peak) { npeak++; FWPEAK += fw }
      DIPROMO += cost(uncached, cached, out, 0.14, 0.0042, 0.42)
      DILIST += cost(uncached, cached, out, 0.20, 0.006, 0.60)
    }
    END {
      if (n == 0) { print "== No charged-turn lines in this window =="; exit }
      if (FW <= 0) FW = 1e-12
      # Insertion sort for the median: n is small and POSIX awk has no asort.
      for (i = 2; i <= n; i++) { v = rate[i]; j = i - 1; while (j > 0 && rate[j] > v) { rate[j + 1] = rate[j]; j-- } rate[j + 1] = v }
      median = (n % 2) ? rate[(n + 1) / 2] : (rate[n / 2] + rate[n / 2 + 1]) / 2

      print "== Prompt cache, charged Len turns =="
      printf "   turns                      %d\n", n
      printf "   weighted hit rate          %.1f%%   (sum cached / sum input: what the bill sees)\n", pct(CACHED, IN)
      printf "   median per-turn hit rate   %.1f%%\n", median
      printf "   one-call turns             %d, weighted %.1f%%   (no in-turn reuse: shows cross-turn caching)\n", n1, pct(CACHED1, IN1)
      printf "   turns by hit rate          <50%%: %d   50-80%%: %d   80-90%%: %d   90-95%%: %d   >=95%%: %d\n", b50, b80, b90, b95, b100
      print ""
      print "== Token mix =="
      printf "   input  %.1fM (cached %.1fM)   output %.2fM   thinking %.2fM (%.0f%% of output)\n", IN / 1e6, CACHED / 1e6, OUT / 1e6, THOUGHT / 1e6, pct(THOUGHT, OUT)
      printf "   input per output token      %.1f\n", (OUT > 0 ? IN / OUT : 0)
      printf "   avg tokens per turn         %.0f in / %.0f out\n", IN / n, OUT / n
      print ""
      print "== The same tokens at other prices (r = cost / Fireworks list) =="
      printf "   Fireworks serverless   $%.2f   r = 1.00   ($%.4f per turn)\n", FW, FW / n
      printf "   DeepSeek direct        $%.2f   r = %.2f   (%d of %d turns on peak hours, %.0f%% of the cost)\n", DS, DS / FW, npeak, n, pct(FWPEAK, FW)
      printf "   DeepInfra (promo)      $%.2f   r = %.2f\n", DIPROMO, DIPROMO / FW
      printf "   DeepInfra (list)       $%.2f   r = %.2f\n", DILIST, DILIST / FW
      print "   (assumes every provider hits the cache as often as Fireworks did; that is the number nobody publishes)"
    }'
