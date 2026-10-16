import type { TerminalScenario } from '../types';
import { rng } from '../series';
import { oneOf, routes } from '$lib/terminal/scenario';
import { err } from './a19-util';

/**
 * "Cannot assign requested address" on outbound calls. A hardening change narrowed the ephemeral
 * port range to 60000-63000 (3,001 ports) and the fraud client opens a new TCP connection per request
 * (no keep-alive), leaving ~2,900 sockets in TIME-WAIT to one destination. Decoys: many ESTABLISHED
 * connections to Postgres (pooled, healthy) and a noisy DNS log.
 */

function ssLines(): string[] {
	const r = rng(1912);
	const rows: string[] = [];
	for (let i = 0; i < 2911; i++) rows.push(`TIME-WAIT  0      0           10.0.4.31:${60000 + i}        10.0.9.40:8443`);
	for (let i = 0; i < 40; i++) rows.push(`ESTAB      0      0           10.0.4.31:${60000 + 2920 + i}        10.0.5.10:5432`);
	for (let i = 0; i < 25; i++) rows.push(`ESTAB      0      0           10.0.4.31:${45000 + i}        10.0.6.7:6379`);
	for (let i = 0; i < 12; i++) rows.push(`TIME-WAIT  0      0           10.0.4.31:${52000 + Math.floor(r() * 7000)}        10.0.2.11:443`);
	rows.push('ESTAB      0      0           10.0.4.31:22           10.8.0.14:51522');
	rows.push('LISTEN     0      4096        0.0.0.0:8080           0.0.0.0:*');
	// Interleave deterministically so the list doesn't look pre-sorted.
	return rows.map((l, i) => [l, (i * 7919) % rows.length] as const).sort((a, b) => a[1] - b[1]).map(([l]) => l);
}

const SS = ssLines();
const HEAD = 'State      Recv-Q Send-Q      Local Address:Port      Peer Address:Port';

const appLog = Array.from({ length: 80 }, (_, i) =>
	i % 4 === 0
		? `2026-10-14T09:4${Math.floor(i / 10)}:${String(i % 60).padStart(2, '0')}Z ERROR fraud-client POST https://fraud.internal:8443/v1/score failed: connect EADDRNOTAVAIL 10.0.9.40:8443 (Cannot assign requested address)`
		: `2026-10-14T09:4${Math.floor(i / 10)}:${String(i % 60).padStart(2, '0')}Z INFO  checkout order=${90000 + i} scored=${(i % 9) / 10} ms=${38 + (i % 17)}`
).join('\n');

const scenario: TerminalScenario = {
	title: 'ssh ops@checkout-4.prod',
	user: 'ops',
	host: 'checkout-4',
	cwd: '/home/ops',
	motd: 'checkout-4 · Ubuntu 24.04 · last config change: CIS hardening profile applied 2026-10-13',
	task: 'Alert: **checkout-4 fails ~25% of fraud checks with `EADDRNOTAVAIL`** since yesterday\'s hardening rollout. Find the remote `ip:port` that is eating the local ports, and `submit` it.',
	files: {
		'/var/log/checkout/app.log': appLog + '\n',
		'/etc/sysctl.d/99-cis-hardening.conf': '# CIS profile v3 (applied 2026-10-13)\nnet.ipv4.conf.all.rp_filter = 1\nnet.ipv4.tcp_syncookies = 1\nnet.ipv4.ip_local_port_range = 60000 63000\n',
		'/etc/sysctl.conf': '# defaults\n',
		'/opt/checkout/config/fraud-client.yaml': 'endpoint: https://fraud.internal:8443/v1/score\ntimeout_ms: 800\nhttp:\n  keep_alive: false    # "avoid stale connections" (2024)\n  max_idle_per_host: 0\n',
		'/var/log/syslog': 'Oct 14 09:40:01 checkout-4 systemd-resolved[612]: Using degraded feature set UDP instead of UDP+EDNS0 for DNS server 10.0.0.2.\n'.repeat(5)
	},
	commands: {
		ss: (args) => {
			const line = args.join(' ');
			let rows = SS;
			if (/state time-wait/i.test(line)) rows = SS.filter((l) => l.startsWith('TIME-WAIT'));
			else if (/state established/i.test(line)) rows = SS.filter((l) => l.startsWith('ESTAB'));
			if (line.includes('-s') && !/-\w*t\w*a/.test(line)) {
				const tw = SS.filter((l) => l.startsWith('TIME-WAIT')).length;
				const est = SS.filter((l) => l.startsWith('ESTAB')).length;
				return `Total: ${SS.length + 210}\nTCP:   ${SS.length} (estab ${est}, closed 0, orphaned 0, timewait ${tw})\n`;
			}
			return (line.includes('-H') ? '' : HEAD + '\n') + rows.join('\n');
		},
		netstat: () => err('netstat: not installed on this image; use ss'),
		sysctl: routes([
			[/ip_local_port_range/, 'net.ipv4.ip_local_port_range = 60000\t63000'],
			[/tcp_tw_reuse/, 'net.ipv4.tcp_tw_reuse = 2'],
			[/tcp_fin_timeout/, 'net.ipv4.tcp_fin_timeout = 60'],
			[/^-a$/, 'net.ipv4.ip_local_port_range = 60000\t63000\nnet.ipv4.tcp_fin_timeout = 60\nnet.ipv4.tcp_tw_reuse = 2\nnet.ipv4.tcp_syncookies = 1']
		])
	},
	answer: {
		prompt: 'ip:port',
		check: (a) => (/^10\.0\.9\.40:8443$/.test(a.trim()) ? true : a.includes('5432') ? 'Those are pooled, long-lived connections. Count states, not just connections.' : 'Group sockets by peer address.'),
		success: '~2,900 TIME-WAIT sockets to the fraud service (no keep-alive) against a 3,001-port range. Fix: enable keep-alive/pooling in the fraud client and restore a sane port range.'
	},
	hints: ['grep ERROR /var/log/checkout/app.log | head -3', 'ss -s', "ss -tan | awk '{print $1, $5}' | sort | uniq -c | sort -rn | head", 'sysctl net.ipv4.ip_local_port_range'],
	solution: ['ss -s', "ss -tan | awk 'NR > 1 {print $1, $5}' | sort | uniq -c | sort -rn | head -5", 'sysctl net.ipv4.ip_local_port_range', 'cat /opt/checkout/config/fraud-client.yaml', 'submit 10.0.9.40:8443']
};

export default scenario;
