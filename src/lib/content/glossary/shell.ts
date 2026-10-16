import type { GlossaryTerm } from '../types';

const terms: GlossaryTerm[] = [
	{
		id: 'unix-pipeline',
		term: 'Unix pipeline',
		aliases: ['pipe', '|', 'sort | uniq -c'],
		category: 'observability',
		short:
			'Chaining small commands with `|` so each one\'s output becomes the next one\'s input: `awk \'{print $1}\' access.log | sort | uniq -c | sort -rn | head`. Each tool does one job (pick a field, sort, count, rank), and together they answer questions like "which IP sent the most errors?" in seconds, on the host, without a dashboard.',
		analogy: 'An assembly line: one station cuts, the next sorts, the next counts. No station needs to know what the others do.',
		related: ['awk', 'jq'],
		page: [
			{ type: 'heading', text: 'The five pipelines that answer most incident questions' },
			{
				type: 'table',
				head: ['Question', 'Pipeline'],
				rows: [
					['Top talkers (count by a field)', "`awk '{print $1}' access.log | sort | uniq -c | sort -rn | head`"],
					['Only errors, then count', "`awk '$9 >= 500 {print $1}' access.log | sort | uniq -c | sort -rn`"],
					['How many lines match', '`grep -c " 502 " access.log` (counts lines, not matches)'],
					['Sum a column', "`awk '{s += $NF} END {print s}' access.log`"],
					['Percentile of a column', "`awk '{print $NF}' access.log | sort -n | awk '{a[NR]=$1} END {print a[int(NR*0.99)]}'`"]
				]
			},
			{ type: 'heading', text: 'Why `sort` comes before `uniq -c`' },
			{
				type: 'p',
				text: '`uniq` only collapses **adjacent** duplicates. Without sorting first, `a b a` counts as three groups. `sort | uniq -c | sort -rn` is the idiom: group, count, then rank by count (numeric, descending).'
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'Common traps',
				text: '`sort -n` vs plain `sort` (lexical: "10" < "9"). `head` on unsorted counts gives random rows. Fields shift when a value contains spaces (a quoted user agent), so check one line with `head -1` and count fields before trusting `$9`.'
			}
		]
	},
	{
		id: 'awk',
		term: 'awk',
		category: 'observability',
		short:
			'A tiny language for line-by-line text processing. It splits each line into fields (`$1`, `$2`, … `$NF` for the last), runs a `pattern { action }` on matching lines, and can keep running totals or per-key counts in arrays, printed in an `END` block. Ideal for log files whose columns have a fixed meaning.',
		related: ['unix-pipeline', 'jq'],
		page: [
			{
				type: 'code',
				lang: 'text',
				code: `awk '{print $1}' file                        # first field of every line
awk '$9 >= 500' file                          # lines where field 9 >= 500 (prints the line)
awk '$9 >= 500 {print $1, $7}' file           # selected fields of matching lines
awk -F, '{print $2}' file.csv                 # comma separated
awk '/timeout/ {n++} END {print n}' file      # count lines matching a regex
awk '{s += $NF} END {print s/NR}' file        # average of the last field
awk '{c[$1]++} END {for (k in c) print c[k], k}' file | sort -rn   # count per key`,
				caption: 'Fields are split on runs of whitespace by default; `NR` is the line number, `NF` the number of fields.'
			},
			{
				type: 'callout',
				tone: 'info',
				title: 'awk vs grep vs cut',
				text: '`grep` answers "which lines?", `cut` extracts columns with a single fixed delimiter, and `awk` does both plus arithmetic and grouping. When you need a condition on a *column* (status ≥ 500, latency > 2 s), reach for awk.'
			}
		]
	},
	{
		id: 'jq',
		term: 'jq',
		category: 'observability',
		short:
			'A command-line JSON processor: `jq \'.items[] | select(.status == 500) | .path\'`. Filters are pipelines over JSON values, so you can navigate fields, filter, group (`group_by`), and compute (`length`, `add`, `sort`) on structured logs and API responses without writing a script. `-r` prints raw strings, `-c` compact one-line output.',
		related: ['unix-pipeline', 'awk']
	},
	{
		id: 'log-rotation',
		term: 'Log rotation (logrotate)',
		aliases: ['logrotate', 'copytruncate'],
		category: 'cloud & infra',
		short:
			'Periodically renaming the current log (`app.log` → `app.log.1`), compressing old ones and deleting the oldest so logs don\'t fill the disk. The catch: a process that keeps the old file open keeps writing to the renamed (or deleted) file unless it is told to reopen (a signal or restart) or logrotate uses `copytruncate`.',
		related: ['deleted-open-file', 'inode']
	},
	{
		id: 'deleted-open-file',
		term: 'Deleted-but-open file',
		aliases: ['lsof +L1', '(deleted)', 'df vs du mismatch'],
		category: 'cloud & infra',
		short:
			'On Linux, deleting a file only removes its name. The data stays on disk until the last process holding it open closes it. So `df` (which counts used blocks) can say the disk is full while `du` (which walks file names) finds far less. `lsof +L1` lists open files with zero links; restarting the holder, or truncating via `/proc/<pid>/fd/<n>`, frees the space.',
		analogy: 'Crossing a book off the library catalogue doesn\'t free the shelf while someone is still reading it.',
		related: ['lsof', 'log-rotation', 'inode', 'file-descriptor'],
		page: [
			{ type: 'heading', text: 'How to spot it' },
			{
				type: 'list',
				items: [
					'`df -h` says 97% used; `du -sh /*` adds up to much less. The gap is space held by deleted files.',
					'`sudo lsof +L1` (or `lsof | grep deleted`) shows `NAME … (deleted)` with a huge SIZE/OFF and the PID holding it.',
					'Usually a log that logrotate (or a human) deleted while the app still had it open.'
				]
			},
			{
				type: 'code',
				lang: 'text',
				code: `$ sudo lsof +L1
COMMAND  PID   USER  FD  TYPE  SIZE/OFF     NLINK NAME
java    4127 ledger  7w  REG   63672959795  0     /var/log/ledger/ledger.log.1 (deleted)

# free the space without a restart (data in that file is lost):
$ sudo truncate -s 0 /proc/4127/fd/7
# or the clean way: restart / signal the app so it reopens its log`
			},
			{
				type: 'callout',
				tone: 'warn',
				text: 'Deleting more files will not help: you are deleting names, not blocks. Fix the cause too: `copytruncate` or a postrotate reload in logrotate, so the app never holds a rotated file for weeks.'
			}
		]
	},
	{
		id: 'user-crontab',
		term: 'User crontab',
		aliases: ['crontab -l', '/var/spool/cron/crontabs', '/etc/cron.d'],
		category: 'cloud & infra',
		short:
			'Cron reads schedules from several places: `/etc/crontab`, files in `/etc/cron.d/` (both with a user column), and per-user crontabs edited with `crontab -e` (stored under `/var/spool/cron/crontabs/<user>`, no user column). A job "running twice" is often the same command scheduled in two of these places, and the per-user one is easy to miss because config management doesn\'t look there.',
		related: ['cron', 'duplicate-scheduler']
	},
	{
		id: 'time-wait',
		term: 'TIME-WAIT',
		aliases: ['TIME_WAIT', 'tcp time wait'],
		category: 'frontend & network',
		short:
			'The state a TCP socket stays in (typically ~60 s on Linux) after the side that closed it first, so late packets from the old connection can\'t be mistaken for a new one. Each socket in TIME-WAIT still occupies a local port for that destination. Opening a fresh connection per request (no keep-alive) at high rate can exhaust the ephemeral port range and fail with `EADDRNOTAVAIL`.',
		related: ['ephemeral-ports', 'connection-pool', 'tcp']
	},
	{
		id: 'oom-killer',
		term: 'OOM killer',
		aliases: ['Out of memory: Killed process'],
		category: 'cloud & infra',
		short:
			'The Linux kernel mechanism that kills a process when memory runs out. It picks a *victim* by a score (mostly current memory use), not the process that caused the growth, so the killed process is often innocent. Find the cause by comparing memory over time, not by reading the victim\'s name in the kernel log.',
		related: ['oomkilled', 'memory-leak', 'rss-memory']
	},
	{
		id: 'pg-blocking-pids',
		term: 'pg_blocking_pids()',
		category: 'databases',
		short:
			'A Postgres function that returns the PIDs blocking a given session\'s lock request. Following it repeatedly (blocked → blocker → its blocker) walks a lock chain to the root: often an `idle in transaction` session that holds a lock while nobody is using it, with a DDL statement queued behind it and all normal traffic queued behind the DDL.',
		related: ['lock-queue', 'idle-in-transaction', 'pg-stat-activity']
	},
	{
		id: 'nginx-location-matching',
		term: 'nginx location matching',
		aliases: ['location ^~', 'regex location'],
		category: 'frontend & network',
		short:
			'How nginx picks a `location` block: exact matches (`=`) win immediately; otherwise it remembers the longest matching prefix, then checks regex locations (`~`, `~*`) in file order and uses the first one that matches. Only if no regex matches does the longest prefix win, unless that prefix is marked `^~`, which skips the regex check.',
		related: ['load-balancer'],
		page: [
			{
				type: 'table',
				head: ['Order', 'Modifier', 'Meaning'],
				rows: [
					['1', '`location = /path`', 'Exact match: chosen immediately'],
					['2', '`location ^~ /prefix`', 'Longest prefix, and stop: regexes are not checked'],
					['3', '`location ~ regex` / `~*`', 'Checked in file order after the prefix search; first match wins'],
					['4', '`location /prefix`', 'Longest plain prefix: used only if no regex matched']
				]
			},
			{
				type: 'code',
				lang: 'text',
				code: `location /api/v2/   { proxy_pass http://v2_pool; }   # longest prefix for /api/v2/orders…
location ~ ^/api/   { proxy_pass http://v1_pool; }   # …but this regex matches too, and wins

# fix: make the prefix final
location ^~ /api/v2/ { proxy_pass http://v2_pool; }`
			},
			{ type: 'p', text: 'Test with `curl -sI` and a response header that names the upstream, or `nginx -T` to see the merged config.' }
		]
	},
	{
		id: 'git-history-secrets',
		term: 'Secrets in git history',
		aliases: ['git log -S', 'leaked key'],
		category: 'security & compliance',
		short:
			'Removing a committed secret in a later commit does not remove it from history: every clone and mirror still has the old commit. `git log -S <string>` finds the commits that added or removed it. The fix is to **rotate the secret** (assume it is compromised) and check its usage logs; rewriting history is optional cleanup, not remediation.',
		related: ['secret-rotation', 'least-privilege']
	},
	{
		id: 'kubectl-logs-previous',
		term: 'kubectl logs --previous',
		category: 'cloud & infra',
		short:
			'Shows the logs of the *previous* (crashed) container instance of a pod. In a CrashLoopBackOff the current container has often just restarted and printed only its startup banner; the stack trace that explains the crash lives in the previous instance.',
		related: ['crashloopbackoff', 'kubernetes']
	},
	{
		id: 'dns-resolver',
		term: 'Recursive DNS resolver',
		aliases: ['resolver', '/etc/resolv.conf', 'authoritative nameserver'],
		category: 'frontend & network',
		short:
			'The server your machine asks for DNS answers (listed in `/etc/resolv.conf`). It looks names up on your behalf and caches each answer for its TTL. The *authoritative* nameserver holds the real records; a resolver can keep serving an old answer until the cached TTL expires, so `dig @resolver` and `dig @authoritative` can disagree.',
		related: ['dns-ttl', 'dns-caching', 'cname-record', 'negative-caching']
	},
	{
		id: 'sysctl',
		term: 'sysctl',
		aliases: ['/etc/sysctl.d', 'kernel parameters'],
		category: 'cloud & infra',
		short:
			'The interface for reading and setting Linux kernel parameters at runtime (`sysctl net.ipv4.ip_local_port_range`), persisted in `/etc/sysctl.d/*.conf`. Hardening profiles change these; a tightened value (fewer ephemeral ports, smaller backlogs) can surface as an application error far from the change.',
		related: ['ephemeral-ports', 'time-wait']
	}
];

export default terms;
