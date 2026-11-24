#!/usr/bin/env python3
"""Visits to openlen.com, from Caddy's access log of the apex (2026-11-23).

The log is written by the `openlen.com, www.openlen.com` block of
infra/caddy/Caddyfile into /var/log/caddy/openlen-apex.log (rolled files beside
it, gzipped, 90 days). Nothing recorded visits before that line went live, so
there is no history before 2026-11-23.

WHAT COUNTS AS A VISIT: a GET answered 200 with an HTML page (`Content-Type:
text/html`) — so no /_next assets, images, API calls or RSC fetches — from a
User-Agent that is not a bot. A VISITOR is one IP + User-Agent (the IP is
Cloudflare's `Cf-Connecting-Ip`), counted per day and over the whole range.
It is an estimate, like every log count: two people behind one IP with the same
browser are one visitor, and a bot that lies about its User-Agent is a person.

NO PERSONAL DATA LEAVES THE BOX: counts only; pages without their query string,
referrers as a bare host, countries as Cloudflare's code. No IP is printed.

RUN IT FROM THIS MACHINE (python3 only, no packages):
  ssh openlen "sudo -n python3 - --since 2026-11-23" < scripts/measure/apex-visits.py
Options: --since YYYY-MM-DD (default: the first of this month, UTC)
         --until YYYY-MM-DD (exclusive; default: none)
         --top N            (rows in each list; default 15)
"""
import argparse
import collections
import datetime as dt
import glob
import gzip
import json
import re
import sys

LOG_GLOB = "/var/log/caddy/openlen-apex*.log*"

BOT = re.compile(
    r"bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link|"
    r"preview|monitor|uptime|pingdom|statuscake|headless|lighthouse|curl|wget|"
    r"python|httpx|go-http|java/|okhttp|node-fetch|axios|undici|scrapy|"
    r"semrush|ahrefs|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|perplexity|"
    r"ccbot|amazonbot|applebot|yandex|baidu|duckduckbot|sogou|seznam|"
    r"whatsapp|telegrambot|discordbot|slackbot|twitterbot|linkedinbot|skypeuripreview",
    re.I,
)
LOCALE = re.compile(r"^/(en|es|pt|fr|de|it|ja|ko|zh|nl)(?=/|$)")


def lines():
    for path in sorted(glob.glob(LOG_GLOB)):
        opener = gzip.open if path.endswith(".gz") else open
        with opener(path, "rt", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if line.startswith("{"):
                    yield line


def header(headers, name):
    value = (headers or {}).get(name)
    return value[0] if isinstance(value, list) and value else ""


def main():
    today = dt.datetime.now(dt.timezone.utc).date()
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default=today.replace(day=1).isoformat())
    ap.add_argument("--until", default="")
    ap.add_argument("--top", type=int, default=15)
    args = ap.parse_args()
    since = dt.date.fromisoformat(args.since)
    until = dt.date.fromisoformat(args.until) if args.until else None

    days = collections.defaultdict(lambda: [0, set()])
    visitors, pages, referrers, countries = set(), collections.Counter(), collections.Counter(), collections.Counter()
    bots = requests = 0
    first = last = None

    for line in lines():
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        req = rec.get("request") or {}
        if "status" not in rec:
            continue  # not an access-log line
        requests += 1
        ts = dt.datetime.fromtimestamp(rec.get("ts", 0), dt.timezone.utc)
        day = ts.date()
        if day < since or (until and day >= until):
            continue
        if req.get("method") != "GET" or rec.get("status") != 200:
            continue
        if not header(rec.get("resp_headers"), "Content-Type").startswith("text/html"):
            continue
        headers = req.get("headers") or {}
        ua = header(headers, "User-Agent")
        if not ua or BOT.search(ua):
            bots += 1
            continue
        if header(headers, "Rsc") or header(headers, "Next-Router-Prefetch"):
            continue  # client-side navigation data, not a page load
        ip = header(headers, "Cf-Connecting-Ip") or req.get("client_ip") or ""
        who = hash((ip, ua))
        days[day][0] += 1
        days[day][1].add(who)
        visitors.add(who)
        path = (req.get("uri") or "/").split("?", 1)[0]
        pages[LOCALE.sub("", path) or "/"] += 1
        ref = header(headers, "Referer")
        host = re.sub(r"^https?://([^/]+).*$", r"\1", ref) if ref else "(directo)"
        if not host.endswith("openlen.com"):
            referrers[host] += 1
        countries[header(headers, "Cf-Ipcountry") or "?"] += 1
        first = ts if first is None or ts < first else first
        last = ts if last is None or ts > last else last

    if requests == 0:
        print("No access-log lines yet in", LOG_GLOB)
        return
    views = sum(v[0] for v in days.values())
    print(f"openlen.com — desde {since}" + (f" hasta {until}" if until else ""))
    if first:
        print(f"  datos de {first:%Y-%m-%d %H:%M} a {last:%Y-%m-%d %H:%M} UTC")
    print(f"  páginas vistas: {views}   visitantes únicos: {len(visitors)}   (bots descartados: {bots})\n")
    print("  día          vistas  visitantes")
    for day in sorted(days):
        print(f"  {day}  {days[day][0]:>6}  {len(days[day][1]):>10}")
    for title, counter in (("páginas", pages), ("de dónde vienen", referrers), ("países", countries)):
        print(f"\n  {title}:")
        for key, n in counter.most_common(args.top):
            print(f"  {n:>6}  {key}")


if __name__ == "__main__":
    sys.exit(main())
