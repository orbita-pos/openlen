import http from 'k6/http';
import { check } from 'k6';

// Hits the edge at apex (openlen.com) which is in the default proxy_hosts list.
// Assumes `examples/mock_node` is running at the configured OPENLEN_EDGE_NODE_URL.
export const options = {
  vus: 50,
  duration: '20s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const res = http.get('https://127.0.0.1:13443/', {
    headers: { Host: 'openlen.com' },
  });
  check(res, { 'is 200': (r) => r.status === 200 });
}
