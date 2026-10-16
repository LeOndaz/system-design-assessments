import type { Assessment, Span } from '../types';
import { timeAxis, shape, step, ramp, bump, window_ } from '../series';

// ───────────────────────── chart data ─────────────────────────

// p1q1 · rebalance storm
const rbX = timeAxis('09:00', 60);
const rbFraud = shape(60, { base: 80, noise: 0.1, seed: 11 }, step(20, 900));
const rbBatch = shape(60, { base: 40, noise: 0.08, seed: 12 }, step(21, 450));
const rbRebalances = rbX.map((_, i) => (i >= 26 && (i - 26) % 6 === 0 ? 4 : i >= 26 && (i - 26) % 6 === 1 ? 2 : 0));
const rbLag = shape(60, { base: 2000, noise: 0.06, seed: 13 }, ramp(24, 60, 2000, 320000));
const rbConsumed = shape(60, { base: 1200, noise: 0.06, seed: 14 }, step(24, 240));
const rbProduced = shape(60, { base: 1200, noise: 0.05, seed: 15 });
const rbBrokerCpu = shape(60, { base: 31, noise: 0.05, seed: 16 }, ramp(24, 30, 31, 46));

// p1q2 · hot partition
const hpX = timeAxis('12:00', 48, 5);
const hpLag = (seed: number) => shape(48, { base: 300, noise: 0.4, seed });
const hpLag3 = shape(48, { base: 300, noise: 0.05, seed: 27 }, ramp(9, 48, 300, 880000));
const hpCpuAvg = shape(48, { base: 33, noise: 0.06, seed: 28 }, step(14, 18));

// p1q3 · retries through the mesh
const mrX = timeAxis('16:00', 40);
const mrFront = shape(40, { base: 400, noise: 0.04, seed: 31 });
const mrInv = shape(40, { base: 410, noise: 0.05, seed: 32 }, ramp(12, 16, 410, 3650));
const mrInvP99 = shape(40, { base: 140, noise: 0.08, seed: 33 }, ramp(10, 14, 140, 1000));
const mrDbPool = shape(40, { base: 4, noise: 0.2, seed: 34 }, ramp(10, 16, 4, 50), (i, v) => Math.min(v, 50));
const mrSpans: Span[] = [
	{ id: 'bff', service: 'web-bff', name: 'GET /cart/summary', start: 0, duration: 9480, error: true, note: '502 to browser after 3 attempts' }
];
for (let a = 0; a < 3; a++) {
	const s = a * 3160;
	mrSpans.push({ id: `c${a}`, parent: 'bff', service: 'cart-svc', name: `GetCart (bff attempt ${a + 1}/3)`, start: s + 10, duration: 3110, error: true });
	for (let t = 0; t < 3; t++)
		mrSpans.push({
			id: `i${a}${t}`,
			parent: `c${a}`,
			service: 'inventory-svc',
			name: `GetStock (mesh try ${t + 1}/3)`,
			start: s + 25 + t * 1030,
			duration: 1000,
			error: true,
			note: a === 0 && t === 0 ? 'UT: upstream request timeout (perTryTimeout 1s)' : undefined
		});
}

// p1q5 · deploys and 5xx
const gsX = timeAxis('14:00', 60);
const deploys = [12, 31, 48];
const near = (i: number) => deploys.some((d) => i >= d && i < d + 3);
const gs5xx = shape(60, { base: 0.08, noise: 0.3, seed: 51, round: 2 }, (i, v) => (near(i) ? v + 5.5 : v));
const gsReady = gsX.map((_, i) => (near(i) ? 10 : 12));
const gsCpuMax = shape(60, { base: 48, noise: 0.06, seed: 52 }, (i, v) => (near(i) ? 96 : v));
const gsP99 = shape(60, { base: 210, noise: 0.07, seed: 53 }, (i, v) => (near(i) ? v + 140 : v));

// p1q6 · probe restart loop
const lpX = timeAxis('03:10', 40);
const lpRestarts = lpX.map((_, i) => (i < 2 ? 0 : i < 4 ? 8 : i < 32 ? (i % 3 === 0 ? 8 : 0) : 0));
const lpDbConns = shape(40, { base: 180, noise: 0.05, seed: 61 }, window_(2, 3, 20), (i, v) => (i >= 3 && i < 32 && i % 3 === 1 ? 410 : v));
const lp5xx = shape(40, { base: 0.1, noise: 0.2, seed: 62, round: 1 }, window_(2, 32, 97));

// p1q7 · gRPC imbalance
const grX = timeAxis('11:00', 50);
const grOld = (seed: number) => shape(50, { base: 650, noise: 0.05, seed }, ramp(10, 30, 650, 1350));
const grNew = (seed: number) => [
	...Array(20).fill(null),
	...shape(30, { base: 12, noise: 0.4, seed })
] as (number | null)[];
const grP99 = shape(50, { base: 110, noise: 0.07, seed: 71 }, ramp(18, 34, 110, 520));
const grCpuOld = shape(50, { base: 45, noise: 0.04, seed: 72 }, ramp(10, 30, 45, 93));
const grCpuNew = [...Array(20).fill(null), ...shape(30, { base: 4, noise: 0.3, seed: 73 })] as (number | null)[];

// p1q10 · metastable
const msX = timeAxis('10:00', 60);
const msDb = shape(60, { base: 14, noise: 0.1, seed: 81 }, window_(5, 9, 2400));
const msOffered = shape(60, { base: 1000, noise: 0.04, seed: 82 }, ramp(5, 10, 1000, 3100), step(41, 1050));
const msGood = shape(60, { base: 1000, noise: 0.04, seed: 83 }, ramp(5, 8, 1000, 290), step(42, 990));
const msErr = shape(60, { base: 0.2, noise: 0.2, seed: 84, round: 1 }, ramp(5, 8, 0.2, 71), step(42, 0.3));
const msQueue = shape(60, { base: 3, noise: 0.3, seed: 85 }, ramp(5, 9, 3, 512), (i, v) => Math.min(v, 512), step(42, 4));
const msPods = msX.map((_, i) => (i < 20 ? 12 : i < 24 ? 12 + (i - 19) * 2 : 20));

// ───────────────────────── assessment ─────────────────────────

const assessment: Assessment = {
	id: 'microservices',
	number: 2,
	title: 'Microservices under pressure',
	tagline: 'Queues, sagas, meshes and the failures that only exist between services.',
	description:
		'Incidents that live in the gaps between services: [[dual-write|dual writes]], [[consumer-rebalance|rebalance storms]], retries multiplied by a [[service-mesh]], deadlines nobody propagated, deploys that drop requests. Then code-reading bug hunts in service code, an idempotent-consumer coding task, and rapid fire.',
	minutes: 125,
	difficulty: 'advanced',
	topics: ['messaging', 'kafka', 'sagas', 'outbox', 'service mesh', 'kubernetes', 'consistency'],
	overview: [
		{
			type: 'budget',
			items: [
				{ label: '1 · Incidents', minutes: 40 },
				{ label: '2 · Code reading', minutes: 30 },
				{ label: '3 · Coding', minutes: 45 },
				{ label: '4 · Rapid fire', minutes: 10 }
			]
		},
		{
			type: 'callout',
			tone: 'info',
			title: 'What a reviewer is grading',
			text: '**Can you reason across a boundary?** Single-service bugs are easy to localise. Here the evidence is spread across dashboards, traces and logs from different services, and the skill being scored is joining them: which signal is the *cause*, which is a *consequence*, and which is a coincidence.'
		},
		{
			type: 'list',
			items: [
				'**Incidents:** name the mechanism, not just the component ("batch time exceeds the poll interval, so the consumer is evicted", not "Kafka is slow"). Quote numbers from the panels.',
				'**Code reading:** every messaging bug has a *loss* direction and a *duplicate* direction. Say which one the code has, and what happens on a crash between any two lines.',
				'**Coding:** correctness under duplicates and reordering, then tests that prove it. Mention what happens on restart.',
				'**Always:** mitigate now (stop the bleeding) vs fix properly vs repair the data already damaged.'
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'The two questions to ask about any arrow between services',
			text: '"What happens if this message is **lost**?" and "What happens if it arrives **twice, or late**?" Most of this assessment is those two questions in disguise.'
		}
	],
	parts: [
		// ═════════════════════════ PART 1 ═════════════════════════
		{
			id: 'p1',
			nav: '1 · Incidents',
			eyebrow: 'Part 1 · 40 minutes · scenarios',
			title: 'Distributed incidents',
			meta: '[[kafka|Kafka]] · service mesh · [[kubernetes|Kubernetes]] · sagas',
			minutes: 40,
			intro: [
				{
					type: 'p',
					text: 'Each scenario gives you dashboards, traces or logs. Read them before you read the hints. At least one panel per dashboard is a red herring: a real change that is a *consequence* of the problem, not its cause.'
				},
				{
					type: 'cards',
					items: [
						{ title: 'Messaging', items: ['[[consumer-lag]] in messages vs in time', 'Rebalances, reprocessing, duplicates', '[[poison-message|Poison messages]] blocking a partition', 'Hot keys → one busy partition'] },
						{ title: 'Calls between services', items: ['Retries at several layers multiply', 'Timeouts that grow going *down* the stack', 'No [[deadline-propagation]] → wasted work', 'Long-lived connections ignore new pods'] },
						{ title: 'Platform', items: ['Probes that restart healthy pods', 'Deploys without [[graceful-shutdown]]', '[[dns-caching|Stale DNS]] after failover', '[[clock-skew]] on one node'] },
						{ title: 'Consistency', items: ['[[dual-write|Dual writes]] lose events', '[[saga|Sagas]] without durable compensation', 'Cache refilled from a lagging replica', 'Ordering by wall-clock time'] }
					]
				}
			],
			questions: [
				{
					id: 'p1q1',
					title: 'Lag climbs, throughput collapses, and orders ship twice',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'list',
							items: [
								'`order-fulfilment` consumes the `orders` topic (24 partitions, 8 consumers, `max.poll.records=500`, `max.poll.interval.ms=300000`). For each record it calls `fraud-api` synchronously, then writes a shipment.',
								'Warehouse reports some orders arrived twice. Nothing was deployed today.'
							]
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'order-fulfilment · consumer health',
								range: 'Today 09:00 – 10:00 UTC',
								filters: ['env=prod', 'group=order-fulfilment'],
								panels: [
									{ kind: 'stat', title: 'Produce rate', value: '1.2k/s', tone: 'ok', spark: rbProduced.slice(0, 30), span: 1 },
									{ kind: 'stat', title: 'Consume rate', value: '240/s', delta: '−80% vs 1h ago', tone: 'crit', spark: rbConsumed, span: 1 },
									{ kind: 'stat', title: 'Duplicate shipments', value: '1,842', delta: 'since 09:26', tone: 'crit', span: 1 },
									{ kind: 'timeseries', title: 'Consumer group lag', unit: '', x: rbX, series: [{ name: 'lag (messages)', points: rbLag, color: 1 }], area: true, span: 3 },
									{ kind: 'timeseries', title: 'fraud-api p99 (client side)', unit: ' ms', x: rbX, series: [{ name: 'p99', points: rbFraud, color: 2 }], span: 2 },
									{
										kind: 'timeseries',
										title: 'Poll-batch processing time (p99)',
										unit: ' s',
										x: rbX,
										series: [{ name: 'batch p99', points: rbBatch, color: 0 }],
										thresholds: [{ value: 300, label: '300 s', tone: 'crit' }],
										span: 2
									},
									{ kind: 'bars', title: 'Group rebalances / min', x: rbX, series: [{ name: 'rebalances', points: rbRebalances, color: 3 }], span: 2 },
									{ kind: 'timeseries', title: 'Broker CPU (avg of 3)', unit: '%', x: rbX, series: [{ name: 'cpu', points: rbBrokerCpu, color: 4 }], yMin: 0, yMax: 100, span: 2 }
								]
							}
						},
						{ type: 'p', text: '**Explain the chain of events, what the broker CPU rise means, and what you\'d change first.**' }
					],
					hints: [
						'Multiply `max.poll.records` by the fraud-api latency before and after 09:20.',
						'What does the broker do to a consumer that hasn\'t polled for 300 s, and what happens to the records it was halfway through?'
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: '**[[consumer-rebalance|Rebalance storm]]: batches now take longer than `max.poll.interval.ms`.**',
									body: 'Before 09:20: 500 records × 80 ms ≈ 40 s per batch. After `fraud-api` p99 jumped to ~900 ms: 500 × 0.9 s ≈ 450 s, above the 300 s threshold drawn on the batch panel. The broker evicts the consumer mid-batch, its partitions move to another member, which is just as slow and is evicted too. Rebalance bars start at ~09:26, a few minutes after the latency step, exactly one batch-length later. Consumption pauses during every rebalance, so consume rate drops 80% while produce rate is flat, and [[consumer-lag|lag]] grows linearly.',
									confirm: 'Consumer logs for `CommitFailedException` / "member … has left the group because the poll interval was exceeded"; group coordinator logs showing generation ids climbing every few minutes.'
								},
								{
									title: '**Duplicates are reprocessing of uncommitted batches.**',
									body: 'An evicted consumer had already written shipments for part of its batch but never committed the offsets, so the new owner starts from the last committed offset and ships them again. With [[at-least-once]] delivery that is expected behaviour; the bug is that the shipment write isn\'t [[idempotent-consumer|idempotent]].',
									confirm: 'Duplicate shipments share an `order_id` and were created by different consumer instances within minutes of a rebalance.'
								},
								{
									title: '**fraud-api is the trigger, not the root cause.**',
									body: 'Something will always get slow sometimes. The design flaw is a consumer whose batch time is unbounded because a synchronous call has no tight [[timeout]] or [[circuit-breaker]].',
									confirm: 'fraud-api\'s own server-side latency dashboard, to decide whether to page that team.'
								}
							]
						},
						{
							type: 'callout',
							tone: 'warn',
							title: 'Red herring: broker CPU',
							text: 'Broker CPU rose from ~31% to ~46%, but only *after* rebalances started. Rebalances make the coordinator and brokers do extra work (group syncs, re-fetching from older offsets). It\'s a consequence. Scaling brokers would change nothing.'
						},
						{
							type: 'p',
							text: '**Also wrong:** adding consumers. 24 partitions and 8 consumers leaves room, but every new member triggers another rebalance and each one is equally slow. You\'d make the storm worse.'
						},
						{
							type: 'p',
							text: '**Mitigate now:** drop `max.poll.records` to ~100 (100 × 0.9 s = 90 s, well under 300 s) and put a 300 ms timeout + circuit breaker on fraud-api with a fallback (queue for manual review). **Fix:** make shipment creation idempotent (unique constraint on `order_id`), process records concurrently within a batch with a bound, use cooperative rebalancing and static membership. **Remediate:** cancel the 1,842 duplicate shipments before they leave the warehouse; that\'s the most time-sensitive action of the lot.'
						}
					]
				},
				{
					id: 'p1q2',
					title: 'We doubled the consumers and nothing changed',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: '`events` topic has 6 partitions, keyed by `tenant_id`. Consumers do per-event enrichment. At 13:10 the on-call engineer scaled the consumer deployment from 6 to 12 replicas. Lag kept growing.'
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'events-enricher',
								range: 'Today 12:00 – 16:00',
								panels: [
									{
										kind: 'timeseries',
										title: 'Lag by partition',
										x: hpX,
										series: [
											{ name: 'p0', points: hpLag(21), color: 0 },
											{ name: 'p1', points: hpLag(22), color: 1 },
											{ name: 'p2', points: hpLag(23), color: 2 },
											{ name: 'p3', points: hpLag3, color: 3 },
											{ name: 'p4', points: hpLag(25), color: 4 },
											{ name: 'p5', points: hpLag(26), color: 5 }
										],
										markers: [{ at: 14, label: 'scaled 6 → 12' }],
										span: 4
									},
									{ kind: 'timeseries', title: 'Consumer CPU (avg)', unit: '%', x: hpX, series: [{ name: 'avg cpu', points: hpCpuAvg }], yMin: 0, yMax: 100, markers: [{ at: 14, label: 'scale' }], span: 2 },
									{
										kind: 'table',
										title: 'Consumers (now)',
										head: ['pod', 'partitions', 'CPU', 'records/s'],
										rows: [
											['enricher-0', 'p0', '21%', '380'],
											['enricher-1', 'p1', '19%', '350'],
											['enricher-2', 'p2', '22%', '400'],
											['enricher-3', 'p3', '99%', '410'],
											['enricher-4', 'p4', '18%', '330'],
											['enricher-5', 'p5', '20%', '360'],
											['enricher-6 … 11', '—', '1%', '0']
										],
										numeric: [2, 3],
										highlight: [3],
										span: 3
									},
									{
										kind: 'table',
										title: 'Top keys on p3 (last hour)',
										head: ['tenant_id', 'share of p3', 'events/s'],
										rows: [
											['northwind', '86%', '2,950'],
											['acme-labs', '6%', '205'],
											['others (41)', '8%', '270']
										],
										numeric: [1, 2],
										span: 3
									}
								]
							}
						},
						{ type: 'p', text: '**Why didn\'t scaling help, and what are your options?**' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: '**One hot key pins one partition to one consumer.**',
									body: 'Partition p3 receives ~3,400 events/s, 86% of them from `northwind`, but enricher-3 can only process ~410/s and is at 99% CPU. The [[partition-key]] is `tenant_id`, so every northwind event *must* go to p3, and a partition is read by exactly one member of a [[consumer-group]]. The other five partitions are keeping up.',
									confirm: 'Per-key produce rate over time: did northwind\'s volume jump around 12:45 (a bulk import or a new integration)?'
								},
								{
									title: '**Scaling beyond the partition count adds idle consumers.**',
									body: '6 partitions → at most 6 active consumers. enricher-6 … 11 have no partitions (0 records/s). The scale-out even caused a [[consumer-rebalance|rebalance]] that paused everyone briefly.'
								}
							]
						},
						{
							type: 'callout',
							tone: 'warn',
							title: 'Red herring: average CPU went *down*',
							text: 'Average consumer CPU fell from ~33% to ~18% after scaling, which looks like "we have headroom". Averages over pods hide the one pod at 99%. Always look at the max or per-pod breakdown when work is partitioned.'
						},
						{
							type: 'list',
							items: [
								'**Ask first: what ordering do you actually need?** If only per-entity ordering matters (per order, per user), key by that instead of tenant. Northwind\'s traffic then spreads across all partitions.',
								'**If per-tenant ordering is required for some event types,** split them: keep those on a tenant-keyed topic, move the rest to an entity-keyed topic.',
								'**Salting the [[hot-partition|hot key]]** (`northwind#0 … #7`) spreads load but breaks per-tenant ordering. Fine only if consumers don\'t need it.',
								'**Parallelise inside the partition:** the consumer fans records out to workers keyed by a finer id (per-key ordering preserved, partition ordering relaxed), committing only the contiguous completed prefix of offsets.',
								'**Adding partitions alone doesn\'t help:** northwind still hashes to one partition, and changing the partition count remaps keys, which temporarily breaks ordering for everyone.'
							]
						}
					]
				},
				{
					id: 'p1q3',
					title: 'Inventory got 9× the traffic of the website',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'p',
							text: 'At 16:12 the cart page started failing. Inventory\'s database got slow first. The mesh config has `retries: 2, perTryTimeout: 1s` on every route. `web-bff` also retries 5xx responses up to 2 times. Here\'s one failing trace and the inventory dashboard.'
						},
						{ type: 'trace', trace: { title: 'GET /cart/summary', traceId: '4bf92f3577b34da6', spans: mrSpans } },
						{
							type: 'dashboard',
							dashboard: {
								style: 'datadog',
								title: 'inventory-svc',
								range: '16:00 – 16:40',
								panels: [
									{
										kind: 'timeseries',
										title: 'Requests / s',
										unit: ' rps',
										x: mrX,
										series: [
											{ name: 'web-bff inbound (users)', points: mrFront, color: 0 },
											{ name: 'inventory-svc inbound', points: mrInv, color: 3 }
										],
										span: 3
									},
									{ kind: 'timeseries', title: 'inventory-svc p99', unit: ' ms', x: mrX, series: [{ name: 'p99', points: mrInvP99, color: 2 }], span: 3 },
									{
										kind: 'timeseries',
										title: 'inventory DB pool: connections in use',
										x: mrX,
										series: [{ name: 'in use', points: mrDbPool, color: 1 }],
										thresholds: [{ value: 50, label: 'pool max', tone: 'crit' }],
										span: 6
									}
								]
							}
						},
						{ type: 'p', text: '**How many calls does one user request generate at the bottom, and why did a slow database become a full outage?**' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: '**Retries at two layers multiply: 3 × 3 = 9.**',
									body: 'The trace shows it exactly: 3 bff attempts, each producing 3 mesh tries to inventory. The application and the [[service-mesh]] each retry without knowing about the other. Inventory inbound goes from ~410 rps to ~3,650 rps (≈ 9×) while real user traffic is flat at 400.',
									confirm: 'Inventory access logs: count requests sharing the same trace id / `x-request-id`.'
								},
								{
									title: '**The retries turned "slow" into "down".**',
									body: 'Inventory [[percentiles|p99]] approached 1 s, right at the per-try [[timeout|timeout]]. Every try that crossed 1 s was abandoned by the mesh but still ran to completion on the server, holding a DB connection. 9× load filled the 50-connection pool, so p99 pinned at the timeout and *every* try failed. Classic [[retry-storm]] leading to a [[cascading-failure]].',
									confirm: 'Server-side request duration vs client-side: the server keeps completing work the client already dropped.'
								},
								{
									title: '**Trigger:** whatever slowed the inventory DB at ~16:10 (a slow query, a vacuum, a lock).',
									body: 'Still worth finding, but it would have been a small latency bump without the amplification.'
								}
							]
						},
						{
							type: 'p',
							text: '**Mitigate now:** turn off retries in one layer (mesh retries on this route to 0, or bff retries), add a [[circuit-breaker]] on inventory with a cached/degraded response ("stock shown at checkout"). **Fix:** retry at exactly one layer, closest to the user who can make the decision; use a [[retry-budget]] and [[exponential-backoff]] with [[jitter]]; set per-try timeout above inventory\'s healthy p99.9, not at its p99; make the server stop work when the client has gone ([[deadline-propagation]]).'
						},
						{ type: 'callout', tone: 'info', text: 'Generalise: *k* layers each making 1 + *r* attempts → (1 + *r*)^*k* calls at the bottom. Three layers of "retry 3 times" is 64.' }
					]
				},
				{
					id: 'p1q4',
					title: 'The customer saw an error, but their card was charged',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'p',
							text: 'Users report: "checkout said something went wrong, so I tried again, and now I have two charges". Gateway [[timeout|timeout]] is 2 s. Each service sets its own client timeouts (pricing 5 s, payment 10 s).'
						},
						{
							type: 'trace',
							trace: {
								title: 'POST /checkout (first attempt)',
								traceId: '9a1c0e77d2',
								spans: [
									{ id: 'gw', service: 'api-gateway', name: 'POST /checkout', start: 0, duration: 2000, error: true, note: '504 Gateway Timeout returned to client at 2000 ms' },
									{ id: 'ord', parent: 'gw', service: 'order-svc', name: 'PlaceOrder', start: 12, duration: 6820 },
									{ id: 'inv', parent: 'ord', service: 'inventory-svc', name: 'Reserve', start: 30, duration: 360 },
									{ id: 'pr', parent: 'ord', service: 'pricing-svc', name: 'Quote', start: 400, duration: 3900, note: 'slow: promo rules cache cold' },
									{ id: 'pay', parent: 'ord', service: 'payment-svc', name: 'Authorize', start: 4320, duration: 2100, note: 'card authorized: auth_8812' },
									{ id: 'ok', parent: 'ord', service: 'order-svc', name: 'commit order', start: 6440, duration: 380 }
								]
							}
						},
						{
							type: 'logs',
							logs: {
								style: 'kibana',
								query: 'customer_id:c_51022 AND service:(api-gateway OR payment-svc)',
								lines: [
									{ ts: '18:04:11.002', level: 'INFO', source: 'api-gateway', msg: 'POST /checkout start', fields: { trace: '9a1c0e77d2' } },
									{ ts: '18:04:13.002', level: 'WARN', source: 'api-gateway', msg: 'upstream timeout, returning 504', fields: { trace: '9a1c0e77d2' } },
									{ ts: '18:04:15.330', level: 'INFO', source: 'payment-svc', msg: 'authorization approved', fields: { trace: '9a1c0e77d2', auth: 'auth_8812', amount: 8450 } },
									{ ts: '18:04:16.910', level: 'INFO', source: 'api-gateway', msg: 'POST /checkout start', fields: { trace: 'f03b51a9e4' } },
									{ ts: '18:04:18.440', level: 'INFO', source: 'payment-svc', msg: 'authorization approved', fields: { trace: 'f03b51a9e4', auth: 'auth_8813', amount: 8450 } },
									{ ts: '18:04:18.700', level: 'INFO', source: 'api-gateway', msg: 'POST /checkout 201', fields: { trace: 'f03b51a9e4' } }
								]
							}
						},
						{ type: 'p', text: '**What are the two separate bugs here, and how do you fix each?**' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: '**No [[deadline-propagation]]: the backend kept working after the client was told it failed.**',
									body: 'The gateway gave up at 2,000 ms. `order-svc` didn\'t know and carried on for another ~4.8 s, including [[auth-and-capture|authorising the card]] at 4,320 ms, *after* the user had already seen an error. Timeouts are inverted: inner timeouts (5 s, 10 s) are longer than the outer one (2 s), so the inner calls can never usefully finish in time.',
									confirm: 'Count traces where a span with side effects starts after the root span has ended.'
								},
								{
									title: '**The retry isn\'t idempotent.**',
									body: 'The browser\'s second attempt is a brand new request (`f03b51a9e4`) with nothing tying it to the first, so payment authorised again (`auth_8813`). A timeout means *unknown outcome*, and the retry has no [[idempotency-key]].',
									confirm: 'Payment provider: more than one authorization per cart within a few seconds.'
								}
							]
						},
						{
							type: 'list',
							items: [
								'**Fix 1:** gateway sends an absolute deadline; each service sets downstream timeouts to `min(own, remaining − margin)` and checks the deadline **before any side effect** ("don\'t authorise if < 500 ms remain"). Inner timeouts shorter than outer.',
								'**Fix 2:** the client generates a checkout idempotency key once per cart submission and re-sends it on retry; order-svc and payment-svc dedupe on it and return the original result.',
								'**Also:** long-running steps like payment are better async: return `202 Accepted` with an order id and let the UI poll, instead of holding a 2 s HTTP request open.',
								'**Remediate:** find carts with multiple authorizations and void the extra ones before they capture (authorizations usually capture later, so there\'s a window to fix this without refunds).'
							]
						}
					]
				},
				{
					id: 'p1q5',
					title: 'Every deploy causes a burst of 502s',
					tag: 'core',
					minutes: 4,
					prompt: [
						{ type: 'p', text: '[[rolling-update|Rolling deploys]] of `api` (12 pods, `maxUnavailable: 2`). Each deploy produces ~90 seconds of 502/503 errors. A teammate thinks new pods are being sent traffic before they\'re warm.' },
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'api · ingress',
								range: '14:00 – 15:00',
								panels: [
									{ kind: 'timeseries', title: '5xx ratio at ingress', unit: '%', x: gsX, series: [{ name: '5xx %', points: gs5xx, color: 3 }], markers: deploys.map((d, k) => ({ at: d, label: `deploy ${k + 1}` })), span: 6 },
									{ kind: 'timeseries', title: 'Ready pods', x: gsX, series: [{ name: 'ready', points: gsReady }], yMin: 0, yMax: 14, span: 2 },
									{ kind: 'timeseries', title: 'CPU (max pod)', unit: '%', x: gsX, series: [{ name: 'max cpu', points: gsCpuMax, color: 1 }], yMin: 0, yMax: 100, span: 2 },
									{ kind: 'timeseries', title: 'p99 latency', unit: ' ms', x: gsX, series: [{ name: 'p99', points: gsP99, color: 2 }], span: 2 }
								]
							}
						},
						{
							type: 'logs',
							logs: {
								style: 'kibana',
								query: 'kubernetes.namespace:api AND (level:ERROR OR message:SIGTERM)',
								lines: [
									{ ts: '14:12:03.118', level: 'INFO', source: 'api-6d9f-k2x8q', msg: 'Received SIGTERM, shutting down', fields: { pod_ip: '10.2.3.14' } },
									{ ts: '14:12:03.121', level: 'INFO', source: 'api-6d9f-k2x8q', msg: 'HTTP server closed', fields: { inflight: 37 } },
									{ ts: '14:12:03.402', level: 'ERROR', source: 'ingress-nginx', msg: 'upstream prematurely closed connection while reading response header', fields: { upstream: '10.2.3.14:8080' } },
									{ ts: '14:12:04.950', level: 'ERROR', source: 'ingress-nginx', msg: 'connect() failed (111: Connection refused) while connecting to upstream', fields: { upstream: '10.2.3.14:8080' } },
									{ ts: '14:12:06.233', level: 'ERROR', source: 'ingress-nginx', msg: 'connect() failed (111: Connection refused) while connecting to upstream', fields: { upstream: '10.2.3.14:8080' } },
									{ ts: '14:12:07.880', level: 'INFO', source: 'api-7b21-vv9pd', msg: 'Ready: listening on :8080', fields: { pod_ip: '10.2.5.31', startup_ms: 4120 } }
								]
							}
						},
						{ type: 'p', text: '**Is the teammate right? What\'s actually happening?**' }
					],
					answer: [
						{
							type: 'p',
							text: '**No: the errors come from the pods that are *leaving*, not the ones arriving.** Every failing upstream in the logs is `10.2.3.14`, the pod that received SIGTERM. It closed its listener 3 ms after SIGTERM, dropping 37 in-flight requests ("prematurely closed"), and kept receiving new connections for several seconds afterwards ("connection refused").'
						},
						{
							type: 'list',
							items: [
								'In Kubernetes, SIGTERM and "remove from endpoints" happen **in parallel**. The endpoint change takes seconds to reach every ingress/kube-proxy, so traffic keeps arriving after SIGTERM.',
								'The app treats SIGTERM as "exit now" instead of starting a [[graceful-shutdown]].',
								'Keep-alive connections from the ingress to the dying pod are reset rather than closed cleanly.'
							]
						},
						{
							type: 'callout',
							tone: 'warn',
							title: 'Red herring: CPU spikes on new pods',
							text: 'The max-pod CPU spikes to ~96% on every deploy because new pods warm up (JIT, caches). It lines up with the errors in time, which is why it\'s tempting, but the [[readiness-probe|readiness probe]] already keeps unready pods out (startup 4 s, then "Ready"), and no error references a new pod\'s IP.'
						},
						{
							type: 'p',
							text: '**Fix:** a `preStop` [[prestop-hook|hook]] that sleeps ~10 s (keep serving while endpoint removal propagates); on SIGTERM fail readiness, stop accepting new connections, send `Connection: close` on responses, wait for in-flight to finish, then exit; `terminationGracePeriodSeconds` larger than preStop + longest request; `maxUnavailable: 0, maxSurge: 2` so capacity never dips. **Test it:** run a load test during a deploy and assert zero 5xx.'
						}
					]
				},
				{
					id: 'p1q6',
					title: 'A 40-second database failover became a 30-minute outage',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'logs',
							logs: {
								style: 'terminal',
								title: 'kubectl get events + api logs (merged)',
								lines: [
									{ ts: '03:12:04', level: 'WARN', source: 'rds', msg: 'Multi-AZ failover started for orders-db' },
									{ ts: '03:12:15', level: 'WARN', source: 'kubelet', msg: 'api-5c7d-a: Liveness probe failed: HTTP probe failed with statuscode: 503 (GET /healthz: db ping timeout)' },
									{ ts: '03:12:15', level: 'WARN', source: 'kubelet', msg: 'api-5c7d-b … api-5c7d-h: Liveness probe failed (7 more pods, same reason)' },
									{ ts: '03:12:35', level: 'INFO', source: 'kubelet', msg: 'Container api failed liveness probe, will be restarted (8 pods)' },
									{ ts: '03:12:44', level: 'INFO', source: 'rds', msg: 'Failover complete' },
									{ ts: '03:12:50', level: 'INFO', source: 'api', msg: 'Starting… opening pool (size 50), warming product cache (1.2M rows)' },
									{ ts: '03:13:21', level: 'WARN', source: 'kubelet', msg: 'Liveness probe failed: Get "http://10.2.1.7:8080/healthz": context deadline exceeded (Client.Timeout 1s)' },
									{ ts: '03:13:41', level: 'INFO', source: 'kubelet', msg: 'Container api failed liveness probe, will be restarted (8 pods)' },
									{ ts: '03:14:30', level: 'WARN', source: 'kubelet', msg: 'Back-off restarting failed container (CrashLoopBackOff)' },
									{ ts: '03:41:02', level: 'INFO', source: 'oncall', msg: 'liveness probe disabled via kubectl patch; all pods Ready at 03:43' }
								]
							}
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'api + orders-db',
								range: '03:10 – 03:50',
								panels: [
									{ kind: 'bars', title: 'Container restarts', x: lpX, series: [{ name: 'restarts', points: lpRestarts, color: 3 }], span: 2 },
									{ kind: 'timeseries', title: 'DB connections', x: lpX, series: [{ name: 'connections', points: lpDbConns, color: 1 }], thresholds: [{ value: 400, label: 'max_connections', tone: 'crit' }], span: 2 },
									{ kind: 'timeseries', title: 'api 5xx', unit: '%', x: lpX, series: [{ name: '5xx', points: lp5xx, color: 3 }], span: 2 }
								]
							}
						},
						{ type: 'p', text: '**Explain why the outage outlived the [[failover|failover]] by half an hour.**' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: '**The [[liveness-probe]] checks the database.**',
									body: 'During the failover, `/healthz` returned 503 because the DB ping failed, so Kubernetes concluded every pod was broken and killed all 8 at the same moment. A healthy process was restarted because a *dependency* was down.',
									confirm: 'Read the `/healthz` handler; it pings the DB.'
								},
								{
									title: '**Then synchronized cold starts kept failing the probe.**',
									body: 'All 8 pods restarted together, each opened 50 connections at once (8 × 50 = 400 → the DB connection spikes hitting `max_connections`) and ran a heavy cache warm-up. Startup took longer than the liveness delay + 1 s timeout, so they were killed again mid-warm-up, every ~70 s, until [[crashloopbackoff|CrashLoopBackOff]] spaced them out further. The system had been pushed into a self-sustaining failure loop ([[metastable-failure]]).',
									confirm: 'Restart bars repeat every ~3 points; connection spikes coincide with each restart wave.'
								}
							]
						},
						{
							type: 'list',
							items: [
								'**Liveness** = "is this process wedged?" Check only in-process things (event loop responsive, not deadlocked). Never a shared dependency.',
								'**[[readiness-probe|Readiness]]** may consider dependencies, but think about what happens when *all* pods fail it together: zero endpoints. Often better to stay ready and return fast errors or degraded responses.',
								'**[[startup-probe|Startup probe]]** with a generous budget for warm-up, so liveness doesn\'t apply until the app has started.',
								'Lazy or background cache warm-up; jittered startup; smaller initial pool sizes.'
							]
						}
					]
				},
				{
					id: 'p1q7',
					title: 'Autoscaler added pods; the old ones are still melting',
					tag: 'tricky',
					minutes: 4,
					prompt: [
						{ type: 'p', text: '`recommendations` is a [[grpc|gRPC]] service called by `web-bff`. [[horizontal-pod-autoscaler|HPA]] scaled it from 3 to 6 pods at 11:20 when CPU passed 70%. Latency kept rising. `kubectl get endpoints` shows 6 ready pods.' },
						{
							type: 'dashboard',
							dashboard: {
								style: 'datadog',
								title: 'recommendations-grpc',
								range: '11:00 – 11:50',
								filters: ['service:recommendations', 'env:prod'],
								panels: [
									{
										kind: 'timeseries',
										title: 'Requests / s by pod',
										unit: ' rps',
										x: grX,
										series: [
											{ name: 'pod-a', points: grOld(74), color: 0 },
											{ name: 'pod-b', points: grOld(75), color: 1 },
											{ name: 'pod-c', points: grOld(76), color: 2 },
											{ name: 'pod-d (new)', points: grNew(77), color: 3 },
											{ name: 'pod-e (new)', points: grNew(78), color: 4 },
											{ name: 'pod-f (new)', points: grNew(79), color: 5 }
										],
										markers: [{ at: 20, label: 'HPA 3 → 6' }],
										span: 4
									},
									{ kind: 'stat', title: 'Ready replicas', value: '6 / 6', tone: 'ok', span: 1 },
									{ kind: 'stat', title: 'Client p99', value: '520 ms', delta: '+370%', tone: 'crit', spark: grP99, span: 1 },
									{
										kind: 'timeseries',
										title: 'CPU by pod',
										unit: '%',
										x: grX,
										series: [
											{ name: 'old pods (avg)', points: grCpuOld, color: 1 },
											{ name: 'new pods (avg)', points: grCpuNew, color: 3 }
										],
										yMin: 0,
										yMax: 100,
										span: 6
									}
								]
							}
						},
						{ type: 'p', text: '**Why is the traffic not moving to the new pods?**' }
					],
					answer: [
						{
							type: 'p',
							text: '**gRPC runs on HTTP/2, which multiplexes all requests over a few [[http2-connection-reuse|long-lived connections]].** A Kubernetes ClusterIP Service balances at [[l4-vs-l7-load-balancing|L4]], i.e. *per connection*, when the connection is opened. `web-bff` opened its connections to pods a–c hours ago and never needs to open new ones, so pods d–f get only the occasional new connection (~12 rps). Endpoints are ready; nobody is using them.'
						},
						{
							type: 'callout',
							tone: 'warn',
							title: 'Red herrings',
							text: '"6/6 ready" and the HPA scaling correctly are both true and irrelevant: [[autoscaling]] worked, load balancing didn\'t. Also note the HPA is now *misled*: average CPU across 6 pods is ~48%, so it won\'t scale further, while the three pods doing all the work sit at 93%.'
						},
						{
							type: 'list',
							items: [
								'**Now:** restart `web-bff` (rolling) so it reconnects and spreads connections across all 6.',
								'**Fix options:** client-side load balancing over a headless Service (gRPC `round_robin` with DNS re-resolution); L7 balancing in a [[service-mesh]] or proxy that balances per request; or server-side `MaxConnectionAge` (e.g. 5 min + jitter) so clients reconnect periodically and pick up new pods.',
								'Same issue appears with HTTP keep-alive pools, database connection pools behind a proxy, and WebSockets.'
							]
						}
					]
				},
				{
					id: 'p1q8',
					title: 'After the failover, billing recovered in 30 s. Orders took 40 minutes.',
					tag: 'core',
					minutes: 4,
					prompt: [
						{ type: 'p', text: 'Managed Postgres failed over at 03:12. The DB hostname is unchanged; it now resolves to a new IP. `billing-api` (Python) recovered almost immediately. `orders-api` (Java, [[connection-pool|HikariCP]]) kept failing until someone restarted it at 03:52.' },
						{
							type: 'logs',
							logs: {
								style: 'kibana',
								query: 'message:("Connection refused" OR "connection established") AND db.host:orders-db.internal',
								histogram: {
									x: timeAxis('03:10', 44),
									counts: [0, 0, 41, 66, 62, 58, 61, 60, 59, 63, 61, 60, 58, 62, 59, 61, 60, 62, 58, 59, 61, 60, 63, 60, 58, 61, 62, 59, 60, 61, 58, 60, 62, 59, 61, 60, 58, 61, 60, 59, 61, 60, 2, 0],
									errors: [0, 0, 41, 66, 62, 58, 61, 60, 59, 63, 61, 60, 58, 62, 59, 61, 60, 62, 58, 59, 61, 60, 63, 60, 58, 61, 62, 59, 60, 61, 58, 60, 62, 59, 61, 60, 58, 61, 60, 59, 61, 60, 0, 0]
								},
								total: '2,431 hits',
								lines: [
									{ ts: '03:12:20.551', level: 'ERROR', source: 'billing-api', msg: 'could not connect to server: Connection refused', fields: { resolved_ip: '10.0.4.17' } },
									{ ts: '03:12:51.020', level: 'INFO', source: 'billing-api', msg: 'connection established', fields: { resolved_ip: '10.0.7.88' } },
									{ ts: '03:13:02.114', level: 'ERROR', source: 'orders-api', msg: 'HikariPool-1 - Connection is not available, request timed out after 30000ms', fields: { resolved_ip: '10.0.4.17' } },
									{ ts: '03:31:47.902', level: 'ERROR', source: 'orders-api', msg: 'java.net.ConnectException: Connection refused', fields: { resolved_ip: '10.0.4.17' } },
									{ ts: '03:51:58.330', level: 'ERROR', source: 'orders-api', msg: 'java.net.ConnectException: Connection refused', fields: { resolved_ip: '10.0.4.17' } },
									{ ts: '03:52:40.006', level: 'INFO', source: 'orders-api', msg: 'HikariPool-1 - Start completed', fields: { resolved_ip: '10.0.7.88' } }
								]
							}
						},
						{ type: 'p', text: '**What\'s different about orders-api, and how do you prevent it?**' }
					],
					answer: [
						{
							type: 'p',
							text: '**[[dns-caching|Stale DNS]].** The `resolved_ip` field gives it away: billing-api re-resolved to `10.0.7.88` within 30 s; orders-api kept dialling the old primary `10.0.4.17` for 40 minutes, even for *new* connections. The JVM caches successful DNS lookups in-process (`networkaddress.cache.ttl`; some setups and older versions cache forever), ignoring the record\'s [[ttl|TTL]]. The restart cleared the cache.'
						},
						{
							type: 'list',
							items: [
								'Set `networkaddress.cache.ttl` to a few seconds (in `java.security` or `-Dsun.net.inetaddr.ttl`), below the DNS record\'s TTL.',
								'Configure the pool to validate and recycle connections: `maxLifetime`, connection test on borrow, short connect timeout, so dead sockets are dropped quickly.',
								'Use the cloud provider\'s JDBC wrapper or a proxy (RDS Proxy / [[pgbouncer|PgBouncer]]) that handles failover.',
								'**Test failover regularly** in staging and record time-to-recover per service. The fact that one service recovered and another didn\'t is only discovered by drills or incidents.'
							]
						}
					]
				},
				{
					id: 'p1q9',
					title: 'Random 401s, but only from some pods',
					tag: 'core',
					minutes: 3,
					prompt: [
						{ type: 'p', text: 'About 4% of API requests fail with 401 right after login. Retrying usually works. Tokens are JWTs issued by `auth-svc` with a 15-minute expiry.' },
						{
							type: 'logs',
							logs: {
								style: 'kibana',
								query: 'service:api AND status:401',
								lines: [
									{ ts: '10:41:07.112', level: 'WARN', source: 'api-8f2-kq', msg: 'JWT rejected: token used before issued', fields: { node: 'ip-10-0-3-44', iat: 1792154467, now: 1792154463 } },
									{ ts: '10:41:07.390', level: 'WARN', source: 'api-8f2-zt', msg: 'JWT rejected: token used before issued', fields: { node: 'ip-10-0-3-44', iat: 1792154467, now: 1792154463 } },
									{ ts: '10:41:09.004', level: 'WARN', source: 'api-8f2-kq', msg: 'JWT rejected: token used before issued', fields: { node: 'ip-10-0-3-44', iat: 1792154469, now: 1792154465 } },
									{ ts: '10:41:12.551', level: 'WARN', source: 'api-8f2-zt', msg: 'JWT rejected: token used before issued', fields: { node: 'ip-10-0-3-44', iat: 1792154472, now: 1792154468 } },
									{ ts: '10:40:58.000', level: 'ERROR', source: 'chronyd@ip-10-0-3-44', msg: 'No suitable source for synchronisation (since 2 days)' }
								]
							}
						},
						{ type: 'p', text: '**Root cause, and what else is probably broken on that node?**' }
					],
					answer: [
						{
							type: 'p',
							text: '**[[clock-skew]] on one node.** Every rejection comes from pods on `ip-10-0-3-44`, and `now` is consistently 4 s behind `iat`. chronyd on that node lost its time source two days ago and the clock has drifted. Fresh tokens look like they were issued in the future, and the library has zero leeway. Retries succeed because they usually land on a pod on another node (or a few seconds later).'
						},
						{
							type: 'list',
							items: [
								'**Now:** [[cordon-and-drain|cordon and drain]] the node; fix time sync (security groups blocking [[ntp|NTP]]? removed time source?). Alert on clock offset per node.',
								'**Fix:** allow ~30–60 s leeway when validating `iat`/`nbf`/[[jwt|exp]].',
								'**Also likely broken on that node:** anything comparing its timestamps to others: "[[last-writer-wins|last write wins]]" conflict resolution, [[distributed-lock]] lease expiry, cache [[ttl|TTLs]] set by absolute time, log ordering across services, signed URL / webhook signature timestamp checks, and events ordered by `created_at`.'
							]
						}
					]
				},
				{
					id: 'p1q10',
					title: 'The database recovered at 10:09. The site didn\'t.',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'storefront-api · overview',
								range: '10:00 – 11:00',
								panels: [
									{
										kind: 'timeseries',
										title: 'Requests / s',
										unit: ' rps',
										x: msX,
										series: [
											{ name: 'offered (incl. retries)', points: msOffered, color: 1 },
											{ name: 'succeeded', points: msGood, color: 0 }
										],
										markers: [{ at: 5, label: 'DB failover' }, { at: 9, label: 'DB healthy' }, { at: 20, label: 'scale 12 → 20' }, { at: 41, label: 'edge rate limit' }],
										span: 6
									},
									{ kind: 'timeseries', title: 'DB p99', unit: ' ms', x: msX, series: [{ name: 'db p99', points: msDb, color: 2 }], log: true, span: 2 },
									{ kind: 'timeseries', title: 'Error ratio', unit: '%', x: msX, series: [{ name: 'errors', points: msErr, color: 3 }], yMin: 0, yMax: 100, span: 2 },
									{ kind: 'timeseries', title: 'Worker queue depth (max pod)', x: msX, series: [{ name: 'queued', points: msQueue, color: 4 }], thresholds: [{ value: 512, label: 'queue cap' }], span: 2 },
									{ kind: 'timeseries', title: 'Pods', x: msX, series: [{ name: 'pods', points: msPods, color: 5 }], yMin: 0, span: 6 }
								]
							}
						},
						{ type: 'p', text: 'Clients: mobile apps retry failed requests 2× immediately; web retries 2× with 1 s delay. **Why did the outage persist for 30 minutes after the trigger was gone? What would you have done at 10:12?**' }
					],
					answer: [
						{
							type: 'p',
							text: '**A [[metastable-failure]]: retries sustained the overload after the trigger ended.** The DB failover (10:05–10:09) caused timeouts; clients retried, so offered load tripled (~1,000 → ~3,100 rps) while success dropped to ~290 rps. Once the queue (512) was full, every request waited behind hundreds of others and exceeded the client\'s timeout, so it failed and was retried, keeping offered load at 3×. Healthy DB, healthy pods, nothing completing in time.'
						},
						{
							type: 'list',
							items: [
								'**Evidence:** DB p99 back to ~14 ms at 10:09 while error ratio stays ~70% until 10:42; queue pinned at its cap; recovery happens exactly when the edge rate limit cuts offered load, not when anything is "fixed".',
								'**Red herring 1:** the DB. It caused the trigger but wasn\'t why the outage lasted. Teams that keep staring at the original cause lose 30 minutes.',
								'**Red herring 2:** scaling 12 → 20 at 10:20 did nothing. 20 pods × 512-deep queues just means more queued requests that are already doomed; the excess offered load is retries, which grow with failures.'
							]
						},
						{
							type: 'p',
							text: '**At 10:12:** [[load-shedding|shed load]] at the edge ([[rate-limiting|rate-limit]] to ~1,100 rps, return 503 fast with `Retry-After`), flush queues; ramp up after [[goodput|goodput]] recovers. **Fix:** bounded queues with a queue timeout (drop requests older than the client timeout), LIFO-ish dequeue under overload, client [[retry-budget|retry budgets]] with [[exponential-backoff]] and [[jitter]], [[circuit-breaker|circuit breakers]] in the apps.'
						}
					]
				},
				{
					id: 'p1q11',
					title: 'Support: "charged, but the order says cancelled"',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'slack',
								from: 'Maya',
								role: 'Support team lead',
								time: 'Thu 11:40',
								body: 'Hey, we\'re getting a weird cluster of complaints since yesterday afternoon. Customers say their order page says "Cancelled – item out of stock" and they got the cancellation email, but their bank shows the money was taken. Some say they waited a day and it\'s still not back.\n\nI checked a few in the admin panel and the orders do say cancelled. Is the refund just slow? What should I tell them? We\'re at about 60 tickets.',
								thread: [{ from: 'Maya', time: '11:43', body: 'Oh and it seems to be mostly the sneaker drop from yesterday, if that helps.' }]
							}
						},
						{
							type: 'code',
							lang: 'python',
							caption: 'The checkout orchestrator, simplified.',
							code: `def checkout(order):
    payment = payments.capture(order.id, order.total_cents)
    try:
        inventory.reserve(order.id, order.items)
    except OutOfStock:
        order.status = "cancelled"
        db.save(order)
        emails.send_cancellation(order)
        try:
            payments.refund(payment.id)
        except Exception:
            log.exception("refund failed")
        return
    order.status = "confirmed"
    db.save(order)`
						},
						{ type: 'p', text: '**Find the bug, then write (a) the clarifying questions you\'d send back, (b) a reply to Maya.**' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: '**The [[saga]]\'s compensation is fire-and-forget.**',
									body: 'If `refund()` fails (payments API slow or rate-limited during a traffic spike, exactly what a sneaker drop causes), the exception is logged and dropped. Nothing ever retries the refund. The order is already marked cancelled and the email already sent, so to every system it looks finished.',
									confirm: 'Search logs for "refund failed" since yesterday, join on order id with the ticket list.'
								},
								{
									title: '**Step order makes it worse.**',
									body: 'Payment is captured *before* stock is reserved, so every out-of-stock order needs a compensation. Reserving first (cheap to undo) and capturing last means the compensation is rarely needed, and is "release a reservation", not "move money back".'
								},
								{
									title: '**A refund that *did* time out may have gone through.**',
									body: 'A blind retry could refund twice. Retries need an [[idempotency-key]] like `refund-{order_id}`.'
								}
							]
						},
						{
							type: 'p',
							text: '**Fix:** persist saga state (`refund_pending`) in the same transaction as the cancellation; a worker retries pending refunds with backoff until the provider confirms; send the "refunded" email only after confirmation; alert on refunds pending > 1 h. Reorder: reserve → capture. **Remediate:** list cancelled orders with a captured payment and no refund, and refund them via a reviewed script (dry run first).'
						},
						{ type: 'heading', text: '(a) Clarifying questions' },
						{
							type: 'list',
							items: [
								'Can you share 3–5 order numbers? (Lets me pull the exact logs.)',
								'Does the bank show it as "pending" or as a completed payment? (Authorization vs capture.)',
								'Has anyone received a refund for a cancelled sneaker-drop order, or none at all?'
							]
						},
						{ type: 'heading', text: '(b) Reply to Maya' },
						{
							type: 'code',
							lang: 'text',
							code: `Thanks Maya, this is a real bug on our side, not a slow refund.

During yesterday's sneaker drop, some orders were cancelled because the
item sold out, but the automatic refund didn't go through for some of
them, and our system didn't try again.

We're refunding every affected order today. Customers should see the
money back in 3–5 business days, depending on their bank. We're also
fixing it so this can't happen silently again.

What to tell customers: "You're right, the item sold out and we
cancelled your order, but our refund didn't go through. We've now
issued it; you'll see it within 3–5 business days. Sorry for the hassle."

I'll send you the full list of affected orders by 3pm so you can
reply to the tickets proactively.`
						}
					]
				}
			]
		},

		// ═════════════════════════ PART 2 ═════════════════════════
		{
			id: 'p2',
			nav: '2 · Code',
			eyebrow: 'Part 2 · 30 minutes · code reading',
			title: 'Bug hunts in service code',
			meta: 'outbox · consumers · locks · schemas · caches',
			minutes: 30,
			intro: [
				{
					type: 'callout',
					tone: 'info',
					title: 'The crash-between-lines drill',
					text: 'For every snippet, put your finger between each pair of lines and ask: "the process is killed *here*. What state is each system in? What happens on restart?" Then ask "what if this runs twice at the same time?" Those two passes find most of these bugs.'
				}
			],
			questions: [
				{
					id: 'p2q1',
					title: '"0.3% of orders never reach the warehouse"',
					tag: 'core',
					group: 'Bug hunts',
					prompt: [
						{ type: 'p', text: 'Missing orders cluster around [[message-queue|broker]] maintenance windows and deploys. No errors are logged.' },
						{
							type: 'code',
							lang: 'python',
							code: `@app.post("/orders")
def create_order(req):
    order = Order.create(customer_id=req.customer_id, items=req.items)
    db.session.commit()
    producer.send("orders", key=order.id, value=order.to_event())
    return {"id": order.id}, 201`
						}
					],
					answer: [
						{
							type: 'p',
							text: '**A [[dual-write]].** The DB commit and the publish are two separate operations. Specifically, `producer.send` in most Kafka clients is asynchronous: it puts the message into an in-memory buffer and returns immediately. The request returns 201 before the broker has the message.'
						},
						{
							type: 'list',
							items: [
								'**Broker maintenance:** the buffered send fails after retries are exhausted; the failure goes to a callback nobody registered, so nothing is logged.',
								'**Deploys:** the pod gets SIGTERM and exits without `producer.flush()`; buffered messages vanish.',
								'**Crash between commit and send:** order exists, event never sent.'
							]
						},
						{
							type: 'p',
							text: '**Fix:** [[transactional-outbox]]: insert the event into an `outbox` table inside the same transaction as the order; a relay (or [[change-data-capture|CDC]]) publishes it. Consumers dedupe on event id. Short-term: `send(...).get(timeout=5)` and flush on shutdown narrows the window but can\'t close it. **Remediate:** reconcile orders vs warehouse shipments since the code shipped and republish the missing ones.'
						}
					]
				},
				{
					id: 'p2q2',
					title: '"About 1 in 20,000 outbox events is never published"',
					tag: 'tricky',
					group: 'Bug hunts',
					prompt: [
						{ type: 'p', text: 'The team adopted the [[transactional-outbox|outbox pattern]] after the previous bug. The relay never logs an error. The missing events are always ones whose transaction took a long time.' },
						{
							type: 'code',
							lang: 'python',
							code: `def relay():
    last_id = state.get("last_id", 0)
    while True:
        rows = db.fetch(
            "SELECT id, topic, key, payload FROM outbox "
            "WHERE id > %s ORDER BY id LIMIT 500", last_id)
        for r in rows:
            broker.publish(r.topic, key=r.key, value=r.payload)
            last_id = r.id
        state.set("last_id", last_id)
        time.sleep(0.2)`
						}
					],
					hints: ['When is `id` assigned: at insert or at commit?'],
					answer: [
						{
							type: 'p',
							text: '**IDs are allocated when a row is inserted, but rows become visible when the transaction commits, and those orders differ.** Transaction A inserts outbox id 41 and then keeps working for 2 s. Meanwhile transaction B inserts id 42 and commits. The relay sees 42, publishes it and advances `last_id` to 42. A commits; row 41 is now visible but `id > 42` will never select it.'
						},
						{
							type: 'table',
							head: ['t', 'Txn A', 'Txn B', 'Relay'],
							rows: [
								['0', 'INSERT → id 41', '', ''],
								['1', '(still running)', 'INSERT → id 42, COMMIT', ''],
								['2', '', '', 'sees 42 → publish, last_id = 42'],
								['3', 'COMMIT (41 visible now)', '', ''],
								['4', '', '', '`WHERE id > 42` → 41 skipped forever']
							]
						},
						{
							type: 'list',
							items: [
								'**Fix:** select by state, not by cursor: `WHERE published_at IS NULL ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED` (a [[select-for-update|locking read]] that skips rows another relay already holds), then mark rows published. Or use [[change-data-capture|CDC]], which reads the commit log in commit order.',
								'**Second bug:** a crash after publishing but before `state.set` republishes up to 500 events. That\'s acceptable [[at-least-once]] behaviour, as long as consumers are [[idempotent-consumer|idempotent]]; say so explicitly.',
								'**Remediate:** find outbox rows with no corresponding published record (or with id ≤ the current cursor and never published) and publish them.'
							]
						},
						{ type: 'callout', tone: 'info', text: 'The same bug appears in any "poll by auto-increment id or by `updated_at > last_seen`" sync job, including ETL jobs and search indexers.' }
					]
				},
				{
					id: 'p2q3',
					title: '"After deploys, a few events are never processed"',
					tag: 'core',
					group: 'Bug hunts',
					prompt: [
						{
							type: 'code',
							lang: 'java',
							code: `props.put("enable.auto.commit", "true");     // commits every 5 s
props.put("max.poll.records", "200");
consumer.subscribe(List.of("payments"));

ExecutorService pool = Executors.newFixedThreadPool(16);
while (running) {
    var records = consumer.poll(Duration.ofMillis(500));
    for (var r : records) {
        pool.submit(() -> handle(r));        // process in parallel
    }
}`
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Auto-commit commits what was *polled*, not what was *processed*.** Records are handed to the thread pool and the loop immediately polls again. Every 5 s, auto-commit commits offsets up to the latest poll, while hundreds of records may still be queued in the executor. On a deploy (or crash), the pool is discarded, those records are never handled, and the committed offset says they were. That\'s [[offset-commit|at-most-once]] delivery, which is message loss.'
						},
						{
							type: 'list',
							items: [
								'**Simple fix:** process synchronously in the poll loop and commit manually after the batch.',
								'**If you need parallelism:** track completed offsets per partition and commit only the highest *contiguous* completed offset; pause partitions when the executor queue is full (that\'s [[backpressure]]).',
								'On shutdown: stop polling, drain the executor, commit, then close (a proper [[graceful-shutdown]]).',
								'Parallel processing also breaks per-key ordering within a partition. If ordering matters, shard the executor by key.'
							]
						}
					]
				},
				{
					id: 'p2q4',
					title: '"Ledger updates stopped at 02:14 for one region"',
					tag: 'core',
					group: 'Bug hunts',
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `for msg in consumer:                      # partition-ordered
    while True:
        try:
            handle(json.loads(msg.value))
            consumer.commit(msg)
            break
        except Exception as e:
            log.error("handle failed, retrying", offset=msg.offset, err=str(e))
            time.sleep(1)`
						},
						{
							type: 'logs',
							logs: {
								style: 'terminal',
								lines: [
									{ ts: '02:14:07', level: 'ERROR', source: 'ledger-consumer-2', msg: 'handle failed, retrying', fields: { partition: 7, offset: 9918231, err: 'Expecting value: line 1 column 1 (char 0)' } },
									{ ts: '02:14:08', level: 'ERROR', source: 'ledger-consumer-2', msg: 'handle failed, retrying', fields: { partition: 7, offset: 9918231, err: 'Expecting value: line 1 column 1 (char 0)' } },
									{ ts: '02:14:09', level: 'ERROR', source: 'ledger-consumer-2', msg: 'handle failed, retrying', fields: { partition: 7, offset: 9918231, err: 'Expecting value: line 1 column 1 (char 0)' } },
									{ ts: '…', msg: '(31,402 identical lines)' }
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: '**A [[poison-message]] blocks the partition forever.** The message at offset 9918231 isn\'t valid JSON (an empty payload, or a different serializer). The loop retries a *permanent* error once a second, forever, and every message behind it on partition 7 waits. Lag on that one partition grows; the others are fine.'
						},
						{
							type: 'list',
							items: [
								'**Classify errors:** transient (timeout, 503, deadlock) → retry with backoff; permanent (parse error, validation error, unknown type) → don\'t retry.',
								'After N attempts or on a permanent error, publish the raw message plus error, offset and headers to a [[dead-letter-queue]], commit, and move on.',
								'Alert on DLQ depth and on "same offset failing repeatedly"; build a replay tool.',
								'**Careful in a ledger:** skipping a message can break balances. For ordering-sensitive data, park the *key* (stop processing that account) rather than the whole partition, and page a human.'
							]
						}
					]
				},
				{
					id: 'p2q5',
					title: '"Some customers got two invoices this month"',
					tag: 'tricky',
					group: 'Bug hunts',
					prompt: [
						{ type: 'p', text: 'The nightly job runs on three instances for redundancy; the lock is meant to ensure only one does the work. This month the job took ~90 s instead of the usual 40 s.' },
						{
							type: 'code',
							lang: 'python',
							code: `def nightly_invoices():
    if not redis.set("lock:invoices", HOSTNAME, nx=True, ex=60):
        return                                # someone else has it
    try:
        for customer in customers_due_today():
            invoices.insert(build_invoice(customer))
    finally:
        redis.delete("lock:invoices")`
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: '**The lease expires while the holder is still working.**',
									body: 'The lock lives 60 s; the job takes 90 s. At t = 60 s the [[redis|Redis]] key expires, a second instance acquires it and starts from the first customer. Both are now inserting invoices. A [[distributed-lock]] with a TTL is only a hint, never a guarantee; a [[gc-pause]] or slow network can cause the same thing even when the job is normally fast.'
								},
								{
									title: '**`finally` deletes someone else\'s lock.**',
									body: 'When instance 1 finishes at 90 s, it deletes the key, which now belongs to instance 2, letting instance 3 in too. Release must be compare-and-delete (a Lua script checking the value is still `HOSTNAME`).'
								}
							]
						},
						{
							type: 'list',
							items: [
								'**The real fix is in the database, not the lock:** a unique constraint on `(customer_id, billing_period)` and `INSERT … ON CONFLICT DO NOTHING`. Now the job is [[idempotency|idempotent]]: running it twice, or three instances at once, produces one invoice per customer.',
								'If exclusivity must be enforced on a resource, use a [[fencing-token]] checked by that resource.',
								'Lease renewal ([[heartbeat|heartbeat]] extends the TTL) reduces but doesn\'t remove the risk.',
								'**Remediate:** void the duplicate invoices before they\'re charged or emailed; tell finance which ones.'
							]
						}
					]
				},
				{
					id: 'p2q6',
					title: '"Ledger consumer crashing since Tuesday\'s payments release"',
					tag: 'core',
					group: 'Bug hunts',
					prompt: [
						{ type: 'p', text: 'Payments team says they "only added a new status, nothing breaking".' },
						{
							type: 'code',
							lang: 'python',
							code: `class RefundStatus(Enum):
    PENDING = "pending"
    SUCCEEDED = "succeeded"
    FAILED = "failed"

def on_refund_event(evt: dict) -> None:
    status = RefundStatus(evt["status"])          # producer now also sends "partially_succeeded"
    amount = int(evt["amount"])
    ledger.record_refund(evt["refund_id"], status, amount)`
						}
					],
					answer: [
						{
							type: 'p',
							text: '**A forward-incompatible [[schema-evolution|schema change]].** Adding an enum value is backwards compatible for the *producer*, but breaks every consumer that maps strings strictly onto a closed enum: `RefundStatus("partially_succeeded")` raises `ValueError`. Each such event becomes a [[poison-message]].'
						},
						{
							type: 'list',
							items: [
								'**Consumer side ("tolerant reader"):** unknown enum values map to an explicit `UNKNOWN` and are parked for review instead of crashing; ignore unknown fields; never assume a field\'s absence means a default.',
								'**Producer side:** treat new enum values as a breaking change for consumers. Announce, have consumers deploy support first, then start emitting. A schema registry with `FORWARD` compatibility checks would have flagged it.',
								'**Contract tests** (consumer-driven) in the producer\'s CI catch this before release.',
								'**Data:** `partially_succeeded` probably carries a different `amount` meaning (partial amount vs requested). Confirm the semantics before replaying the parked events into the ledger.'
							]
						}
					]
				},
				{
					id: 'p2q7',
					title: '"Checkout charged the old price for an hour after a price change"',
					tag: 'tricky',
					group: 'Bug hunts',
					prompt: [
						{
							type: 'columns',
							columns: [
								{
									title: 'catalog-svc',
									blocks: [
										{
											type: 'code',
											lang: 'python',
											code: `def update_price(pid, price):
    with db.transaction():
        db.execute(
          "UPDATE products SET price=%s "
          "WHERE id=%s", price, pid)
        bus.publish("product.updated",
                    {"id": pid})`
										}
									]
								},
								{
									title: 'checkout-svc',
									blocks: [
										{
											type: 'code',
											lang: 'python',
											code: `def on_product_updated(evt):
    cache.delete(f"product:{evt['id']}")

def get_product(pid):
    p = cache.get(f"product:{pid}")
    if p is None:
        p = catalog.get(pid)   # served from a read replica
        cache.set(f"product:{pid}", p, ttl=3600)
    return p`
										}
									]
								}
							]
						},
						{ type: 'p', text: 'Only *some* price changes are affected. The stale price always lasts close to exactly one hour.' }
					],
					answer: [
						{
							type: 'p',
							text: '**Two races, both refilling the cache with the old value, which then lives for the full [[ttl]].**'
						},
						{
							type: 'ranked',
							items: [
								{
									title: '**The event is published before the transaction commits.**',
									body: '`publish` runs inside the `with` block. checkout can receive the event, delete the key, and re-read the product *before* catalog commits, getting the old price. (And if the transaction rolls back, the event was a lie.)'
								},
								{
									title: '**The refill reads from a lagging replica.**',
									body: 'Even after commit, `catalog.get` is served from a [[read-replica]]. With a few hundred ms of [[replication-lag]], the first read after invalidation returns the old row. Under load there\'s almost always a request ready to refill the key immediately.'
								}
							]
						},
						{
							type: 'p',
							text: '"Some" and "exactly an hour" fit perfectly: the bug only bites when a read lands in the small window, and once it does the stale value is pinned for 3,600 s.'
						},
						{
							type: 'list',
							items: [
								'Publish **after** commit via the [[transactional-outbox]].',
								'Put the new data (price + `version`) in the event and **write** the cache from the event instead of deleting and re-reading; ignore events with a lower version than the cached one.',
								'Or read-your-writes: refill from the primary when handling an invalidation, or pass the version and reject replica reads older than it.',
								'For money, **don\'t trust a cache at the moment of charging**: checkout re-reads the authoritative price (or a price quote with an id and expiry) before charging.'
							]
						}
					]
				},
				{
					id: 'p2q8',
					title: 'Model answer: engineer note for the missing-orders bug',
					tag: 'template',
					group: 'Write-up',
					prompt: [{ type: 'p', text: 'Write yours for the first bug hunt ("0.3% of orders never reach the warehouse") before opening this.' }],
					answerLabel: 'Show model note',
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `Summary
~0.3% of orders are never received by the warehouse. They exist in our DB
but no "orders" event was ever published.

Root cause
orders/api.py:41. create_order() commits the order, then calls
producer.send(), which is asynchronous (buffers in memory, returns at once).
- If the broker is unavailable longer than the client's retry window,
  the send fails in a callback we never registered → silent drop.
- On deploy, pods exit without producer.flush() → buffered events lost.
This is a dual write: DB and broker are updated separately with no
atomicity. Present since the endpoint was written (a9f3e1c, 2025-11-03).

Evidence
- 412 orders in the last 30 days without a warehouse record; 388 of them
  within 2 min of a deploy or the broker maintenance window.
- Reproduced in staging: kill -TERM during load → 6/1000 orders missing.

Impact
412 orders (list in the PR) placed but not fulfilled; customers were
charged. Oldest is 29 days old.

Fix (PR #2231)
1. Insert the event into an outbox table in the same transaction as the
   order. Relay publishes with event_id = outbox.id.
2. Warehouse consumer dedupes on event_id (unique constraint).
3. Test: inject a broker failure after commit → event still published
   once the broker returns; duplicate delivery → one shipment.

Remediation
Script republishes events for the 412 orders (dry-run output attached).
Support is contacting the customers with the oldest orders first.

Follow-ups
- Daily reconciliation job: orders vs shipments, alert on any gap > 1h.
- Audit other producer.send() call sites (found 3 more: refunds, signups,
  address changes).`
						},
						{ type: 'p', text: 'Note how the root cause names the mechanism precisely: a [[dual-write]], where the database and the broker are updated separately with nothing tying them together.' },
						{
							type: 'p',
							text: 'Notice: line number, mechanism for *both* loss paths, how the start date was found, a count with how it was computed, the test that proves the fix, the data repair, and the audit of sibling call sites. That last item is the "contribution beyond the AI output" reviewers look for.'
						}
					]
				}
			]
		},

		// ═════════════════════════ PART 3 ═════════════════════════
		{
			id: 'p3',
			nav: '3 · Coding',
			eyebrow: 'Part 3 · 45 minutes · coding',
			title: 'An idempotent, ordered event projector',
			meta: 'duplicates · reordering · gaps · restarts',
			minutes: 45,
			intro: [
				{
					type: 'p',
					text: 'Events about orders arrive from a broker with [[at-least-once]] delivery. They can be duplicated and, because they come from several producers and retries, reordered. Build the [[cqrs-read-model|read model]] anyway.'
				},
				{
					type: 'code',
					lang: 'python',
					caption: 'The contract.',
					code: `@dataclass(frozen=True)
class Event:
    event_id: str          # unique per event
    order_id: str
    version: int           # 1, 2, 3 … per order, no gaps at the producer
    type: str              # "created" | "amount_changed" | "paid" | "shipped" | "cancelled"
    data: dict             # created/amount_changed: {"total_cents": int}

class OrderProjector:
    def handle(self, event: Event) -> list[Event]: ...
        # returns the events actually applied as a result of this delivery, in order
    def state(self, order_id: str) -> OrderView | None: ...
        # None until version 1 has been applied`
				},
				{
					type: 'list',
					items: [
						'Apply events per order strictly in [[aggregate-version|version]] order.',
						'A version already applied (or already waiting) is a duplicate: ignore it.',
						'A version from the future waits in a buffer until the gap is filled.',
						'Different orders are independent.',
						'Unknown event types must not crash the projector.'
					]
				}
			],
			questions: [
				{
					id: 'p3q1',
					title: 'Warm-up: trace the deliveries by hand',
					tag: 'core',
					prompt: [
						{ type: 'p', text: 'Order A. Deliveries arrive in this order. What does each `handle()` call return, and what is `state("A").version` after each?' },
						{ type: 'code', lang: 'text', code: '1. A v1 created {total_cents: 5000}\n2. A v3 paid\n3. A v1 created (duplicate)\n4. A v2 amount_changed {total_cents: 4500}\n5. A v4 shipped\n6. A v3 paid (duplicate)\n7. B v2 paid' }
					],
					answer: [
						{
							type: 'table',
							head: ['#', 'Delivery', 'Returns', 'A.version', 'Why'],
							rows: [
								['1', 'A v1', '[v1]', '1', 'next expected'],
								['2', 'A v3', '[]', '1', 'buffered, waiting for v2'],
								['3', 'A v1', '[]', '1', 'duplicate of applied'],
								['4', 'A v2', '[v2, v3]', '3', 'fills gap, drains buffer'],
								['5', 'A v4', '[v4]', '4', 'next expected'],
								['6', 'A v3', '[]', '4', 'duplicate of applied'],
								['7', 'B v2', '[]', '4', 'B independent; buffered, `state("B")` is None']
							],
							numeric: [3]
						},
						{ type: 'p', text: 'Final A: status `shipped`, total 4500. Delivery 4 is the interesting one: one call can apply several events.' }
					]
				},
				{
					id: 'p3q2',
					title: 'Reference solution (Python)',
					tag: 'coding',
					minutes: 30,
					prompt: [{ type: 'p', text: 'Write yours against the timer first. Then compare.' }],
					answerLabel: 'Show solution',
					answer: [
						{
							type: 'code',
							lang: 'python',
							code: `from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Event:
    event_id: str
    order_id: str
    version: int
    type: str
    data: dict[str, Any] = field(default_factory=dict)


@dataclass
class OrderView:
    order_id: str
    status: str = "new"
    total_cents: int = 0
    version: int = 0
    unknown_events: int = 0


class GapTooLarge(Exception):
    """Too many future events buffered for one order; something upstream is lost."""


def apply(view: OrderView, event: Event) -> None:
    if event.type == "created":
        view.status = "open"
        view.total_cents = event.data["total_cents"]
    elif event.type == "amount_changed":
        view.total_cents = event.data["total_cents"]
    elif event.type in ("paid", "shipped", "cancelled"):
        view.status = event.type
    else:
        view.unknown_events += 1          # tolerant reader: count it, keep the version moving


class OrderProjector:
    def __init__(self, max_buffered_per_order: int = 1_000):
        self._views: dict[str, OrderView] = {}
        self._pending: dict[str, dict[int, Event]] = {}
        self._max_buffered = max_buffered_per_order

    def state(self, order_id: str) -> OrderView | None:
        view = self._views.get(order_id)
        return view if view and view.version > 0 else None

    def handle(self, event: Event) -> list[Event]:
        if event.version < 1:
            raise ValueError(f"invalid version {event.version} for {event.order_id}")

        view = self._views.setdefault(event.order_id, OrderView(event.order_id))
        if event.version <= view.version:
            return []                                     # duplicate of an applied event

        pending = self._pending.setdefault(event.order_id, {})
        if event.version in pending:
            return []                                     # duplicate of a buffered event
        pending[event.version] = event
        if len(pending) > self._max_buffered:
            raise GapTooLarge(f"{event.order_id}: waiting for v{view.version + 1}")

        applied: list[Event] = []
        while (nxt := pending.pop(view.version + 1, None)) is not None:
            apply(view, nxt)
            view.version = nxt.version
            applied.append(nxt)

        if not pending:
            del self._pending[event.order_id]
        return applied`
						},
						{
							type: 'list',
							items: [
								'**Dedupe by version, not by `event_id`.** A producer retry might mint a new event id for the same change; the version is the natural key. (If two events share a version but differ in content, that\'s a producer bug worth flagging; see the tests.)',
								'**O(1) per delivery** amortised; each event is buffered and popped once.',
								'**The buffer is bounded.** An unbounded buffer is a [[memory-leak]] the first time a version is truly lost.',
								'`apply` is a separate function: one place to add event types, easy to unit-test.'
							]
						}
					]
				},
				{
					id: 'p3q3',
					title: 'Write the tests',
					tag: 'coding',
					minutes: 10,
					prompt: [{ type: 'p', text: 'List at least eight cases before opening.' }],
					answerLabel: 'Show tests',
					answer: [
						{
							type: 'code',
							lang: 'python',
							code: `import pytest

def ev(v, typ="paid", order="A", total=None, eid=None):
    data = {"total_cents": total} if total is not None else {}
    return Event(eid or f"{order}-{v}", order, v, typ, data)

def test_in_order():
    p = OrderProjector()
    assert p.handle(ev(1, "created", total=5000)) == [ev(1, "created", total=5000)]
    assert [e.version for e in p.handle(ev(2, "paid"))] == [2]
    assert p.state("A").status == "paid"

def test_duplicate_of_applied_is_ignored():
    p = OrderProjector()
    p.handle(ev(1, "created", total=5000))
    assert p.handle(ev(1, "created", total=5000)) == []
    assert p.state("A").version == 1

def test_out_of_order_is_buffered_then_drained():
    p = OrderProjector()
    p.handle(ev(1, "created", total=5000))
    assert p.handle(ev(3, "shipped")) == []
    assert [e.version for e in p.handle(ev(2, "paid"))] == [2, 3]
    assert p.state("A").status == "shipped"

def test_duplicate_of_buffered_is_ignored():
    p = OrderProjector()
    p.handle(ev(3, "paid"))
    assert p.handle(ev(3, "paid")) == []

def test_nothing_visible_before_v1():
    p = OrderProjector()
    p.handle(ev(2, "paid"))
    assert p.state("A") is None

def test_orders_are_independent():
    p = OrderProjector()
    p.handle(ev(1, "created", order="A", total=100))
    assert p.handle(ev(2, "paid", order="B")) == []
    assert p.state("A").version == 1 and p.state("B") is None

def test_unknown_type_advances_version():
    p = OrderProjector()
    p.handle(ev(1, "created", total=100))
    p.handle(ev(2, "gift_wrapped"))
    p.handle(ev(3, "paid"))
    assert (p.state("A").version, p.state("A").unknown_events) == (3, 1)

def test_gap_too_large_raises():
    p = OrderProjector(max_buffered_per_order=2)
    p.handle(ev(2)); p.handle(ev(3))
    with pytest.raises(GapTooLarge):
        p.handle(ev(4))

def test_rejects_invalid_version():
    with pytest.raises(ValueError):
        OrderProjector().handle(ev(0))

def test_any_delivery_order_gives_same_state():
    import itertools
    events = [ev(1, "created", total=5000), ev(2, "amount_changed", total=4500),
              ev(3, "paid"), ev(4, "shipped")]
    for perm in itertools.permutations(events + events[:2]):   # with duplicates
        p = OrderProjector()
        for e in perm:
            p.handle(e)
        s = p.state("A")
        assert (s.status, s.total_cents, s.version) == ("shipped", 4500, 4)`
						},
						{ type: 'p', text: 'The last test is the one that impresses: a [[property-based-testing|property]] ("every permutation with duplicates converges to the same state") rather than one hand-picked example.' }
					]
				},
				{
					id: 'p3q4',
					title: 'Follow-up: the service restarts. What breaks?',
					tag: 'tricky',
					prompt: [{ type: 'p', text: 'The projector runs in a consumer that commits Kafka offsets after each `handle()`. Views are stored in Postgres; the pending buffer is in memory. The pod restarts. What can go wrong, and how do you fix it?' }],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: '**Buffered events are lost, and their offsets were already committed.**',
									body: 'v3 arrived, was buffered, and its offset committed. The pod restarts; the buffer is gone; v2 arrives and is applied; v3 will never be redelivered. Order A is stuck at v2 forever.',
									confirm: 'Write the test: handle v3, "restart" (new projector, same stored views), handle v2 → version stays 2.'
								},
								{
									title: '**View and offset aren\'t updated atomically.**',
									body: 'Crash after writing the view but before committing the offset → redelivery. That one is safe *because* the version check makes it idempotent. Crash after committing but before writing → lost update. So: write view first, commit offset after.'
								}
							]
						},
						{
							type: 'list',
							items: [
								'**Option A:** persist the pending buffer in the same DB transaction as the views (a `pending_events` table).',
								'**Option B:** only [[offset-commit|commit offsets]] up to the lowest offset still sitting in the buffer, so buffered events are redelivered after a restart.',
								'**Option C:** store the consumer offsets in the same Postgres transaction as the view (and seek to them on startup): view and offset are then atomic, which is the honest version of "[[exactly-once]]".',
								'**Gaps that never fill:** alert when an order has been waiting for the same version for > N minutes, then fetch the current state from the source-of-truth API to resync.'
							]
						}
					]
				}
			]
		},

		// ═════════════════════════ PART 4 ═════════════════════════
		{
			id: 'p4',
			nav: '4 · Rapid fire',
			eyebrow: 'Rapid fire · 1–2 min each',
			title: 'Teasers',
			meta: 'quick reasoning reps',
			minutes: 10,
			questions: [
				{
					id: 't1',
					title: 'Exactly-once to a payment API?',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'The broker advertises "exactly-once semantics". Does that mean your consumer will call the payment provider exactly once per message?' }],
					answer: [{ type: 'p', text: 'No. Broker [[exactly-once]] covers reads and writes *inside* the broker (consume → produce → commit atomically). An external HTTP call is outside that transaction: a crash after the call but before the commit redelivers the message. You still need an [[idempotency-key]] on the payment call.' }]
				},
				{
					id: 't2',
					title: 'Three retry layers',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'bff retries 2×, cart-svc retries 3×, the [[service-mesh|mesh]] retries 2× on every hop. A request to the bottom service always fails. How many calls hit it per user click?' }],
					answer: [{ type: 'p', text: '(1+2) × (1+3) × (1+2) = **36**. And the mesh also retries the bff → cart hop, so it\'s worse: (1+2)(1+2) × (1+3)(1+2) = 108 if the mesh is on both hops. Retry in one place.' }]
				},
				{
					id: 't3',
					title: '12 partitions, 20 consumers',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'What do the extra consumers do? And what happens if you raise the topic to 24 partitions?' }],
					answer: [{ type: 'p', text: '8 sit idle; a partition has exactly one owner in a [[consumer-group]]. Raising to 24 partitions lets all 20 work, but `hash(key) % partitions` changes, so new messages for a key may land on a different partition than its older, still-unconsumed messages, and per-key ordering breaks during the transition.' }]
				},
				{
					id: 't4',
					title: 'Lag in messages vs lag in time',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'Lag is 1.8M messages. Producers write 25k/s; consumers now read 30k/s. How far behind are you, and when do you catch up?' }],
					answer: [{ type: 'p', text: 'About 1.8M ÷ 25k ≈ **72 s behind** real time. You gain 5k/s, so 1.8M ÷ 5k = **360 s ≈ 6 min** to catch up. "1.8M" sounds alarming; "72 seconds" is what users feel. Report [[consumer-lag]] in time.' }]
				},
				{
					id: 't5',
					title: 'Timeouts that grow downwards',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'Gateway [[timeout|timeout]] 2 s. order-svc → pricing timeout 5 s. What\'s wrong?' }],
					answer: [{ type: 'p', text: 'Pricing can run for 3 s after the user already got an error: pure wasted work, plus side effects nobody is waiting for. Each hop\'s timeout must be shorter than its caller\'s remaining budget. Better: propagate the deadline ([[deadline-propagation]]).' }]
				},
				{
					id: 't6',
					title: 'Should /healthz check the database?',
					tag: 'teaser',
					prompt: [],
					answer: [{ type: 'p', text: 'Not for the **[[liveness-probe|liveness]]** probe: a DB blip would restart every pod at once. For **[[readiness-probe|readiness]]**, only if failing *all* pods out of rotation together is better than serving errors or degraded responses, which it rarely is. Report dependency health in metrics instead.' }]
				},
				{
					id: 't7',
					title: 'Sort events by created_at?',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'Two services emit events about the same account. A consumer applies them sorted by their `created_at` timestamps. What\'s the risk?' }],
					answer: [{ type: 'p', text: '[[clock-skew]]: the two hosts\' clocks differ by milliseconds to seconds, so "later" by timestamp isn\'t necessarily later in reality. Use a single writer that assigns an [[aggregate-version]], or route both through one partition keyed by account and use offsets.' }]
				}
			]
		}
	]
};

export default assessment;
