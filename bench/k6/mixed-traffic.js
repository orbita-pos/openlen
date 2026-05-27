// Mixed-traffic bench scenario — production-shaped distribution.
//
// 70% wildcard subdomain static, 20% apex proxy, 10% custom domain. Driven at
// 300 RPS total, so each scenario lands at:
//   wildcard:     210 RPS
//   apex:          60 RPS
//   custom:        30 RPS
//
// All three scenarios share the same constant-arrival-rate executor so the
// load profile is steady — the bench is about p99/error-rate parity, not
// burst behavior.
//
// Tunable env (defaults match the per-scenario scripts):
//   OPENLEN_TARGET        https://127.0.0.1:443
//   OPENLEN_HOST          openlen.com
//   OPENLEN_SUB           mirror
//   OPENLEN_CUSTOM_HOST   mybrand.com
//   DURATION              60s
//   TOTAL_RPS             300

import http from 'k6/http';
import { check } from 'k6';

const TARGET = __ENV.OPENLEN_TARGET || 'https://127.0.0.1:443';
const APEX_HOST = __ENV.OPENLEN_HOST || 'openlen.com';
const SUB = __ENV.OPENLEN_SUB || 'mirror';
const CUSTOM_HOST = __ENV.OPENLEN_CUSTOM_HOST || 'mybrand.com';
const SUB_HOST = `${SUB}.openlen.com`;

const TOTAL = parseInt(__ENV.TOTAL_RPS || '300', 10);
const DURATION = __ENV.DURATION || '60s';

// 70 / 20 / 10 split, rounded to integers so the sum exactly hits TOTAL.
const APEX_RPS = Math.round(TOTAL * 0.2);
const CUSTOM_RPS = Math.round(TOTAL * 0.1);
const WILDCARD_RPS = TOTAL - APEX_RPS - CUSTOM_RPS;

function scenario(name, rps, vus) {
  return {
    executor: 'constant-arrival-rate',
    rate: rps,
    timeUnit: '1s',
    duration: DURATION,
    preAllocatedVUs: vus,
    maxVUs: vus * 4,
    exec: name,
    tags: { scenario: name },
  };
}

export const options = {
  insecureSkipTLSVerify: true,
  scenarios: {
    wildcard_static: scenario('wildcardStatic', WILDCARD_RPS, 100),
    apex: scenario('apex', APEX_RPS, 30),
    custom_domain: scenario('customDomain', CUSTOM_RPS, 20),
  },
  summaryTrendStats: ['min', 'med', 'avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(99)<2000'],
  },
};

export function wildcardStatic() {
  const res = http.get(`${TARGET}/`, {
    headers: { Host: SUB_HOST },
    tags: { scenario: 'wildcard_static' },
  });
  check(res, { 'wildcard 200': (r) => r.status === 200 });
}

export function apex() {
  const res = http.get(`${TARGET}/`, {
    headers: { Host: APEX_HOST },
    tags: { scenario: 'apex' },
  });
  check(res, { 'apex 2xx/3xx': (r) => r.status >= 200 && r.status < 400 });
}

export function customDomain() {
  const res = http.get(`${TARGET}/`, {
    headers: { Host: CUSTOM_HOST },
    tags: { scenario: 'custom_domain' },
  });
  check(res, { 'custom 200': (r) => r.status === 200 });
}
