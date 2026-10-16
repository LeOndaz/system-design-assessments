import type { TerminalScenario } from '../types';
import { oneOf } from '$lib/terminal/scenario';
import { err } from './a19-util';

/**
 * /api/v2/* requests land on the v1 pool. The config has a prefix `location /api/v2/` AND a regex
 * `location ~ ^/api/(.*)$` added later for CORS; nginx checks regex locations after picking the
 * longest prefix, and a matching regex wins unless the prefix uses `^~`. Decoy: an `upstream v2_pool`
 * health warning (one v2 node is draining and isn't the cause).
 */

const CONF = `# /etc/nginx/conf.d/api.conf
upstream v1_pool {
    server 10.0.7.11:8080;
    server 10.0.7.12:8080;
}
upstream v2_pool {
    server 10.0.8.21:8080;
    server 10.0.8.22:8080 max_fails=3;   # draining for kernel upgrade
}

server {
    listen 443 ssl;
    server_name api.shop.example;

    location /api/v2/ {
        proxy_pass http://v2_pool;
        add_header X-Upstream v2_pool always;
    }

    location /api/ {
        proxy_pass http://v1_pool;
        add_header X-Upstream v1_pool always;
    }

    # 2026-10-09 CORS preflight for the partner portal (ticket WEB-4471)
    location ~ ^/api/(.*)$ {
        if ($request_method = OPTIONS) { return 204; }
        add_header Access-Control-Allow-Origin https://partners.shop.example always;
        proxy_pass http://v1_pool;
        add_header X-Upstream v1_pool always;
    }

    location = /healthz { return 200 "ok"; }
}
`;

const v1log = Array.from({ length: 60 }, (_, i) => {
	const v2 = i % 3 !== 0;
	return `10.0.0.10 - - [14/Oct/2026:09:4${Math.floor(i / 10)}:${String((i * 7) % 60).padStart(2, '0')} +0000] "GET /api/${v2 ? 'v2/orders?page=' + i : 'v1/orders/88' + i} HTTP/1.0" ${v2 ? 404 : 200} ${v2 ? 41 : 1820} upstream=v1`;
}).join('\n');

const scenario: TerminalScenario = {
	title: 'ssh ops@edge-2.prod',
	user: 'ops',
	host: 'edge-2',
	cwd: '/etc/nginx',
	motd: 'edge-2 · nginx 1.24',
	task: 'Partner integration: **"Every /api/v2/ call returns 404 since last Thursday; v1 works."** The v2 service itself is healthy. Find which line of `/etc/nginx/conf.d/api.conf` holds the `location` that actually handles `/api/v2/orders`, and `submit` that line number.',
	files: {
		'/etc/nginx/conf.d/api.conf': CONF,
		'/etc/nginx/nginx.conf': 'user www-data;\nworker_processes auto;\nevents { worker_connections 4096; }\nhttp {\n    include /etc/nginx/conf.d/*.conf;\n}\n',
		'/var/log/nginx/upstream-v1.log': v1log + '\n',
		'/var/log/nginx/upstream-v2.log': '10.0.0.10 - - [08/Oct/2026:23:59:51 +0000] "GET /api/v2/orders?page=3 HTTP/1.0" 200 2213 upstream=v2\n',
		'/var/log/nginx/error.log': '2026/10/14 09:12:40 [warn] 2201#2201: upstream server temporarily disabled while connecting to upstream, upstream: "http://10.0.8.22:8080/healthz"\n',
		'/home/ops/CHANGES.md': '2026-10-09 added CORS location for partner portal (WEB-4471)\n'
	},
	commands: {
		nginx: (args) => {
			if (args.includes('-T')) return `nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful\n# configuration file /etc/nginx/conf.d/api.conf:\n${CONF}`;
			if (args.includes('-t')) return 'nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful';
			if (args.includes('-s')) return '';
			return err('usage: nginx -t | -T | -s reload');
		},
		curl: (args) => {
			const url = args.find((a) => a.includes('/api/') || a.includes('/healthz')) ?? '';
			const head = args.some((a) => /^-[a-zA-Z]*I/.test(a) || a === '-v' || /^-[a-zA-Z]*i/.test(a));
			if (url.includes('/api/')) {
				const isV2 = url.includes('/api/v2/');
				const status = isV2 ? '404 Not Found' : '200 OK';
				return (head ? `HTTP/1.1 ${status}\nServer: nginx/1.24.0\nContent-Type: application/json\nX-Upstream: v1_pool\nAccess-Control-Allow-Origin: https://partners.shop.example\n\n` : '') + (isV2 ? '{"error":"route not found"}' : '{"orders":[…]}');
			}
			return 'ok';
		}
	},
	answer: {
		prompt: 'line number',
		check: (a) => (a.trim() === '26' ? true : a.trim() === '15' ? 'That is the location you *intended*. nginx checks something after picking it.' : a.trim() === '20' ? 'Prefix /api/ is shorter than /api/v2/, so it is not chosen over it.' : 'Use grep -n location on the file.'),
		success: 'The regex location on line 26 wins: nginx finds the longest prefix (/api/v2/) first, then tries regex locations in order and uses the first match. Fix: `location ^~ /api/v2/` or tighten the regex to v1.'
	},
	hints: ['grep -n location /etc/nginx/conf.d/api.conf', 'curl -sI https://api.shop.example/api/v2/orders', 'tail -5 /var/log/nginx/upstream-v1.log'],
	solution: ['grep -n location /etc/nginx/conf.d/api.conf', 'curl -sI https://api.shop.example/api/v2/orders', 'grep -c "/api/v2/" /var/log/nginx/upstream-v1.log', 'submit 26']
};

export default scenario;
