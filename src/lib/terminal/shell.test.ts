import { describe, expect, it } from 'vitest';
import { Shell } from './shell';
import { routes, oneOf } from './scenario';
import type { TerminalScenario } from '$lib/content/types';

const scenario: TerminalScenario = {
	user: 'ops',
	host: 'api-1',
	files: {
		'/var/log/nginx/access.log': [
			'10.0.0.1 - - [14/Oct/2026:09:00:01] "GET /api/orders HTTP/1.1" 200 512 0.120',
			'10.0.0.2 - - [14/Oct/2026:09:00:02] "GET /api/orders HTTP/1.1" 500 87 2.301',
			'10.0.0.1 - - [14/Oct/2026:09:00:03] "POST /api/pay HTTP/1.1" 502 0 30.001',
			'10.0.0.3 - - [14/Oct/2026:09:00:04] "GET /health HTTP/1.1" 200 2 0.001',
			'10.0.0.1 - - [14/Oct/2026:09:00:05] "GET /api/orders HTTP/1.1" 500 87 2.410'
		].join('\n') + '\n',
		'/etc/app/config.json': JSON.stringify({ db: { host: 'db-1', pool: 20 }, flags: [{ name: 'a', on: true }, { name: 'b', on: false }] }),
		'/home/ops/notes.txt': 'hello\nworld\n'
	},
	commands: { kubectl: routes([[/^get pods$/, 'NAME   STATUS\napi-1  Running']]) },
	answer: { prompt: 'ip', check: oneOf('10.0.0.1') },
	solution: []
};

const run = (sh: Shell, l: string) => sh.run(l).text;

describe('shell', () => {
	it('pipes, awk, sort, uniq', () => {
		const sh = new Shell(scenario);
		expect(run(sh, "awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head -1")).toBe('      3 10.0.0.1\n');
		expect(run(sh, "awk '$8 >= 500 {print $8}' /var/log/nginx/access.log | sort | uniq -c")).toBe('      2 500\n      1 502\n');
		expect(run(sh, "awk '{s += $NF} END {printf \"%.2f\\n\", s}' /var/log/nginx/access.log")).toBe('34.83\n');
		expect(run(sh, "awk '{c[$1]++} END {for (k in c) print k, c[k]}' /var/log/nginx/access.log | sort")).toBe('10.0.0.1 3\n10.0.0.2 1\n10.0.0.3 1\n');
		expect(run(sh, "awk '$6 ~ /pay/ {print $1 \" -> \" $8}' /var/log/nginx/access.log")).toBe('10.0.0.1 -> 502\n');
	});
	it('grep flags', () => {
		const sh = new Shell(scenario);
		expect(run(sh, 'grep -c " 500 " /var/log/nginx/access.log')).toBe('2\n');
		expect(run(sh, 'grep -rl orders /var/log')).toBe('/var/log/nginx/access.log\n');
		expect(run(sh, "grep -oE '\"[A-Z]+ [^ ]+' /var/log/nginx/access.log | sort -u")).toContain('"POST /api/pay');
	});
	it('jq', () => {
		const sh = new Shell(scenario);
		expect(run(sh, 'jq -r .db.host /etc/app/config.json')).toBe('db-1\n');
		expect(run(sh, "jq -r '.flags[] | select(.on) | .name' /etc/app/config.json")).toBe('a\n');
		expect(run(sh, "jq '.flags | map(.name) | length' /etc/app/config.json")).toBe('2\n');
	});
	it('fs, cd, redirects, globs, sed, find', () => {
		const sh = new Shell(scenario);
		run(sh, 'cd /var/log/nginx && cut -d" " -f1 access.log > /tmp/ips');
		expect(sh.cwd).toBe('/var/log/nginx');
		expect(run(sh, 'wc -l /tmp/ips')).toBe('5 /tmp/ips\n');
		expect(run(sh, 'ls /var/log/*/')).toBe('access.log\n');
		expect(run(sh, "sed -n '2p' ~/notes.txt")).toBe('world\n');
		expect(run(sh, "sed 's/o/0/g' ~/notes.txt")).toBe('hell0\nw0rld\n');
		expect(run(sh, 'find / -name "*.json"')).toBe('/etc/app/config.json\n');
		expect(run(sh, 'nope')).toContain('command not found');
		expect(run(sh, 'false && echo no || echo yes')).toBe('yes\n');
	});
	it('for loops, jq -s, </dev/null', () => {
		const sh = new Shell(scenario);
		expect(run(sh, 'for h in a b c; do echo host-$h; done')).toBe('host-a\nhost-b\nhost-c\n');
		expect(run(sh, 'for f in /etc/app/*.json; do jq -r .db.pool $f; done')).toBe('20\n');
		expect(run(sh, "echo '{\"a\":1}' > /tmp/x.json && echo '{\"a\":2}' >> /tmp/x.json && jq -s 'map(.a) | add' /tmp/x.json")).toBe('3\n');
		expect(run(sh, 'cat < /dev/null')).toBe('');
	});

	it('scenario commands and submit', () => {
		const sh = new Shell(scenario);
		expect(run(sh, 'kubectl get pods')).toContain('Running');
		expect(run(sh, 'kubectl get svc')).toContain('unsupported');
		expect(run(sh, 'submit 10.0.0.2')).toContain('Not quite');
		expect(run(sh, 'submit 10.0.0.1')).toContain('Correct');
		expect(sh.solved).toBe(true);
	});
});
