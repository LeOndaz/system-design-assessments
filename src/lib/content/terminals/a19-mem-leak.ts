import type { TerminalScenario } from '../types';
import { oneOf } from '$lib/terminal/scenario';

/**
 * Hourly `ps` snapshots over 24 h. postgres has the biggest RSS but is flat (shared buffers);
 * gunicorn workers saw-tooth because max_requests recycles them; image-worker (pid 2231) grows
 * ~140 MB/h monotonically, the leak. The OOM killer log names a victim (gunicorn) that is not the cause.
 */

function snapshot(h: number) {
	const rows = [
		['postgres', 1310, 2_031_120 + (h % 3) * 1200],
		['gunicorn', 1880 + Math.floor(h / 6), 512_000 + ((h % 6) * 61_000)],
		['gunicorn', 1890 + Math.floor(h / 6), 498_000 + (((h + 2) % 6) * 60_200)],
		['image-worker', 2231, 380_000 + h * 143_500],
		['nginx', 990, 18_200],
		['node_exporter', 802, 21_400 + (h % 2) * 300]
	] as const;
	const head = '    PID USER      %MEM    RSS COMMAND';
	const body = rows.map(([cmd, pid, rss]) => `${String(pid).padStart(7)} ${cmd === 'postgres' ? 'postgres' : 'app     '}  ${((rss / 16_000_000) * 100).toFixed(1).padStart(4)} ${String(rss).padStart(7)} ${cmd}`);
	return `# snapshot 2026-10-13T${String(h).padStart(2, '0')}:00:00Z (RSS in KiB)\n${head}\n${body.join('\n')}\n`;
}

const files: Record<string, string> = {};
for (let h = 0; h < 24; h++) files[`/var/log/psmon/ps-2026-10-13T${String(h).padStart(2, '0')}.txt`] = snapshot(h);
files['/var/log/kern.log'] =
	'Oct 14 00:41:12 worker-3 kernel: [3512.441] Out of memory: Killed process 1893 (gunicorn) total-vm:1622340kB, anon-rss:842112kB, file-rss:0kB, shmem-rss:0kB, UID:1001 pgtables:2012kB oom_score_adj:0\nOct 14 00:41:12 worker-3 kernel: [3512.447] oom_reaper: reaped process 1893 (gunicorn), now anon-rss:0kB\n';
files['/etc/gunicorn.conf.py'] = 'workers = 2\nmax_requests = 5000          # recycle workers periodically\nmax_requests_jitter = 500\n';
files['/etc/postgresql/16/main/postgresql.conf'] = 'shared_buffers = 2GB\nwork_mem = 16MB\n';
files['/opt/image-worker/CHANGELOG'] = '1.8.0 (2026-10-12): cache decoded thumbnails in-process for speed (lru not yet wired up)\n';

const scenario: TerminalScenario = {
	title: 'ssh ops@worker-3.prod',
	user: 'ops',
	host: 'worker-3',
	cwd: '/home/ops',
	motd: 'worker-3 · 16 GB RAM · psmon writes hourly snapshots to /var/log/psmon/',
	task: 'Overnight the kernel **OOM-killed a process on worker-3** and it will happen again tonight. The hourly `ps` snapshots for yesterday are in `/var/log/psmon/`. Find the process that is actually leaking and `submit` its name.',
	files,
	commands: {
		ps: () =>
			'    PID USER      %MEM    RSS COMMAND\n   1310 postgres  12.7 2033520 postgres\n   1884 app        3.8  610800 gunicorn\n   1894 app        3.6  580100 gunicorn\n   2231 app       23.4 3741500 image-worker\n    990 www-data   0.1   18200 nginx\n',
		free: () => '               total        used        free      shared  buff/cache   available\nMem:            15Gi        12Gi       420Mi       2.1Gi       2.6Gi       1.1Gi\nSwap:             0B          0B          0B\n'
	},
	answer: {
		prompt: 'process name',
		check: (a) => (/^(image-worker|2231)$/.test(a.trim()) ? true : a.includes('gunicorn') ? 'gunicorn was the OOM victim. Is it the one growing?' : a.includes('postgres') ? 'Biggest is not the same as growing.' : 'Compare RSS across snapshots.'),
		success: 'image-worker grows ~140 MB every hour without ever dropping (in-process thumbnail cache with no eviction). The OOM killer picked a gunicorn worker as the victim, but it was not the cause.'
	},
	hints: ['ls /var/log/psmon | head', 'cat /var/log/psmon/ps-2026-10-13T00.txt', 'grep -h image-worker /var/log/psmon/*', "grep -h gunicorn /var/log/psmon/* | awk '{print $1, $4}'"],
	solution: ['cat /var/log/kern.log', 'cat /var/log/psmon/ps-2026-10-13T00.txt', 'grep -h image-worker /var/log/psmon/*', 'grep -h postgres /var/log/psmon/*', 'submit image-worker']
};

export default scenario;
