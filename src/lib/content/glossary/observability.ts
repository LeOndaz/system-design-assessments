import type { GlossaryTerm } from '../types';
import { rng, shape, step, timeAxis } from '../series';

// Small worked-example data for the dedicated pages.
const hmX = timeAxis('10:00', 24, 5);
const hmY = ['<25 ms', '25–50', '50–100', '100–250', '250–500', '500 ms–1 s', '>1 s'];
const hmR = rng(42);
const hmFast = [30, 45, 18, 5, 2, 0, 0];
const hmSlow = [0, 0, 2, 8, 50, 30, 10];
const hmValues = hmY.map((_, row) =>
	hmX.map((_, col) => {
		const mix = col >= 12 ? 0.8 * hmFast[row] + 0.2 * hmSlow[row] : hmFast[row];
		return Math.round(mix * 12 * (0.85 + 0.3 * hmR()));
	})
);

const credX = timeAxis('06:00', 48, 15);

const terms: GlossaryTerm[] = [
	{
		id: 'saturation',
		term: 'Saturation',
		category: 'observability',
		short:
			'How “full” a resource is: the fraction of its capacity in use, plus the work queued waiting for it. A resource near 100% saturation doesn’t get a bit slower, it gets dramatically slower, because new work has to wait in line behind everything already there. It’s often the first signal that moves, before latency or errors.',
		analogy: 'A motorway at 70% capacity flows; at 98% one braking car creates a jam that lasts an hour.',
		related: ['use-method', 'littles-law', 'worker-pool', 'connection-pool']
	},
	{
		id: 'red-method',
		term: 'RED method',
		category: 'observability',
		short:
			'A checklist for any request-serving service: **R**ate (requests per second), **E**rrors (how many fail), **D**uration (how long they take, as [[percentiles]]). It describes what the *users* of a service experience. When a dashboard is unfamiliar, find these three panels first.',
		related: ['use-method', 'saturation', 'slo']
	},
	{
		id: 'use-method',
		term: 'USE method',
		category: 'observability',
		short:
			'A checklist for any *resource* (CPU, disk, connection pool, thread pool): **U**tilization (how busy), **S**aturation (how much work is waiting), **E**rrors. RED tells you a service is hurting; USE tells you which resource is the bottleneck. Walk every resource on the request path and ask the three questions.',
		related: ['red-method', 'saturation']
	},
	{
		id: 'slo',
		term: 'SLO (service level objective)',
		aliases: ['SLI', 'SLA'],
		category: 'reliability practice',
		short:
			'A target for how reliable a service should be, measured from the user’s side, e.g. “99.9% of checkout requests succeed in under 800 ms over 30 days”. The measurement itself is the SLI (indicator); a contractual promise with penalties is an SLA. SLOs turn “is it bad?” into a number you can alert on.',
		related: ['error-budget', 'burn-rate']
	},
	{
		id: 'error-budget',
		term: 'Error budget',
		category: 'reliability practice',
		short:
			'The amount of failure an [[slo]] allows. A 99.9% monthly target means 0.1% of requests (about 43 minutes of full outage) may fail. Teams spend the budget on risky deploys and experiments; when it runs out, they slow down and fix reliability.',
		related: ['slo', 'burn-rate']
	},
	{
		id: 'burn-rate',
		term: 'Burn rate',
		category: 'reliability practice',
		short:
			'How fast you’re using up the [[error-budget]] compared with the allowed pace. Burn rate 1 = you’ll use exactly the whole budget by the end of the window; burn rate 14 = the month’s budget is gone in about two days. Alerting on burn rate over two windows (e.g. 1 h and 5 min) catches real incidents and ignores brief blips.',
		related: ['slo', 'error-budget', 'low-traffic-ratio']
	},
	{
		id: 'low-traffic-ratio',
		term: 'Low-traffic ratio trap',
		category: 'observability',
		short:
			'Percentages computed from tiny counts are noise. At 03:00 with 4 requests a minute, 2 failures is a “50% error rate” that pages someone for nothing, while at peak 2% errors may be thousands of angry users. Always look at the absolute count next to the ratio, and set a minimum request volume on ratio alerts.',
		related: ['burn-rate']
	},
	{
		id: 'histogram-metric',
		term: 'Histogram metric',
		category: 'observability',
		short:
			'A metric that counts observations into buckets (“how many requests took 0–10 ms, 10–25 ms, …”) instead of storing one number. Because bucket counts can be added up across pods and time, you can compute a correct p99 for the whole fleet afterwards. A pre-computed p99 per pod (a “summary”) cannot be combined: averaging p99s gives a number that means nothing.',
		related: ['percentiles', 'latency-heatmap', 'percentile-averaging']
	},
	{
		id: 'percentile-averaging',
		term: 'Averaging percentiles',
		category: 'observability',
		short:
			'Taking the mean of several p99 values (per pod, per minute) does not give the p99 of the combined traffic. One pod with 10% of traffic and a 4 s p99 can dominate the real fleet p99 while barely moving the average of p99s. To combine, you need the raw distribution: [[histogram-metric|histogram buckets]] or the raw events.',
		related: ['percentiles', 'histogram-metric']
	},
	{
		id: 'latency-heatmap',
		term: 'Latency heatmap',
		category: 'observability',
		short:
			'A chart where time runs left to right, latency buckets run bottom to top, and colour shows how many requests landed in each cell. Unlike a p99 line it shows the *shape* of the distribution, so you can see two separate groups of requests (one fast, one slow) that a single percentile line blends into one misleading number.',
		related: ['histogram-metric', 'bimodal-distribution', 'percentiles'],
		page: [
			{ type: 'heading', text: 'How to read one' },
			{
				type: 'list',
				items: [
					'**x-axis** is time, exactly like a normal graph.',
					'**y-axis** is latency buckets, fastest at the bottom. Each row is a range, not a single value.',
					'**colour** is how many requests fell into that time × latency cell. Darker or brighter = more.',
					'A **single horizontal band** means requests are consistent. A **band that drifts upward** means everything got slower together (a shared resource). A **second band appearing** means a separate population of requests is slow while the rest is untouched.'
				]
			},
			{ type: 'heading', text: 'Example: the second band' },
			{
				type: 'dashboard',
				dashboard: {
					style: 'grafana',
					title: 'search-api · request latency',
					range: '10:00 – 12:00',
					panels: [
						{ kind: 'heatmap', title: 'Request duration heatmap', x: hmX, y: hmY, values: hmValues, span: 6 }
					]
				}
			},
			{
				type: 'p',
				text: 'From 11:00 a new band appears at 250 ms–1 s while the original band at the bottom keeps its shape. Roughly a fifth of requests moved. That is a question about **which** requests (one host? one tenant? one code path behind a [[feature-flag]]?), not about **all** requests. A p99 line would simply have jumped from ~120 ms to ~700 ms and hidden the distinction.'
			},
			{
				type: 'callout',
				tone: 'info',
				title: 'Rule of thumb',
				text: 'Whenever the slow fraction looks like a round number (25%, 33%, 50%), compare it with the number of hosts, shards, or flag rollout percentages. 1 of 4 hosts = 25%.'
			}
		]
	},
	{
		id: 'bimodal-distribution',
		term: 'Bimodal distribution',
		category: 'observability',
		short:
			'Data with two separate peaks instead of one, e.g. most requests take 20 ms and a distinct group takes 300 ms with almost nothing in between. It almost always means two different code paths or two kinds of hosts (cache hit vs miss, healthy vs sick replica). Averages and single percentiles land in the empty gap and describe no real request.',
		related: ['latency-heatmap', 'percentiles']
	},
	{
		id: 'metric-cardinality',
		term: 'Metric cardinality',
		category: 'observability',
		short:
			'The number of distinct time series a metric produces: one per unique combination of label values. A label like `status` has 5 values; a label like `user_id` has millions, and each becomes its own series that the monitoring system must store. Unbounded labels make the metrics database slow, expensive, or fall over.',
		related: ['cardinality', 'histogram-metric']
	},
	{
		id: 'counter-reset',
		term: 'Counter reset',
		aliases: ['rate()', 'increase()'],
		category: 'observability',
		short:
			'Counters only go up (“total requests served since start”), and they restart at 0 when the process restarts. Functions like Prometheus `rate()` notice the drop and treat it as a reset, so the per-second rate stays correct. A naive “value now minus value 5 minutes ago” instead produces a huge negative spike, and `rate()` applied to a gauge (a value that legitimately goes down) is wrong in the other direction.',
		related: ['histogram-metric']
	},
	{
		id: 'trace-span',
		term: 'Span (tracing)',
		aliases: ['trace', 'distributed trace'],
		category: 'observability',
		short:
			'One timed operation inside a request: “SELECT orders”, “POST /charge”. A trace is the tree of spans for a single request across services, drawn as a waterfall. Time the parent spent that isn’t covered by any child span is work nobody instrumented: queueing, lock waits, GC, or a pool checkout.',
		related: ['trace-sampling', 'uninstrumented-gap']
	},
	{
		id: 'uninstrumented-gap',
		term: 'Uninstrumented gap',
		category: 'observability',
		short:
			'An empty stretch inside a parent span where no child span is running. The time was spent somewhere the code doesn’t create spans: waiting for a database connection from the pool, a mutex, a thread-pool queue, a garbage-collection pause, or CPU work like JSON serialization. Large gaps are a clue, not noise: correlate them with pool-wait and GC metrics.',
		related: ['trace-span', 'connection-pool', 'gc-pause']
	},
	{
		id: 'trace-sampling',
		term: 'Trace sampling',
		aliases: ['head-based sampling', 'tail-based sampling'],
		category: 'observability',
		short:
			'Keeping only some traces to save cost. **Head-based** sampling decides at the start of a request (“keep 1%”), before anyone knows if it will be slow or fail, so rare errors are mostly thrown away. **Tail-based** sampling decides after the request finishes and can keep every error and slow request. “I can’t find an error trace” under 1% head sampling proves nothing.',
		related: ['trace-span'],
		page: [
			{ type: 'heading', text: 'The arithmetic that bites' },
			{
				type: 'p',
				text: 'A service handles 200 req/s. 0.05% of requests fail: that’s 6 failures per minute, 360 an hour, and customers notice. With 1% head-based sampling you keep 1 in 100 traces, so you’d expect about **3.6 failed traces per hour**, and they’re mixed into 7,200 kept traces. Filter by a specific customer and you probably have zero.'
			},
			{
				type: 'table',
				head: ['', 'Head-based', 'Tail-based'],
				rows: [
					['Decides', 'When the request starts', 'After the whole trace is collected'],
					['Keeps errors?', 'Only by luck (same % as everything)', 'Yes, rules like “keep all errors, all > 2 s”'],
					['Cost', 'Cheap, no buffering', 'Collector must buffer every span until the trace completes'],
					['Bias', 'Representative of normal traffic', 'Over-represents bad requests (that’s the point)']
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				text: 'Use metrics to count and logs/tail-sampled traces to explain. Never conclude “it doesn’t happen” from the absence of a sampled trace.'
			}
		]
	},
	{
		id: 'cfs-quota',
		term: 'CFS quota (CPU limits)',
		aliases: ['cpu limit', 'cfs throttling'],
		category: 'cloud & infra',
		short:
			'How Linux enforces a container CPU limit: in every 100 ms period the container may use at most `limit × 100 ms` of CPU time, summed across all its threads. A 1-core limit with 8 busy threads burns its 100 ms in about 12 ms of wall time, then the whole container is frozen for the remaining 88 ms. Average usage over a minute can look well below the limit while individual requests stall.',
		related: ['cpu-throttling', 'tail-latency'],
		page: [
			{ type: 'heading', text: 'Why the average lies' },
			{
				type: 'p',
				text: 'Metrics scrape every 15–60 s and report average cores used. A container that bursts to 8 cores for 12 ms and then is frozen for 88 ms shows exactly **1.0 core average** during busy periods and maybe **0.6 core** over a minute that includes quiet moments. Neither number reveals that requests arriving during the frozen 88 ms simply wait.'
			},
			{
				type: 'code',
				lang: 'promql',
				code: `# fraction of 100 ms periods in which the container was throttled
sum by (pod) (rate(container_cpu_cfs_throttled_periods_total[5m]))
  / sum by (pod) (rate(container_cpu_cfs_periods_total[5m]))`,
				caption: 'Anything above a few percent on a latency-sensitive service is worth a look.'
			},
			{
				type: 'list',
				items: [
					'Remove CPU **limits** for latency-sensitive services and keep CPU **requests** for scheduling (a common, debated practice).',
					'Or raise the limit and match runtime thread counts to it (JVM `-XX:ActiveProcessorCount`, Go `GOMAXPROCS` via automaxprocs).',
					'Watch throttled-periods ratio, not just usage vs limit.'
				]
			}
		]
	},
	{
		id: 'cpu-credits',
		term: 'CPU credits (burstable instances)',
		aliases: ['t3', 't2', 'burstable', 'CPUCreditBalance'],
		category: 'cloud & infra',
		short:
			'Burstable cloud instances (AWS t2/t3/t4g, including RDS db.t3) are sold with a low baseline CPU, e.g. 20% per vCPU. When idle they earn credits; running above baseline spends them. When the balance hits zero in “standard” mode the instance is capped at baseline, so the CPU graph flattens at exactly 20% and looks healthy while the database is starved.',
		related: ['burst-balance', 'saturation'],
		page: [
			{ type: 'heading', text: 'The shape to recognise' },
			{
				type: 'dashboard',
				dashboard: {
					style: 'cloudwatch',
					title: 'RDS · orders-db (db.t3.medium, credit spec: standard)',
					range: '06:00 – 18:00',
					panels: [
						{
							kind: 'timeseries',
							title: 'CPUCreditBalance',
							x: credX,
							series: [{ name: 'credits', points: shape(48, { base: 120, noise: 0.01, seed: 3 }, (i, v) => (i < 12 ? v : Math.max(0, 120 - (i - 12) * 6))) }],
							span: 3
						},
						{
							kind: 'timeseries',
							title: 'CPUUtilization',
							unit: '%',
							yMin: 0,
							yMax: 100,
							x: credX,
							series: [{ name: 'cpu', points: shape(48, { base: 10, noise: 0.08, seed: 4 }, step(12, 55), step(32, 20)) }],
							thresholds: [{ value: 20, label: 'baseline 20%', tone: 'warn' }],
							span: 3
						}
					]
				}
			},
			{
				type: 'p',
				text: 'Credits drain from 09:00 while CPU runs at ~55%. At 11:00 the balance hits zero and CPU drops to a perfectly flat 20%. That flat line at the baseline is the giveaway: real workloads are never that smooth. Demand didn’t fall; the hypervisor capped it.'
			},
			{
				type: 'table',
				head: ['Instance', 'Baseline per vCPU', 'Credits earned / h', 'Max balance'],
				rows: [
					['t3.micro', '10%', '12', '288'],
					['t3.medium', '20%', '24', '576'],
					['t3.large', '30%', '36', '864']
				],
				numeric: [1, 2, 3],
				caption: 'One credit = one vCPU at 100% for one minute.'
			},
			{
				type: 'list',
				items: [
					'**Unlimited mode** lets the instance keep bursting and bills the surplus instead of capping.',
					'For a production database with steady load, a fixed-performance class (m/r) is usually the right fix.',
					'The same pattern exists for disks: gp2 EBS [[burst-balance]].'
				]
			}
		]
	},
	{
		id: 'burst-balance',
		term: 'Burst balance (EBS gp2)',
		category: 'cloud & infra',
		short:
			'Older AWS gp2 disks get a baseline of 3 IOPS per GB and can burst to 3,000 IOPS by spending an I/O credit bucket. When `BurstBalance` hits 0%, a 100 GB volume drops to 300 IOPS, disk queue length climbs and every query waits on I/O. Same trap as [[cpu-credits]], for storage.',
		related: ['cpu-credits']
	},
	{
		id: 'lambda-cold-start',
		term: 'Lambda cold start',
		category: 'cloud & infra',
		short:
			'When no warm instance of a serverless function is free, the platform must create one: download code, start the runtime, run your initialization. That adds 100 ms to several seconds to that one request (`Init Duration` in logs). Bursty traffic causes many cold starts at once; steady traffic rarely does.',
		related: ['lambda-concurrency']
	},
	{
		id: 'lambda-concurrency',
		term: 'Lambda concurrency limit',
		aliases: ['throttles', 'reserved concurrency'],
		category: 'cloud & infra',
		short:
			'Each AWS account has a regional cap on functions running at the same moment (often 1,000), shared by **every** function in the account. If one function fans out to 900 parallel executions, others get throttled (`Throttles` metric, 429 `TooManyRequestsException`) even though nothing is wrong with them. Reserved concurrency carves out a guaranteed slice, and also caps a function.',
		related: ['lambda-cold-start', 'noisy-neighbor', 'littles-law']
	},
	{
		id: 'visibility-timeout',
		term: 'Visibility timeout (SQS)',
		category: 'messaging',
		short:
			'When a consumer receives a message from an SQS queue it is hidden, not deleted. If the consumer doesn’t delete it within the visibility timeout, the queue assumes the consumer died and makes it visible again, so another consumer processes it too. If processing routinely takes longer than the timeout, every message gets processed several times.',
		related: ['at-least-once', 'idempotent-consumer', 'dead-letter-queue'],
		page: [
			{ type: 'heading', text: 'Timeline of one message when processing takes 34 s and the timeout is 30 s' },
			{
				type: 'table',
				head: ['t', 'Event'],
				rows: [
					['0 s', 'Worker A receives message M (receive count 1). M is hidden for 30 s.'],
					['30 s', 'Timeout expires, M becomes visible again. Worker A is still busy.'],
					['31 s', 'Worker B receives M (receive count 2). Now two workers process the same message.'],
					['34 s', 'Worker A finishes, sends the email, deletes M using its receipt handle.'],
					['65 s', 'Worker B finishes: second email sent. Depending on timing, a third copy may already be in flight.'],
					['…', 'After `maxReceiveCount` receives, M moves to the [[dead-letter-queue|DLQ]] even though it was processed successfully.']
				]
			},
			{
				type: 'list',
				items: [
					'Signals: `NumberOfMessagesReceived` well above `NumberOfMessagesSent`, consumer duration near or above the timeout, DLQ filling with messages that look fine.',
					'Fix: visibility timeout comfortably above worst-case processing time (AWS suggests 6× the function timeout for Lambda event sources), or extend it while working (`ChangeMessageVisibility` heartbeat).',
					'Always make the consumer [[idempotent-consumer|idempotent]]: SQS standard queues are [[at-least-once]] anyway.'
				]
			}
		]
	},
	{
		id: 'write-sharding',
		term: 'Write sharding',
		aliases: ['key salting'],
		category: 'databases',
		short:
			'Spreading writes for one logical key across several physical keys by adding a suffix (`SALE#2026-10-16#0` … `#9`), then summing them when reading. Needed because a single key always lives on a single partition, and a partition has a fixed ceiling (DynamoDB: about 1,000 writes/s) no matter how much capacity the whole table has.',
		related: ['hot-partition', 'partition-key']
	},
	{
		id: 'nat-port-exhaustion',
		term: 'NAT port exhaustion',
		category: 'cloud & infra',
		short:
			'A NAT gateway rewrites your private IP to its public IP and tells connections apart by source port. It has roughly 55,000 ports per destination (IP + port + protocol). If the app opens a brand-new connection for every call to one external API instead of reusing them, ports run out and new connections fail (`ErrorPortAllocation`), even though bandwidth is fine.',
		related: ['connection-pool', 'keep-alive-timeout']
	},
	{
		id: 'keep-alive-timeout',
		term: 'Keep-alive timeout mismatch',
		category: 'frontend & network',
		short:
			'HTTP keep-alive lets a client reuse one TCP connection for many requests; each side closes idle connections after its own timeout. If the server behind a load balancer closes idle connections sooner (Node.js default 5 s) than the load balancer does (ALB default 60 s), the balancer sometimes sends a request on a connection the server is closing at that instant, and the user gets a 502. Rule: backend idle timeout > load-balancer idle timeout.',
		related: ['load-balancer-5xx']
	},
	{
		id: 'load-balancer-5xx',
		term: 'Load-balancer vs target 5xx',
		aliases: ['ELB 5xx', 'HTTPCode_ELB_5XX', 'HTTPCode_Target_5XX', '502', '504'],
		category: 'cloud & infra',
		short:
			'A 5xx can be generated by your application (target 5xx) or by the load balancer itself (ELB 5xx) when it couldn’t get a usable answer from the application: 502 (bad or broken connection), 503 (no healthy targets), 504 (target too slow). Comparing the two counts tells you whether to look in your code or in the plumbing between the balancer and your servers.',
		related: ['keep-alive-timeout', 'deep-health-check'],
		page: [
			{
				type: 'table',
				head: ['Seen by client', 'ELB 5xx', 'Target 5xx', 'Look at'],
				rows: [
					['500 from app', '–', '↑', 'App logs and exceptions'],
					['502, target logs show nothing', '↑', '–', 'Connections: [[keep-alive-timeout|keep-alive mismatch]], target crashed mid-response, TLS to target'],
					['503', '↑', '–', 'No healthy targets: failing health checks, empty target group, deploy drained everyone'],
					['504', '↑', '–', 'Target slower than the balancer’s idle timeout'],
					['460 (ALB)', '–', '–', 'Client closed the connection before the response'],
				]
			},
			{
				type: 'p',
				text: 'The ALB access log field `target_status_code` is `-` when the balancer never got a response. That one field splits “our code returned an error” from “our code never answered”.'
			}
		]
	},
	{
		id: 'deep-health-check',
		term: 'Deep vs shallow health check',
		category: 'reliability practice',
		short:
			'A shallow health check (`/health` returns 200 if the process is running) only proves the server is up. A deep check also verifies dependencies the instance needs (database reachable, disk writable). Shallow checks keep sick instances in rotation; overly deep checks can take the whole fleet out when a shared dependency blips. Usually: shallow for liveness, a careful local-dependency check for readiness.',
		related: ['readiness-probe', 'gray-failure']
	},
	{
		id: 'availability-zone',
		term: 'Availability zone (AZ)',
		category: 'cloud & infra',
		short:
			'One of several physically separate data centres inside a cloud region, with independent power and networking. Services spread instances across AZs so one building’s failure doesn’t take them down. When errors line up with a single AZ, suspect the zone (network, a dependency’s primary living there) before your code.',
		related: ['gray-failure']
	},
	{
		id: 'gray-failure',
		term: 'Gray failure',
		category: 'reliability practice',
		short:
			'A component that is partially broken (slow, dropping some packets, failing some requests) while its health checks still pass. The system keeps sending it traffic because, by its own definition, it’s healthy. Detect by comparing latency and errors *across* peers (per host, per AZ) rather than against fixed thresholds.',
		related: ['availability-zone', 'deep-health-check']
	},
	{
		id: 'idle-in-transaction',
		term: 'Idle in transaction',
		category: 'databases',
		short:
			'A Postgres session state meaning a transaction was opened (BEGIN) but the connection is currently doing nothing: the application is busy elsewhere, often waiting on an HTTP call, before it commits. The connection is pinned to that request and any row locks are held the whole time. Lots of these means code is doing slow non-database work inside a transaction. A session left idle in transaction for hours is worse: Postgres cannot vacuum away any row version newer than that transaction\'s snapshot, so tables bloat across the whole database.',
		related: ['connection-pool', 'lock-wait', 'vacuum', 'table-bloat']
	},
	{
		id: 'lock-wait',
		term: 'Lock wait',
		category: 'databases',
		short:
			'Time a query spends doing nothing because another transaction holds a lock on the rows or table it needs. The database CPU stays low (nobody is working, everyone is waiting) while query latency explodes. In Postgres it shows as `wait_event_type = Lock` in `pg_stat_activity`; the culprit is usually a long transaction, not the waiting query.',
		related: ['idle-in-transaction']
	},
	{
		id: 'redis-eviction',
		term: 'Redis eviction policy',
		aliases: ['maxmemory-policy', 'volatile-lru', 'allkeys-lru'],
		category: 'caching',
		short:
			'What Redis deletes when it reaches `maxmemory`. `allkeys-lru` evicts any least-recently-used key. `volatile-lru` evicts only keys that have a [[ttl]], so keys written without a TTL can never be evicted: if a feature stores lots of them, they squeeze the real cache out until hit rate collapses. `noeviction` rejects writes instead.',
		related: ['cache-hit-rate', 'ttl']
	},
	{
		id: 'log-mapping-conflict',
		term: 'Log index mapping conflict',
		category: 'observability',
		short:
			'Log search engines like Elasticsearch fix each field’s type (text, number, object) the first time they see it in an index. If a new deploy logs `user` as an object where it used to be a string, every new document with that field is rejected, and the logs silently vanish from search. The service is fine; its logs aren’t arriving.',
		related: ['no-data-alert']
	},
	{
		id: 'no-data-alert',
		term: 'No-data (absence) alert',
		aliases: ['absent()'],
		category: 'observability',
		short:
			'An alert that fires when a metric or log stream stops arriving. Without one, a crashed exporter or a broken log pipeline looks like “zero errors”, which is the best possible news, and nobody investigates. Many dashboards also draw missing data as 0 by default, which hides the gap visually.',
		related: ['log-mapping-conflict']
	},
	{
		id: 'log-scale',
		term: 'Logarithmic axis',
		category: 'observability',
		short:
			'An axis where each gridline is 10× the previous (1, 10, 100, 1000). Useful when values span huge ranges, but distances lie to the eye: two lines that look close together may differ by 5×, and a small wiggle near the top is a huge absolute change. Always read the tick labels before judging a gap.'
	},
	{
		id: 'stacked-chart',
		term: 'Stacked vs overlaid chart',
		category: 'observability',
		short:
			'In a stacked chart each series is drawn on top of the ones below, so a band’s *thickness* is its value and its *height* includes everything underneath. When a lower series spikes, every band above it rises too even though their values didn’t change. Overlaid lines share the same baseline, so each line’s height is its own value.'
	}
];

export default terms;
