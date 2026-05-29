// Custom-domain bench scenario.
//
// Drives a steady GET / against a verified custom-domain host. With the edge,
// every request hits the LRU-cached custom-domain lookup → serve from disk
// (same code path as wildcard subdomain after the lookup hit). With Caddy +
// the Next /served/<host>/ adapter it's a proxy hop to Node — that's the
// delta we're measuring.
//
// The custom domain must already be verified (`customDomains.status =
// "verified"`) and ideally cert-warm (if testing the edge, hit it once
// before the bench so ACME isn't on the cold path).
//
// Tunable env:
//   OPENLEN_TARGET        https://127.0.0.1:443
//   OPENLEN_CUSTOM_HOST   mybrand.com   (must resolve to the bench target IP)
//   RPS                   100
//   DURATION              60s

import http from 'k6/http';
import { check } from 'k6';

const TARGET = __ENV.OPENLEN_TARGET || 'https://127.0.0.1:443';
const HOST = __ENV.OPENLEN_CUSTOM_HOST || 'mybrand.com';

export const options = {
  insecureSkipTLSVerify: true,
  scenarios: {
    custom_domain: {
      executor: 'constant-arrival-rate',
      rate: parseInt(__ENV.RPS || '100', 10),
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  summaryTrendStats: ['min', 'med', 'avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(99)<2000'],
  },
};

export default function () {
  const res = http.get(`${TARGET}/`, {
    headers: { Host: HOST },
    tags: { scenario: 'custom_domain' },
  });
  check(res, {
    'status 200': (r) => r.status === 200,
  });
}
