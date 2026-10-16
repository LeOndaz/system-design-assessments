import type { TerminalScenario } from '../types';
import { oneOf } from '$lib/terminal/scenario';
import { err } from './a19-util';

/**
 * ~1 in 3 requests fail TLS. Three backends behind HAProxy (TLS passthrough); one host's
 * certbot renewal has been failing for weeks. Decoy: api-3's cert expires in 18 days (fine for now),
 * and the intermediate chain warning on api-1 is cosmetic for modern clients.
 */

const HOSTS: Record<string, { ip: string; notBefore: string; notAfter: string; serial: string; ok: boolean; chainNote?: string }> = {
	'api-1': { ip: '10.0.2.21', notBefore: 'Sep 20 04:11:02 2026 GMT', notAfter: 'Dec 19 04:11:01 2026 GMT', serial: '04A1F3C2', ok: true },
	'api-2': { ip: '10.0.2.22', notBefore: 'Jul 15 03:00:12 2026 GMT', notAfter: 'Oct 13 03:00:11 2026 GMT', serial: '03B77E10', ok: false },
	'api-3': { ip: '10.0.2.23', notBefore: 'Aug  3 05:42:40 2026 GMT', notAfter: 'Nov  1 05:42:39 2026 GMT', serial: '0391AA5D', ok: true }
};

const hostOf = (target: string) => {
	const h = target.replace(/:443$/, '').replace(/\.internal$/, '');
	return Object.entries(HOSTS).find(([name, v]) => name === h || v.ip === h);
};

function sClient(name: string) {
	const v = HOSTS[name];
	const verify = v.ok ? 'Verify return code: 0 (ok)' : 'Verify return code: 10 (certificate has expired)';
	return `CONNECTED(00000003)
depth=1 C = US, O = Let's Encrypt, CN = R11
verify return:1
depth=0 CN = api.shop.example
${v.ok ? 'verify return:1' : 'verify error:num=10:certificate has expired\nnotAfter=' + v.notAfter + '\nverify return:1'}
---
Certificate chain
 0 s:CN = api.shop.example
   i:C = US, O = Let's Encrypt, CN = R11
   v:NotBefore: ${v.notBefore}; NotAfter: ${v.notAfter}
 1 s:C = US, O = Let's Encrypt, CN = R11
   i:C = US, O = Internet Security Research Group, CN = ISRG Root X1
---
Server certificate
subject=CN = api.shop.example
issuer=C = US, O = Let's Encrypt, CN = R11
---
SSL handshake has read 4632 bytes and written 401 bytes
New, TLSv1.3, Cipher is TLS_AES_256_GCM_SHA384
    ${verify}
---
`;
}

const scenario: TerminalScenario = {
	title: 'ssh ops@lb-1.prod',
	user: 'ops',
	host: 'lb-1',
	cwd: '/home/ops',
	motd: 'lb-1 · HAProxy 2.8 (TCP mode, TLS passthrough to api-1..3)',
	task: 'Mobile team: **"About a third of API calls fail with a certificate error; retries usually work."** HAProxy passes TLS straight through to three backends. Find the backend serving a bad certificate and `submit` its hostname.',
	files: {
		'/dev/null': '',
		'/etc/haproxy/haproxy.cfg':
			'global\n    log /dev/log local0\ndefaults\n    mode tcp\n    timeout connect 5s\n    timeout client 60s\n    timeout server 60s\nfrontend api_tls\n    bind *:443\n    default_backend api_nodes\nbackend api_nodes\n    balance roundrobin\n    server api-1 10.0.2.21:443 check\n    server api-2 10.0.2.22:443 check\n    server api-3 10.0.2.23:443 check\n',
		'/etc/hosts': '127.0.0.1 localhost\n10.0.2.21 api-1.internal api-1\n10.0.2.22 api-2.internal api-2\n10.0.2.23 api-3.internal api-3\n',
		'/var/log/haproxy.log':
			'Oct 14 09:30:11 lb-1 haproxy[812]: 198.51.100.4:51122 [14/Oct/2026:09:30:11.201] api_tls api_nodes/api-1 1/0/412 5231 -- 220/220/219/73/0 0/0\nOct 14 09:30:11 lb-1 haproxy[812]: 198.51.100.9:40411 [14/Oct/2026:09:30:11.288] api_tls api_nodes/api-2 1/0/38 2112 SD 220/220/219/73/0 0/0\nOct 14 09:30:12 lb-1 haproxy[812]: 198.51.100.12:33190 [14/Oct/2026:09:30:12.007] api_tls api_nodes/api-3 1/0/401 5110 -- 221/221/220/73/0 0/0\n',
		'/home/ops/runbooks/certs.md': '# Certificates\nEach api node renews its own cert with certbot (systemd timer). Check expiry with:\n  openssl s_client -connect <host>:443 -servername api.shop.example </dev/null\n  echo | openssl s_client -connect <host>:443 2>/dev/null | openssl x509 -noout -enddate\n'
	},
	commands: {
		openssl: (args, ctx) => {
			const line = args.join(' ');
			if (args[0] === 's_client') {
				const i = args.indexOf('-connect');
				const target = i >= 0 ? args[i + 1] : '';
				const h = hostOf(target ?? '');
				if (!h) return err(`${target}: Name or service not known\nconnect:errno=2`);
				return sClient(h[0]);
			}
			if (args[0] === 'x509') {
				// Piped from s_client: find which cert is on stdin.
				const m = /NotAfter: ([^\n;]+)/.exec(ctx.stdin);
				if (!m) return err('Could not read certificate from <stdin>\nUnable to load certificate');
				const parts: string[] = [];
				if (line.includes('-enddate') || line.includes('-dates')) parts.push(`notAfter=${m[1]}`);
				if (line.includes('-dates')) parts.unshift(`notBefore=${/NotBefore: ([^;]+)/.exec(ctx.stdin)?.[1] ?? ''}`);
				if (line.includes('-subject')) parts.push('subject=CN = api.shop.example');
				if (line.includes('-serial')) parts.push('serial=' + (Object.values(HOSTS).find((v) => v.notAfter === m[1])?.serial ?? ''));
				return parts.join('\n') || 'Certificate: (use -noout -enddate)';
			}
			return err(`openssl: ${args[0] ?? ''}: not available in this sandbox (try s_client or x509)`);
		},
		curl: (args) => {
			const url = args.find((a) => a.startsWith('https://')) ?? '';
			const h = hostOf(url.replace('https://', '').split('/')[0]);
			if (!h) return err(`curl: (6) Could not resolve host: ${url}`);
			if (!h[1].ok) return err('curl: (60) SSL certificate problem: certificate has expired\nMore details here: https://curl.se/docs/sslcerts.html', 60);
			return '{"status":"ok","node":"' + h[0] + '"}';
		},
		ping: (args) => `PING ${args[args.length - 1]}: 56 data bytes\n64 bytes: icmp_seq=0 ttl=64 time=0.41 ms\n64 bytes: icmp_seq=1 ttl=64 time=0.38 ms`
	},
	answer: { prompt: 'hostname', check: oneOf('api-2', 'api-2.internal', '10.0.2.22'), success: 'api-2 expired on Oct 13 03:00 UTC; round-robin sends ~1/3 of handshakes to it, which is why retries "usually work".' },
	hints: ['cat /etc/haproxy/haproxy.cfg', 'openssl s_client -connect api-1:443 -servername api.shop.example', 'curl https://api-2.internal/health'],
	solution: [
		'grep server /etc/haproxy/haproxy.cfg',
		'openssl s_client -connect api-1:443 -servername api.shop.example | openssl x509 -noout -enddate',
		'openssl s_client -connect api-2:443 -servername api.shop.example | openssl x509 -noout -enddate',
		'openssl s_client -connect api-3:443 -servername api.shop.example | openssl x509 -noout -enddate',
		'submit api-2'
	]
};

export default scenario;
