import type { Assessment, Panel, Question, Series, SeriesColor } from '../types';
import { bump, gap, periodic, ramp, rng, scaleFrom, shape, step, timeAxis, wave } from '../series';

// ───────────────────────── tiny builders ─────────────────────────

type TS = Extract<Panel, { kind: 'timeseries' }>;
type Bars = Extract<Panel, { kind: 'bars' }>;

const S = (name: string, points: (number | null)[], color?: SeriesColor, dashed?: boolean): Series => ({
	name,
	points,
	color,
	dashed
});
const ts = (title: string, x: string[], series: Series[], o: Partial<TS> = {}): Panel => ({
	kind: 'timeseries',
	title,
	x,
	series,
	...o
});
const bars = (title: string, x: string[], series: Series[], o: Partial<Bars> = {}): Panel => ({
	kind: 'bars',
	title,
	x,
	series,
	...o
});
const stat = (title: string, value: string, o: { delta?: string; tone?: 'ok' | 'warn' | 'crit' | 'info'; spark?: number[]; span?: 1 | 2 | 3 } = {}): Panel => ({
	kind: 'stat',
	title,
	value,
	...o
});
const flat = (n: number, v: number) => Array.from({ length: n }, () => v);
const cap = (xs: number[], max: number) => xs.map((v) => Math.min(v, max));

// ═════════════════════════ PART 1 · Grafana ═════════════════════════

const g1x = timeAxis('13:50', 60);
const g1Deploy = [{ at: 20, label: 'deploy v3.18' }];
const g1InUse = cap(shape(60, { base: 9, seed: 4, noise: 0.12 }, ramp(20, 25, 9, 60)), 60);
const g1IdleTx = cap(shape(60, { base: 0, seed: 7, noise: 0.08 }, ramp(20, 25, 0, 46)), 46);
const g1Active = shape(60, { base: 8, seed: 6, noise: 0.15 }, ramp(20, 25, 8, 14));

const g1: Question = {
	id: 'g1-idle-in-tx',
	group: 'Grafana · service dashboards',
	title: 'Checkout is on fire, the database is bored',
	tag: 'tricky',
	minutes: 12,
	prompt: [
		{
			type: 'p',
			text: 'Page at 14:16: `checkout-api` p99 above 4 s. The database team says Postgres is fine. `checkout-api` runs 3 pods, each with a pool of 20 DB connections. Read the dashboard and write the causal chain.'
		},
		{
			type: 'dashboard',
			dashboard: {
				style: 'grafana',
				title: 'checkout-api · overview',
				range: '13:50 – 14:49 UTC',
				filters: ['env=prod', 'cluster=eu-1', 'pods=3'],
				panels: [
					ts('Requests/s by route', g1x, [S('/checkout', shape(60, { base: 230, seed: 11, noise: 0.04 }), 0), S('other', shape(60, { base: 190, seed: 12, noise: 0.04 }), 1)], { stacked: true, area: true, unit: ' req/s', span: 3, markers: g1Deploy }),
					ts('Latency (all routes)', g1x, [S('p50', shape(60, { base: 45, seed: 2, noise: 0.1 }, ramp(22, 34, 45, 1400)), 0), S('p99', shape(60, { base: 180, seed: 3, noise: 0.08 }, ramp(21, 30, 180, 5000)), 2)], { unit: ' ms', span: 3, markers: g1Deploy }),
					ts('DB pool connections in use (sum of 3 pods)', g1x, [S('in use', g1InUse, 0), S('pool max', flat(60, 60), 3, true)], { yMin: 0, yMax: 70, span: 2, markers: g1Deploy }),
					ts('DB pool wait p95', g1x, [S('wait', shape(60, { base: 1, seed: 5, noise: 0.3 }, ramp(21, 31, 1, 4200)), 4)], { unit: ' ms', span: 2 }),
					ts('Postgres sessions by state (this app)', g1x, [S('active', g1Active, 0), S('idle in transaction', g1IdleTx, 2), S('idle', g1InUse.map((v) => Math.max(0, 60 - v)), 1)], { stacked: true, area: true, span: 2 }),
					ts('Outbound fraud-check p95', g1x, [S('fraud-check', shape(60, { base: 240, seed: 9, noise: 0.06 }), 5)], { unit: ' ms', span: 2, yMin: 0 }),
					ts('Postgres CPU', g1x, [S('cpu', shape(60, { base: 28, seed: 10, noise: 0.08 }), 0)], { unit: '%', yMin: 0, yMax: 100, span: 2 }),
					ts('JVM GC pause p99', g1x, [S('gc', shape(60, { base: 8, seed: 13, noise: 0.2 }, bump(32, 40, 55)), 3)], { unit: ' ms', span: 2 })
				]
			}
		}
	],
	hints: [
		'Which panel moves first after 14:10, and which panels don’t move at all?',
		'“Idle in transaction” sessions are holding a connection while doing nothing in the database. What is the request doing instead?',
		'Little’s law: 230 checkout req/s × how long each one holds a connection = ?'
	],
	answer: [
		{
			type: 'p',
			text: '**Timeline first.** Deploy v3.18 lands at 14:10. Within a minute the *idle in transaction* band appears (0 → ~46 sessions by 14:15) and *pool in use* climbs to the 60-connection ceiling at 14:15. *Pool wait p95* starts rising at 14:11 and reaches ~4 s. The p99 rise begins at 14:11 and p50 follows at ~14:12 once *every* request queues for a connection. What didn’t move: request rate, Postgres CPU (~28%), and fraud-check latency (~240 ms).'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'v3.18 opens the DB transaction *before* the fraud-check HTTP call, so each checkout pins a connection for ~270 ms while doing nothing in Postgres.',
					body: '[[idle-in-transaction|Idle in transaction]] is precisely “connection checked out, transaction open, app busy elsewhere”. [[littles-law|Little’s law]]: 230 checkout req/s × ~0.27 s held ≈ **62 connections needed**, against a pool of 60. The pool is permanently full, so every route, including the cheap ones, waits in the [[connection-pool]] queue. Fraud-check latency is unchanged: the dependency didn’t get slower, the code started holding a scarce resource across it.',
					confirm: '`SELECT state, query, now() - state_change FROM pg_stat_activity WHERE state = \'idle in transaction\'`: the last query will be checkout’s `SELECT … FOR UPDATE` or `INSERT orders`. Then diff v3.18 around the fraud call.'
				},
				{
					title: 'A slow query or lock contention in Postgres.',
					body: 'Would show *active* sessions rising and CPU or [[lock-wait|lock waits]] climbing. Active stays flat at ~8–14 and CPU is flat. Ruled down.',
					confirm: '`pg_stat_activity` grouped by `wait_event_type`.'
				},
				{
					title: 'Fraud-check provider got slower.',
					body: 'The obvious guess when an external call is involved, but its p95 is flat at ~240 ms throughout. Ruled out by the panel.'
				}
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Red herring',
			text: 'The GC pause bump at 14:22–14:30 comes **after** latency had already exploded: thousands of queued requests hold buffers in memory, so the heap fills and GC works harder. It’s a symptom of the queue, not its cause. Anything that starts after the first deviation can’t be the trigger.'
		},
		{
			type: 'p',
			text: '**Mitigate now:** [[rollback]] v3.18. **Fix properly:** call fraud-check before `BEGIN` (no network I/O inside transactions), set `idle_in_transaction_session_timeout`, and alert on pool wait time, which moved a full minute before user latency.'
		}
	]
};

const g2x = timeAxis('10:00', 60);
const g2Change = [{ at: 15, label: 'limits: cpu 2 → 1' }];
const g2: Question = {
	id: 'g2-cfs',
	group: 'Grafana · service dashboards',
	title: 'CPU is at 60% of the limit, but p99 tripled',
	tag: 'tricky',
	minutes: 10,
	prompt: [
		{
			type: 'p',
			text: 'A platform engineer “right-sized” `pricing-svc` (JVM, 8 request threads) because it “only ever uses 0.6 cores”. Nobody else changed anything. The team says CPU is clearly not the problem: look at the usage panel.'
		},
		{
			type: 'dashboard',
			dashboard: {
				style: 'grafana',
				title: 'pricing-svc · resources',
				range: '10:00 – 10:59',
				filters: ['namespace=pricing', 'pods=6'],
				panels: [
					ts('Latency', g2x, [S('p50', shape(60, { base: 28, seed: 21, noise: 0.08 }, scaleFrom(15, 1.25)), 0), S('p99', shape(60, { base: 120, seed: 22, noise: 0.1 }, step(15, 380)), 2)], { unit: ' ms', span: 3, markers: g2Change }),
					ts('Requests/s', g2x, [S('rps', shape(60, { base: 900, seed: 23, noise: 0.04 }), 1)], { unit: ' req/s', span: 3, yMin: 0 }),
					ts('CPU usage vs limit (avg per pod, 1 m)', g2x, [S('usage', shape(60, { base: 0.58, seed: 24, noise: 0.05, round: 2 }), 0), S('limit', flat(60, 2).map((v, i) => (i >= 15 ? 1 : v)), 3, true)], { unit: ' cores', yMin: 0, yMax: 2.4, span: 2, markers: g2Change }),
					ts('Throttled periods', g2x, [S('throttled / total', shape(60, { base: 0.5, seed: 25, noise: 0.3, round: 1 }, step(15, 38)), 2)], { unit: '%', yMin: 0, yMax: 100, span: 2 }),
					ts('Node CPU (all nodes)', g2x, [S('node', shape(60, { base: 44, seed: 26, noise: 0.05 }), 4)], { unit: '%', yMin: 0, yMax: 100, span: 2 }),
					stat('Pod restarts (1h)', '0', { tone: 'ok' }),
					stat('Heap used', '41%', { tone: 'ok' }),
					stat('Error rate', '0.02%', { tone: 'ok' })
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: '**The change at 10:15 is the only event.** p99 steps from ~120 ms to ~380 ms and p50 rises ~25% exactly at the marker, while traffic is flat and average usage stays ~0.58 cores, comfortably under the new 1-core limit. But *Throttled periods* jumps from ~0.5% to ~38% at the same instant.'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'CPU throttling by the CFS quota: the 1-core limit is enforced per 100 ms, not per minute.',
					body: 'With a [[cfs-quota|CFS quota]] of 1 core, the container gets 100 ms of CPU time per 100 ms period across *all* threads. A request burst running 8 threads in parallel spends that in ~12 ms of wall time and the container is frozen for the rest of the period. The 1-minute average of 0.58 cores is the average of bursts and silences; it can’t show the freezes. 38% of periods throttled means more than a third of the time some request was waiting for the quota to refill: that’s [[tail-latency]].',
					confirm: 'Per-pod `rate(container_cpu_cfs_throttled_seconds_total)`; flip the limit back on one pod and compare its p99 with the others.'
				},
				{
					title: 'GC pressure from fewer cores.',
					body: 'The JVM sizes GC threads from visible CPUs, and a 1-core limit can change heuristics. Plausible contributor, but heap is at 41% and the step is instantaneous rather than growing. Secondary.'
				}
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Red herring',
			text: 'Node CPU at ~44% says the *machine* has plenty of spare CPU. Throttling is a per-container quota: the container is frozen while the node sits idle. “The node isn’t busy” is not evidence against throttling; it’s typical of it.'
		},
		{
			type: 'p',
			text: '**Fix:** revert to 2 cores or remove the CPU limit (keep the request for scheduling), and match JVM threads to the limit (`-XX:ActiveProcessorCount`). Right-size by throttled-period ratio and p99, not by average usage. See [[cpu-throttling]].'
		}
	]
};

const g3x = timeAxis('06:00', 72, 10);
const g3Launch = [{ at: 6, label: 'recently-viewed launched' }];
const g3: Question = {
	id: 'g3-redis-ttl',
	group: 'Grafana · service dashboards',
	title: 'The cache slowly stopped caching',
	tag: 'tricky',
	minutes: 10,
	prompt: [
		{
			type: 'p',
			text: 'Product-page latency got worse throughout the day, with no deploy after 07:00. Redis `maxmemory` is 6 GB, policy `volatile-lru`. The cache stores product JSON with a 15-minute TTL. A new “recently viewed” feature launched at 07:00 and stores each visitor’s list in the same Redis.'
		},
		{
			type: 'dashboard',
			dashboard: {
				style: 'grafana',
				title: 'redis-cache-01 · overview',
				range: '06:00 – 17:50',
				filters: ['instance=redis-cache-01'],
				panels: [
					ts('Used memory vs maxmemory', g3x, [S('used', cap(shape(72, { base: 3.1, seed: 31, noise: 0.01, round: 2 }, ramp(6, 40, 3.1, 6)), 6), 0), S('maxmemory', flat(72, 6), 3, true)], { unit: ' GB', yMin: 0, yMax: 7, span: 2, markers: g3Launch }),
					ts('Keys / keys with TTL', g3x, [S('keys (M)', shape(72, { base: 4.2, seed: 32, noise: 0.01, round: 2 }, ramp(6, 40, 4.2, 9.1)), 0), S('keys with TTL (M)', shape(72, { base: 4.1, seed: 33, noise: 0.01, round: 2 }, ramp(40, 60, 4.1, 0.9)), 1)], { span: 2 }),
					ts('Evicted keys/s', g3x, [S('evictions', shape(72, { base: 0, seed: 34, noise: 0.2 }, step(40, 850)), 2)], { span: 2 }),
					ts('Cache hit rate', g3x, [S('hit rate', shape(72, { base: 95, seed: 35, noise: 0.005, round: 1 }, ramp(40, 60, 95, 61)), 0)], { unit: '%', yMin: 0, yMax: 100, span: 2 }),
					ts('Postgres read QPS', g3x, [S('reads', shape(72, { base: 1200, seed: 36, noise: 0.04 }, ramp(40, 60, 1200, 9400)), 4)], { span: 2 }),
					ts('Redis CPU', g3x, [S('cpu', shape(72, { base: 18, seed: 37, noise: 0.08 }), 5)], { unit: '%', yMin: 0, yMax: 100, span: 2 }),
					ts('Product page p95', g3x, [S('p95', shape(72, { base: 60, seed: 38, noise: 0.06 }, ramp(40, 60, 60, 340)), 2)], { unit: ' ms', span: 6, markers: g3Launch })
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: '**Two phases.** 07:00–12:40: memory climbs linearly from 3.1 GB to the 6 GB ceiling while total keys climb from 4.2 M to ~9 M, and nothing else changes. That’s the new feature writing keys. From 12:40 (memory hits `maxmemory`): evictions jump to ~850/s, *keys with TTL* collapse from 4.1 M toward 0.9 M, hit rate slides 95% → ~61%, Postgres reads go 1.2 k → 9.4 k QPS, and p95 goes 60 → 340 ms.'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'Recently-viewed keys have no TTL, and `volatile-lru` can only evict keys that *have* a TTL, so the immortal keys squeeze out the actual cache.',
					body: 'Total keys rose by ~5 M but *keys with TTL* didn’t: the new keys are TTL-less. Under [[redis-eviction|volatile-lru]], when memory is full Redis may only evict keys with an expiry, which are exactly the product-JSON cache entries. Every eviction makes room that the next recently-viewed write takes, so the cache shrinks continuously. Hit rate 95% → 61% means the miss rate went 5% → 39%, ~8× more DB reads, matching 1.2 k → 9.4 k QPS. This is a [[cache-hit-rate]] collapse caused by memory policy, not by traffic.',
					confirm: '`INFO keyspace` (keys vs expires), `redis-cli --bigkeys` / `SCAN MATCH rv:*` with `TTL` sampling, `CONFIG GET maxmemory-policy`.'
				},
				{
					title: 'Traffic growth during the day.',
					body: 'Would raise Redis CPU and request rate. Redis CPU is flat at ~18%. Ruled down.'
				}
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Red herring',
			text: 'Redis CPU is flat and low, so “Redis is healthy” is the natural conclusion. A cache can be perfectly fast and still useless if it no longer holds the right data. Hit rate and keyspace composition are the health signals for a cache; CPU isn’t.'
		},
		{
			type: 'p',
			text: '**Mitigate:** add a TTL to recently-viewed keys (e.g. 30 days, refreshed on write) and cap list length; temporarily switch to `allkeys-lru`. **Fix properly:** don’t co-locate data that must persist with a cache that must evict; give the feature its own Redis. Alert on `expires/keys` ratio and evictions, not only memory.'
		}
	]
};

const g4x = timeAxis('09:00', 60);
const g4Lag = [0, 1, 2, 3, 4, 5].map((p) =>
	p === 3
		? shape(60, { base: 150, seed: 40 + p, noise: 0.1 }, ramp(10, 60, 150, 8900000))
		: shape(60, { base: 180, seed: 40 + p, noise: 0.3 }, bump(30, 33, 2600))
);
const g4: Question = {
	id: 'g4-hot-partition',
	group: 'Grafana · service dashboards',
	title: 'We doubled the consumers and the lag got worse',
	tag: 'core',
	minutes: 10,
	prompt: [
		{
			type: 'p',
			text: '`order-events` topic, 6 partitions, consumer group `fulfilment`. Orders from some customers are shipping hours late. At 09:30 someone scaled the consumers from 6 to 12 pods “to clear the lag”.'
		},
		{
			type: 'dashboard',
			dashboard: {
				style: 'grafana',
				title: 'kafka · order-events / fulfilment',
				range: '09:00 – 09:59',
				panels: [
					ts('Consumer lag by partition', g4x, g4Lag.map((pts, p) => S(`p${p}`, pts, (p % 6) as SeriesColor)), { span: 6, markers: [{ at: 30, label: 'consumers 6 → 12' }] }),
					ts('Produce rate by partition', g4x, [0, 1, 2, 3, 4, 5].map((p) => S(`p${p}`, shape(60, { base: 780, seed: 50 + p, noise: 0.06 }, p === 3 ? step(10, 3800) : (_, v) => v), (p % 6) as SeriesColor)), { unit: ' msg/s', span: 3 }),
					ts('Consume rate by partition', g4x, [0, 1, 2, 3, 4, 5].map((p) => S(`p${p}`, shape(60, { base: 780, seed: 60 + p, noise: 0.06 }, p === 3 ? step(10, 820) : bump(30, 33, -780), bump(30, 33, p === 3 ? -820 : 0)), (p % 6) as SeriesColor)), { unit: ' msg/s', span: 3 }),
					bars('Rebalances', g4x, [S('rebalances', flat(60, 0).map((_, i) => (i === 30 || i === 31 ? 1 : 0)), 2)], { span: 2 }),
					{ kind: 'table', title: 'Top message keys, last 15 min', span: 4, head: ['key (customer_id)', 'partition', 'share'], rows: [['cust_88120 (bulk importer)', 'p3', '71.4%'], ['cust_10233', 'p1', '1.9%'], ['cust_55017', 'p5', '1.6%'], ['cust_70402', 'p3', '1.1%']], numeric: [2], highlight: [0] }
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: 'At 09:10 p3’s produce rate jumps from ~780 to ~3,800 msg/s while its consume rate stays pinned at ~820 msg/s, the most one consumer can process. p3’s lag grows by ~3,000 msg/s to ~8.9 M by 09:59. Every other partition’s lag stays near zero (their brief 09:30 bump is invisible at this scale).'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'One customer’s bulk import sends 71% of all traffic with a single [[partition-key]], so it all lands on p3 and is processed by exactly one consumer.',
					body: 'Kafka keeps per-key order by sending a key to one partition, and a partition is read by at most one consumer in the group. The table shows `cust_88120` at 71% of messages, all on p3. That’s a [[hot-partition]]: the topic as a whole has capacity, one lane doesn’t. Every other customer whose key hashes to p3 (e.g. `cust_70402`) waits behind the import, which is why “some customers” ship late.',
					confirm: 'Per-partition lag + top keys (shown). Check fulfilment logs for `cust_70402` orders: they’ll be delayed by the same amount as p3’s lag.'
				}
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Why scaling made it worse (the red herring)',
			text: 'With 6 partitions, consumers 7–12 get no partition and sit idle. Adding them triggered a [[consumer-rebalance|rebalance]] (09:30–09:31) that paused **all** consumption for ~3 minutes: see the consume-rate dip to zero and the lag bump on every partition. Parallelism in a consumer group is capped by partition count.'
		},
		{
			type: 'list',
			items: [
				'**Now:** move the bulk importer to its own topic (or a separate consumer path), so normal customers stop queuing behind it; scale back to 6 consumers.',
				'**Properly:** a better key (e.g. `customer_id + order_id` if per-customer order isn’t required), per-key parallel processing inside the consumer, or more partitions planned up front (adding partitions later remaps keys and breaks ordering for in-flight keys).',
				'Alert on **per-partition** [[consumer-lag]], not total lag: total lag hides one stuck lane.'
			]
		}
	]
};

// ═════════════════════════ PART 2 · Kibana ═════════════════════════

const k1x = timeAxis('11:00', 60);
const k1: Question = {
	id: 'k1-token-expiry',
	group: 'Kibana · log investigations',
	title: 'A burst of 401s every five minutes',
	tag: 'tricky',
	minutes: 10,
	prompt: [
		{
			type: 'p',
			text: '`orders-api` calls `inventory-api` with a service token (lifetime 300 s) fetched from the auth server and cached in-process. Users report occasional “couldn’t reserve stock, please retry”.'
		},
		{
			type: 'logs',
			logs: {
				style: 'kibana',
				title: 'Discover · logs-orders-*',
				query: 'service:orders-api AND (http.status:401 OR message:*token*)',
				total: '1,448 hits',
				histogram: {
					x: k1x,
					counts: shape(60, { base: 4, seed: 70, noise: 0.5 }, periodic(5, 1, 38, 2)),
					errors: shape(60, { base: 0, seed: 71, noise: 0.2 }, periodic(5, 1, 34, 2))
				},
				lines: [
					{ ts: '11:06:59.981', level: 'INFO', source: 'orders-api-7f9c', msg: 'using cached service token', fields: { token_age_s: 299.6, cache_ttl_s: 300 } },
					{ ts: '11:07:00.012', level: 'WARN', source: 'orders-api-7f9c', msg: 'inventory-api responded 401 Unauthorized', fields: { 'error.code': 'token_expired', token_age_s: 299.7, route: 'POST /reserve' } },
					{ ts: '11:07:00.044', level: 'WARN', source: 'orders-api-2b1d', msg: 'inventory-api responded 401 Unauthorized', fields: { 'error.code': 'token_expired', token_age_s: 299.8 } },
					{ ts: '11:07:00.051', level: 'ERROR', source: 'orders-api-7f9c', msg: 'reserve failed, surfacing to client', fields: { order_id: 'ord_9921', status: 502 } },
					{ ts: '11:07:00.310', level: 'INFO', source: 'orders-api-7f9c', msg: 'service token refreshed', fields: { expires_in: 300, fetch_ms: 262 } },
					{ ts: '11:07:00.402', level: 'INFO', source: 'inventory-api-1', msg: 'jwt rejected', fields: { reason: 'exp', exp: '11:06:58.7', now: '11:07:00.4', skew_s: 1.7 } }
				]
			}
		}
	],
	hints: ['Compare the token’s age when it was rejected with its lifetime.', 'When does the cache start counting: when the token was issued, or when the response arrived?'],
	answer: [
		{
			type: 'p',
			text: 'The histogram is a spike every 5 minutes (11:02, 11:07, 11:12 …), matching the 300 s token lifetime. Every rejection has `token_age_s` ≈ 299.6–299.8, *inside* the cache’s 300 s TTL, and `inventory-api` says the token’s `exp` was 1.7 s earlier than its clock.'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'The cache expires tokens exactly at their lifetime, measured from when the *response arrived*, while the server measures from issue time on its own clock.',
					body: 'The token is issued at T, arrives ~0.26 s later (`fetch_ms: 262`), and the cache considers it valid until arrival + 300 s. `inventory-api`’s clock is also ahead by ~1.5 s ([[clock-skew]]). So for the last ~2 s of every cycle the cache hands out a token the server already considers expired. Every request in that window fails, then the refresh happens and the next 298 s are fine: hence periodic bursts.',
					confirm: 'Plot the 401s by `token_age_s`: they’ll all cluster above ~298 s. Compare the `exp` claim with the cache’s computed expiry for one token.'
				},
				{
					title: 'Auth server outage every 5 minutes.',
					body: 'Would show refresh *failures*. The refresh succeeds in 262 ms. Ruled out.'
				}
			]
		},
		{
			type: 'p',
			text: '**Fix:** refresh proactively at ~80% of lifetime (or `exp − 30 s`), base expiry on the token’s own `exp` claim, and on a 401 `token_expired` force-refresh and retry once. Allow a small leeway (e.g. 30 s) on the verifying side.'
		}
	]
};

const k2x = timeAxis('09:30', 60);
const k2: Question = {
	id: 'k2-old-clients',
	group: 'Kibana · log investigations',
	title: 'Only some phones can’t check out',
	tag: 'core',
	minutes: 10,
	prompt: [
		{ type: 'p', text: 'Support: “iPhone users can’t place orders since this morning. Android is fine. Some iPhone users are fine too.” Nothing was released on mobile today.' },
		{
			type: 'logs',
			logs: {
				style: 'kibana',
				title: 'Discover · logs-api-*',
				query: 'service:cart-api AND http.status >= 400',
				total: '3,912 hits',
				histogram: {
					x: k2x,
					counts: shape(60, { base: 6, seed: 80, noise: 0.4 }, step(30, 128), bump(50, 52, 40)),
					errors: shape(60, { base: 1, seed: 81, noise: 0.4 }, step(30, 122))
				},
				lines: [
					{ ts: '09:59:41.208', level: 'INFO', source: 'deployer', msg: 'rollout cart-api v2.14.0 started', fields: { change: 'migrate request validation to strict schema' } },
					{ ts: '10:00:12.551', level: 'WARN', source: 'cart-api-6d8', msg: 'request validation failed', fields: { status: 400, path: 'POST /cart/checkout', 'client.app_version': '4.9.2', 'client.platform': 'ios', error: 'items[0].quantity: expected integer, received string' } },
					{ ts: '10:00:12.880', level: 'INFO', source: 'cart-api-6d8', msg: 'checkout accepted', fields: { status: 201, 'client.app_version': '5.2.0', 'client.platform': 'ios' } },
					{ ts: '10:00:13.004', level: 'WARN', source: 'cart-api-1aa', msg: 'request validation failed', fields: { status: 400, 'client.app_version': '4.8.0', 'client.platform': 'ios', error: 'items[0].quantity: expected integer, received string' } },
					{ ts: '10:00:13.120', level: 'INFO', source: 'cart-api-1aa', msg: 'checkout accepted', fields: { status: 201, 'client.app_version': '5.1.3', 'client.platform': 'android' } },
					{ ts: '10:20:44.017', level: 'WARN', source: 'reports-worker', msg: 'slow query', fields: { duration_ms: 8120, query: 'daily_sales_rollup' } }
				]
			}
		},
		{
			type: 'dashboard',
			dashboard: {
				style: 'kibana',
				title: 'cart-api · 400s breakdown',
				range: '09:30 – 10:29',
				panels: [
					bars('400 responses by app_version', k2x, [S('4.x', shape(60, { base: 0, seed: 82, noise: 0.3 }, step(30, 118)), 2), S('5.x', shape(60, { base: 5, seed: 83, noise: 0.5 }), 0)], { stacked: true, span: 4 }),
					{ kind: 'table', title: 'Active iOS users by app version', span: 2, head: ['version', 'share'], rows: [['5.2.0', '64%'], ['5.1.x', '19%'], ['4.9.x', '11%'], ['≤ 4.8', '6%']], numeric: [1] }
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: 'The error histogram steps from ~1 to ~120/min at 10:00, 19 s after `cart-api v2.14.0` starts rolling out with “strict schema” validation. The breakdown shows the new 400s are all `4.x` clients; `5.x` is unchanged. Every failure carries the same message: `quantity: expected integer, received string`.'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'The backend deploy made validation strict, and old app versions (4.x, ~17% of iOS users) send `quantity` as a string.',
					body: 'The old lenient validator coerced `"2"` to `2`; the strict one rejects it. “No mobile release today” is true and irrelevant: the *server* changed its contract. “iPhone only” is a correlation: the 4.x builds still in use are iOS (Android force-updated earlier, or 4.x Android serialized correctly). It’s a backward-compatibility break.',
					confirm: 'Replay a captured 4.9.2 request body against v2.13 and v2.14. Group 400s by `client.app_version × client.platform`.'
				}
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Red herrings',
			text: 'The small histogram bump at 10:20 is `reports-worker`’s slow query: a different service that matches `status >= 400` only through a loose query. And “iPhone” is the reporter’s framing; the real dimension is app version.'
		},
		{
			type: 'p',
			text: '**Now:** roll back v2.14 or ship a coercion shim for `client.app_version < 5`. **Prevent:** contract tests using recorded payloads from every supported client version, a minimum-supported-version policy, and canary rollouts watched on **4xx by client version** (a 400 spike is an outage for the user even though it’s “their fault” by HTTP semantics).'
		}
	]
};

const k3x = timeAxis('15:00', 50);
const k3: Question = {
	id: 'k3-mapping',
	group: 'Kibana · log investigations',
	title: 'Payments went silent',
	tag: 'tricky',
	minutes: 10,
	prompt: [
		{ type: 'p', text: 'An on-call engineer sees the `payments` log volume drop to zero at 15:25 and declares a payments outage. Check before waking the company.' },
		{
			type: 'logs',
			logs: {
				style: 'kibana',
				title: 'Discover · logs-payments-*',
				query: 'service:payments',
				total: '61,204 hits',
				histogram: { x: k3x, counts: shape(50, { base: 2400, seed: 90, noise: 0.05 }, step(25, 0)) },
				lines: [
					{ ts: '15:24:58.902', level: 'INFO', source: 'payments-5c', msg: 'charge captured', fields: { amount: 4200, currency: 'EUR', user: 'u_1192' } },
					{ ts: '15:24:59.610', level: 'INFO', source: 'deployer', msg: 'rollout payments v8.3.0 complete', fields: { change: 'structured user context in logs' } }
				]
			}
		},
		{
			type: 'dashboard',
			dashboard: {
				style: 'grafana',
				title: 'payments · RED  /  log pipeline',
				range: '15:00 – 15:49',
				panels: [
					ts('payments requests/s', k3x, [S('rps', shape(50, { base: 140, seed: 91, noise: 0.05 }), 0)], { span: 2, yMin: 0 }),
					ts('payments 5xx/s', k3x, [S('5xx', shape(50, { base: 0.3, seed: 92, noise: 0.5, round: 1 }), 2)], { span: 2, yMin: 0, yMax: 10 }),
					ts('Log shipper: docs rejected by index', k3x, [S('rejected/s', shape(50, { base: 0, seed: 93, noise: 0.05 }, step(25, 40)), 2)], { span: 2 }),
					stat('Elasticsearch cluster', 'green', { tone: 'ok' }),
					stat('ES disk used', '61%', { tone: 'ok' })
				]
			}
		},
		{
			type: 'logs',
			logs: {
				style: 'terminal',
				title: 'log-shipper (stderr)',
				lines: [
					{ ts: '15:25:03.118', level: 'WARN', source: 'shipper', msg: 'bulk item rejected: mapper_parsing_exception: failed to parse field [user] of type [keyword] in document. Preview of field\'s value: \'{id=u_1192, plan=pro}\'' },
					{ ts: '15:25:03.119', level: 'WARN', source: 'shipper', msg: 'dropping 412 records (dead letter queue disabled)' }
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: '**Payments is fine.** Requests stay at ~140/s and 5xx stays ~0.3/s across 15:25. What changed at 15:25 is the log pipeline: *docs rejected* jumps from 0 to ~40/s, the same rate payments logs used to arrive (2,400/min ÷ 60).'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'v8.3.0 changed the `user` log field from a string to an object, and the existing index maps `user` as `keyword`: every new document is rejected.',
					body: 'Elasticsearch fixes a field’s type when an index first sees it. A [[log-mapping-conflict|mapping conflict]] rejects the whole document, and with the shipper’s DLQ disabled the logs are dropped. The last accepted line (15:24:58) still has `user: "u_1192"`; the deploy completed 0.7 s later.',
					confirm: 'The shipper error names the field and shows the object preview. `GET logs-payments-*/_mapping/field/user`.'
				}
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Red herrings',
			text: 'Cluster *green* and disk 61% are true and irrelevant: the cluster is healthy, it’s refusing this document shape. And the core lesson: **missing data is not zero**. A log count of 0 means “no logs arrived”, not “no traffic”. Always cross-check with an independent signal (metrics) before declaring an outage.'
		},
		{
			type: 'p',
			text: '**Fix:** log the object under a new name (`user_ctx.id`), or start a new index with the new mapping (it’ll take effect at the next daily rollover). Turn on the shipper DLQ so rejected logs can be replayed. Add a [[no-data-alert]] on per-service log volume and an alert on rejected documents.'
		}
	]
};

const k4x = timeAxis('08:30', 60);
const k4Pods = ['pay-gw-a (up 26h)', 'pay-gw-b (up 26h)', 'pay-gw-c (up 1h)', 'pay-gw-d (up 50m)', 'pay-gw-e (up 20m)'];
const k4: Question = {
	id: 'k4-cert-pods',
	group: 'Kibana · log investigations',
	title: '40% of bank calls fail, and the cert “isn’t expired”',
	tag: 'tricky',
	minutes: 10,
	prompt: [
		{ type: 'p', text: 'Since 09:00, ~40% of outbound calls from `pay-gw` to the bank’s mTLS API fail. Security confirms the client certificate was rotated at 07:30 and the new one is valid until next year. The Kubernetes secret holds the new cert.' },
		{
			type: 'dashboard',
			dashboard: {
				style: 'kibana',
				title: 'pay-gw · outbound TLS errors',
				range: '08:30 – 09:29',
				panels: [
					bars('TLS errors by pod', k4x, k4Pods.map((p, i) => S(p, shape(60, { base: 0, seed: 100 + i, noise: 0.15 }, step(30, i < 2 ? 55 : 0)), i as SeriesColor)), { stacked: true, span: 4 }),
					{ kind: 'table', title: 'Requests by pod (last 30 min)', span: 2, head: ['pod', 'requests', 'errors'], rows: [['pay-gw-a', '3,310', '1,640'], ['pay-gw-b', '3,280', '1,655'], ['pay-gw-c', '3,290', '0'], ['pay-gw-d', '3,305', '0'], ['pay-gw-e', '3,300', '0']], numeric: [1, 2], highlight: [0, 1] }
				]
			}
		},
		{
			type: 'logs',
			logs: {
				style: 'kibana',
				query: 'service:pay-gw AND level:(WARN OR ERROR)',
				lines: [
					{ ts: '09:00:00.884', level: 'ERROR', source: 'pay-gw-a', msg: 'tls: remote error: tls: bad certificate', fields: { peer: 'api.bank.example:443', client_cert_serial: '4F:A1:…:09', client_cert_not_after: '2026-10-16T09:00:00Z' } },
					{ ts: '09:00:01.102', level: 'INFO', source: 'pay-gw-c', msg: 'bank call ok', fields: { client_cert_serial: '7C:22:…:E3', client_cert_not_after: '2027-10-16T00:00:00Z' } },
					{ ts: '09:00:01.519', level: 'WARN', source: 'pay-gw-b', msg: 'dns lookup slow', fields: { host: 'api.bank.example', ms: 310 } },
					{ ts: '09:00:02.007', level: 'ERROR', source: 'pay-gw-b', msg: 'tls: remote error: tls: bad certificate', fields: { client_cert_serial: '4F:A1:…:09' } }
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: 'Errors start at 09:00 sharp and come only from pods **a** and **b**, the two up for 26 h (each ~50% of its calls). Pods c, d, e (started after the 07:30 rotation) have zero errors. The failing log lines present serial `4F:A1…` with `not_after 09:00:00Z today`; the successful ones present `7C:22…` valid until 2027. 2 of 5 pods = 40%.'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'Pods a and b loaded the old certificate into memory at startup and never re-read the secret; it expired at 09:00.',
					body: 'Kubernetes updates the mounted secret file, but most TLS clients read cert files once when the process starts. The secret is correct, the new cert is valid, and security is right. Two long-lived processes are still presenting the old [[tls-certificate|certificate]]. “Rotated” only happens per process when the process reloads.',
					confirm: 'Logged `client_cert_serial` per pod (shown). `kubectl exec` and compare the file on disk with what the process presents.'
				}
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Red herring',
			text: '`dns lookup slow` on pod b looks suspicious next to the errors but appears on healthy pods too, and DNS problems produce connection errors, not `bad certificate`.'
		},
		{
			type: 'p',
			text: '**Now:** restart a and b (rolling). **Properly:** hot-reload certs on file change (or use a sidecar/mesh that does), rotate with overlap (new cert live days before the old one expires), and export `client_cert_not_after_seconds` from each process so you alert on what is *in use*, not on what’s in the secret.'
		}
	]
};

// ═════════════════════════ PART 3 · CloudWatch ═════════════════════════

const c1x = timeAxis('08:00', 72, 5);
const c1Job = [{ at: 12, label: 'weekly report job starts' }];
const c1Cpu = shape(72, { base: 12, seed: 110, noise: 0.08 }, step(12, 60), step(47, 20)).map((v, i) => (i >= 47 ? 20 : v));
const c1: Question = {
	id: 'c1-cpu-credits',
	group: 'CloudWatch · AWS resources',
	title: 'RDS CPU is only 20%, yet every query is slow',
	tag: 'tricky',
	minutes: 10,
	prompt: [
		{ type: 'p', text: 'Orders API p95 jumped from 90 ms to 2.6 s at ~11:55. The DBA points at CPU: “20%, the database is idle.” Instance: `db.t3.medium`, credit specification **standard**.' },
		{
			type: 'dashboard',
			dashboard: {
				style: 'cloudwatch',
				title: 'RDS · orders-db',
				range: '08:00 – 13:55 (5-minute periods)',
				filters: ['eu-west-1', 'db.t3.medium', 'credits: standard'],
				panels: [
					ts('CPUUtilization', c1x, [S('Average', c1Cpu, 0)], { unit: '%', yMin: 0, yMax: 100, span: 3, markers: c1Job }),
					ts('CPUCreditBalance', c1x, [S('Average', shape(72, { base: 140, seed: 111, noise: 0.01 }, ramp(12, 47, 140, 0)), 1)], { span: 3 }),
					ts('ReadLatency', c1x, [S('Average', shape(72, { base: 2, seed: 112, noise: 0.15, round: 1 }, step(47, 46)), 0)], { unit: ' ms', span: 2 }),
					ts('DatabaseConnections', c1x, [S('Sum', cap(shape(72, { base: 42, seed: 113, noise: 0.05 }, ramp(47, 56, 42, 300)), 300), 0)], { span: 2, thresholds: [{ value: 300, label: 'max_connections', tone: 'crit' }] }),
					ts('FreeableMemory', c1x, [S('Average', shape(72, { base: 1.4, seed: 114, noise: 0.02, round: 2 }), 2)], { unit: ' GB', span: 2, yMin: 0 }),
					ts('ReadIOPS', c1x, [S('Average', shape(72, { base: 420, seed: 115, noise: 0.08 }, step(12, 610)), 3)], { span: 3 }),
					ts('orders-api p95 (from app)', c1x, [S('p95', shape(72, { base: 90, seed: 116, noise: 0.06 }, step(47, 2600)), 2)], { unit: ' ms', span: 3 })
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: 'At 09:00 the report job starts and CPU goes 12% → ~60%. *CPUCreditBalance* drains linearly from 140 to 0 by ~11:55. At that exact point CPU drops to a dead-flat **20%**, read latency jumps 2 → 46 ms, connections climb to the 300 ceiling and app p95 hits 2.6 s.'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'Burstable instance out of [[cpu-credits|CPU credits]]: AWS is capping the database at its 20% baseline.',
					body: 'A t3.medium earns 24 credits/h and has a 20%-per-vCPU baseline. At 60% on 2 vCPUs it spends 72 credits/h, net −48/h: 140 credits last ~2.9 h: 09:00 → ~11:55, exactly when the balance hits zero. In *standard* mode, when the balance hits 0 the instance is held at baseline. The CPU graph didn’t fall because demand fell; demand is now far above what it’s allowed to use. The flatness of the line is the tell. Queries queue, connections pile up ([[littles-law]] again), and latency explodes.',
					confirm: 'CPUCreditBalance hitting 0 at the moment latency changes (shown). Also `CPUSurplusCreditBalance` stays 0 in standard mode.'
				},
				{
					title: 'Memory pressure / I/O saturation.',
					body: 'FreeableMemory is flat at 1.4 GB, and ReadIOPS rose at 09:00 with the job but didn’t change at 10:55. Read latency rises because queries wait for CPU, not disk. Ruled down.'
				}
			]
		},
		{
			type: 'p',
			text: '**Now:** switch credit spec to *unlimited* (takes effect immediately, billed per surplus) or pause the report job. **Properly:** production databases with sustained load belong on fixed-performance classes (m/r), run reports on a [[read-replica]], and alarm on `CPUCreditBalance < 20% of max`. Same family of trap: gp2 EBS [[burst-balance]].'
		}
	]
};

const c2x = timeAxis('08:30', 60);
const c2Batch = shape(60, { base: 0, seed: 120, noise: 0.03 }, ramp(30, 33, 0, 760));
const c2ApiWant = shape(60, { base: 330, seed: 121, noise: 0.05 }, wave(60, 0.08));
const c2Api = c2ApiWant.map((v, i) => Math.min(v, 1000 - c2Batch[i]));
const c2: Question = {
	id: 'c2-lambda-concurrency',
	group: 'CloudWatch · AWS resources',
	title: 'The API Lambda is throttled and nobody touched it',
	tag: 'core',
	minutes: 8,
	prompt: [
		{ type: 'p', text: 'Mobile users see “Something went wrong” on ~20% of actions from 09:00. `api-handler`’s code and config haven’t changed in two weeks.' },
		{
			type: 'dashboard',
			dashboard: {
				style: 'cloudwatch',
				title: 'Lambda · account overview',
				range: '08:30 – 09:29 (1-minute periods)',
				filters: ['eu-central-1', 'account concurrency limit: 1,000'],
				panels: [
					ts('ConcurrentExecutions by function', c2x, [S('api-handler', c2Api, 0), S('batch-import', c2Batch, 1), S('other', flat(60, 12), 2)], { stacked: true, area: true, span: 3, markers: [{ at: 30, label: 'S3 upload: 2.1M-row import' }], thresholds: [{ value: 1000, label: 'account limit', tone: 'crit' }] }),
					ts('api-handler Throttles', c2x, [S('Sum', c2ApiWant.map((w, i) => Math.round(Math.max(0, w - c2Api[i]) * 22)), 2)], { span: 3 }),
					ts('api-handler Duration p99', c2x, [S('p99', shape(60, { base: 180, seed: 122, noise: 0.08 }), 0)], { unit: ' ms', span: 2, yMin: 0 }),
					ts('api-handler Init Duration (cold starts)', c2x, [S('p99', shape(60, { base: 380, seed: 123, noise: 0.1 }, bump(30, 32, 260)), 3)], { unit: ' ms', span: 2, yMin: 0 }),
					ts('API Gateway 5XXError', c2x, [S('Sum', shape(60, { base: 2, seed: 124, noise: 0.4 }, step(31, 1700)), 2)], { span: 2 })
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: 'At 09:00 `batch-import` jumps from 0 to ~760 concurrent executions. Stacked concurrency hits the 1,000 account limit; `api-handler` is squeezed from ~330 to ~230, and its Throttles and the API Gateway 5XX both rise at 09:01.'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'The batch import consumed the account-wide [[lambda-concurrency|concurrency pool]], so the API function is throttled.',
					body: 'The 1,000 limit is shared by every function in the account and region. An S3-triggered import fanned out to 760 parallel executions, a classic [[noisy-neighbor]]. `api-handler` didn’t change: its p99 duration is flat at ~180 ms. It just can’t get execution slots. ~100 missing slots out of ~330 ≈ 30% of requests throttled at peak, consistent with “~20% of actions”.',
					confirm: 'Throttles on `api-handler` start the same minute `batch-import` concurrency rises (shown). Check `UnreservedConcurrentExecutions`.'
				}
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Red herring',
			text: 'The *Init Duration* bump at 09:00 is a few cold starts as throttled-and-retried invocations land on fresh instances. It adds ~260 ms to a handful of requests; it does not produce errors. [[lambda-cold-start|Cold starts]] make requests slow, throttles make them fail.'
		},
		{
			type: 'p',
			text: '**Fix:** reserved concurrency for `api-handler` (guaranteed slots) and a reserved-concurrency **cap** on `batch-import` (e.g. 100), or feed the import through SQS with maximum concurrency set. Request a limit increase if the totals are legitimate. Alarm on `Throttles > 0` for user-facing functions.'
		}
	]
};

const c3x = timeAxis('12:00', 60);
const c3Deploy = [{ at: 15, label: 'worker v1.9 (adds PDF invoice)' }];
const c3: Question = {
	id: 'c3-visibility',
	group: 'CloudWatch · AWS resources',
	title: 'Customers get three confirmation emails and the queue keeps growing',
	tag: 'tricky',
	minutes: 10,
	prompt: [
		{ type: 'p', text: 'Queue `order-confirmations` (standard SQS, visibility timeout **30 s**, maxReceiveCount 3 → DLQ). Workers send an email and then delete the message. Two complaints: duplicate emails, and confirmations arriving 40+ minutes late.' },
		{
			type: 'dashboard',
			dashboard: {
				style: 'cloudwatch',
				title: 'SQS · order-confirmations',
				range: '12:00 – 12:59',
				panels: [
					ts('Messages sent / received / deleted', c3x, [S('NumberOfMessagesSent', shape(60, { base: 600, seed: 130, noise: 0.04 }), 0), S('NumberOfMessagesReceived', shape(60, { base: 600, seed: 131, noise: 0.04 }, step(16, 1650)), 1), S('NumberOfMessagesDeleted', shape(60, { base: 600, seed: 132, noise: 0.04 }, step(16, 450)), 2)], { span: 3, markers: c3Deploy }),
					ts('Worker duration (avg)', c3x, [S('avg', shape(60, { base: 4.1, seed: 133, noise: 0.06, round: 1 }, step(15, 34)), 0)], { unit: ' s', span: 3, thresholds: [{ value: 30, label: 'visibility timeout', tone: 'crit' }], markers: c3Deploy }),
					ts('ApproximateNumberOfMessagesVisible', c3x, [S('Max', shape(60, { base: 20, seed: 134, noise: 0.1 }, ramp(16, 60, 20, 6900)), 0)], { span: 2 }),
					ts('ApproximateAgeOfOldestMessage', c3x, [S('Max', shape(60, { base: 5, seed: 135, noise: 0.1 }, ramp(16, 60, 5, 2700)), 1)], { unit: ' s', span: 2 }),
					ts('DLQ ApproximateNumberOfMessagesVisible', c3x, [S('Max', shape(60, { base: 0, seed: 136, noise: 0.05 }, ramp(19, 60, 0, 4100)), 2)], { span: 2 }),
					ts('Worker CPU', c3x, [S('avg', shape(60, { base: 38, seed: 137, noise: 0.08 }, step(15, 44)), 3)], { unit: '%', yMin: 0, yMax: 100, span: 6 })
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: 'v1.9 deploys at 12:15 and average worker duration goes from 4 s to **34 s**, above the 30 s visibility timeout. From 12:16: *Received* jumps to ~1,650/min while *Sent* stays ~600, *Deleted* falls to ~450, visible messages climb to ~6,900, the oldest message ages to 45 min, and the DLQ starts filling at 12:19.'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'Processing now outlasts the [[visibility-timeout]], so every message is redelivered while its first worker is still working on it.',
					body: 'At 30 s the queue assumes the worker died and hands the message to another worker. Each message is received ~2.75× (1,650 ÷ 600), so each email goes out 2–3 times. The redundant copies eat worker capacity, so fewer distinct messages are completed per minute (deleted 450 < sent 600) and the backlog grows: that’s the lateness. After the 3rd receive, messages go to the [[dead-letter-queue|DLQ]] even though they were processed. SQS is [[at-least-once]], and this config turns “at least once” into “about three times”.',
					confirm: '`ApproximateReceiveCount` attribute on sampled messages; email-provider logs show the same message id sent 2–3 times ~30 s apart.'
				}
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Red herring',
			text: 'Worker CPU rising 38% → 44% looks like “workers are overloaded, add more”. Adding workers makes the duplicates *worse* (more parallel copies) and doesn’t touch the cause. PDF rendering mostly waits on I/O, and the duplicate processing is what’s burning capacity.'
		},
		{
			type: 'list',
			items: [
				'**Now:** raise the visibility timeout to well above worst-case duration (e.g. 180 s). Redrive the DLQ only after deduping.',
				'**Properly:** heartbeat `ChangeMessageVisibility` for long jobs, render PDFs in a separate step, and make the consumer [[idempotent-consumer|idempotent]] (record `order_id` email-sent before sending, or use the provider’s idempotency key).',
				'Alarm on `Received / Sent > 1.2` and on [[queue-age|age of oldest message]].'
			]
		}
	]
};

const c4x = timeAxis('10:00', 60);
const c4Sale = [{ at: 20, label: 'flash sale starts' }];
const c4: Question = {
	id: 'c4-dynamo-hot',
	group: 'CloudWatch · AWS resources',
	title: '10,000 WCU provisioned, 21% used, and still throttling',
	tag: 'tricky',
	minutes: 8,
	prompt: [
		{ type: 'p', text: 'Flash sale at 10:20. The `sales` DynamoDB table is provisioned at 10,000 WCU. Writes start failing with `ProvisionedThroughputExceededException`. A teammate wants to raise capacity to 40,000.' },
		{
			type: 'dashboard',
			dashboard: {
				style: 'cloudwatch',
				title: 'DynamoDB · sales',
				range: '10:00 – 10:59',
				panels: [
					ts('ConsumedWriteCapacityUnits (per second)', c4x, [S('consumed', shape(60, { base: 900, seed: 140, noise: 0.06 }, step(20, 2100)), 0), S('provisioned', flat(60, 10000), 3, true)], { span: 3, markers: c4Sale }),
					ts('WriteThrottleEvents', c4x, [S('Sum', shape(60, { base: 0, seed: 141, noise: 0.15 }, step(20, 3400)), 2)], { span: 3, markers: c4Sale }),
					stat('Consumed / provisioned', '21%', { tone: 'ok' }),
					stat('SuccessfulRequestLatency p99', '7 ms', { tone: 'ok' }),
					{ kind: 'table', title: 'Contributor Insights · most throttled keys', span: 4, head: ['partition key', 'throttled writes', 'share'], rows: [['SALE#2026-10-16#counter', '198,450', '97.2%'], ['SALE#2026-10-16#sku_771', '2,110', '1.0%'], ['USER#u_8812', '41', '0.0%']], numeric: [1, 2], highlight: [0] }
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: 'At 10:20 consumed write capacity rises to ~2,100/s, only 21% of the 10,000 provisioned, yet throttles jump to ~3,400/min. Contributor Insights shows 97% of throttled writes hit one key: `SALE#2026-10-16#counter`.'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'Every order increments one counter item: a single-key [[hot-partition]], capped at ~1,000 WCU/s no matter what the table has.',
					body: 'DynamoDB spreads capacity across partitions and a single item always lives on one partition, which tops out around 1,000 writes/s. The table-level average looks healthy because the other partitions are nearly idle. Adaptive capacity can move capacity between partitions but can’t split one item. Raising to 40,000 WCU changes nothing for that key (and switching to on-demand doesn’t either).',
					confirm: 'Contributor Insights (shown). Successful writes to the counter plateau near ~1,000/s.'
				}
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Red herring',
			text: 'p99 latency of 7 ms is for *successful* requests only. Throttled requests are rejected fast and don’t appear in it. A fast latency panel during an error storm often means the failures are quick rejections.'
		},
		{
			type: 'p',
			text: '**Fix:** [[write-sharding]] (`…#counter#0` to `#9`, pick randomly, sum on read), or stop doing synchronous counters: write order events and aggregate asynchronously (streams → aggregator). Load-test the sale’s *key distribution*, not just total throughput.'
		}
	]
};

const c5x = timeAxis('00:00', 48, 30);
const c5Req = shape(48, { base: 9000, seed: 150, noise: 0.04 }, wave(48, 0.75, 36));
const c5: Question = {
	id: 'c5-alb-keepalive',
	group: 'CloudWatch · AWS resources',
	title: 'A trickle of 502s that the app never sees',
	tag: 'tricky',
	minutes: 10,
	prompt: [
		{ type: 'p', text: 'Since the team replaced nginx with the Node.js server directly behind the ALB last week, there’s a constant trickle of 502s. App logs show no errors and no matching requests.' },
		{
			type: 'dashboard',
			dashboard: {
				style: 'cloudwatch',
				title: 'ALB · web-prod',
				range: 'Last 24 hours (30-minute periods)',
				panels: [
					ts('RequestCount', c5x, [S('Sum', c5Req, 0)], { span: 3 }),
					ts('HTTPCode_ELB_502_Count vs HTTPCode_Target_5XX_Count', c5x, [S('ELB 502', shape(48, { base: 44, seed: 151, noise: 0.25 }), 2), S('Target 5XX', shape(48, { base: 1, seed: 152, noise: 0.8 }), 0)], { span: 3 }),
					ts('TargetResponseTime p99', c5x, [S('p99', shape(48, { base: 0.24, seed: 153, noise: 0.08, round: 2 }), 0)], { unit: ' s', span: 2, yMin: 0 }),
					ts('HealthyHostCount', c5x, [S('Min', flat(48, 6), 1)], { span: 2, yMin: 0, yMax: 8 }),
					stat('ALB idle timeout', '60 s', { tone: 'info' })
				]
			}
		},
		{
			type: 'logs',
			logs: {
				style: 'cloudwatch',
				title: 'ALB access logs (Athena)',
				lines: [
					{ ts: '03:14:07.221', msg: 'GET /api/cart', fields: { elb_status_code: 502, target_status_code: '-', request_processing_time: 0.0, target_processing_time: -1, error_reason: 'TargetConnectionError' } },
					{ ts: '14:41:52.903', msg: 'POST /api/checkout', fields: { elb_status_code: 502, target_status_code: '-', target_processing_time: -1, error_reason: 'TargetConnectionError' } }
				]
			}
		}
	],
	hints: ['What is Node’s default `server.keepAliveTimeout`, and how does it compare with the ALB’s idle timeout?'],
	answer: [
		{
			type: 'p',
			text: 'ELB 502s run at ~44 per 30 min **regardless of traffic** (traffic varies ~7× between night and afternoon), while target 5XX is ~1, target latency is flat at 0.24 s, and all 6 hosts are healthy. Access logs show `target_status_code: -` and `target_processing_time: -1`: the target never produced a response.'
		},
		{
			type: 'ranked',
			items: [
				{
					title: '[[keep-alive-timeout|Keep-alive timeout mismatch]]: Node closes idle connections after 5 s, the ALB keeps them for 60 s and occasionally sends a request on a socket Node is closing.',
					body: 'The ALB reuses idle backend connections. Node.js’s default `keepAliveTimeout` is 5 s; nginx previously absorbed this. When the ALB picks a connection that has been idle ~5 s, Node closes it as the request arrives and the ALB returns 502 itself: [[load-balancer-5xx|ELB 5xx, not target 5xx]]. The rate depends on how many connections go idle near 5 s, not on traffic volume, which fits the flat count. It began with the migration.',
					confirm: 'Set `server.keepAliveTimeout = 65_000` and `headersTimeout = 66_000` on one target group and watch its 502s go to zero.'
				},
				{
					title: 'Targets crashing / deploys draining.',
					body: 'HealthyHostCount never drops and 502s are spread across the whole day, not clustered at deploy times. Ruled out.'
				}
			]
		},
		{
			type: 'p',
			text: '**Rule:** backend idle timeout must be **longer** than the load balancer’s. 502s are proportionally worst at night (44 of ~2,000 requests vs 44 of ~15,000 in the afternoon), which is why a ratio alert flaps overnight while daytime looks fine.'
		}
	]
};

const c6x = timeAxis('14:00', 60);
const c6Flag = [{ at: 10, label: 'geo-enrichment flag → 100%' }];
const c6: Question = {
	id: 'c6-nat',
	group: 'CloudWatch · AWS resources',
	title: 'Outbound calls time out, but only to one partner',
	tag: 'core',
	minutes: 8,
	prompt: [
		{ type: 'p', text: 'Private-subnet services reach the internet through one NAT gateway. From ~14:24, calls to the geo-IP partner API time out (`connect ETIMEDOUT`). Calls to other partners are mostly fine. The partner says they see *less* traffic from us than usual.' },
		{
			type: 'dashboard',
			dashboard: {
				style: 'cloudwatch',
				title: 'NAT gateway · nat-0a12',
				range: '14:00 – 14:59',
				panels: [
					ts('ActiveConnectionCount', c6x, [S('Max', cap(shape(60, { base: 9000, seed: 160, noise: 0.03 }, ramp(10, 25, 9000, 55000)), 55100), 0)], { span: 3, markers: c6Flag, thresholds: [{ value: 55000, label: '~55k per destination', tone: 'crit' }] }),
					ts('ErrorPortAllocation', c6x, [S('Sum', shape(60, { base: 0, seed: 161, noise: 0.2 }, step(24, 2400)), 2)], { span: 3 }),
					ts('ConnectionAttemptCount vs ConnectionEstablishedCount', c6x, [S('attempts', shape(60, { base: 2200, seed: 162, noise: 0.05 }, step(10, 9800)), 1), S('established', shape(60, { base: 2200, seed: 163, noise: 0.05 }, step(10, 9800), step(24, 7300)), 0)], { span: 3 }),
					ts('BytesOutToDestination', c6x, [S('Sum', shape(60, { base: 210, seed: 164, noise: 0.05 }, step(10, 260)), 3)], { unit: ' MB', span: 3, yMin: 0 }),
					{ kind: 'table', title: 'VPC Flow Logs · top destinations (ESTABLISHED + TIME_WAIT)', span: 6, head: ['destination', 'port', 'connections', 'share'], rows: [['203.0.113.40 (geo-ip partner)', '443', '50,870', '92%'], ['198.51.100.7 (email API)', '443', '2,104', '4%'], ['other', '—', '2,213', '4%']], numeric: [2, 3], highlight: [0] }
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: 'The geo-enrichment flag goes to 100% at 14:10. Connection attempts jump ~4.5× (2.2 k → 9.8 k/min) while bytes out rise only ~25%: lots of tiny new connections. Active connections climb to ~55 k by 14:24, exactly when *ErrorPortAllocation* starts (~2,400/min) and established falls below attempts. 92% of connections go to one IP:port.'
		},
		{
			type: 'ranked',
			items: [
				{
					title: '[[nat-port-exhaustion|NAT port exhaustion]] to a single destination: the new feature opens a fresh TCP connection per lookup, with no keep-alive.',
					body: 'A NAT gateway can hold ~55,000 simultaneous connections to one destination IP+port. Each new connection takes a port, and closed connections linger in TIME_WAIT. At 9.8 k new connections/min, mostly to 203.0.113.40:443, the table fills in ~15 minutes. New connections to that partner then can’t get a port, which the app sees as connect timeouts. The partner sees *less* traffic because our connections never leave the NAT. Other partners are mostly fine because the limit is per destination.',
					confirm: 'ErrorPortAllocation > 0 (shown). Check the HTTP client config of the geo feature: likely a new client per call or `Connection: close`.'
				}
			]
		},
		{
			type: 'p',
			text: '**Now:** turn the flag down. **Properly:** reuse connections ([[connection-pool]] + keep-alive), cache geo lookups (IP → country changes rarely), and if volume is legitimately high, add secondary IPs to the NAT gateway (each adds ~55 k ports per destination). Alarm on `ErrorPortAllocation > 0`.'
		}
	]
};

const c7x = timeAxis('16:00', 60);
const c7: Question = {
	id: 'c7-gray-az',
	group: 'CloudWatch · AWS resources',
	title: 'One third of users are miserable and every health check is green',
	tag: 'tricky',
	minutes: 10,
	prompt: [
		{ type: 'p', text: 'Error budget burning since 16:20. 9 instances across three availability zones (3 per AZ), behind an ALB with cross-zone balancing on. Health check: `GET /health` returns 200 if the process is up.' },
		{
			type: 'dashboard',
			dashboard: {
				style: 'cloudwatch',
				title: 'web-prod · per-AZ view',
				range: '16:00 – 16:59',
				panels: [
					ts('TargetResponseTime p99 by AZ', c7x, [S('eu-west-1a', shape(60, { base: 0.22, seed: 170, noise: 0.08, round: 2 }), 0), S('eu-west-1b', shape(60, { base: 0.23, seed: 171, noise: 0.1, round: 2 }, step(20, 2.4)), 2), S('eu-west-1c', shape(60, { base: 0.21, seed: 172, noise: 0.08, round: 2 }), 1)], { unit: ' s', span: 3 }),
					ts('Target 5XX by AZ', c7x, [S('1a', shape(60, { base: 2, seed: 173, noise: 0.5 }), 0), S('1b', shape(60, { base: 2, seed: 174, noise: 0.4 }, step(20, 140)), 2), S('1c', shape(60, { base: 2, seed: 175, noise: 0.5 }), 1)], { span: 3 }),
					ts('HealthyHostCount by AZ', c7x, [S('1a', flat(60, 3), 0), S('1b', flat(60, 3), 2), S('1c', flat(60, 3), 1)], { span: 2, yMin: 0, yMax: 4 }),
					ts('CPUUtilization by AZ', c7x, [S('1a', shape(60, { base: 46, seed: 176, noise: 0.05 }), 0), S('1b', shape(60, { base: 45, seed: 177, noise: 0.05 }, step(20, 19)), 2), S('1c', shape(60, { base: 47, seed: 178, noise: 0.05 }), 1)], { unit: '%', yMin: 0, yMax: 100, span: 2 }),
					ts('TCP retransmits/s by AZ (node exporter)', c7x, [S('1a', shape(60, { base: 12, seed: 179, noise: 0.3 }), 0), S('1b', shape(60, { base: 12, seed: 180, noise: 0.3 }, step(20, 480)), 2), S('1c', shape(60, { base: 11, seed: 181, noise: 0.3 }), 1)], { span: 2 })
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: 'From 16:20 only **eu-west-1b** deviates: p99 0.23 → 2.4 s, target 5xx 2 → ~140, TCP retransmits 12 → ~480/s. 1a and 1c are untouched. All 9 hosts stay healthy. 3 of 9 hosts ≈ a third of requests.'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'A [[gray-failure]] in one [[availability-zone]]: partial network impairment in 1b (packet loss), while the shallow health check keeps the hosts in rotation.',
					body: 'Retransmits are the network-level fingerprint: packets are being lost and resent, so calls from 1b instances to their dependencies take far longer or time out. The health check only proves the process runs, so the ALB keeps routing a third of traffic there. Every 1b host is affected at the same moment, which points at the zone, not a bad deploy (a deploy would roll host by host).',
					confirm: 'Compare per-instance metrics within 1b (all three should match), check the AWS Health dashboard, and run a cross-AZ latency probe from a 1b host.'
				}
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Red herring',
			text: 'CPU in 1b **drops** to ~19%. That looks like “1b is fine, it’s barely working”. It’s barely working because its threads are blocked waiting on the network. Low CPU with high latency means waiting, not health.'
		},
		{
			type: 'p',
			text: '**Now:** shift traffic away from 1b (zonal shift, or deregister its targets), with 1a/1c capacity scaled up to absorb it. **Properly:** a [[deep-health-check|readiness check]] that exercises local dependencies, outlier detection that compares peers, and alarms grouped by AZ so a one-zone problem looks like one.'
		}
	]
};

// ═════════════════════════ PART 4 · traces & heatmaps ═════════════════════════

const t1x = timeAxis('09:30', 30, 2);
const t1y = ['<10 ms', '10–25', '25–50', '50–100', '100–250', '250–500', '500 ms–1 s', '>1 s'];
const t1Fast = [8, 52, 30, 7, 2, 1, 0, 0];
const t1Slow = [0, 0, 1, 6, 20, 58, 13, 2];
const t1R = rng(190);
const t1Values = t1y.map((_, row) =>
	t1x.map((_, col) => Math.round((col >= 12 ? 0.75 * t1Fast[row] + 0.25 * t1Slow[row] : t1Fast[row]) * 20 * (0.85 + 0.3 * t1R())))
);
const t1: Question = {
	id: 't1-bimodal',
	group: 'Traces & heatmaps',
	title: 'p50 didn’t move. p99 went from 60 ms to 520 ms.',
	tag: 'core',
	minutes: 8,
	prompt: [
		{ type: 'p', text: '`catalog-api`, 4 instances behind a round-robin balancer. A 25% rollout of a new pricing [[feature-flag]] went out at 09:54. Separately, instance `i-0c` was replaced at 09:53 after a hardware notice.' },
		{
			type: 'dashboard',
			dashboard: {
				style: 'grafana',
				title: 'catalog-api · latency',
				range: '09:30 – 10:28',
				panels: [
					{ kind: 'heatmap', title: 'Request duration heatmap', x: t1x, y: t1y, values: t1Values, span: 4 },
					ts('Percentiles & mean', t1x, [S('p50', shape(30, { base: 22, seed: 191, noise: 0.05 }), 0), S('mean', shape(30, { base: 24, seed: 192, noise: 0.05 }, step(12, 105)), 3, true), S('p99', shape(30, { base: 60, seed: 193, noise: 0.08 }, step(12, 520)), 2)], { unit: ' ms', span: 2, log: true }),
					bars('Requests by instance', t1x, ['i-0a', 'i-0b', 'i-0c', 'i-0d'].map((n, i) => S(n, shape(30, { base: 250, seed: 194 + i, noise: 0.04 }), i as SeriesColor)), { stacked: true, span: 6 })
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: 'From 09:54 the [[latency-heatmap|heatmap]] grows a **second band** at 250–500 ms while the original band at 10–50 ms keeps its shape. About a quarter of requests moved. p50 stays at 22 ms because 75% of requests are still fast; p99 lands inside the new band; the mean (~105 ms) describes no actual request. This is a [[bimodal-distribution]].'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'Two candidate 25% populations: the new instance `i-0c` (1 of 4 = 25%) or the 25% flag cohort. The heatmap can’t tell them apart; one group-by can.',
					body: 'Both events happened within a minute and both explain exactly 25%. That’s the point of the question: the shape says “a distinct subset”, and your next step is to split latency by `instance` and by `flag_variant`. If it’s the instance: cold caches or JIT on the fresh host should *improve* over minutes, and this band doesn’t fade, so suspect a misconfiguration on the replacement (wrong instance type, missing local cache, different AZ). If it’s the flag: the new pricing path (an extra call per item, an [[n-plus-one]]) is slow for everyone in the cohort.',
					confirm: 'p99 grouped by instance and by flag variant. Turning the flag to 0% is the cheaper experiment; draining `i-0c` is the other.'
				}
			]
		},
		{
			type: 'callout',
			tone: 'info',
			text: 'The requests-by-instance panel shows traffic evenly split (~250 each), so a balancer imbalance isn’t the cause. It also confirms 1 instance = 25% of traffic. The percentile panel uses a [[log-scale|log axis]]: the p50 and p99 lines look barely more than one gridline apart, which is a ~24× difference.'
		}
	]
};

const t2Shards = Array.from({ length: 8 }, (_, i) => ({
	id: `s${i}`,
	parent: 'fan',
	service: `index-shard-${i}`,
	name: 'search',
	start: 22 + i,
	duration: i === 5 ? 1850 : [41, 52, 38, 47, 55, 0, 44, 49][i],
	note: i === 5 ? 'node index-7 · segment merge in progress' : undefined
}));
const t2: Question = {
	id: 't2-slow-shard',
	group: 'Traces & heatmaps',
	title: 'Search takes 1.9 s, and every shard but one answered in 50 ms',
	tag: 'core',
	minutes: 6,
	prompt: [
		{
			type: 'trace',
			trace: {
				title: 'GET /search?q=wireless+headphones',
				traceId: '7d1e…b0a4',
				spans: [
					{ id: 'root', service: 'search-api', name: 'GET /search', start: 0, duration: 1912 },
					{ id: 'auth', parent: 'root', service: 'auth', name: 'verify token', start: 3, duration: 14 },
					{ id: 'fan', parent: 'root', service: 'search-api', name: 'fan-out to 8 shards', start: 20, duration: 1855 },
					...t2Shards,
					{ id: 'merge', parent: 'root', service: 'search-api', name: 'merge + rank', start: 1876, duration: 31 }
				]
			}
		},
		{ type: 'p', text: 'Shard-level p99 for the fleet is 120 ms; this is happening on ~15% of searches.' }
	],
	answer: [
		{
			type: 'p',
			text: 'Seven shards answer in 38–55 ms; `index-shard-5` takes 1,850 ms, and the fan-out waits for the slowest. The request takes as long as its slowest dependency: the [[fan-out]] turns one sick shard into a slow request for everyone.'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'Shard 5’s node is busy with a segment merge (the span note), so it’s slow for every query that touches it.',
					body: 'Merges, GC, a [[noisy-neighbor]] or a hot shard all make one node slow. With 8 shards per query, even a 2% per-shard slow rate makes ~15% of requests slow: 1 − 0.98⁸ ≈ 15%, matching the observed rate. That’s [[tail-latency]] amplification.',
					confirm: 'Group shard span duration by `node`: index-7 will stand out. Check merge/GC metrics on that node.'
				}
			]
		},
		{
			type: 'p',
			text: '**Mitigations:** per-shard timeout with partial results (“results may be incomplete”), [[hedged-requests]] to a replica after the shard p95 (~60 ms), throttle merges during peak, and alert on per-node shard latency rather than the fleet p99, which averages the bad node away.'
		}
	]
};

const t3x = timeAxis('10:00', 60);
const t3: Question = {
	id: 't3-lock-wait',
	group: 'Traces & heatmaps',
	title: 'An UPDATE of one row takes 2.9 seconds',
	tag: 'tricky',
	minutes: 10,
	prompt: [
		{
			type: 'trace',
			trace: {
				title: 'POST /orders/8812/cancel',
				traceId: '91aa…3c07',
				spans: [
					{ id: 'r', service: 'orders-api', name: 'POST /orders/:id/cancel', start: 0, duration: 3010 },
					{ id: 'b', parent: 'r', service: 'postgres', name: 'BEGIN', start: 4, duration: 1 },
					{ id: 's', parent: 'r', service: 'postgres', name: 'SELECT order FOR UPDATE', start: 6, duration: 3 },
					{ id: 'u', parent: 'r', service: 'postgres', name: 'UPDATE inventory SET reserved = reserved - 1 WHERE sku = $1', start: 11, duration: 2950, note: 'wait_event=Lock:transactionid' },
					{ id: 'c', parent: 'r', service: 'postgres', name: 'COMMIT', start: 2963, duration: 4 },
					{ id: 'e', parent: 'r', service: 'events', name: 'publish OrderCancelled', start: 2970, duration: 30 }
				]
			}
		},
		{
			type: 'dashboard',
			dashboard: {
				style: 'grafana',
				title: 'orders-db',
				range: '10:00 – 10:59',
				panels: [
					ts('orders-api p99', t3x, [S('p99', shape(60, { base: 80, seed: 200, noise: 0.08 }, periodic(15, 4, 2900, 5)), 2)], { unit: ' ms', span: 3 }),
					ts('Sessions waiting on locks', t3x, [S('waiting', shape(60, { base: 0, seed: 201, noise: 0.2 }, periodic(15, 4, 38, 5)), 2)], { span: 3 }),
					ts('Oldest open transaction age', t3x, [S('max age', shape(60, { base: 1, seed: 202, noise: 0.2 }, periodic(15, 4, 230, 5)), 4)], { unit: ' s', span: 3 }),
					ts('Postgres CPU', t3x, [S('cpu', shape(60, { base: 24, seed: 203, noise: 0.06 }, periodic(15, 4, 6, 5)), 0)], { unit: '%', yMin: 0, yMax: 100, span: 3 })
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: 'The UPDATE span is 2,950 ms with `wait_event=Lock:transactionid`: it did nothing for ~3 s except wait for another transaction to release the row. The dashboard repeats every 15 min (10:05, 10:20, 10:35, 10:50): for 4 minutes, lock-waiting sessions jump to ~38, the oldest open transaction reaches ~230 s, and p99 spikes to ~3 s. CPU barely moves (24% → 30%).'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'A job that runs every 15 minutes updates inventory rows in one long transaction (~4 min) and holds their row locks until it commits.',
					body: 'Any request touching a locked SKU queues behind it: that’s [[lock-wait]]. The guilty party is the *holder*, not the waiting UPDATE, which is why optimizing the cancel query would do nothing. The oldest-transaction panel lines up exactly with the waits.',
					confirm: 'During a spike: `SELECT pid, now() - xact_start, query FROM pg_stat_activity ORDER BY xact_start LIMIT 5` and `pg_blocking_pids(<waiting pid>)`.'
				}
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Red herring',
			text: 'Low, flat Postgres CPU makes “the DB is fine” tempting. Lock waits are idle time: nobody is working, everyone is waiting. High latency + low CPU in a database is a lock or I/O story.'
		},
		{
			type: 'p',
			text: '**Fix:** have the job commit in small batches (e.g. 500 rows), update rows in a consistent order, set `lock_timeout` on user-facing paths so they fail fast rather than hang, and alert on oldest-transaction age.'
		}
	]
};

const t4: Question = {
	id: 't4-hidden-retries',
	group: 'Traces & heatmaps',
	title: '“Our p99 is 120 ms.” “Your calls take 2.1 s.” Who’s right?',
	tag: 'tricky',
	minutes: 8,
	prompt: [
		{ type: 'p', text: 'The checkout team sees `payments.charge` taking 2+ s on ~1 in 3 checkouts. The payments team’s server-side p99 is 120 ms and they refuse the ticket. Payments runs 3 instances behind DNS round-robin; one was decommissioned yesterday.' },
		{
			type: 'trace',
			trace: {
				title: 'POST /checkout',
				traceId: 'c0f3…88e1',
				spans: [
					{ id: 'r', service: 'checkout', name: 'POST /checkout', start: 0, duration: 2190 },
					{ id: 'c', parent: 'r', service: 'checkout', name: 'payments-client.charge', start: 12, duration: 2140 },
					{ id: 'a1', parent: 'c', service: 'checkout', name: 'attempt 1 · connect 10.4.2.17:443', start: 12, duration: 1000, error: true, note: 'connect timeout' },
					{ id: 'a2', parent: 'c', service: 'checkout', name: 'attempt 2 · connect 10.4.2.17:443', start: 1015, duration: 1000, error: true, note: 'connect timeout' },
					{ id: 'a3', parent: 'c', service: 'checkout', name: 'attempt 3 · 10.4.2.31:443', start: 2018, duration: 130 },
					{ id: 'p', parent: 'a3', service: 'payments', name: 'POST /charges', start: 2030, duration: 112 }
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: '**Both are right.** The payments server span is 112 ms. The client span is 2,140 ms because it contains two 1-second connect timeouts to `10.4.2.17` before attempt 3 reaches `10.4.2.31`. Those first attempts never reached a payments server, so they don’t exist in payments’ metrics.'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'The checkout client still resolves the decommissioned instance’s IP (stale [[dns-caching|DNS cache]]) and retries against it, ~1 in 3 times.',
					body: 'The removed instance was 1 of 3 DNS records: “~1 in 3 checkouts” matches. Many runtimes cache DNS longer than the record’s TTL (the JVM can cache forever by default with a security manager; connection pools pin resolved IPs). Both attempts 1 and 2 picked the same dead IP, suggesting the client resolved once and retried the same address.',
					confirm: 'Count client spans by peer IP; check the client’s DNS cache TTL and whether the pool re-resolves.'
				}
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'The lesson in a sentence',
			text: 'Server-side latency excludes everything before the request arrives: DNS, connect, TLS, client-side queueing, and failed attempts. Retries hidden inside one client span are invisible unless each attempt gets its own [[trace-span|span]].'
		},
		{
			type: 'p',
			text: '**Fix:** respect DNS TTL / re-resolve on connect failure, a short connect timeout (~100–200 ms inside a datacentre) separate from the read timeout, try a *different* endpoint on retry, and outlier ejection in the client or mesh. Make sure the charge uses an idempotency key, since it’s being retried.'
		}
	]
};

const t5x = timeAxis('15:00', 40);
const t5: Question = {
	id: 't5-missing-time',
	group: 'Traces & heatmaps',
	title: 'The request took 1,240 ms. The spans add up to 160.',
	tag: 'core',
	minutes: 8,
	prompt: [
		{
			type: 'trace',
			trace: {
				title: 'GET /reports/42',
				spans: [
					{ id: 'r', service: 'reports-api', name: 'GET /reports/:id', start: 0, duration: 1240 },
					{ id: 'a', parent: 'r', service: 'reports-api', name: 'authorize', start: 2, duration: 8 },
					{ id: 'q', parent: 'r', service: 'postgres', name: 'SELECT report rows', start: 1082, duration: 41 },
					{ id: 'x', parent: 'r', service: 'reports-api', name: 'render JSON', start: 1126, duration: 110 }
				]
			}
		},
		{
			type: 'dashboard',
			dashboard: {
				style: 'grafana',
				title: 'reports-api',
				range: '15:00 – 15:39',
				panels: [
					ts('DB pool acquire time p99', t5x, [S('acquire', shape(40, { base: 3, seed: 210, noise: 0.3 }, step(18, 1050)), 2)], { unit: ' ms', span: 2 }),
					ts('DB pool: in use / max', t5x, [S('in use', cap(shape(40, { base: 6, seed: 211, noise: 0.1 }, step(18, 10)), 10), 0), S('max', flat(40, 10), 3, true)], { span: 2, yMin: 0, yMax: 12 }),
					ts('GC pause p99', t5x, [S('gc', shape(40, { base: 12, seed: 212, noise: 0.2 }), 4)], { unit: ' ms', span: 2 })
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: 'Between `authorize` ending at 10 ms and the query starting at 1,082 ms there’s a **~1,070 ms [[uninstrumented-gap]]**. The DB pool panel shows acquire time p99 jumping to ~1,050 ms at 15:18 and the pool pinned at 10/10. The gap is the wait for a connection; acquiring from the pool isn’t its own span.'
		},
		{
			type: 'list',
			items: [
				'**Where gaps usually hide:** [[connection-pool]] checkout, thread-pool queues, mutexes, [[gc-pause|GC pauses]], CPU work nobody wrapped in a span (serialization), and [[cpu-throttling]].',
				'**Red herring:** GC p99 is a steady 12 ms. It can’t explain a full second.',
				'**Next questions:** what holds the 10 connections since 15:18? (Probably a slow endpoint or an [[idle-in-transaction]] path.) Add a `db.pool.acquire` span so the next trace shows it directly.'
			]
		}
	]
};

// ═════════════════════════ PART 5 · teasers ═════════════════════════

const te1x = timeAxis('01:00', 48, 5);
const te1Req = shape(48, { base: 900, seed: 220, noise: 0.05 }, ramp(0, 24, 900, 4), ramp(24, 48, 4, 700));
const te1: Question = {
	id: 'te1-low-traffic',
	group: 'Rapid fire',
	title: 'The 03:00 “50% error rate” page',
	tag: 'teaser',
	prompt: [
		{
			type: 'dashboard',
			dashboard: {
				style: 'grafana',
				title: 'internal-admin',
				panels: [
					ts('Error rate', te1x, [S('errors / requests', te1Req.map((r, i) => (i === 24 ? 50 : i === 23 ? 25 : Math.round((2 / Math.max(r, 1)) * 1000) / 10)), 2)], { unit: '%', span: 3 }),
					ts('Requests / 5 min', te1x, [S('requests', te1Req, 0)], { span: 3 })
				]
			}
		},
		{ type: 'p', text: 'Wake someone up?' }
	],
	answer: [
		{
			type: 'p',
			text: 'No. At 03:00 traffic is ~4 requests per 5 minutes, so 2 failures = 50%. Absolute errors are flat at ~2 the whole night. That’s the [[low-traffic-ratio]]. Alert on [[burn-rate]] with a minimum request count, or on absolute errors for low-traffic services.'
		}
	]
};

const te2: Question = {
	id: 'te2-avg-p99',
	group: 'Rapid fire',
	title: 'Average the p99s?',
	tag: 'teaser',
	prompt: [
		{
			type: 'table',
			head: ['pod', 'share of traffic', 'p99'],
			rows: [['a', '30%', '90 ms'], ['b', '30%', '95 ms'], ['c', '30%', '88 ms'], ['d', '10%', '4,100 ms']],
			numeric: [1, 2]
		},
		{ type: 'p', text: 'The dashboard shows “p99 (avg of pods) = 1,093 ms”. Another shows “p99 (weighted avg) = 492 ms”. What’s the real fleet p99?' }
	],
	answer: [
		{
			type: 'p',
			text: 'Neither, and you can’t compute it from these numbers. Pod d serves 10% of traffic and at least 1% of *its* requests take ≥ 4.1 s, i.e. ≥ 0.1% of all traffic, but its slow tail may be much fatter than 1%. If, say, 15% of d’s requests are slow, that’s 1.5% of all traffic and the fleet p99 is several seconds. Percentiles don’t average: aggregate [[histogram-metric|histogram buckets]] and compute the percentile once. See [[percentile-averaging]].'
		}
	]
};

const te3x = timeAxis('12:00', 40);
const te3Raw = shape(40, { base: 0, seed: 230, noise: 0 }, (i) => (i < 22 ? 50000 + i * 1200 : (i - 22) * 1200));
const te3: Question = {
	id: 'te3-counter-reset',
	group: 'Rapid fire',
	title: 'The counter fell off a cliff',
	tag: 'teaser',
	prompt: [
		{
			type: 'dashboard',
			dashboard: {
				style: 'grafana',
				title: 'billing-worker',
				panels: [ts('http_requests_total (raw)', te3x, [S('counter', te3Raw, 0)], { span: 6, markers: [{ at: 22, label: 'pod restart' }] })]
			}
		},
		{ type: 'p', text: 'A colleague’s panel `http_requests_total - http_requests_total offset 5m` shows a huge negative spike at 12:22. Is traffic negative? What would `rate()` show?' }
	],
	answer: [
		{
			type: 'p',
			text: 'The pod restarted and the counter started again from 0: a [[counter-reset]]. The naive subtraction gives about −70,000. `rate()` / `increase()` detect that the value went down, treat it as a reset, and keep reporting the true ~20 req/s (1,200 per minute). Use `rate()` on counters and never on gauges, and never subtract raw counters across time.'
		}
	]
};

const te4x = timeAxis('09:00', 40);
const te4: Question = {
	id: 'te4-log-scale',
	group: 'Rapid fire',
	title: 'They look almost the same',
	tag: 'teaser',
	prompt: [
		{
			type: 'dashboard',
			dashboard: {
				style: 'datadog',
				title: 'checkout · regions',
				panels: [
					ts('p95 latency', te4x, [S('eu', shape(40, { base: 120, seed: 240, noise: 0.06 }), 0), S('ap', shape(40, { base: 640, seed: 241, noise: 0.06 }), 1)], { unit: ' ms', log: true, span: 6 })
				]
			}
		},
		{ type: 'p', text: '“AP is only slightly slower than EU.” True?' }
	],
	answer: [{ type: 'p', text: 'No. The y-axis is [[log-scale|logarithmic]]: the lines sit less than one gridline apart, but 640 ms vs 120 ms is **5.3×**. Read the tick labels before judging a gap; on a log axis equal distances mean equal *ratios*.' }]
};

const te5: Question = {
	id: 'te5-sampling',
	group: 'Rapid fire',
	title: 'No error traces, so no errors?',
	tag: 'teaser',
	prompt: [{ type: 'p', text: 'A customer reports failures. Tracing is head-sampled at 1%. You search the last hour for error traces for their account and find none. The service does 200 req/s overall; that customer is 2% of traffic.' }],
	answer: [
		{
			type: 'p',
			text: 'Their traffic is ~4 req/s, ~14,400 requests an hour, of which 1% (~144) are traced. If 2% of their requests fail, you’d expect ~3 error traces, and finding zero is quite likely by chance. With [[trace-sampling|head-based sampling]] absence of evidence is not evidence. Check logs and metrics (unsampled), and use tail-based sampling that keeps every error.'
		}
	]
};

const te6x = timeAxis('14:00', 40);
const te6: Question = {
	id: 'te6-flatline',
	group: 'Rapid fire',
	title: 'Queue depth: zero. Great news?',
	tag: 'teaser',
	prompt: [
		{
			type: 'dashboard',
			dashboard: {
				style: 'grafana',
				title: 'jobs',
				panels: [
					ts('Queue depth', te6x, [S('depth', shape(40, { base: 380, seed: 250, noise: 0.15 }, step(18, 0)), 0)], { span: 3, yMin: 0 }),
					ts('Queue depth (null shown as gap)', te6x, [S('depth', gap(shape(40, { base: 380, seed: 250, noise: 0.15 }), 18, 40), 0)], { span: 3, yMin: 0 })
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: 'The left panel has “null as zero” on; the right panel shows the same data with nulls as gaps. Queue depth didn’t drop to zero at 14:18; the metric **stopped arriving** (exporter crashed, scrape failing). A real drain would slope down, not fall off a cliff in one scrape. Check `up{job="queue-exporter"}`, and add a [[no-data-alert]].'
		}
	]
};

const te7x = timeAxis('10:00', 40);
const te7Us = shape(40, { base: 300, seed: 260, noise: 0.05 }, bump(20, 28, 900));
const te7: Question = {
	id: 'te7-stacked',
	group: 'Rapid fire',
	title: 'EU traffic spiked at 10:20… did it?',
	tag: 'teaser',
	prompt: [
		{
			type: 'dashboard',
			dashboard: {
				style: 'kibana',
				title: 'traffic by region',
				panels: [
					ts('Requests/s (stacked)', te7x, [S('us', te7Us, 0), S('ap', shape(40, { base: 150, seed: 261, noise: 0.05 }), 1), S('eu', shape(40, { base: 200, seed: 262, noise: 0.05 }), 2)], { stacked: true, area: true, span: 6 })
				]
			}
		},
		{ type: 'p', text: 'The top band (EU) clearly jumps at 10:20. Who’s spiking?' }
	],
	answer: [
		{
			type: 'p',
			text: 'The US. In a [[stacked-chart]] every band sits on top of the ones below, so when US (the bottom band) goes from ~300 to ~1,200, AP and EU are lifted with it. EU’s *thickness* stays ~200 throughout. Switch to overlaid lines or hover each series before attributing a spike.'
		}
	]
};

// ═════════════════════════ assessment ═════════════════════════

const assessment: Assessment = {
	id: 'dashboards',
	number: 3,
	title: 'Read the Dashboards',
	tagline: 'Grafana, Kibana, CloudWatch and trace waterfalls. Find the cause in the charts.',
	description:
		'Every scenario is a dashboard, a log search or a trace. Your job is to read it like an on-call engineer: find the first thing that moved, separate causes from consequences, dismiss the red herrings, and name the check that proves it. Expect plausible-but-wrong first guesses.',
	minutes: 200,
	difficulty: 'advanced',
	topics: ['Grafana / Prometheus', 'Kibana logs', 'AWS CloudWatch', 'Tracing', 'Heatmaps', 'Red herrings'],
	overview: [
		{
			type: 'budget',
			items: [
				{ label: '1 · Grafana', minutes: 40 },
				{ label: '2 · Kibana', minutes: 40 },
				{ label: '3 · CloudWatch', minutes: 65 },
				{ label: '4 · Traces', minutes: 40 },
				{ label: 'Rapid fire', minutes: 15 }
			]
		},
		{
			type: 'cards',
			items: [
				{
					title: '1 · Scope',
					items: ['Which service, which region, what time range?', 'Read every panel title and unit before any line.', 'Is the axis log-scale, stacked, or rate vs raw?']
				},
				{
					title: '2 · First deviation',
					items: ['Find the earliest panel that moved and its exact time.', 'Line it up with markers: deploys, flags, jobs, traffic.', 'Anything that moves later is a candidate *consequence*.']
				},
				{
					title: '3 · Correlate',
					items: ['Which panels moved together, and which didn’t move at all?', 'Flat panels are evidence: they rule things out.', 'Segment: per host, AZ, partition, client version.']
				},
				{
					title: '4 · Causal chain',
					items: ['Write it as arrows: trigger → resource → symptom.', 'Check it with arithmetic ([[littles-law]], ratios, 1 of N).', 'Name the red herring and why it’s one.']
				},
				{
					title: '5 · Confirm',
					items: ['The single query or experiment that proves or kills it.', 'Mitigate now (rollback, flag off, shift traffic).', 'Fix properly, and the alert that would have fired first.']
				}
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'What graders look for',
			text: 'Specific times and numbers quoted from the panels, an explicit “this moved first”, at least one thing ruled out with evidence, and arithmetic that ties the trigger to the symptom. “Latency went up because of the database” scores nothing; “pool wait rose at 14:11, a minute before p99, while DB CPU stayed at 28%” scores well.'
		}
	],
	parts: [
		{
			id: 'grafana',
			nav: '1 · Grafana',
			eyebrow: 'Part 1 · 40 minutes · service metrics',
			title: 'Service dashboards',
			meta: 'Prometheus-style metrics · pools · CPU limits · caches · Kafka',
			minutes: 40,
			intro: [
				{
					type: 'p',
					text: 'Start with the [[red-method|RED]] panels (rate, errors, duration) to see what users feel, then walk the [[use-method|USE]] panels (utilization, [[saturation]], errors) of each resource on the path to find the bottleneck.'
				}
			],
			questions: [g1, g2, g3, g4]
		},
		{
			id: 'kibana',
			nav: '2 · Kibana',
			eyebrow: 'Part 2 · 40 minutes · log investigations',
			title: 'Log search and histograms',
			meta: 'histogram shape · field breakdowns · missing logs',
			minutes: 40,
			intro: [
				{
					type: 'list',
					items: [
						'**Shape of the histogram first:** step (deploy/config), periodic (TTL, cron, token lifetime), ramp (growth, leak), cliff to zero (pipeline, not traffic).',
						'**Then break down by a field**: host, pod, version, tenant. Bugs that affect “some users” almost always split cleanly on one field.',
						'**Read the structured fields**, not just the message. The answer is often in `token_age_s` or `client.app_version`.'
					]
				}
			],
			questions: [k1, k2, k3, k4]
		},
		{
			id: 'cloudwatch',
			nav: '3 · CloudWatch',
			eyebrow: 'Part 3 · 65 minutes · AWS',
			title: 'Managed-service limits nobody remembers',
			meta: 'RDS · Lambda · SQS · DynamoDB · ALB · NAT · AZs',
			minutes: 65,
			intro: [
				{
					type: 'callout',
					tone: 'info',
					title: 'Pattern',
					text: 'Most AWS incidents in these drills are a **hidden limit**: a credit balance, a per-partition ceiling, an account-wide pool, a per-destination port table, a timeout on one side of a connection. When a resource looks under-used but requests fail, look for the limit that applies to a *slice* of it.'
				}
			],
			questions: [c1, c2, c3, c4, c5, c6, c7]
		},
		{
			id: 'traces',
			nav: '4 · Traces',
			eyebrow: 'Part 4 · 40 minutes · waterfalls & heatmaps',
			title: 'Traces and heatmaps',
			meta: 'bimodal latency · fan-out · lock waits · hidden retries · gaps',
			minutes: 40,
			intro: [
				{
					type: 'list',
					items: [
						'In a waterfall, the **critical path** is the chain of spans the parent actually waited on. Optimizing anything off it changes nothing.',
						'**Gaps** inside a parent are uninstrumented time: pools, locks, GC, CPU.',
						'In a heatmap, a **second band** means a subset; a **rising band** means everything.'
					]
				}
			],
			questions: [t1, t2, t3, t4, t5]
		},
		{
			id: 'rapid',
			nav: 'Rapid fire',
			eyebrow: 'Rapid fire · 1–2 min each',
			title: 'Chart-reading traps',
			meta: 'ratios · percentiles · counters · log axes · sampling · missing data · stacking',
			minutes: 15,
			questions: [te1, te2, te3, te4, te5, te6, te7]
		}
	]
};

export default assessment;
