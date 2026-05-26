import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 50,
  duration: '20s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<10'],
  },
};

export default function () {
  const res = http.get('https://127.0.0.1:13443/', {
    headers: { Host: 'demo.openlen.com' },
  });
  check(res, { 'is 200': (r) => r.status === 200 });
}
