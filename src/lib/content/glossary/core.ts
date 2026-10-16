import type { GlossaryTerm } from '../types';
import { timeAxis, shape, step, periodic } from '../series';

const hourX = timeAxis('11:50', 30);
const stampedeX = timeAxis('09:55', 40);

const terms: GlossaryTerm[] = [
	// ───────────────────────── latency & capacity ─────────────────────────
	{
		id: 'percentiles',
		term: 'Percentiles (p50 / p95 / p99)',
		aliases: ['p50', 'p95', 'p99', 'median', 'latency percentile'],
		category: 'latency & capacity',
		short:
			"Sort every request by how long it took. The p95 is the value 95% of requests beat, so 1 in 20 users waited longer. Averages hide problems: a few 10-second requests barely move the mean but wreck the p99, which is what your unhappiest users feel. Percentiles can't be averaged across servers, so they have to be computed from the combined data or a histogram.",
		analogy:
			"In a queue of 100 people, the p99 is how long the 99th person waited. Even if the average wait is short, that one person is still furious.",
		related: ['tail-latency', 'hedged-requests', 'fan-out'],
		page: [
			{ type: 'heading', text: 'A worked example' },
			{
				type: 'p',
				text: 'Ten requests took (ms): `20, 22, 23, 25, 25, 26, 28, 30, 31, 2400`. The **mean** is 263 ms, which describes none of them. The **p50 (median)** is ~25 ms, the typical experience. The **p90** is 31 ms (nearest-rank: the 9th of 10 sorted values; interpolating tools like numpy report ~268 ms, because with only ten samples the 2400 drags the estimate up). The **p99** is ~2400 ms: one request in a hundred is terrible.'
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'Two mistakes that show up in debugging',
				text: '**Averaging percentiles.** Server A p99 = 100 ms, server B p99 = 900 ms. The fleet p99 is *not* 500 ms; you need the merged distribution. **Ignoring volume.** A p99 over 50 requests is noise. Check the request count before trusting a tail.'
			},
			{ type: 'heading', text: 'How to read them during an incident' },
			{
				type: 'list',
				items: [
					'**p50 moves, p99 moves:** everything got slower. Look at shared resources (DB, CPU, a dependency on every path).',
					'**p50 flat, p99 explodes:** a subset is slow. Segment by endpoint, tenant, payload size or host. See [[tail-latency]].',
					'**p99 has a ceiling at exactly N seconds:** requests are hitting a [[timeout]] and the chart is showing the timeout value, not the real latency.'
				]
			},
			{
				type: 'dashboard',
				dashboard: {
					style: 'grafana',
					title: 'Same traffic, three percentiles',
					range: 'Last 30 minutes',
					panels: [
						{
							kind: 'timeseries',
							title: 'checkout latency',
							span: 6,
							unit: 'ms',
							x: hourX,
							series: [
								{ name: 'p50', points: shape(30, { base: 42, noise: 0.06, seed: 1 }), color: 0 },
								{ name: 'p95', points: shape(30, { base: 120, noise: 0.08, seed: 2 }, step(18, 260)), color: 1 },
								{ name: 'p99', points: shape(30, { base: 300, noise: 0.1, seed: 3 }, step(18, 2900)), color: 2 }
							],
							markers: [{ at: 18, label: 'big tenant batch' }]
						}
					]
				}
			},
			{
				type: 'p',
				text: 'The p50 never moves, so most users are fine. The p99 jumps tenfold when one large customer starts a batch. A dashboard showing only the average would show a small bump.'
			}
		]
	},
	{
		id: 'tail-latency',
		term: 'Tail latency',
		aliases: ['long tail', 'latency tail'],
		category: 'latency & capacity',
		short:
			"The slowest few percent of requests (p99, p99.9). Tails come from things that hit only some requests: GC pauses, cache misses, lock waits, one slow shard, a big customer's data. They matter more than they look, because a page that makes 50 backend calls almost always hits at least one tail.",
		related: ['percentiles', 'fan-out', 'hedged-requests', 'gc-pause']
	},
	{
		id: 'littles-law',
		term: "Little's law",
		aliases: ['L = λW', 'littles law'],
		category: 'latency & capacity',
		short:
			"In any stable system, requests in flight = arrival rate × time each spends inside (L = λ × W). It's why latency and capacity are linked: if each request suddenly takes 10× longer at the same traffic, you need 10× as many workers or connections, or requests start queueing. Queueing adds more latency, so it spirals.",
		analogy:
			'A coffee shop with 10 customers arriving per minute, each staying 3 minutes, always has about 30 people inside. If the barista slows down so each stay is 10 minutes, there are 100 people inside, and the shop only has 40 seats.',
		related: ['worker-pool', 'connection-pool', 'throughput', 'timeout'],
		page: [
			{ type: 'heading', text: 'The formula' },
			{
				type: 'p',
				text: '**L = λ × W.** L = average number in the system (in-flight requests). λ = arrival rate (requests/second). W = average time in the system (seconds). It holds for a worker pool, a DB connection pool, a queue, or a whole service, as long as the system is stable (not filling up forever).'
			},
			{ type: 'heading', text: 'Worked example: the slow dependency' },
			{
				type: 'table',
				head: ['', 'Rate λ', 'Time W', 'In flight L', 'Workers', 'Result'],
				numeric: [1, 2, 3, 4],
				rows: [
					['Normal', '200 req/s', '0.05 s', '10', '64', 'Fine: 54 idle'],
					['Dependency slows', '200 req/s', '2 s', '400', '64', '336 waiting'],
					['Throughput cap', '—', '2 s', '64', '64', 'max 32 req/s served']
				]
			},
			{
				type: 'p',
				text: "Once L exceeds the pool size, requests queue. Queue wait is added to W, so the real W is much more than 2 s. Every endpoint that shares the pool slows down, including ones that never touch the slow dependency. That's why one slow third-party call can freeze a whole service."
			},
			{ type: 'heading', text: 'Using it backwards' },
			{
				type: 'list',
				items: [
					'**Sizing a pool:** need L = λ × W. At 500 req/s × 40 ms of DB time = 20 connections busy on average; add headroom for bursts.',
					'**Spotting queueing:** if measured in-flight ≈ pool size and latency is rising, you are queueing. Raising the pool helps only if the downstream can take more load.',
					'**Why timeouts protect capacity:** a [[timeout]] caps W, which caps L. A 2 s timeout on a call that would hang 30 s frees workers 15× faster.'
				]
			}
		]
	},
	{
		id: 'throughput',
		term: 'Throughput',
		aliases: ['RPS', 'QPS', 'requests per second'],
		category: 'latency & capacity',
		short:
			"How much work gets finished per unit of time (requests/second, jobs/minute). It's different from latency: a system can be fast per request but low-throughput (one worker), or high-throughput but slow (huge batches). When a system saturates, throughput stops rising and latency climbs instead.",
		related: ['littles-law', 'worker-pool']
	},
	{
		id: 'worker-pool',
		term: 'Worker pool (thread pool)',
		aliases: ['thread pool', 'gunicorn workers', 'executor'],
		category: 'latency & capacity',
		short:
			'A fixed number of threads or processes that handle requests. Each request holds a worker until it finishes, including the time it spends waiting on a database or API. If workers are all busy, new requests wait in a queue even though the CPU may be idle. Many "everything is slow" incidents are a pool full of workers waiting on one slow thing.',
		analogy: 'Checkout lanes at a supermarket: if three cashiers are each stuck on a customer arguing about a coupon, the whole queue stops.',
		related: ['littles-law', 'bulkhead', 'connection-pool', 'timeout']
	},
	{
		id: 'connection-pool',
		term: 'Connection pool',
		aliases: ['db pool', 'max_connections', 'pool exhaustion'],
		category: 'latency & capacity',
		short:
			"A set of already-open database (or HTTP) connections an app reuses, because opening a new one costs time (TCP, TLS, auth). The pool has a maximum size. When every connection is checked out, the next request waits, and that wait often doesn't show up as 'DB time' in traces. The database also has its own ceiling (Postgres max_connections), and pods × pool size can exceed it when you scale out.",
		related: ['pgbouncer', 'worker-pool', 'littles-law', 'autoscaling']
	},
	{
		id: 'timeout',
		term: 'Timeout',
		category: 'reliability practice',
		short:
			"A limit on how long you'll wait for something before giving up. Without one, a hung dependency holds your workers forever. Important: when a call times out you don't know if the other side did the work, so a timeout means 'unknown outcome', not 'failed'. Retrying it is only safe if the operation is idempotent.",
		related: ['idempotency', 'circuit-breaker', 'littles-law', 'retry-storm']
	},
	{
		id: 'circuit-breaker',
		term: 'Circuit breaker',
		category: 'reliability practice',
		short:
			"A wrapper around calls to a dependency that counts failures. After too many it 'opens' and fails calls instantly for a while instead of waiting on a dependency that's down, then lets a few test calls through to see if it recovered. It protects your own capacity and gives the struggling dependency room to recover.",
		analogy: 'The breaker in your house trips so one faulty appliance does not burn down the wiring for everything else.',
		related: ['timeout', 'bulkhead', 'retry-storm']
	},
	{
		id: 'bulkhead',
		term: 'Bulkhead',
		category: 'reliability practice',
		short:
			"Giving each dependency or feature its own separate pool of workers or connections, so one going slow can't use up the capacity everything else needs. Named after ship compartments: a leak floods one compartment, not the whole hull.",
		related: ['worker-pool', 'circuit-breaker', 'noisy-neighbor']
	},
	{
		id: 'exponential-backoff',
		term: 'Exponential backoff',
		aliases: ['backoff'],
		category: 'reliability practice',
		short:
			"Waiting longer after each failed retry: 100 ms, 200 ms, 400 ms, 800 ms… It gives an overloaded service time to recover instead of hammering it at full speed. Always combine it with [[jitter]], or all clients back off in lockstep and retry at the same instants.",
		related: ['jitter', 'retry-storm', 'idempotency']
	},
	{
		id: 'jitter',
		term: 'Jitter',
		category: 'reliability practice',
		short:
			"Adding randomness to timings (retry delays, cache expiry, cron start times) so that many clients don't act at the exact same moment. Without it, synchronized behaviour creates periodic spikes: every cache key set at 09:00 with a 1-hour TTL expires at 10:00 together.",
		related: ['exponential-backoff', 'ttl', 'cache-stampede']
	},
	{
		id: 'idempotency',
		term: 'Idempotency',
		aliases: ['idempotent'],
		category: 'distributed systems',
		short:
			"An operation is idempotent if doing it twice has the same effect as doing it once. 'Set status to shipped' is idempotent; 'charge $50' is not. Networks force you to care: requests time out, messages get redelivered, users double-click, so anything that might be repeated must either be naturally idempotent or made idempotent.",
		analogy: "Pressing a lift call button five times still brings one lift. Paying for coffee five times gets you charged five times.",
		related: ['idempotency-key', 'timeout', 'webhook', 'out-of-order-delivery'],
		page: [
			{ type: 'heading', text: 'Why it comes up constantly' },
			{
				type: 'p',
				text: 'In a distributed system, "did it happen?" is often unknowable. A [[timeout]] can fire *after* the server did the work but before the response arrived. Message queues and [[webhook|webhooks]] deliver **at least once**, so duplicates are normal. The only robust answer is to make repeats harmless.'
			},
			{ type: 'heading', text: 'Naturally idempotent vs not' },
			{
				type: 'table',
				head: ['Operation', 'Idempotent?', 'Why'],
				rows: [
					['`SET balance = 100`', 'Yes', 'Same end state every time'],
					['`SET balance = balance - 10`', 'No', 'Each repeat subtracts again'],
					['`PUT /users/7 {name}`', 'Yes (by design)', 'Replaces state'],
					['`POST /charges`', 'No', 'Creates a new charge each call'],
					['`DELETE /orders/9`', 'Yes', 'Already gone after the first'],
					['Send email', 'No', 'Customer gets two emails']
				]
			},
			{ type: 'heading', text: 'Making a non-idempotent operation safe' },
			{
				type: 'code',
				lang: 'python',
				code: `def charge(order):
    # Same key for every attempt of the same logical operation.
    key = f"order-{order.id}-charge"
    resp = payments.post("/charges",
                         json={"amount": order.total_cents},
                         headers={"Idempotency-Key": key},
                         timeout=5)
    db.mark_paid(order.id, resp.json()["charge_id"])`,
				caption: 'The provider remembers the key and returns the original result on a retry instead of charging again.'
			},
			{
				type: 'list',
				items: [
					'**Dedupe table:** store processed message/event ids; skip if seen (insert with a unique constraint, in the same transaction as the effect).',
					'**Conditional writes:** `UPDATE … WHERE status = \'pending\'` applies only once.',
					'**Natural keys:** upsert on a business key instead of inserting blindly.'
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				text: 'A key that changes between attempts (e.g. includes a timestamp or a random UUID generated per attempt) provides no protection. The key must identify the *logical* operation.'
			}
		]
	},
	{
		id: 'idempotency-key',
		term: 'Idempotency key',
		category: 'distributed systems',
		short:
			"A unique id the client sends with a request (e.g. 'order-881-charge') so the server can recognise a retry of the same operation and return the original result instead of doing it again. It must stay the same across retries of one logical action and differ between different actions.",
		related: ['idempotency', 'timeout']
	},
	{
		id: 'retry-storm',
		term: 'Retry storm',
		aliases: ['retry amplification'],
		category: 'reliability practice',
		short:
			"When a dependency slows down, every client retries, which multiplies the load on the thing that's already struggling, so it gets slower, so more retries… Layers multiply it: three layers each retrying 3× turn one user request into up to 64 calls at the bottom. Fixes: retry at one layer only, retry budgets, backoff with jitter, circuit breakers.",
		related: ['exponential-backoff', 'jitter', 'circuit-breaker', 'timeout']
	},

	// ───────────────────────── caching ─────────────────────────
	{
		id: 'cache-hit-rate',
		term: 'Cache hit rate',
		aliases: ['hit ratio', 'miss rate'],
		category: 'caching',
		short:
			"The share of lookups the cache could answer without going to the database. Think in the miss rate instead: 99% → 98% hit rate sounds tiny, but misses go from 1% to 2%, which doubles the load on the database behind it.",
		related: ['cache-stampede', 'ttl', 'cardinality']
	},
	{
		id: 'cache-stampede',
		term: 'Cache stampede (thundering herd)',
		aliases: ['thundering herd', 'dogpile'],
		category: 'caching',
		short:
			"When a popular cache entry expires (or the cache is flushed), hundreds of requests miss at the same moment and all run the same expensive query at once. The database spikes, the query gets slower, more requests pile up behind it. It's a burst problem: the average hit rate can look fine.",
		analogy: 'A shop restocking its only checkout machine at lunchtime: everyone who would have used it rushes the one human cashier.',
		related: ['single-flight', 'stale-while-revalidate', 'jitter', 'ttl'],
		page: [
			{ type: 'heading', text: 'What it looks like' },
			{
				type: 'dashboard',
				dashboard: {
					style: 'grafana',
					title: 'Cache + DB · hourly expiry',
					range: '09:55 – 10:35',
					panels: [
						{
							kind: 'timeseries',
							title: 'Cache misses / s',
							span: 3,
							x: stampedeX,
							series: [{ name: 'misses', points: shape(40, { base: 30, noise: 0.15, seed: 4 }, periodic(100, 3, 2400, 5)), color: 1 }],
							markers: [{ at: 5, label: '10:00 TTL expiry' }]
						},
						{
							kind: 'timeseries',
							title: 'DB p95',
							span: 3,
							unit: 'ms',
							x: stampedeX,
							series: [{ name: 'p95', points: shape(40, { base: 25, noise: 0.1, seed: 5 }, periodic(100, 5, 1400, 5)), color: 2 }]
						}
					]
				}
			},
			{
				type: 'p',
				text: 'The spike lines up with the expiry, lasts a few minutes, and happens again at the next expiry. If the keys were all written by one warm-up job, they all expire together.'
			},
			{ type: 'heading', text: 'Fixes, cheapest first' },
			{
				type: 'list',
				items: [
					'**[[jitter|TTL jitter]]:** expire at 3600 s ± 10% so keys spread out.',
					'**[[single-flight]]:** only one request recomputes a missing key; the others wait for its result.',
					'**[[stale-while-revalidate]]:** serve the old value while one background refresh runs.',
					'**Early refresh:** refresh popular keys a little before expiry, probabilistically.'
				]
			}
		]
	},
	{
		id: 'ttl',
		term: 'TTL (time to live)',
		aliases: ['expiry', 'expiration'],
		category: 'caching',
		short:
			"How long a cached value (or DNS record, or message) is kept before it's considered expired. Short TTLs mean fresher data but more misses; long TTLs mean fewer misses but staler data. Identical TTLs set at the same moment expire together, which causes periodic spikes.",
		related: ['cache-stampede', 'jitter', 'cache-hit-rate']
	},
	{
		id: 'single-flight',
		term: 'Single-flight (request coalescing)',
		aliases: ['request coalescing', 'singleflight'],
		category: 'caching',
		short:
			"When many requests need the same missing value at once, let only the first one compute it and make the others wait for and share its result. It turns 500 identical database queries into one. Usually implemented with an in-process lock map or a short-lived distributed lock.",
		related: ['cache-stampede', 'stale-while-revalidate']
	},
	{
		id: 'stale-while-revalidate',
		term: 'Stale-while-revalidate',
		aliases: ['SWR'],
		category: 'caching',
		short:
			"A caching policy: when a value expires, keep serving the old (stale) copy for a little while and refresh it in the background. Users never wait on the slow recompute, and only one refresh runs. The trade-off is that people see slightly old data for a short window.",
		related: ['cache-stampede', 'single-flight', 'ttl']
	},
	{
		id: 'cardinality',
		term: 'Cardinality',
		aliases: ['high cardinality'],
		category: 'caching',
		short:
			"The number of distinct values something can take. A cache key built from (product_id) has as many entries as products; add user_id and it has products × users, so almost every lookup is a miss. The same idea hurts metrics (a label with millions of values) and query planning (how selective a column is).",
		related: ['cache-hit-rate', 'table-statistics']
	},

	// ───────────────────────── databases ─────────────────────────
	{
		id: 'n-plus-one',
		term: 'N+1 queries',
		aliases: ['n+1', 'n plus one'],
		category: 'databases',
		short:
			"Running one query to get a list, then one more query per item in that list. With 10 items it's 11 fast queries and nobody notices; with a big customer's 5,000 items it's 5,001 round-trips. ORMs cause it silently when you touch a relationship inside a loop.",
		related: ['tail-latency', 'multi-tenancy'],
		page: [
			{ type: 'heading', text: 'The shape in code' },
			{
				type: 'code',
				lang: 'python',
				code: `orders = Order.objects.filter(customer_id=cid)      # 1 query
for o in orders:
    print(o.customer.name, len(o.items.all()))      # +2 queries per order`,
				caption: '3 orders → 7 queries. 3,000 orders → 6,001 queries.'
			},
			{
				type: 'columns',
				columns: [
					{
						title: 'Fix: load relations up front',
						blocks: [
							{
								type: 'code',
								lang: 'python',
								code: `orders = (Order.objects
    .filter(customer_id=cid)
    .select_related("customer")
    .prefetch_related("items"))   # 3 queries total`
							}
						]
					},
					{
						title: 'Fix: let SQL do it',
						blocks: [
							{
								type: 'code',
								lang: 'sql',
								code: `SELECT o.id, count(i.id)
FROM orders o
LEFT JOIN items i ON i.order_id = o.id
WHERE o.customer_id = $1
GROUP BY o.id;`
							}
						]
					}
				]
			},
			{ type: 'heading', text: 'How to spot it' },
			{
				type: 'list',
				items: [
					'Query count per request grows with data size (log or trace it).',
					'A trace shows a "comb": hundreds of identical tiny DB spans in a row.',
					'Latency is fine for small accounts and terrible for large ones ([[tail-latency]] segmented by tenant).'
				]
			}
		]
	},
	{
		id: 'database-index',
		term: 'Database index',
		aliases: ['index', 'b-tree', 'composite index'],
		category: 'databases',
		short:
			"A sorted lookup structure (usually a B-tree) that lets the database jump straight to matching rows instead of reading the whole table. Like a book's index: you find 'Postgres, p.214' instead of reading every page. Column order matters in a composite index: (tenant_id, created_at) serves 'this tenant, newest first' but not 'newest across all tenants'. Indexes speed up reads and slow down writes.",
		related: ['seq-scan', 'query-planner', 'explain-analyze']
	},
	{
		id: 'seq-scan',
		term: 'Sequential scan',
		aliases: ['seq scan', 'full table scan'],
		category: 'databases',
		short:
			"Reading every row of a table in order to find the ones that match. It sounds bad but is the right choice when you need a large fraction of the table, because reading pages in order is much cheaper than jumping around via an index. It becomes a problem when the planner picks it for a small result, or the table has grown so the scan takes seconds.",
		related: ['database-index', 'query-planner', 'query-plan-flip']
	},
	{
		id: 'query-planner',
		term: 'Query planner (optimizer)',
		aliases: ['optimizer', 'query optimizer', 'execution plan'],
		category: 'databases',
		short:
			"The part of the database that decides *how* to run your SQL: which index to use, which join order, whether to scan the whole table. It guesses how many rows each step will return using [[table-statistics]] and picks the plan with the lowest estimated cost. When the guess is wrong, a query that should take 5 ms can take 5 seconds.",
		related: ['table-statistics', 'query-plan-flip', 'explain-analyze', 'seq-scan']
	},
	{
		id: 'table-statistics',
		term: 'Table statistics',
		aliases: ['pg_stats', 'ANALYZE', 'histogram stats', 'most common values'],
		category: 'databases',
		short:
			"A summary of each column's data the planner uses to estimate row counts: how many distinct values, the most common values and how often each appears, and a histogram of the rest. They come from a random sample, refreshed by ANALYZE (autovacuum runs it periodically). If they're stale or the sample misses a skewed value, estimates are wrong and the planner picks bad plans.",
		related: ['query-planner', 'query-plan-flip', 'cardinality']
	},
	{
		id: 'query-plan-flip',
		term: 'Query plan flip',
		aliases: ['plan regression', 'plan change', 'generic plan'],
		category: 'databases',
		short:
			"The same SQL suddenly runs with a different plan, e.g. switches from an index scan to a full table scan, because the planner's row estimate crossed a cost threshold. It often happens only for some parameter values (a huge tenant), after statistics refresh, or after a prepared statement switches to a generic plan. The query text never changed, so it looks like a mystery slowdown.",
		related: ['query-planner', 'table-statistics', 'seq-scan', 'multi-tenancy', 'explain-analyze'],
		page: [
			{ type: 'heading', text: 'Step 1: how the planner guesses row counts' },
			{
				type: 'p',
				text: 'For `WHERE tenant_id = 42` the planner looks in [[table-statistics]] (Postgres `pg_stats`). It has a **most-common-values (MCV) list** with frequencies, e.g. `{17: 0.31, 42: 0.12, …}`, and a **histogram** for everything else. Values in the MCV list get their exact frequency; values not in it get a share of what remains, roughly evenly. These numbers come from a **random sample** (default ~30,000 rows, set by `default_statistics_target = 100`), refreshed by `ANALYZE`.'
			},
			{
				type: 'p',
				text: 'Estimated rows = table rows × frequency. On a 10M-row table: a tiny tenant (0.1%) → ~10,000 rows; tenant 17 (31%) → ~3.1M rows.'
			},
			{ type: 'heading', text: 'Step 2: why the plan differs per tenant' },
			{
				type: 'p',
				text: "An index scan costs a random page read per matching row (more or less). A sequential scan reads every page, but in order, which is far cheaper per page. For 10,000 rows the index wins easily. For 3.1M rows (a third of the table) jumping around the index would touch most pages anyway, in random order, so the planner chooses a [[seq-scan]]. **Same SQL, same index, different plan, chosen by the parameter value.**"
			},
			{
				type: 'columns',
				columns: [
					{
						title: 'Small tenant',
						blocks: [
							{
								type: 'code',
								lang: 'sql',
								code: `EXPLAIN ANALYZE SELECT * FROM events
WHERE tenant_id = 903;

Index Scan using events_tenant_idx
  (cost=0.43..812.10 rows=9800)
  (actual time=0.03..6.1 rows=10112)
Execution Time: 7.4 ms`
							}
						]
					},
					{
						title: 'Big tenant',
						blocks: [
							{
								type: 'code',
								lang: 'sql',
								code: `EXPLAIN ANALYZE SELECT * FROM events
WHERE tenant_id = 17;

Seq Scan on events
  (cost=0.00..245000.00 rows=3100000)
  Filter: (tenant_id = 17)
  Rows Removed by Filter: 6900000
Execution Time: 2840.2 ms`
							}
						]
					}
				]
			},
			{ type: 'heading', text: 'Step 3: when the flip is right vs wrong' },
			{
				type: 'p',
				text: 'If the query really returns 3.1M rows, the seq scan is the *correct* choice; the problem is the query (it shouldn\'t load a third of the table). The flip is **wrong** when the query only needs a few rows but the planner can\'t see that:'
			},
			{
				type: 'code',
				lang: 'sql',
				code: `SELECT * FROM events
WHERE tenant_id = 17
ORDER BY created_at DESC
LIMIT 50;`,
				caption: 'Needs 50 rows. With only an index on (tenant_id), the planner may scan the whole tenant, sort 3.1M rows, and keep 50.'
			},
			{
				type: 'p',
				text: 'With an index on `(tenant_id, created_at)` the database can walk the newest 50 entries for tenant 17 and stop, ~1 ms regardless of tenant size.'
			},
			{ type: 'heading', text: 'Other ways the plan flips without a deploy' },
			{
				type: 'list',
				items: [
					'**Stale statistics:** a tenant imports 2M rows on Tuesday; until ANALYZE runs, the planner thinks they\'re tiny (or the reverse). The plan changes the moment autovacuum re-analyzes.',
					'**Sampling misses skew:** with a small sample, a mid-size tenant may not land in the MCV list, so its estimate is the "average" share: wildly off in either direction.',
					'**Correlated columns:** `WHERE tenant_id = 17 AND region = \'eu\'` is estimated by multiplying the two frequencies as if independent. If every row of tenant 17 is EU, the estimate is far too low.',
					'**Prepared statements and generic plans:** Postgres plans a prepared statement with the actual parameter values for the first 5 executions (custom plans). After that, if a parameter-free **generic plan** looks no more expensive on average, it switches to it, and that one plan is used for every tenant. A plan that suits the average tenant can be terrible for the biggest one, and the switch happens on the 6th execution, silently, per connection.'
				]
			},
			{ type: 'heading', text: 'Fixes' },
			{
				type: 'list',
				items: [
					'**Composite index matching filter + sort:** `CREATE INDEX CONCURRENTLY ON events (tenant_id, created_at DESC);`',
					'**Refresh and enrich statistics:** `ANALYZE events;` raise `ALTER TABLE events ALTER COLUMN tenant_id SET STATISTICS 1000;` so skewed values are captured.',
					'**Extended statistics** for correlated columns: `CREATE STATISTICS ON tenant_id, region FROM events;`',
					'**Control generic plans:** `plan_cache_mode = force_custom_plan` for the affected role/query, so each execution is planned with its real parameter.',
					'**Partition or isolate big tenants:** list-partition by tenant or move whales to their own table/database so their statistics don\'t distort everyone else\'s (see [[multi-tenancy]]).',
					'**Always confirm with [[explain-analyze]]** for both a small and a large tenant, and compare estimated vs actual rows. A 100× gap is the signature.'
				]
			}
		]
	},
	{
		id: 'explain-analyze',
		term: 'EXPLAIN ANALYZE',
		aliases: ['explain', 'query plan'],
		category: 'databases',
		short:
			"A command that runs a query and shows the plan the database actually used, with estimated vs actual row counts and time per step. The key thing to read: where estimated rows and actual rows differ a lot (that's where the planner was fooled) and which step took the time. Careful: it really executes the query, so wrap writes in a transaction you roll back.",
		related: ['query-planner', 'query-plan-flip', 'seq-scan']
	},
	{
		id: 'keyset-pagination',
		term: 'Keyset pagination',
		aliases: ['cursor pagination', 'seek pagination', 'offset pagination'],
		category: 'databases',
		short:
			"Paging with 'give me 50 rows after id 12345' (`WHERE id < :last ORDER BY id DESC LIMIT 50`) instead of 'skip 100,000 rows then give me 50' (OFFSET). OFFSET still reads and throws away every skipped row, so deep pages get slower and slower. Keyset uses the index to jump straight to the position, so every page costs the same.",
		related: ['database-index', 'n-plus-one']
	},
	{
		id: 'table-bloat',
		term: 'Table bloat (dead tuples)',
		aliases: ['bloat', 'vacuum', 'dead tuples', 'autovacuum'],
		category: 'databases',
		short:
			"In Postgres an UPDATE or DELETE doesn't overwrite the row; it leaves the old version behind as a 'dead tuple' until VACUUM cleans it. If vacuum falls behind (very busy tables, long-running transactions holding old snapshots), tables and indexes fill with dead rows, so every scan reads more pages and queries slowly get slower even though the live data didn't grow.",
		related: ['seq-scan', 'database-index']
	},
	{
		id: 'replication-lag',
		term: 'Replication lag',
		category: 'databases',
		short:
			"How far a read replica is behind the primary database. Writes go to the primary and are copied over asynchronously, so for a moment (normally milliseconds, sometimes minutes under heavy load) the replica returns old data. Classic symptom: a user saves something, the page reloads from a replica, and their change seems to have vanished.",
		related: ['read-replica', 'eventual-consistency']
	},
	{
		id: 'read-replica',
		term: 'Read replica',
		category: 'databases',
		short:
			"A copy of the database that receives the primary's changes and serves read-only queries, to take load off the primary. Reads from it may be slightly stale because of [[replication-lag]], so anything that must see its own just-written data should read from the primary.",
		related: ['replication-lag', 'eventual-consistency']
	},
	{
		id: 'multi-tenancy',
		term: 'Multi-tenancy',
		aliases: ['tenant', 'pool model', 'silo model', 'bridge model', 'tenant_id'],
		category: 'databases',
		short:
			"One running system serving many customers (tenants). The usual setup is a shared database where every row has a tenant_id: the data is logically separate, but the tenants share the same CPU, memory, connections, locks and query plans. That sharing is why one big customer can affect everyone, and why work that grows with a customer's size shows up only for big customers.",
		related: ['tenant-isolation', 'noisy-neighbor', 'hot-partition', 'query-plan-flip'],
		page: [
			{ type: 'heading', text: 'Three common models' },
			{
				type: 'table',
				head: ['Model', 'How data is split', 'What is shared', 'Typical use'],
				rows: [
					['**Pool**', 'Same tables, every row has `tenant_id`', 'Everything: CPU, RAM, buffer cache, connections, locks, indexes, statistics', 'Most SaaS; cheap, easy to run'],
					['**Bridge**', 'One schema per tenant in the same database', 'Server CPU/RAM/disk, connection limit, buffer cache; tables and stats are separate', 'Mid-size B2B, some customisation'],
					['**Silo**', 'One database (or cluster) per tenant', 'Usually only the app tier and infra', 'Enterprise, regulated, very large tenants']
				]
			},
			{ type: 'heading', text: '"Isolated" by tenant_id still means shared' },
			{
				type: 'p',
				text: 'A `WHERE tenant_id = ?` filter isolates *data visibility*. It does not isolate *resources*. In the pool model, two tenants share:'
			},
			{
				type: 'list',
				items: [
					'**CPU and disk I/O** of the database server: a big tenant\'s report slows everyone\'s queries.',
					'**Buffer cache (RAM):** a big tenant scanning millions of rows evicts small tenants\' hot pages, so their queries go to disk.',
					'**Locks:** a long transaction or migration on a shared table blocks all tenants.',
					'**The [[connection-pool]]:** slow queries from one tenant hold connections everyone needs.',
					'**Indexes and [[table-statistics]]:** one B-tree for all tenants, and one set of statistics in which a giant tenant\'s skew distorts the planner\'s estimates for everyone ([[query-plan-flip]]).'
				]
			},
			{ type: 'heading', text: 'Why "only big customers are slow" happens in each model' },
			{
				type: 'cards',
				items: [
					{
						title: 'Every model',
						items: [
							'Work that grows with tenant size: [[n-plus-one]] over members, in-memory aggregation, no pagination.',
							'Per-tenant third-party rate limits hit only by big tenants.',
							'Bigger payloads to serialize and send.'
						]
					},
					{
						title: 'Pool model only',
						items: [
							'Plan flips: the big tenant\'s parameter value crosses the seq-scan threshold.',
							'[[hot-partition|Hot partition]] or hot cache key when sharded by tenant_id.',
							'Contention they create also hits others, see [[noisy-neighbor]].'
						]
					},
					{
						title: 'Silo model',
						items: [
							'Their dedicated DB may be under-provisioned for their size.',
							'Their own stats/indexes are stale or missing (each silo is maintained separately).',
							'No cross-tenant DB contention, so if small tenants are also slow at the same time, suspect the shared app tier or infra rather than the big tenant\'s database.'
						]
					}
				]
			},
			{ type: 'heading', text: 'Assumptions behind the scenario' },
			{
				type: 'list',
				items: [
					'The **pool model**: one shared database, tenants separated by `tenant_id`. That is what makes plan flips and hot partitions possible candidates.',
					'Tenants vary hugely in size (power-law: a handful of tenants own most rows). Without skew, "only big customers" wouldn\'t happen.',
					'p50 is fine because **most requests come from small tenants**, so the median request never sees the problem. The p99 is dominated by the few big tenants\' requests.',
					'Small tenants are *not* slow at the same moments. If they were, you\'d suspect contention (a big tenant slowing the shared DB) rather than work that scales with size.'
				]
			},
			{
				type: 'callout',
				tone: 'info',
				title: 'A good interview move',
				text: 'State the model you\'re assuming out loud: "I\'ll assume a shared Postgres with tenant_id on every table; if they\'re on separate databases, the plan-flip and hot-partition hypotheses drop out and I\'d look harder at per-tenant provisioning."'
			}
		]
	},
	{
		id: 'tenant-isolation',
		term: 'Tenant isolation',
		aliases: ['cross-tenant leak', 'data isolation'],
		category: 'security & compliance',
		short:
			"The guarantee that one customer can never see or affect another customer's data. In shared systems it rests on every query, cache key, search index and background job carrying the tenant id correctly. A single forgotten filter is a data breach, so good systems enforce it centrally (in the data-access layer or with row-level security) instead of trusting each developer.",
		related: ['multi-tenancy', 'shared-mutable-state', 'rag'],
		page: [
			{ type: 'heading', text: 'Where tenant leaks hide' },
			{
				type: 'table',
				head: ['Layer', 'How it leaks', 'Guard'],
				rows: [
					['SQL', 'A query without `WHERE tenant_id = ?`', 'Row-level security; repository layer that always adds the filter'],
					['Cache', 'Key `report:2026-10` without tenant prefix', 'Key builder that requires tenant id'],
					['Search / vector index', 'Query without tenant filter or shared namespace', 'Mandatory filter in the client wrapper; index per tenant'],
					['Background jobs', 'Worker reuses the previous job\'s context', 'Immutable per-job context; no module-level state'],
					['Files / object storage', 'Predictable paths, missing prefix', 'Prefix per tenant + scoped credentials'],
					['Logs & exports', 'Admin export runs across all tenants', 'Explicit scope parameter, audited']
				]
			},
			{ type: 'heading', text: 'Defence in depth' },
			{
				type: 'code',
				lang: 'sql',
				code: `ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_only ON documents
  USING (tenant_id = current_setting('app.tenant_id')::int);
-- the app sets app.tenant_id per transaction; a forgotten WHERE returns nothing instead of everything`
			},
			{
				type: 'list',
				items: [
					'**Assert at the boundary:** before returning results, check every row\'s tenant matches the request. A mismatch is a hard failure plus an alert.',
					'**Test it:** an automated test that creates two tenants and tries to read B\'s data as A through every endpoint.',
					'**Treat it as severity 1:** in healthcare or finance a leak is a reportable incident even if only one record crossed.'
				]
			}
		]
	},
	{
		id: 'hot-partition',
		term: 'Hot partition (hot key)',
		aliases: ['hot shard', 'hot key'],
		category: 'distributed systems',
		short:
			"When data is split across shards or partitions by a key (like tenant_id), one key that gets far more traffic than the others overloads its single shard while the rest sit idle. Adding more shards doesn't help, because that one key still lives in one place. Fixes spread the hot key (add a suffix, split large tenants) or cache it.",
		related: ['multi-tenancy', 'noisy-neighbor']
	},
	{
		id: 'noisy-neighbor',
		term: 'Noisy neighbor',
		category: 'cloud & infra',
		short:
			"One tenant, process or VM using so much of a shared resource (CPU, disk, network, database) that others on the same hardware slow down, even though they did nothing different. The tell-tale sign: your latency rises while your own load is flat, and it correlates with someone else's activity.",
		analogy: 'The flat upstairs doing laundry at 2 a.m.: your water pressure drops and you did nothing.',
		related: ['multi-tenancy', 'bulkhead', 'hot-partition']
	},
	{
		id: 'pgbouncer',
		term: 'PgBouncer (connection pooler)',
		aliases: ['RDS Proxy', 'connection pooler', 'transaction pooling'],
		category: 'databases',
		short:
			"A lightweight proxy in front of Postgres that lets thousands of app connections share a few dozen real database connections. In transaction mode a real connection is lent out only for the length of one transaction. It's the standard fix when scaling out app pods pushes the total connections past what Postgres can handle; the catch is that session features (prepared statements, SET, advisory locks) behave differently.",
		related: ['connection-pool', 'autoscaling']
	},

	// ───────────────────────── cloud & infra ─────────────────────────
	{
		id: 'autoscaling',
		term: 'Autoscaling (HPA)',
		aliases: ['HPA', 'horizontal pod autoscaler', 'scale out'],
		category: 'cloud & infra',
		short:
			"Automatically adding or removing servers/pods based on a metric like CPU. It helps when the bottleneck is the scaled tier itself. If the real bottleneck is downstream (a database, a rate-limited API), more pods just send more load to it and can make things worse, e.g. by opening more database connections than it allows. New instances also take time to start, so scaling lags sudden spikes.",
		related: ['connection-pool', 'pgbouncer', 'cpu-throttling']
	},
	{
		id: 'cpu-throttling',
		term: 'CPU throttling (container limits)',
		aliases: ['cfs throttling', 'cpu limits'],
		category: 'cloud & infra',
		short:
			"In Kubernetes a CPU limit gives a container a time budget per 100 ms window. If it uses its budget early (e.g. many threads busy at once), it's frozen until the next window, adding up to tens of milliseconds of pause to whatever request was running. Average CPU can look low (30%) while requests are being throttled, so check the throttled-periods metric, not utilisation.",
		related: ['tail-latency', 'autoscaling']
	},
	{
		id: 'sticky-sessions',
		term: 'Sticky sessions',
		aliases: ['session affinity'],
		category: 'cloud & infra',
		short:
			"A load-balancer setting that sends all requests from one user to the same server, usually because the server keeps session state in memory. It causes uneven load: a server that got a few heavy users stays overloaded while others idle, and when it dies those users lose their sessions.",
		related: ['autoscaling', 'hot-partition']
	},
	{
		id: 'gc-pause',
		term: 'GC pause',
		aliases: ['garbage collection', 'stop-the-world'],
		category: 'latency & capacity',
		short:
			"Languages with garbage collection (Java, Go, Node, Python, .NET) periodically find and free unused memory. Some phases pause the program, and every request in progress waits. Pauses get longer and more frequent as the heap fills up, which is why a [[memory-leak]] shows up first as rising [[tail-latency]].",
		related: ['memory-leak', 'tail-latency', 'sawtooth-pattern']
	},
	{
		id: 'memory-leak',
		term: 'Memory leak',
		category: 'latency & capacity',
		short:
			"Memory that the program keeps holding although it will never use it again, e.g. a global dict used as a cache with no eviction, or event listeners never removed. Memory grows until the process is killed (OOM) or restarted. Before that, garbage collection works harder and harder, so latency climbs too. Restarting 'fixes' it temporarily, which is the giveaway.",
		related: ['gc-pause', 'sawtooth-pattern']
	},
	{
		id: 'sawtooth-pattern',
		term: 'Sawtooth pattern',
		category: 'observability',
		short:
			"A chart that climbs steadily and then drops suddenly, over and over. In memory graphs it means something accumulates until a reset (a restart, an OOM kill, a full GC). In latency graphs it often mirrors the memory sawtooth. The period tells you something: a drop at fixed times points to a scheduled restart or job; drops at random times point to crashes.",
		related: ['memory-leak', 'gc-pause']
	},
	{
		id: 'event-loop',
		term: 'Event loop',
		aliases: ['event loop blocking', 'nodejs event loop'],
		category: 'latency & capacity',
		short:
			"Node.js (and Python asyncio) run all your code on one thread that switches between requests whenever one is waiting on I/O. That's efficient for waiting, but any CPU-heavy work (a big JSON.parse, a regex, a sync crypto call) blocks the thread, so *every* other request on that process waits until it finishes. Symptom: unrelated endpoints get slow together, with low I/O.",
		related: ['worker-pool', 'tail-latency']
	},

	// ───────────────────────── frontend & network ─────────────────────────
	{
		id: 'request-waterfall',
		term: 'Request waterfall',
		category: 'frontend & network',
		short:
			"When a page makes requests one after another because each one needs data from the previous (user → org → projects → stats). The total time is the sum of all round-trips, so on a mobile connection with 300 ms latency, four dependent calls cost over a second before any server work. Fixes: fetch independent things in parallel, or have one endpoint return everything.",
		related: ['bff', 'rum', 'cors-preflight']
	},
	{
		id: 'cors-preflight',
		term: 'CORS preflight',
		aliases: ['OPTIONS request', 'CORS'],
		category: 'frontend & network',
		short:
			"Before a browser sends a 'non-simple' request (custom headers, JSON body, PUT/DELETE) to another domain, it first sends an OPTIONS request asking permission. That doubles the round-trips for every such call unless the server lets the browser cache the answer (Access-Control-Max-Age). Serving the API from the same domain as the page avoids it entirely.",
		related: ['request-waterfall', 'rum']
	},
	{
		id: 'rum',
		term: 'RUM (real user monitoring)',
		aliases: ['real user monitoring', 'web vitals', 'TTI'],
		category: 'observability',
		short:
			"Measuring performance in the actual browsers of real users, not on your servers. It captures what server metrics can't see: network latency, slow phones, big JavaScript bundles, rendering time. When the server says 120 ms but users say the page takes 7 seconds, RUM is how you find where the other 6.9 seconds went.",
		related: ['request-waterfall', 'percentiles']
	},
	{
		id: 'bff',
		term: 'BFF (backend for frontend)',
		aliases: ['backend for frontend', 'aggregation endpoint'],
		category: 'frontend & network',
		short:
			"A thin server-side API built specifically for one frontend, which calls the various backend services and returns exactly what a screen needs in one response. It moves the [[request-waterfall]] from the user's slow network to the fast data-center network.",
		related: ['request-waterfall', 'fan-out']
	},

	// ───────────────────────── distributed systems ─────────────────────────
	{
		id: 'webhook',
		term: 'Webhook',
		category: 'distributed systems',
		short:
			"An HTTP request another service sends to your URL when something happens ('payment succeeded'). Providers retry when you don't answer quickly with a 2xx, deliver duplicates, and don't guarantee order. So handlers must verify the signature, be idempotent, tolerate out-of-order events, and respond fast (do the real work later via a queue).",
		related: ['idempotency', 'out-of-order-delivery', 'state-machine']
	},
	{
		id: 'out-of-order-delivery',
		term: 'Out-of-order delivery',
		category: 'distributed systems',
		short:
			"Events arriving in a different order than they happened, because of retries, parallel consumers, or different network paths. If a handler blindly applies whatever arrives, a late 'processing' event can overwrite a newer 'shipped'. Guard with versions or timestamps (only apply if newer) or a [[state-machine]] that rejects backward moves.",
		related: ['webhook', 'state-machine', 'idempotency', 'eventual-consistency']
	},
	{
		id: 'state-machine',
		term: 'State machine',
		category: 'distributed systems',
		short:
			"Modelling something's lifecycle as a fixed set of states (pending → paid → shipped → delivered) and the allowed moves between them. Any event that would make an illegal move (shipped → pending) is rejected or logged. It makes duplicates and out-of-order events harmless and documents the business rules.",
		related: ['out-of-order-delivery', 'webhook']
	},
	{
		id: 'eventual-consistency',
		term: 'Eventual consistency',
		category: 'distributed systems',
		short:
			"A guarantee that if writes stop, all copies of the data will *eventually* agree, but at any instant different readers may see different versions. It's the price of replicas, caches, search indexes and async pipelines. Bugs appear when code assumes a write is visible everywhere immediately ('save, then read back from the replica / search index').",
		related: ['replication-lag', 'read-replica', 'out-of-order-delivery'],
		page: [
			{ type: 'heading', text: 'Where it bites' },
			{
				type: 'flow',
				steps: [
					{ label: 'Write to primary', tone: 'ok' },
					{ label: 'Replicate / emit event', note: 'ms to minutes' },
					{ label: 'Replica · cache · search index', tone: 'warn' },
					{ label: 'Reader sees old value', tone: 'crit' }
				],
				caption: 'Every arrow is a delay that grows under load.'
			},
			{
				type: 'table',
				head: ['Symptom', 'Cause'],
				rows: [
					['"I saved it, then it disappeared"', 'Page re-read from a lagging [[read-replica]]'],
					['New product not in search results', 'Index refresh interval / indexing queue backlog'],
					['Summary built from last week\'s data', 'Job triggered before indexing finished'],
					['Two dashboards disagree', 'Different caches with different TTLs']
				]
			},
			{ type: 'heading', text: 'Patterns that help' },
			{
				type: 'list',
				items: [
					'**Read your own writes:** route a user\'s reads to the primary for a few seconds after they write, or pass the written version along.',
					'**Trigger on completion, not on start:** fire downstream work on an "indexed" event, not "uploaded".',
					'**Fail closed:** if expected data isn\'t there yet, retry later rather than proceeding with what\'s visible.',
					'**Show staleness:** "updated 2 min ago" sets the right expectation.'
				]
			}
		]
	},
	{
		id: 'race-condition',
		term: 'Race condition',
		category: 'distributed systems',
		short:
			"A bug where the result depends on the timing of two things running at once. Classic case: two requests both read balance = 100, both subtract 30, both write 70; one withdrawal vanished. Races are rare in testing and common under production concurrency, so 'it started when we increased concurrency' is strong evidence.",
		related: ['shared-mutable-state', 'idempotency']
	},
	{
		id: 'shared-mutable-state',
		term: 'Shared mutable state',
		aliases: ['global state', 'module-level state'],
		category: 'distributed systems',
		short:
			"Data that several concurrent tasks can both read and change, like a module-level variable, a singleton, or a reused object. When two requests run at once, one can overwrite the other's values mid-flight, so request A ends up using request B's data. Per-request immutable objects avoid it.",
		related: ['race-condition', 'tenant-isolation']
	},
	{
		id: 'hedged-requests',
		term: 'Hedged requests',
		category: 'latency & capacity',
		short:
			"If a request hasn't answered within, say, its p95 time, send the same request to a second replica and use whichever answers first. It cuts tail latency a lot for a few percent extra load. Only safe for idempotent reads.",
		related: ['tail-latency', 'fan-out', 'idempotency']
	},
	{
		id: 'fan-out',
		term: 'Fan-out',
		category: 'latency & capacity',
		short:
			"One request triggering many parallel calls (to shards, services, or items). The overall request is as slow as the slowest call, so tails add up: if each of 100 calls is slow 1% of the time, about 63% of requests hit at least one slow call (1 − 0.99¹⁰⁰).",
		related: ['tail-latency', 'hedged-requests', 'percentiles']
	},

	// ───────────────────────── money & time ─────────────────────────
	{
		id: 'utc',
		term: 'UTC vs local time',
		aliases: ['UTC', 'timezone', 'local time'],
		category: 'money & time',
		short:
			"UTC is the single global reference clock with no daylight saving. Store and compute timestamps in UTC, and convert to a person's timezone only for display. Bugs happen when code mixes them, e.g. stores the UTC date but displays the local date: an appointment at 23:30 UTC is already 'tomorrow' in Cairo.",
		related: ['iana-timezone', 'off-by-one']
	},
	{
		id: 'iana-timezone',
		term: 'IANA timezone',
		aliases: ['tz database', 'Europe/Berlin'],
		category: 'money & time',
		short:
			"A named timezone like 'Europe/Berlin' or 'Africa/Cairo', from the standard tz database that knows each region's offset and daylight-saving history. Store this name, not a fixed offset like +02:00, because offsets change with DST and with government decisions.",
		related: ['utc']
	},
	{
		id: 'minor-units',
		term: 'Minor units (integer cents)',
		aliases: ['cents', 'integer money'],
		category: 'money & time',
		short:
			"Storing money as a whole number of the smallest unit (5000 cents instead of 50.00 dollars) so no fractions or float errors appear. Not every currency has 2 decimals: JPY has 0, and KWD/BHD have 3, so the scale must come from the currency. Mixing units (cents in a 'dollars' column) gives 100× errors.",
		related: ['floating-point', 'decimal-arithmetic', 'bankers-rounding']
	},
	{
		id: 'floating-point',
		term: 'Floating-point error',
		aliases: ['float', 'float precision', '0.1 + 0.2'],
		category: 'money & time',
		short:
			"Computers store most decimals in binary approximately, so 0.1 + 0.2 = 0.30000000000000004 and 2.675 is really 2.67499999…. Tiny errors add up over many operations and flip roundings at the .5 boundary. Never use floats for money; use integers or decimal types.",
		related: ['decimal-arithmetic', 'minor-units', 'bankers-rounding']
	},
	{
		id: 'decimal-arithmetic',
		term: 'Decimal arithmetic',
		aliases: ['Decimal', 'BigDecimal', 'numeric'],
		category: 'money & time',
		short:
			"Number types (Python Decimal, Java BigDecimal, SQL NUMERIC) that store base-10 digits exactly, so 0.1 really is 0.1. They let you control precision and rounding rules explicitly, which is what billing and accounting require. Slower than floats, which never matters for money.",
		related: ['floating-point', 'bankers-rounding', 'minor-units']
	},
	{
		id: 'bankers-rounding',
		term: "Banker's rounding (half-to-even)",
		aliases: ['round half to even', 'half-up rounding', 'ROUND_HALF_UP'],
		category: 'money & time',
		short:
			"A rounding rule where exact halves go to the nearest *even* number: 0.5 → 0, 1.5 → 2, 2.5 → 2. It avoids a systematic upward bias over many roundings, and it's the default in Python 3's round() and in IEEE floats. Most people (and many billing specs) expect half-up (2.5 → 3), so the default silently disagrees with the spec.",
		related: ['floating-point', 'decimal-arithmetic', 'largest-remainder'],
		page: [
			{ type: 'heading', text: 'Side by side' },
			{
				type: 'table',
				head: ['Value', 'Half-up', 'Half-even (banker\'s)', 'Python `round()`'],
				numeric: [0, 1, 2, 3],
				rows: [
					['0.5', '1', '0', '0'],
					['1.5', '2', '2', '2'],
					['2.5', '3', '2', '2'],
					['3.5', '4', '4', '4'],
					['−2.5', '−3 (away from 0)', '−2', '−2']
				]
			},
			{
				type: 'p',
				text: 'Sum of the four positive halves: true total 8.0, half-up gives 10, half-even gives 8. That\'s why statisticians and some banking systems prefer half-even: across many values it doesn\'t drift upward.'
			},
			{ type: 'heading', text: 'The float trap on top' },
			{
				type: 'code',
				lang: 'python',
				code: `>>> round(2.675, 2)
2.67           # 2.675 is stored as 2.67499999999999982236431605997495353221893310546875
>>> from decimal import Decimal, ROUND_HALF_UP
>>> Decimal("2.675").quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
Decimal('2.68')`
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'In an assessment',
				text: 'Write the rounding rule as a comment, use [[decimal-arithmetic|Decimal]] or integer math, round **once** at the end, and add a test whose exact value is x.5 so the rule is proven, e.g. 1 cent × 15/30 days = 0.5.'
			}
		]
	},
	{
		id: 'largest-remainder',
		term: 'Largest remainder allocation',
		aliases: ['penny allocation', 'hamilton method'],
		category: 'money & time',
		short:
			"A way to split a rounded total into rounded parts that still add up exactly. Round every part down, then give the leftover cents one each to the parts with the biggest fractional remainders. Without it, rounding each invoice line separately makes the lines sum to a few cents more or less than the total.",
		related: ['bankers-rounding', 'proration']
	},
	{
		id: 'proration',
		term: 'Proration',
		aliases: ['prorated billing'],
		category: 'money & time',
		short:
			"Charging for only part of a billing period, in proportion to how much of it was used: a user active 10 of 31 days pays 10/31 of the monthly price. The tricky parts are always the edges: inclusive vs exclusive end dates, months of different lengths, leap years, and when to round.",
		related: ['off-by-one', 'inclusive-exclusive', 'interval-overlap', 'leap-year']
	},
	{
		id: 'off-by-one',
		term: 'Off-by-one error',
		category: 'money & time',
		short:
			"Counting one too many or one too few, usually at a boundary. The classic: days from the 15th to the 31st inclusive is 31 − 15 + 1 = 17, not 16. It also shows up in loops (< vs <=), pagination, and array slicing. Test the first and last element of every range.",
		related: ['inclusive-exclusive', 'interval-overlap']
	},
	{
		id: 'leap-year',
		term: 'Leap year rule',
		category: 'money & time',
		short:
			"A year has a Feb 29 if it's divisible by 4, except century years, which need to be divisible by 400. So 2024 and 2000 are leap years, 1900 and 2100 are not. Billing that divides by 'days in month' needs this; code that assumes Feb has 28 days or a year has 365 is wrong one year in four.",
		related: ['proration', 'off-by-one']
	},
	{
		id: 'inclusive-exclusive',
		term: 'Inclusive vs exclusive bounds',
		aliases: ['half-open interval', '[start, end)'],
		category: 'money & time',
		short:
			"Whether a range's end point counts. 'Deactivated on Jan 10' can mean the 10th was their last active day (inclusive) or their first inactive day (exclusive), a one-day difference on every bill. Many systems use half-open ranges [start, end) because they chain cleanly without gaps or overlaps. Always find out which and write it down.",
		related: ['off-by-one', 'interval-overlap', 'proration']
	},
	{
		id: 'interval-overlap',
		term: 'Interval overlap',
		category: 'money & time',
		short:
			"How much two ranges share: overlap = max(0, min(end1, end2) − max(start1, start2) + 1) for inclusive day ranges. It replaces looping over every day: intersect the user's active range with the month and count, in constant time.",
		related: ['inclusive-exclusive', 'off-by-one', 'proration']
	},

	// ───────────────────────── reliability practice ─────────────────────────
	{
		id: 'swallowed-exception',
		term: 'Swallowed exception',
		aliases: ['except: pass', 'silent failure'],
		category: 'reliability practice',
		short:
			"Catching an error and doing nothing with it (`except: pass`). The program carries on as if everything worked, so a failure that hits every item looks like success, and the logs say 'sync complete'. Catch specific errors, log them with an id, count them, and report partial failure.",
		related: ['data-remediation']
	},
	{
		id: 'feature-flag',
		term: 'Feature flag',
		aliases: ['feature toggle', 'kill switch'],
		category: 'reliability practice',
		short:
			"A runtime switch that turns code paths on or off without a deploy, often per customer or for a percentage of traffic. It makes rollouts gradual and turning a bad change off take seconds. It also means two users can run different code, which is a common reason a bug affects 'only some customers'.",
		related: ['rollback', 'blue-green-deployment']
	},
	{
		id: 'rollback',
		term: 'Rollback',
		category: 'reliability practice',
		short:
			"Returning to the last known-good version after a bad change. It's usually the fastest mitigation and should come before root-causing. But it can't undo data changes: a migration that dropped a column or rows written in a new format need [[data-remediation]], and sometimes the old code can't read data the new code wrote.",
		related: ['feature-flag', 'blue-green-deployment', 'data-remediation']
	},
	{
		id: 'blue-green-deployment',
		term: 'Blue/green deployment',
		aliases: ['blue-green', 'blue green'],
		category: 'reliability practice',
		short:
			"Running the new version (green) alongside the old one (blue), then switching traffic over in one step once green is ready, and switching back if something goes wrong. The same idea applies to data: build a new index alongside the old one, fill it fully, then cut over atomically.",
		related: ['rollback', 'feature-flag']
	},
	{
		id: 'data-remediation',
		term: 'Data remediation',
		category: 'reliability practice',
		short:
			"Fixing the records a bug already damaged, separate from fixing the code. Deploying the fix stops new damage but doesn't refund the double charges, resend the missing contacts, or correct the wrong dates. A good write-up says which records were affected, since when (git blame on the bad line), and how they'll be repaired, with a dry run first.",
		related: ['rollback', 'swallowed-exception']
	},
	{
		id: 'sso',
		term: 'SSO (single sign-on)',
		aliases: ['IdP', 'SAML', 'OIDC', 'identity provider', 'sub claim'],
		category: 'security & compliance',
		short:
			"Logging into many apps with one company account. The identity provider (IdP: Okta, Azure AD, Google) proves who you are and sends the app 'claims' such as email and a stable subject id ('sub'). Match users on the sub, not the email: emails change and differ in case, which causes 'can't log in' tickets after migrations.",
		related: ['type-coercion']
	},
	{
		id: 'type-coercion',
		term: 'Type mismatch / coercion',
		aliases: ['string vs number', 'SameValueZero', 'strict equality'],
		category: 'frontend & network',
		short:
			"Comparing or combining values of different types: the string '12' from a URL vs the number 12 from JSON. Strict comparisons treat them as different, so filters silently match nothing; loose ones convert unpredictably. Convert and validate data where it enters your program, so everything inside has one type.",
		related: ['sso']
	},

	// ───────────────────────── ai & retrieval ─────────────────────────
	{
		id: 'rag',
		term: 'RAG (retrieval-augmented generation)',
		aliases: ['retrieval augmented generation'],
		category: 'ai & retrieval',
		short:
			"A setup where, before asking an LLM a question, you search your own documents for relevant passages and paste them into the prompt, so the model answers from your data instead of from memory. Each stage (splitting docs, embedding, searching, prompting) can fail separately, and a wrong answer can come from bad retrieval or from the model ignoring good retrieval.",
		related: ['embedding', 'vector-index', 'chunking', 'top-k', 'hallucination', 'groundedness'],
		page: [
			{ type: 'heading', text: 'The pipeline' },
			{
				type: 'flow',
				steps: [
					{ label: 'Source docs / transcripts' },
					{ label: '[[chunking|Chunk]]' },
					{ label: '[[embedding|Embed]]' },
					{ label: '[[vector-index|Index]]' },
					{ label: 'Query → retrieve [[top-k]]' },
					{ label: 'Prompt + LLM' },
					{ label: 'Answer' }
				],
				caption: 'Indexing (left) usually runs ahead of time; retrieval and generation (right) run per question.'
			},
			{ type: 'heading', text: 'First triage question: retrieval or generation?' },
			{
				type: 'p',
				text: 'Log the retrieved chunks for the bad answer. If the wrong fact **is in the retrieved text**, the problem is upstream: ingestion, chunking, metadata filters, or a cross-[[tenant-isolation|tenant]] leak. If it is **not** in the retrieved text, the model produced it: [[hallucination]], prompt issues, or [[context-window]] truncation.'
			},
			{ type: 'heading', text: 'Failure map' },
			{
				type: 'table',
				head: ['Stage', 'Typical failure'],
				rows: [
					['Ingest / [[asr|ASR]]', 'Misheard names, truncated audio, wrong speaker labels'],
					['Chunking', 'Negation split from the fact it negates'],
					['Embedding', 'Query and index embedded with different models'],
					['Retrieval', 'Missing tenant filter, threshold not recalibrated, top-k too small'],
					['Generation', 'Unpinned model updated, instructions truncated, lost in the middle']
				]
			},
			{
				type: 'callout',
				tone: 'info',
				title: 'Does it even need RAG?',
				text: 'If the input is one document that fits in the context window (one 4k-token call transcript), skip retrieval and give the model the whole thing. Retrieval adds failure modes you don\'t need.'
			}
		]
	},
	{
		id: 'embedding',
		term: 'Embedding',
		aliases: ['vector', 'embedding model'],
		category: 'ai & retrieval',
		short:
			"A list of numbers (a vector) a model produces for a piece of text, placed so that texts with similar meaning end up close together. Searching 'nausea after dose' finds 'felt sick after taking it' because their vectors are near. Vectors from different embedding models live in different spaces and can't be compared: upgrade the model and you must re-embed everything.",
		related: ['vector-index', 'cosine-similarity', 'rag']
	},
	{
		id: 'vector-index',
		term: 'Vector index (vector database)',
		aliases: ['vector db', 'ANN index', 'pgvector'],
		category: 'ai & retrieval',
		short:
			"A store that holds embeddings and quickly finds the ones nearest to a query vector, usually approximately (ANN) for speed. Alongside vectors it stores metadata (tenant_id, call_id, model version) used as filters. A missing filter returns other customers' or other calls' chunks.",
		related: ['embedding', 'top-k', 'tenant-isolation']
	},
	{
		id: 'chunking',
		term: 'Chunking',
		category: 'ai & retrieval',
		short:
			"Splitting documents into smaller pieces before embedding them, because retrieval returns pieces, not whole documents. Chunk boundaries matter: a split between 'Did you feel nausea?' and 'No, none at all' means the question can be retrieved without its answer. Chunk along natural units (paragraphs, speaker turns) and add overlap.",
		related: ['rag', 'embedding', 'top-k']
	},
	{
		id: 'top-k',
		term: 'Top-k',
		category: 'ai & retrieval',
		short:
			"How many of the nearest chunks retrieval returns. Too few and the key passage is missed; too many and irrelevant text crowds the prompt, costs more, and distracts the model. The right k depends on chunk size and how many places an answer can be spread across.",
		related: ['rag', 'reranker', 'cosine-similarity']
	},
	{
		id: 'reranker',
		term: 'Reranker',
		aliases: ['cross-encoder'],
		category: 'ai & retrieval',
		short:
			"A second, slower and more accurate model that re-scores the chunks retrieval found (e.g. the top 50) and keeps the best few. Vector search is fast but fuzzy; the reranker reads query and chunk together, so it judges relevance much better. Removing it to save latency often quietly hurts answer quality.",
		related: ['top-k', 'hybrid-search']
	},
	{
		id: 'hybrid-search',
		term: 'Hybrid search',
		aliases: ['BM25', 'keyword search'],
		category: 'ai & retrieval',
		short:
			"Combining keyword search (exact words, good for drug names, codes and ids) with vector search (meaning, good for paraphrases), then merging the results. Pure vector search is weak on rare exact terms like a new drug name; pure keyword search misses synonyms. The weighting between them is a tuning knob that can quietly change behaviour.",
		related: ['reranker', 'embedding']
	},
	{
		id: 'cosine-similarity',
		term: 'Cosine similarity',
		aliases: ['similarity score', 'similarity threshold'],
		category: 'ai & retrieval',
		short:
			"A score of how closely two vectors point in the same direction, from −1 to 1 (usually 0–1 for text). It's only meaningful relative to the same model: 0.82 might be a strong match for one model and noise for another. Any fixed threshold ('keep chunks above 0.78') must be recalibrated after changing the embedding model.",
		related: ['embedding', 'top-k']
	},
	{
		id: 'asr',
		term: 'ASR (speech-to-text)',
		aliases: ['speech recognition', 'transcription'],
		category: 'ai & retrieval',
		short:
			"Automatic speech recognition turns audio into text. Errors here poison everything downstream: a misheard drug name becomes a wrong fact in the summary, and the LLM can't know. Errors rise with accents, noise, new vocabulary (new product names) and vendor or model changes.",
		related: ['diarization', 'data-drift']
	},
	{
		id: 'diarization',
		term: 'Speaker diarization',
		aliases: ['diarisation', 'speaker labels'],
		category: 'ai & retrieval',
		short:
			"Working out who spoke when in a recording ('Agent:' vs 'Caller:'). If it swaps speakers, the agent's scripted question 'any dizziness or nausea?' gets attributed to the patient as a reported symptom.",
		related: ['asr']
	},
	{
		id: 'pii-redaction',
		term: 'PII redaction',
		aliases: ['PII', 'PHI', 'de-identification'],
		category: 'security & compliance',
		short:
			"Removing personal data (names, phone numbers, addresses, health identifiers) from text before storing or processing it. Over-eager rules can also strip useful facts: a pattern for 'numbers that look like IDs' can delete dosages, and a name filter can delete drug names that look like surnames.",
		related: ['pharmacovigilance', 'tenant-isolation']
	},
	{
		id: 'pharmacovigilance',
		term: 'Pharmacovigilance',
		aliases: ['adverse event reporting', 'PV'],
		category: 'security & compliance',
		short:
			"Monitoring and reporting side effects of medicines after they're on the market, which pharmaceutical companies are legally required to do, often within strict deadlines. Software in this space handles health data and regulatory reports, so a missed side effect or a leak between customers is a compliance incident, not just a bug.",
		related: ['pii-redaction', 'tenant-isolation']
	},
	{
		id: 'hallucination',
		term: 'Hallucination',
		category: 'ai & retrieval',
		short:
			"An LLM producing fluent, confident content that isn't supported by its input or by reality, e.g. naming a typical drug for a symptom because it's statistically likely. It's more likely when the context is missing the answer, instructions are vague, or temperature is high. Check it by comparing the output against the retrieved source text.",
		related: ['groundedness', 'rag']
	},
	{
		id: 'groundedness',
		term: 'Groundedness (faithfulness)',
		aliases: ['faithfulness', 'citations'],
		category: 'ai & retrieval',
		short:
			"How well every claim in an LLM's output is supported by the source text it was given. You can enforce it by asking for citations (span ids) for each extracted fact and automatically rejecting facts whose cited span doesn't contain them.",
		related: ['hallucination', 'golden-eval-set']
	},
	{
		id: 'lost-in-the-middle',
		term: 'Lost in the middle',
		category: 'ai & retrieval',
		short:
			"An observed LLM weakness: information at the start and end of a long prompt gets used more reliably than information buried in the middle. So a side effect mentioned halfway through a long transcript is more likely to be missed. Splitting long inputs and summarising pieces separately helps.",
		related: ['context-window']
	},
	{
		id: 'context-window',
		term: 'Context window',
		aliases: ['token limit'],
		category: 'ai & retrieval',
		short:
			"The maximum amount of text (in tokens) a model can take in one request, prompt plus output. When code assembles a prompt that's too long, something gets cut: if it's the end, late facts vanish; if it's the start, the instructions vanish. Count tokens before sending and reserve room for instructions and the answer.",
		related: ['lost-in-the-middle', 'chunking']
	},
	{
		id: 'model-pinning',
		term: 'Model pinning',
		aliases: ['model alias', 'latest alias'],
		category: 'ai & retrieval',
		short:
			"Calling an exact, dated model version instead of an alias like 'model-latest' that the provider can repoint. With an alias, behaviour can change overnight with no deploy on your side. Pin the version and log the model id returned with each response, so a quality change can be traced.",
		related: ['data-drift', 'golden-eval-set']
	},
	{
		id: 'data-drift',
		term: 'Data drift',
		aliases: ['distribution shift'],
		category: 'ai & retrieval',
		short:
			"The real-world input slowly becoming different from what the system was built and tested on: new product names, a new language mix, longer calls, new user behaviour. Nothing was deployed, yet accuracy slides. Detect it by tracking input statistics over time and re-running a fixed evaluation set.",
		related: ['golden-eval-set', 'model-pinning', 'asr']
	},
	{
		id: 'golden-eval-set',
		term: 'Golden evaluation set',
		aliases: ['eval set', 'evals', 'regression set'],
		category: 'ai & retrieval',
		short:
			"A fixed collection of real inputs with known correct outputs, run automatically against the pipeline on every change and on a schedule. It turns 'the summaries feel worse' into 'recall on side effects dropped from 94% to 81% on Tuesday', and catches silent changes like provider model updates.",
		related: ['data-drift', 'groundedness', 'model-pinning']
	}
];

export default terms;
