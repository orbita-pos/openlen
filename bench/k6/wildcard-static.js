// Wildcard subdomain static-serve bench scenario.
//
// Drives a steady GET / against a real `<sub>.openlen.com` so the edge
// resolves index.html off disk directly. The biggest traffic class in prod;
// this is the gate-relevant scenario for "is the edge as fast as nginx?".
//
// Pick a SUB that's actually deployed and has an index.html at
// /var/www/openlen/<sub>/current/. The operator passes it via env.
//
// Tunable env:
//   OPENLEN_TARGET  https://127.0.0.1:443
//   OPENLEN_SUB     mirror   (sub.openlen.com → publish_root/<sub>/current/)
//   RPS             500
//   DURATION        60s

import http from 'k6/http';
import { check } from 'k6';

const TARGET = __ENV.OPENLEN_TARGET || 'https://127.0.0.1:443';
const SUB = __ENV.OPENLEN_SUB || 'mirror';
const HOST = `${SUB}.openlen.com`;

export const options = {
  insecureSkipTLSVerify: true,
  scenarios: {
    wildcard_static: {
      executor: 'constant-arrival-rate',
      rate: parseInt(__ENV.RPS || '500', 10),
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: 100,
      maxVUs: 800,
    },
  },
  summaryTrendStats: ['min', 'med', 'avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_failed: ['rate<0.001'],
    http_req_duration: ['p(99)<1000'],
  },
};

export default function () {
  const res = http.get(`${TARGET}/`, {
    headers: { Host: HOST },
    tags: { scenario: 'wildcard_static' },
  });
  check(res, {
    'status 200': (r) => r.status === 200,
    'has html body': (r) =>
      typeof r.body === 'string' && r.body.length > 0,
  });
}
