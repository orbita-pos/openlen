// Apex / www reverse-proxy bench scenario.
//
// Drives a steady GET / against `Host: openlen.com` (the apex landing) so the
// edge always falls through to Node. Useful for confirming the edge doesn't
// slow apex traffic vs. nginx's direct proxy_pass.
//
// Tunable env:
//   OPENLEN_TARGET  https://127.0.0.1:443 (the listener under test)
//   OPENLEN_HOST    openlen.com
//   RPS             200
//   DURATION        60s

import http from 'k6/http';
import { check } from 'k6';

const TARGET = __ENV.OPENLEN_TARGET || 'https://127.0.0.1:443';
const HOST = __ENV.OPENLEN_HOST || 'openlen.com';

export const options = {
  insecureSkipTLSVerify: true,
  scenarios: {
    apex: {
      executor: 'constant-arrival-rate',
      rate: parseInt(__ENV.RPS || '200', 10),
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: 50,
      maxVUs: 400,
    },
  },
  summaryTrendStats: ['min', 'med', 'avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  // Gates: encoded for visibility only — bench/diff.py is the canonical
  // accept/reject judge across baseline vs edge runs. k6's own threshold
  // failures still surface non-zero exit so CI can chain on it.
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(99)<5000'],
  },
};

export default function () {
  const res = http.get(`${TARGET}/`, {
    headers: { Host: HOST },
    tags: { scenario: 'apex' },
  });
  check(res, {
    'status is 2xx/3xx': (r) => r.status >= 200 && r.status < 400,
  });
}
