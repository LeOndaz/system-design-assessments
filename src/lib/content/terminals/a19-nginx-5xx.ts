import type { TerminalScenario } from '../types';
import { rng } from '../series';
import { oneOf, routes } from '$lib/terminal/scenario';
import { clock } from './a19-util';

/**
 * 5xx spike: one client hammers a slow export endpoint. Decoys: the health checker dominates
 * total requests, and yesterday's rotated log has a far bigger (already resolved) offender.
 */

const PATHS = ['/api/v1/orders', '/api/v1/orders/8812', '/api/v1/customers', '/api/v1/invoices', '/static/app.js', '/api/v1/search?q=shoes'];
const UA = '"Mozilla/5.0 (Macintosh)"';

function line(day: string, h: number, sec: number, ip: string, method: string, path: string, status: number, bytes: number, rt: number, ua = UA) {
	return `${ip} - - [${day}:${clock(h, sec)} +0000] "${method} ${path} HTTP/1.1" ${status} ${bytes} "-" ${ua} ${rt.toFixed(3)}`;
}

function today(): string {
	const r = rng(1901);
	const out: string[] = [];
	for (let i = 0; i < 1400; i++) {
		const sec = i * 2.5;
		const x = r();
		if (x < 0.27) out.push(line('14/Oct/2026', 9, sec, '10.0.0.5', 'GET', '/healthz', 200, 2, 0.001, '"kube-probe/1.30"'));
		else if (x < 0.335) {
			const fail = r() < 0.87;
			const status = fail ? (r() < 0.62 ? 502 : 504) : 200;
			out.push(line('14/Oct/2026', 9, sec, '203.0.113.77', 'POST', '/api/v1/export?format=csv&range=365d', status, fail ? 166 : 9_812_331, fail ? 60.001 : 41.2, '"python-requests/2.31.0"'));
		} else {
			const ip = `198.51.100.${1 + Math.floor(r() * 60)}`;
			const p = PATHS[Math.floor(r() * PATHS.length)];
			const y = r();
			const status = y < 0.012 ? 500 : y < 0.04 ? 404 : y < 0.05 ? 304 : 200;
			out.push(line('14/Oct/2026', 9, sec, ip, 'GET', p, status, status === 200 ? 1200 + Math.floor(r() * 9000) : 162, 0.02 + r() * 0.3));
		}
	}
	return out.join('\n') + '\n';
}

function yesterday(): string {
	const r = rng(1902);
	const out: string[] = [];
	for (let i = 0; i < 800; i++) {
		const sec = i * 4.5;
		if (r() < 0.5) out.push(line('13/Oct/2026', 14, sec, '192.0.2.44', 'GET', '/api/v1/search?q=' + 'a'.repeat(1 + Math.floor(r() * 5)), 503, 197, 0.002, '"Go-http-client/1.1"'));
		else out.push(line('13/Oct/2026', 14, sec, `198.51.100.${1 + Math.floor(r() * 60)}`, 'GET', PATHS[Math.floor(r() * PATHS.length)], 200, 3000, 0.05));
	}
	return out.join('\n') + '\n';
}

const errorLog = (() => {
	const r = rng(1903);
	const out: string[] = [];
	for (let i = 0; i < 160; i++) {
		const t = clock(9, i * 22 + Math.floor(r() * 10));
		out.push(
			`2026/10/14 ${t} [error] 1187#1187: *${48211 + i * 7} upstream timed out (110: Connection timed out) while reading response header from upstream, client: 203.0.113.77, server: api.shop.example, request: "POST /api/v1/export?format=csv&range=365d HTTP/1.1", upstream: "http://10.0.2.${11 + (i % 3)}:8080/api/v1/export?format=csv&range=365d", host: "api.shop.example"`
		);
		if (i % 9 === 0) out.push(`2026/10/14 ${t} [warn] 1187#1187: *${48212 + i * 7} an upstream response is buffered to a temporary file /var/cache/nginx/proxy_temp/4/02/0000000024 while reading upstream, client: 198.51.100.${7 + (i % 40)}, server: api.shop.example`);
	}
	return out.join('\n') + '\n';
})();

const scenario: TerminalScenario = {
	title: 'ssh ops@edge-1.prod',
	user: 'ops',
	host: 'edge-1',
	cwd: '/home/ops',
	motd: 'Welcome to edge-1 (Ubuntu 24.04 LTS). nginx 1.24 · 4 vCPU\nLast login: Wed Oct 14 09:52:10 2026 from 10.8.0.14',
	task: 'PagerDuty: **5xx ratio on api.shop.example above 4% for the last hour**. Find the client IP responsible for the most 5xx responses *in the current log* and `submit` it.',
	files: {
		'/var/log/nginx/access.log': today(),
		'/var/log/nginx/access.log.1': yesterday(),
		'/var/log/nginx/access.log.2.gz': '(binary gzip data: use zcat / zgrep)\n',
		'/var/log/nginx/error.log': errorLog,
		'/etc/nginx/nginx.conf':
			'user www-data;\nworker_processes auto;\nevents { worker_connections 4096; }\nhttp {\n    log_format main \'$remote_addr - $remote_user [$time_local] "$request" \'\n                    \'$status $body_bytes_sent "$http_referer" "$http_user_agent" $request_time\';\n    access_log /var/log/nginx/access.log main;\n    include /etc/nginx/conf.d/*.conf;\n}\n',
		'/etc/nginx/conf.d/api.conf':
			'upstream api_pool {\n    server 10.0.2.11:8080;\n    server 10.0.2.12:8080;\n    server 10.0.2.13:8080;\n}\nserver {\n    listen 443 ssl;\n    server_name api.shop.example;\n    proxy_read_timeout 60s;\n    location / { proxy_pass http://api_pool; }\n}\n',
		'/home/ops/README.md': '# edge-1\nLogs: /var/log/nginx (rotated daily at 00:00 UTC by logrotate)\nLog format: see /etc/nginx/nginx.conf (status is field 9, request time is the last field)\n'
	},
	commands: {
		systemctl: routes([[/^status nginx/, '● nginx.service - A high performance web server\n     Loaded: loaded (/lib/systemd/system/nginx.service; enabled)\n     Active: active (running) since Mon 2026-10-12 06:10:44 UTC; 2 days ago\n   Main PID: 1186 (nginx)\n      Tasks: 5 (limit: 9387)']])
	},
	answer: { prompt: 'client IP', check: oneOf('203.0.113.77'), success: 'That client is driving most of the 5xx: a 365-day CSV export that always exceeds the 60 s proxy timeout.' },
	hints: ["head -3 /var/log/nginx/access.log", "awk '{print $9}' /var/log/nginx/access.log | sort | uniq -c", "awk '$9 >= 500 {print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head"],
	solution: ["awk '$9 >= 500 {print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head -3", 'submit 203.0.113.77']
};

export default scenario;
