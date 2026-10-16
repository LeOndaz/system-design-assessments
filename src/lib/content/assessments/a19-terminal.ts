import type { Assessment } from '../types';
import nginx5xx from '../terminals/a19-nginx-5xx';
import jqP99, { P99 } from '../terminals/a19-jq-p99';
import memLeak from '../terminals/a19-mem-leak';
import diskFull from '../terminals/a19-disk-full';
import cronTwice from '../terminals/a19-cron-twice';
import ports from '../terminals/a19-ports';
import certExpiry from '../terminals/a19-cert-expiry';
import dnsStale from '../terminals/a19-dns-stale';
import nginxRoute from '../terminals/a19-nginx-route';
import k8sCrash from '../terminals/a19-k8s-crashloop';
import pgLocks from '../terminals/a19-pg-locks';
import gitSecret from '../terminals/a19-git-secret';

const p99Rows = [...P99].sort((a, b) => b.p99 - a.p99).map((r) => [`\`${r.route}\``, String(r.n), String(r.avg), String(r.p99)]);

const assessment: Assessment = {
	id: 'terminal',
	number: 19,
	title: 'Terminal investigations',
	tagline: 'Twelve live shells. Logs, disks, crons, certs, DNS, nginx, Kubernetes, Postgres, git. Find it, submit it.',
	description:
		'Every question is a real-feeling sandbox: a filesystem full of logs, configs and decoys, plus the tools you would reach for on call (`grep`, `awk`, `jq`, `du`, `lsof`, `ss`, `dig`, `openssl`, `kubectl`, `psql`, `git`). Investigate, then `submit` the answer. The model answer shows the shortest path and the red herrings you should have dismissed.',
	minutes: 146,
	difficulty: 'advanced',
	track: 'interactive',
	topics: ['shell', 'logs', 'linux', 'networking', 'kubernetes', 'postgres', 'git'],
	overview: [
		{
			type: 'budget',
			items: [
				{ label: '1 · Logs & text', minutes: 32 },
				{ label: '2 · Hosts', minutes: 34 },
				{ label: '3 · Network & TLS', minutes: 32 },
				{ label: '4 · Platforms', minutes: 36 },
				{ label: 'Rapid fire', minutes: 12 }
			]
		},
		{
			type: 'cards',
			items: [
				{ title: '1 · Orient', items: ['Read the alert literally: *which* number, *which* window, *which* host.', '`ls`, `cat README`, `cat /etc/<service>` before grepping blindly.', 'Look at one raw line (`head -1`) and count fields before trusting `$9`.'] },
				{ title: '2 · Narrow', items: ['Filter to the symptom first (status ≥ 500, state = waiting), then group.', 'Group and rank: `sort | uniq -c | sort -rn | head`.', 'Compare against a baseline: another host, another resolver, yesterday.'] },
				{ title: '3 · Prove', items: ['One command that shows the mechanism, not just the correlation.', 'Name the decoy you dismissed and why.', 'Fix the instance *and* the cause (config, timeout, keep-alive).'] }
			]
		},
		{
			type: 'callout',
			tone: 'info',
			title: 'How the sandbox works',
			text: 'Type `help` for the command list. Pipes, `&&`, redirects, globs and `$VARS` work; Tab completes, ↑/↓ recall history. Scenario tools (`kubectl`, `psql -c`, `dig`, `openssl`, `git`…) understand the common subcommands. Nothing leaves your browser. `reset` restores the initial state.'
		}
	],
	parts: [
		// ───────────────────────── PART 1 ─────────────────────────
		{
			id: 'p1',
			nav: '1 · Logs & text',
			eyebrow: 'Part 1 · 32 minutes · text processing',
			title: 'Make the logs talk',
			meta: '[[unix-pipeline|pipelines]] · [[awk]] · [[jq]] · snapshots over time',
			minutes: 32,
			questions: [
				{
					id: 'l1',
					title: 'Who is behind the 5xx spike?',
					tag: 'core',
					minutes: 10,
					prompt: [{ type: 'terminal', terminal: nginx5xx }],
					hints: ['The client with the most requests is not the client with the most errors.', 'Filter on the status column first (`$9 >= 500`), then group by IP. And stay in the current file.'],
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `$ head -1 /var/log/nginx/access.log                 # confirm field positions
$ awk '{print $1}' access.log | sort | uniq -c | sort -rn | head -2
    366 10.0.0.5          <- kube-probe: the most traffic, all 200s
    102 203.0.113.77
$ awk '$9 >= 500 {print $1}' access.log | sort | uniq -c | sort -rn | head -3
     94 203.0.113.77      <- 94 of the 102 5xx in the hour
$ awk '$1 == "203.0.113.77" {print $9}' access.log | sort | uniq -c
      8 200
     64 502
     30 504`,
							caption: 'Answer: **203.0.113.77**, a client pulling `POST /api/v1/export?range=365d` (each run is longer than `proxy_read_timeout 60s`).'
						},
						{
							type: 'ranked',
							items: [
								{ title: 'Decoy 1: the health checker.', body: '`10.0.0.5` is the top talker (366 requests) but every response is a 200. Ranking by volume instead of by errors points at it.' },
								{ title: 'Decoy 2: yesterday\'s log.', body: '`access.log.1` has `192.0.2.44` with 391 × 503: a bigger number, from a different day. The alert is about the last hour; `grep -r` across the directory mixes them.' },
								{ title: 'Confirm the mechanism.', body: '`grep 203.0.113.77 error.log | head` shows "upstream timed out … while reading response header": the export takes longer than the 60 s proxy timeout.' }
							]
						},
						{
							type: 'p',
							text: '**Mitigate:** rate-limit that client/endpoint (`limit_req` on `/api/v1/export`) or block it while you talk to its owner. **Fix:** make exports asynchronous (job + download link) instead of a 40–60 s synchronous request holding an upstream connection.'
						}
					]
				},
				{
					id: 'l2',
					title: 'The average lies: which route breaks the p99 SLO?',
					tag: 'tricky',
					minutes: 12,
					prompt: [{ type: 'terminal', terminal: jqP99 }],
					hints: ['The dashboard export ranks by average. The SLO is on [[percentiles|p99]].', 'Group by route, sort each group\'s `ms`, take the element at index `floor(n × 0.99)`.'],
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `$ jq -c 'group_by(.route) | map({route: .[0].route, n: length,
      avg: ((map(.ms) | add) / length | floor),
      p99: (map(.ms) | sort | .[(length * 0.99 | floor)])})' /var/log/api/requests.json

# one-route alternative with plain tools:
$ jq -r '.[] | select(.route=="/api/checkout") | .ms' requests.json | sort -n \\
    | awk '{a[NR]=$1} END {print a[int(NR*0.99)]}'`
						},
						{ type: 'table', head: ['Route', 'n', 'avg ms', 'p99 ms'], rows: p99Rows, numeric: [1, 2, 3] },
						{
							type: 'p',
							text: 'Answer: **/api/checkout**. About 2.5% of checkouts hit a ~4 s fraud-check timeout; 97.5% are fast, so the average (≈233 ms) looks healthy while p99 is ≈4.1 s. `/api/reports` has the worst average because it is a [[bimodal-distribution|bimodal]] batch endpoint (0.9 s or 1.8 s), but its p99 stays under 2 s.'
						},
						{
							type: 'callout',
							tone: 'warn',
							text: 'Averages hide tails; percentiles hide *which* requests. Next step: split checkout p99 by `status` (the 504s) and by `region` before blaming the fraud service.'
						}
					]
				},
				{
					id: 'l3',
					title: 'The OOM killer shot the wrong process',
					tag: 'tricky',
					minutes: 10,
					prompt: [{ type: 'terminal', terminal: memLeak }],
					hints: ['The [[oom-killer]] picks a victim by memory score, not the cause.', 'Compare one process\'s RSS across all 24 snapshots: `grep -h <name> /var/log/psmon/*`.'],
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `$ cat /var/log/kern.log                      # victim: gunicorn (pid 1893)
$ grep -h image-worker /var/log/psmon/*        # 380,000 → 3,680,500 KiB, +143,500 KiB every hour
$ grep -h gunicorn /var/log/psmon/*            # 512,000 → 817,000 KiB, then back down: max_requests recycling
$ grep -h postgres /var/log/psmon/*            # ~2.0 GiB, flat (shared_buffers = 2GB)`,
							caption: 'Answer: **image-worker** (pid 2231).'
						},
						{
							type: 'ranked',
							items: [
								{ title: 'Growth, not size.', body: 'postgres has the biggest RSS but it is flat: that is its configured buffer cache. A leak is a slope that never comes down.' },
								{ title: 'Sawtooth is healthy here.', body: 'gunicorn climbs and drops every ~6 h because `max_requests` recycles workers. That is a mitigation for *its* slow growth, and it is why it was the convenient victim at 00:41.' },
								{ title: 'The cause.', body: 'image-worker 1.8.0 added an in-process thumbnail cache "lru not yet wired up": an unbounded cache, ~140 MB/h, ~3.4 GB/day on a 16 GB box shared with Postgres.' }
							]
						},
						{ type: 'p', text: '**Mitigate:** restart image-worker on a schedule or set a memory limit (cgroup / `MemoryMax=`) so *it* is killed, not gunicorn. **Fix:** bound the cache (LRU by bytes), and alert on per-process RSS slope, not just host memory.' }
					]
				}
			]
		},

		// ───────────────────────── PART 2 ─────────────────────────
		{
			id: 'p2',
			nav: '2 · Hosts',
			eyebrow: 'Part 2 · 34 minutes · Linux hosts',
			title: 'Disks, schedules and sockets',
			meta: '[[deleted-open-file|df vs du]] · [[user-crontab|crontabs]] · [[time-wait|TIME-WAIT]]',
			minutes: 34,
			questions: [
				{
					id: 'h1',
					title: 'Disk full, but nothing is big',
					tag: 'tricky',
					minutes: 12,
					prompt: [{ type: 'terminal', terminal: diskFull }],
					hints: ['Add up what `du` finds and compare it with what `df` says is used.', 'Space can be held by files that no longer have a name.'],
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `$ df -h                                   # 97G used of 100G
$ sudo du -sh /var /usr /opt /home /tmp   # ≈ 38G in total: 59G unaccounted for
$ sudo lsof +L1                           # open files with zero links
java 4127 ledger 7w REG … 63672959795 0 … /var/log/ledger/ledger.log.1 (deleted)`,
							caption: 'Answer: **4127**, the ledger JVM, still writing to a 59 GiB log that logrotate renamed and later deleted.'
						},
						{
							type: 'ranked',
							items: [
								{ title: 'Why deleting logs "didn\'t help".', body: 'Deleting removes the name; blocks are freed when the last open file descriptor closes ([[deleted-open-file]]). `/etc/logrotate.d/ledger` had `copytruncate` removed, and the JVM never reopens its log, so it kept writing to the rotated file for four weeks.' },
								{ title: 'Decoys.', body: '`/var/lib/docker` (18 GB) and the journal (2.4 GB) are large but normal and `du` *can* see them; the old heap dump (1.8 GB) is worth deleting but doesn\'t explain 59 GB.' }
							]
						},
						{
							type: 'p',
							text: '**Mitigate now:** `sudo systemctl restart ledger` (or `truncate -s 0 /proc/4127/fd/7` if a restart is worse than losing that log). **Fix:** restore `copytruncate` or add a `postrotate` that makes the app reopen logs; alert on df-vs-du divergence.'
						}
					]
				},
				{
					id: 'h2',
					title: 'Every invoice, twice',
					tag: 'core',
					minutes: 10,
					prompt: [
						{
							type: 'ticket',
							ticket: { channel: 'support', from: 'Dana Ruiz', role: 'Support lead', subject: 'Duplicate invoice emails (3 nights)', time: 'Wed 08:12', body: 'We have 40+ tickets from customers who received the same invoice email twice, around 2am their time, three nights in a row. The billing team says nothing changed in the code. Can someone look before tonight\'s run?' }
						},
						{ type: 'terminal', terminal: cronTwice }
					],
					hints: ['The run log shows two PIDs starting within the same second. Two schedulers, or one scheduler with two entries?', 'Cron has more than one place to keep jobs. Which one would config management never look at?'],
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `$ grep start /var/log/billing/run.log     # two PIDs per night, same second
$ journalctl -u cron                      # two CMD lines at 02:00, both as (billing), different command strings
$ cat /etc/cron.d/billing                 # the Ansible-managed entry
$ sudo crontab -l -u billing              # a second, hand-installed entry from migration night`,
							caption: 'Answer: **/var/spool/cron/crontabs/billing**, the per-user crontab duplicating `/etc/cron.d/billing`.'
						},
						{
							type: 'p',
							text: 'The two journal lines differ (`/opt/billing/bin/send-invoices` vs `cd /opt/billing && ./bin/send-invoices`): that is the tell that these are two *definitions*, not one cron firing twice. The commented line in `/etc/crontab` is a decoy, and so is the SMTP retry on Oct 13 (one process retried; both still finished).'
						},
						{
							type: 'p',
							text: '**Fix:** remove the user crontab (`sudo crontab -r -u billing`), and make the job idempotent: record "invoice emailed" per invoice so a second run (or a manual rerun) sends nothing. Add a lock (`flock -n`) so overlapping runs exit. See [[user-crontab]] and [[duplicate-scheduler]].'
						}
					]
				},
				{
					id: 'h3',
					title: 'Cannot assign requested address',
					tag: 'tricky',
					minutes: 12,
					prompt: [{ type: 'terminal', terminal: ports }],
					hints: ['Count sockets by *state and peer*, not just by peer.', 'How many local ports does this host have to give out? (`sysctl`)'],
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `$ ss -s                                   # timewait 2923
$ ss -tan | awk 'NR > 1 {print $1, $5}' | sort | uniq -c | sort -rn | head -5
   2911 TIME-WAIT 10.0.9.40:8443          <- fraud service
     40 ESTAB 10.0.5.10:5432              <- Postgres pool: healthy, long-lived
$ sysctl net.ipv4.ip_local_port_range      # 60000–63000 = 3,001 ports (default is ~28k)
$ cat /opt/checkout/config/fraud-client.yaml   # keep_alive: false`,
							caption: 'Answer: **10.0.9.40:8443**.'
						},
						{
							type: 'p',
							text: 'Each fraud check opens a new TCP connection and closes it, leaving the socket in [[time-wait|TIME-WAIT]] for ~60 s, holding a local port for that destination. Yesterday\'s hardening ([[sysctl]] `ip_local_port_range = 60000 63000`) cut the pool from ~28k to 3,001 ports, so ~2,900 TIME-WAIT sockets to one peer leave almost nothing: new connects fail with `EADDRNOTAVAIL`. Postgres has more ESTABLISHED sockets but they are reused; that is what a [[connection-pool]] looks like.'
						},
						{
							type: 'p',
							text: '**Mitigate:** restore the default port range. **Fix:** enable keep-alive / pooling in the fraud client (one connection serves thousands of requests). `tcp_tw_reuse` helps outbound connections but treats the symptom.'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 3 ─────────────────────────
		{
			id: 'p3',
			nav: '3 · Network & TLS',
			eyebrow: 'Part 3 · 32 minutes · network',
			title: 'Certificates, resolvers and routing',
			meta: '[[tls-certificate|certs]] · [[dns-resolver|resolvers]] · [[nginx-location-matching|nginx locations]]',
			minutes: 32,
			questions: [
				{
					id: 'n1',
					title: 'One in three handshakes fails',
					tag: 'core',
					minutes: 10,
					prompt: [{ type: 'terminal', terminal: certExpiry }],
					hints: ['"Retries usually work" + three backends in round-robin = one bad backend.', 'Check each backend directly, not through the load balancer.'],
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `$ grep server /etc/haproxy/haproxy.cfg
$ openssl s_client -connect api-1:443 -servername api.shop.example | openssl x509 -noout -enddate
notAfter=Dec 19 04:11:01 2026 GMT
$ openssl s_client -connect api-2:443 -servername api.shop.example | openssl x509 -noout -enddate
notAfter=Oct 13 03:00:11 2026 GMT        <- expired yesterday
$ openssl s_client -connect api-3:443 -servername api.shop.example | openssl x509 -noout -enddate
notAfter=Nov  1 05:42:39 2026 GMT`,
							caption: 'Answer: **api-2**.'
						},
						{
							type: 'p',
							text: 'HAProxy runs in TCP mode with TLS passthrough, so each backend presents its *own* certificate; round-robin sends about a third of handshakes to api-2, and a retry usually lands elsewhere. api-3 expiring in 18 days is not today\'s problem but is the next incident: the per-host certbot timers are clearly not monitored.'
						},
						{
							type: 'p',
							text: '**Mitigate:** take api-2 out of the pool (`disable server api_nodes/api-2`), renew its cert. **Fix:** terminate TLS at the LB with one managed certificate, or monitor expiry per backend (alert at 21 and 7 days).'
						}
					]
				},
				{
					id: 'n2',
					title: 'Only the Cairo office sees the old site',
					tag: 'tricky',
					minutes: 10,
					prompt: [{ type: 'terminal', terminal: dnsStale }],
					hints: ['Ask the same question to three servers: the office resolver, a public resolver, the authoritative nameserver.', 'Look at the TTL column in the stale answer.'],
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `$ cat /etc/resolv.conf                          # nameserver 10.20.0.2
$ dig api.shop.example                          # CNAME api-old-…elb, TTL 71234 (!)
$ dig @1.1.1.1 api.shop.example +short          # 34.240.11.7 / 34.240.19.81 (new)
$ dig @ns1.dnsprovider.example api.shop.example # A records, TTL 300: authoritative is correct`,
							caption: 'Answer: **10.20.0.2**, the office\'s recursive resolver.'
						},
						{
							type: 'p',
							text: 'The old record was a CNAME with TTL 86400. The [[dns-resolver|resolver]] cached it shortly before the cutover and will keep serving it for another 71,234 s (≈20 h). The migration notes say it all: "lower old CNAME TTL a day ahead: skipped". The `/etc/hosts` staging override is unrelated.'
						},
						{
							type: 'p',
							text: '**Mitigate:** flush the cache on the office resolver (or temporarily forward that zone to the authoritative servers). **Fix (process):** lower the TTL at least one *old TTL* before any DNS cutover, verify with `dig` that resolvers show the low TTL, then switch. See [[dns-ttl]].'
						}
					]
				},
				{
					id: 'n3',
					title: 'v2 requests land on v1',
					tag: 'tricky',
					minutes: 12,
					prompt: [{ type: 'terminal', terminal: nginxRoute }],
					hints: ['`curl -sI` shows which pool answered (`X-Upstream`).', 'In nginx, the longest prefix is not the final word: regex locations are checked after it.'],
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `$ grep -n location /etc/nginx/conf.d/api.conf
15:    location /api/v2/ {
20:    location /api/ {
26:    location ~ ^/api/(.*)$ {        <- added Oct 9 for CORS
33:    location = /healthz { … }
$ curl -sI https://api.shop.example/api/v2/orders   # 404, X-Upstream: v1_pool
$ grep -c "/api/v2/" /var/log/nginx/upstream-v1.log # 40 v2 requests in the v1 log`,
							caption: 'Answer: **26**.'
						},
						{
							type: 'p',
							text: '[[nginx-location-matching|nginx\'s algorithm]]: exact match → longest prefix (remembered) → regex locations in order → first regex match wins; the prefix is used only if no regex matches, unless it is marked `^~`. The CORS regex added on Oct 9 matches every `/api/…` path, so `/api/v2/` traffic has gone to `v1_pool` (which 404s on v2 routes) ever since. The draining v2 node in `error.log` is a decoy.'
						},
						{
							type: 'p',
							text: '**Fix:** `location ^~ /api/v2/ { … }` (or narrow the regex to `^/api/v1/`, or move CORS into a `map`/`if` inside the existing locations), then `nginx -t && nginx -s reload`. Add a synthetic check per API version that asserts the upstream header.'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 4 ─────────────────────────
		{
			id: 'p4',
			nav: '4 · Platforms',
			eyebrow: 'Part 4 · 36 minutes · Kubernetes · Postgres · git',
			title: 'Platform tools under pressure',
			meta: '[[kubectl-logs-previous|kubectl logs --previous]] · [[pg-blocking-pids]] · [[git-history-secrets|git log -S]]',
			minutes: 36,
			questions: [
				{
					id: 'k1',
					title: 'CrashLoopBackOff after a release',
					tag: 'core',
					minutes: 12,
					prompt: [{ type: 'terminal', terminal: k8sCrash }],
					hints: ['The current container just restarted; its log is only the banner.', 'Compare the ConfigMap in prod and staging.'],
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `$ kubectl get pods -n prod
$ kubectl logs payments-7d9f8b6c5-4kq2r -n prod              # only the startup banner
$ kubectl logs payments-7d9f8b6c5-4kq2r -n prod --previous   # KeyError: 'LEDGER_URL'
$ kubectl get cm payments-config -n prod -o yaml             # LEDGER_HOST + LEDGER_PORT, no LEDGER_URL
$ kubectl get cm payments-config -n staging -o yaml          # has LEDGER_URL: why staging passed
$ kubectl rollout undo deployment/payments -n prod           # mitigate: back to 2.13.1`,
							caption: 'Answer: **LEDGER_URL**.'
						},
						{
							type: 'ranked',
							items: [
								{ title: 'Use `--previous`.', body: 'In a crash loop, the interesting logs belong to the container that crashed ([[kubectl-logs-previous]]).' },
								{ title: 'Decoys.', body: 'The liveness probe failures are a consequence (the app never starts listening). The OOMKilling event is reports-worker 41 minutes earlier. The Secret is fine.' },
								{ title: 'Why it slipped through.', body: 'Config lives in two places (Helm values per environment) and the release changed the contract (host+port → URL) without a migration step. The rollout stalled safely at 1/3 because the old ReplicaSet kept serving.' }
							]
						},
						{
							type: 'p',
							text: '**Fix:** support both shapes for one release (`LEDGER_URL` or build it from host+port), add `LEDGER_URL` to prod values, roll forward. Validate required settings at startup with a clear error and add a pre-deploy check that diffs required env keys against each environment.'
						}
					]
				},
				{
					id: 'k2',
					title: 'The migration that froze checkout',
					tag: 'tricky',
					minutes: 14,
					prompt: [{ type: 'terminal', terminal: pgLocks }],
					hints: ['Use `pg_blocking_pids(pid)` and follow the chain until you reach a session that is not waiting.', 'Look at `state` and `xact_start` of the root.'],
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `$ psql -c "SELECT pid, pg_blocking_pids(pid) AS blocked_by, query
           FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0"
 32010 | {31877} | ALTER TABLE orders ADD COLUMN refund_reason text;
 32101 | {32010} | INSERT INTO orders …              (×6 app sessions)
$ psql -c "SELECT * FROM pg_stat_activity"
 31877 | mk | psql | 10.8.0.37 | idle in transaction | xact_start 09:02:11 | UPDATE orders …`,
							caption: 'Answer: **31877**. The ALTER (32010) is a victim too.'
						},
						{
							type: 'p',
							text: 'This is a [[lock-queue]]: `ALTER TABLE` needs AccessExclusiveLock, so it waits behind pid 31877, an [[idle-in-transaction]] psql session from a laptop that ran an UPDATE at 09:02 and never committed. Every new query on `orders` then queues *behind the waiting ALTER*, even though they don\'t conflict with 31877. Killing app sessions or restarting the app changes nothing.'
						},
						{
							type: 'ranked',
							items: [
								{ title: 'Least damage first: cancel the ALTER.', body: '`SELECT pg_cancel_backend(32010)`: the queue drains instantly, checkout recovers, and you lose nothing but a migration you can rerun.' },
								{ title: 'Then deal with the root.', body: 'Ask the owner of 31877 (user `mk`) to commit/roll back; if unreachable, `pg_terminate_backend(31877)` rolls back their uncommitted UPDATE.' },
								{ title: 'Prevent.', body: 'Migrations run with `SET lock_timeout = \'3s\'` and retry; `idle_in_transaction_session_timeout` on human roles; no ad-hoc writes to prod from laptops.' }
							]
						}
					]
				},
				{
					id: 'k3',
					title: '"That\'s just the docs example key"',
					tag: 'tricky',
					minutes: 10,
					prompt: [{ type: 'terminal', terminal: gitSecret }],
					hints: ['`grep -r` searches the working tree. The scanner searched history.', '`git log -S <string>` lists commits that added or removed a string.'],
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `$ grep -rn AKIA .                       # only docs/config.md: AKIAIOSFODNN7EXAMPLE (the documented placeholder)
$ git log -S AKIA --oneline
7be0d44 remove debug creds              <- removed it
19dd2e8 docs: config examples           <- the placeholder
a3f9c21 wip: local s3 uploads           <- added a live key in deploy/local.env
$ git show a3f9c21`,
							caption: 'Answer: **a3f9c21**.'
						},
						{
							type: 'p',
							text: 'The teammate is right about the file they looked at and wrong about the repository: commit 7be0d44 deleted the key from the tree, but the public mirror (and every clone) still contains a3f9c21 ([[git-history-secrets]]).'
						},
						{
							type: 'ranked',
							items: [
								{ title: 'Rotate now.', body: 'Deactivate the key, issue a new one, deploy it. Assume it was used: bots scrape public repos within minutes.' },
								{ title: 'Investigate usage.', body: 'Check the cloud audit log for that key ID since 2026-09-29: unknown IPs, new resources, data reads.' },
								{ title: 'Prevent.', body: 'Pre-commit and CI secret scanning, `*.env` in `.gitignore` from day one, short-lived credentials (workload identity) instead of static keys. History rewrite is optional cleanup *after* rotation.' }
							]
						}
					]
				}
			]
		},

		// ───────────────────────── TEASERS ─────────────────────────
		{
			id: 'teasers',
			nav: 'Rapid fire',
			eyebrow: 'Rapid fire · 2 min each',
			title: 'Shell reflexes',
			minutes: 12,
			questions: [
				{
					id: 't1',
					title: '`grep -c 502 access.log` says 120. Is that the number of 502s?',
					tag: 'teaser',
					minutes: 2,
					prompt: [],
					answer: [{ type: 'p', text: 'No. It counts **lines containing the text "502" anywhere**: response sizes like `5021`, paths like `/orders/50211`, ports, timestamps. Filter on the column: `awk \'$9 == 502\' access.log | wc -l`.' }]
				},
				{
					id: 't2',
					title: 'Why is `uniq -c` without `sort` wrong?',
					tag: 'teaser',
					minutes: 2,
					prompt: [],
					answer: [{ type: 'p', text: '`uniq` only merges **adjacent** identical lines, so an unsorted stream gives many small groups per key. Always `sort | uniq -c | sort -rn`. See [[unix-pipeline]].' }]
				},
				{
					id: 't3',
					title: 'You deleted 20 GB of logs; `df` didn\'t move. Two reasons?',
					tag: 'teaser',
					minutes: 2,
					prompt: [],
					answer: [{ type: 'p', text: '(1) A process still holds the files open: [[deleted-open-file]], check `lsof +L1`. (2) The space is reserved or on another mount: you deleted from a different filesystem, or ext4\'s reserved blocks for root. (Bonus: snapshots on a CoW filesystem or volume keep the blocks too.)' }]
				},
				{
					id: 't4',
					title: '`tail -f app.log` stopped showing new lines after midnight. Bug?',
					tag: 'teaser',
					minutes: 2,
					prompt: [],
					answer: [{ type: 'p', text: '[[log-rotation|logrotate]] renamed the file; `tail -f` follows the **file descriptor** (the old, renamed file). Use `tail -F` (follow by name, reopen on rotation).' }]
				},
				{
					id: 't5',
					title: 'Which side of a TCP connection sits in TIME-WAIT?',
					tag: 'teaser',
					minutes: 2,
					prompt: [],
					answer: [{ type: 'p', text: 'The side that **closes first** (active close). A client that opens and closes a connection per request accumulates [[time-wait|TIME-WAIT]] sockets and burns its own ephemeral ports; a server that closes first accumulates them instead.' }]
				},
				{
					id: 't6',
					title: '`awk \'{print $9}\'` returns garbage on a few lines. Why?',
					tag: 'teaser',
					minutes: 2,
					prompt: [],
					answer: [{ type: 'p', text: 'awk splits on whitespace, so any field containing spaces (a request line with an unescaped space, an IPv6 or a custom log format) shifts later columns. Check with `awk \'{print NF}\' file | sort | uniq -c`; better, log JSON and use [[jq]].' }]
				}
			]
		}
	]
};

export default assessment;
