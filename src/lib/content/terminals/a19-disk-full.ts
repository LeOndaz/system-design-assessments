import type { TerminalScenario } from '../types';
import { oneOf, routes } from '$lib/terminal/scenario';
import { fakeDu, human } from './a19-util';

/**
 * df says 97% used, du only finds ~38 GB. The gap is a 58 GB log that logrotate deleted while
 * the JVM still holds it open. Decoys: /var/lib/docker and the journal look big but are normal.
 */

const G = 1024 ** 3;
const M = 1024 ** 2;

const sizes: Record<string, number> = {
	'/usr/lib/x86_64-linux-gnu/libLLVM.so.17': 0.9 * G,
	'/usr/share/doc/README': 0.3 * G,
	'/usr/bin/java': 2.1 * G,
	'/opt/ledger/lib/ledger-service.jar': 0.28 * G,
	'/var/lib/docker/overlay2/3f1c/diff/layer.tar': 11.2 * G,
	'/var/lib/docker/overlay2/9a0e/diff/layer.tar': 6.9 * G,
	'/var/lib/postgresql/16/main/base/16384/2619': 9.4 * G,
	'/var/log/journal/7f3c/system.journal': 2.4 * G,
	'/var/log/ledger/ledger.log': 412 * M,
	'/var/log/ledger/ledger.log.2.gz': 96 * M,
	'/var/log/ledger/gc.log': 38 * M,
	'/var/log/syslog': 140 * M,
	'/var/log/syslog.1': 210 * M,
	'/var/cache/apt/archives/pkgs.deb': 1.1 * G,
	'/home/ops/heapdump-2026-09-30.hprof': 1.8 * G,
	'/tmp/ledger-export.csv': 0.2 * G
};

const total = Object.values(sizes).reduce((a, b) => a + b, 0);
const DELETED = 59.3 * G;
const DISK = 100 * G;

const files: Record<string, string> = Object.fromEntries(Object.keys(sizes).map((p) => [p, '']));
Object.assign(files, {
	'/var/log/ledger/ledger.log': '2026-10-14T09:40:01Z INFO  ledger.posting batch=88123 entries=512 ms=41\n2026-10-14T09:40:02Z ERROR ledger.audit write failed: No space left on device (ENOSPC)\n2026-10-14T09:40:02Z ERROR ledger.posting failed to append audit record, rejecting batch=88124\n',
	'/etc/logrotate.d/ledger':
		'/var/log/ledger/ledger.log {\n    daily\n    rotate 7\n    compress\n    delaycompress\n    missingok\n    notifempty\n    # copytruncate   <- removed in commit 5e1d2 "simplify logrotate"\n    create 0640 ledger ledger\n}\n',
	'/etc/systemd/system/ledger.service':
		'[Unit]\nDescription=Ledger service\n[Service]\nUser=ledger\nExecStart=/usr/bin/java -Xmx6g -jar /opt/ledger/lib/ledger-service.jar --log-file=/var/log/ledger/ledger.log\nRestart=on-failure\n[Install]\nWantedBy=multi-user.target\n',
	'/home/ops/NOTES.md': '- 2026-09-30 took a heap dump for the leak investigation (can be deleted)\n- docker images pruned weekly by cron\n'
});

const lsofAll = `COMMAND     PID     USER   FD   TYPE DEVICE     SIZE/OFF    NODE NAME
systemd       1     root  cwd    DIR  259,1         4096       2 /
sshd       1022     root    3u  IPv4  23811          0t0     TCP *:22 (LISTEN)
postgres   1310 postgres  txt    REG  259,1      9874432 1311021 /usr/lib/postgresql/16/bin/postgres
postgres   1310 postgres    7u   REG  259,1   1073741824 2049133 /var/lib/postgresql/16/main/base/16384/2619
dockerd    1402     root    9u  unix 0x0000             0t0   31882 /run/docker.sock
java       4127   ledger  txt    REG  259,1        16224 1572911 /usr/bin/java
java       4127   ledger    1w   REG  259,1    432013312 2621470 /var/log/ledger/ledger.log
java       4127   ledger    7w   REG  259,1  63672959795 2621377 /var/log/ledger/ledger.log.1 (deleted)
java       4127   ledger   12u  IPv4  91221          0t0     TCP 10.0.4.21:8080 (LISTEN)
rsyslogd    988   syslog    7w   REG  259,1    146800640 2621202 /var/log/syslog
`;

const scenario: TerminalScenario = {
	title: 'ssh ops@ledger-2.prod',
	user: 'ops',
	host: 'ledger-2',
	cwd: '/home/ops',
	motd: 'ledger-2 · Ubuntu 24.04 · 100G root volume',
	task: 'Alert: **ledger-2 root filesystem 97% full; ledger rejecting batches (ENOSPC)**. Someone already deleted old logs and it did not help. Find the PID of the process that is still holding the space, and `submit` it.',
	files,
	commands: {
		df: (args) => {
			const used = total + DELETED;
			if (args.some((a) => a.includes('i')))
				return 'Filesystem       Inodes  IUsed   IFree IUse% Mounted on\n/dev/nvme0n1p1  6553600 214551 6339049    4% /\n';
			const h = args.some((a) => a.includes('h'));
			const f = (b: number) => (h ? human(b) : String(Math.round(b / 1024)));
			return `Filesystem      ${h ? ' Size  Used Avail' : '1K-blocks      Used Available'} Use% Mounted on\n/dev/nvme0n1p1  ${f(DISK)}  ${f(used)}  ${f(DISK - used)}  ${Math.round((used / DISK) * 100)}% /\ntmpfs           ${f(7.8 * G)}     0  ${f(7.8 * G)}   0% /dev/shm\n`;
		},
		du: fakeDu(sizes),
		lsof: (args) => {
			const line = args.join(' ');
			if (line.includes('+L1') || line.includes('+L 1'))
				return 'COMMAND  PID   USER   FD   TYPE DEVICE    SIZE/OFF NLINK    NODE NAME\njava    4127 ledger    7w   REG  259,1 63672959795     0 2621377 /var/log/ledger/ledger.log.1 (deleted)\n';
			const m = /-p\s*(\d+)/.exec(line);
			if (m) return lsofAll.split('\n').filter((l, i) => i === 0 || l.split(/\s+/)[1] === m[1]).join('\n') + '\n';
			return lsofAll;
		},
		systemctl: routes([
			[/^status ledger/, '● ledger.service - Ledger service\n     Active: active (running) since Thu 2026-09-17 03:12:09 UTC; 4 weeks 0 days ago\n   Main PID: 4127 (java)\n     Memory: 5.9G'],
			[/^restart ledger/, (_m, ctx) => ((ctx.state.restarted = true), '')]
		]),
		ps: () => '    PID USER       %CPU %MEM    RSS COMMAND\n      1 root        0.0  0.1  12044 /sbin/init\n    988 syslog      0.1  0.0   6120 /usr/sbin/rsyslogd -n\n   1310 postgres    2.1 12.4 2031123 postgres: 16/main\n   1402 root        0.4  0.9 151200 /usr/bin/dockerd\n   4127 ledger     38.2 37.1 6091234 /usr/bin/java -Xmx6g -jar /opt/ledger/lib/ledger-service.jar\n'
	},
	answer: { prompt: 'pid', check: oneOf('4127'), success: 'The JVM still has the deleted ledger.log.1 (59 GB) open on fd 7. Space is only freed when the last file descriptor closes.' },
	hints: ['df -h', 'sudo du -sh /var/* /home/* /opt', 'sudo lsof +L1'],
	solution: ['df -h', 'sudo du -sh /var /usr /opt /home /tmp', 'sudo lsof +L1', 'submit 4127']
};

export default scenario;
