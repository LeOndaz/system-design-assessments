import type { Assessment } from '../types';

const a1: Assessment = {
	id: 'full-stack',
	number: 1,
	title: 'The four-part assessment',
	tagline: 'Perf debugging, a bug ticket with two write-ups, RAG troubleshooting, and a billing coding task.',
	description:
		'Four parts, about 115 minutes. Every scenario has a model answer folded underneath. Try each one against the timer before you open it, then tick it off.',
	minutes: 115,
	difficulty: 'intermediate',
	topics: ['performance', 'debugging', 'written communication', 'RAG', 'coding'],
	overview: [
		{
			type: 'budget',
			items: [
				{ label: '1 · Perf debug', minutes: 15 },
				{ label: '2 · Debug + write', minutes: 25 },
				{ label: '3 · RAG', minutes: 20 },
				{ label: '4 · Billing code', minutes: 55 }
			]
		},
		{
			type: 'callout',
			tone: 'info',
			title: 'What a human reviewer is grading',
			text: '**Parts 1 & 3:** breadth first (list causes per layer), then a *ranked* shortlist tied to specific symptoms, then how you would confirm each one. A flat brain-dump scores lower than a ranked list with "evidence for / against / next check". **Part 2:** two audiences. The engineer note needs file, line, mechanism, fix, test, and [[data-remediation|data remediation]]. The non-technical note needs impact, timeline, and what to tell customers, with zero jargon. **Part 4:** correct output first, then visible engineering: small helpers, stated assumptions, integer or [[decimal-arithmetic|Decimal]] money math, and extra tests for the edges.'
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Weighting tip',
			text: 'Part 4 is almost half the clock and is the only part with an objective pass/fail. If something earlier goes badly, move on. A clean Part 4 with tests is worth more than a perfect Part 1.'
		}
	],
	parts: [
		// ───────────────────────── PART 1 ─────────────────────────
		{
			id: 'p1',
			nav: '1 · Perf',
			eyebrow: 'Part 1 · 15 minutes · scenario',
			title: 'Distributed performance debugging',
			meta: 'DB · cache · backend · frontend · 3rd-party API',
			minutes: 15,
			intro: [
				{
					type: 'callout',
					tone: 'info',
					title: 'The answer skeleton (use it every time)',
					text: '**1. Read the timing diagram first.** Which span grew? Is the growth inside a component (work got slower) or between components (queueing, pool wait, network)? **2. Scope it.** All endpoints or one? All users or big tenants? Constant or periodic? Started at a deploy, a traffic change, or slowly over weeks? **3. Brainstorm per layer**, quickly, so the reviewer sees breadth. **4. Rank top 3** with evidence for, evidence against, and the one check that confirms or kills it. **5. Mitigate now vs fix properly.** [[rollback|Rollback]], raise timeout, [[feature-flag]], then the structural fix.'
				},
				{
					type: 'cards',
					items: [
						{
							title: 'Database',
							items: [
								'Missing [[database-index|index]] / [[query-plan-flip|plan regression]] after stats change',
								'[[n-plus-one|N+1 queries]], unbounded `SELECT`, `OFFSET` paging',
								'Lock contention, long transactions',
								'[[connection-pool|Connection pool]] exhausted ([[kubernetes|pods]] × pool > max_connections)',
								'[[replication-lag|Replication lag]] on read replicas, vacuum / [[table-bloat|bloat]]'
							]
						},
						{
							title: 'Cache',
							items: [
								'[[cache-hit-rate|Hit rate]] drop (key format changed in deploy)',
								'[[cache-stampede|Stampede]] / thundering herd on expiry',
								'Synchronized [[ttl|TTLs]] → periodic spikes',
								'Eviction from memory pressure, [[hot-partition|hot key]] on one shard',
								'Large values: serialization cost dominates'
							]
						},
						{
							title: 'Backend',
							items: [
								'[[worker-pool|Worker pool]] saturation ([[littles-law]])',
								'Sync call to slow dependency, no [[timeout]]',
								'[[gc-pause|GC pauses]], [[memory-leak]] sawtooth',
								'CPU-bound work on the [[event-loop]] (Node)',
								'Logging/tracing overhead, chatty serialization'
							]
						},
						{
							title: '3rd-party API',
							items: [
								'Upstream latency increase',
								'Rate limited (429) + retries without backoff = [[retry-storm]]',
								'No [[circuit-breaker]] → cascading failure',
								'New TLS/DNS per call (no keep-alive)'
							]
						},
						{
							title: 'Frontend',
							items: [
								'[[request-waterfall|Request waterfall]] (sequential fetches)',
								'Bundle size / blocking scripts',
								'[[cors-preflight|CORS preflight]] per request',
								'Polling too aggressively, no request dedupe'
							]
						},
						{
							title: 'Infra / network',
							items: [
								'[[autoscaling|Autoscaling]] lag, [[noisy-neighbor|noisy neighbour]], [[cpu-throttling|CPU throttling]] (k8s limits)',
								'DNS resolution slow, cross-region hop added',
								'Load balancer imbalance ([[sticky-sessions|sticky sessions]])'
							]
						}
					]
				}
			],
			questions: [
				{
					id: 'p1q1',
					title: 'The dependency that froze everything',
					tag: 'core',
					prompt: [
						{
							type: 'list',
							items: [
								'[[percentiles|p95]] latency on *all* endpoints went from 180 ms to 6 s since 14:00. No deploy.',
								'DB CPU 25%, cache hit rate unchanged at 94%.',
								'Timing diagram: only `/checkout` calls the payment API; that span went from 120 ms to 5 s.',
								'Backend [[worker-pool|worker pool]] shows 64/64 busy.'
							]
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Pool exhaustion from a slow third-party call with no (or a long) timeout.',
									body: "Checkout requests hold workers for 5 s each. [[littles-law|Little's law]]: in-flight = rate × time, so the pool fills and every other endpoint queues behind it. That's why unrelated endpoints slowed even though their own spans didn't grow.",
									confirm: 'Per-endpoint worker occupancy, queue wait time in traces, payment API status page.'
								},
								{
									title: '[[retry-storm|Retry amplification]].',
									body: 'If the client retries 3× on timeout, load on the provider and worker hold time multiply.',
									confirm: 'Outbound request count vs inbound checkout count.'
								},
								{
									title: 'Outbound [[connection-pool|connection pool]] limit',
									body: 'e.g. HTTP client max 10 connections per host. Requests wait for a socket, not the provider.',
									confirm: 'Client-side pool wait metric vs provider-reported latency.'
								}
							]
						},
						{ type: 'p', text: '**Ruled down:** DB and cache. Their metrics are flat.' },
						{
							type: 'p',
							text: '**Mitigate:** short timeout (≈2× normal p99), [[circuit-breaker]], fail checkout fast with a retryable error. **Fix:** [[bulkhead]] (separate pool for payment calls), async payment with [[webhook]] confirmation, retries with [[exponential-backoff]] + [[jitter]] and an [[idempotency-key]].'
						}
					]
				},
				{
					id: 'p1q2',
					title: 'Cache hit rate falls off a cliff after deploy',
					tag: 'core',
					prompt: [
						{
							type: 'list',
							items: [
								'Deploy at 09:00. [[cache-hit-rate|Hit rate]] 96% → 35%. DB [[throughput|QPS]] ×12, DB p95 30 ms → 900 ms.',
								'Latency slowly recovers over ~1 hour but never fully.'
							]
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Cache key changed in the deploy',
									body: 'New prefix, serializer version, or an added field like locale or a timestamp. The whole cache is effectively cold. Partial recovery = keys refilling. "Never fully" suggests the new key has *higher [[cardinality]]* (e.g. includes user id or a request timestamp), so hit rate is permanently lower.',
									confirm: 'Diff the key builder; sample keys in Redis before/after.'
								},
								{
									title: '[[cache-stampede|Stampede]].',
									body: 'Many concurrent misses for the same key all hit the DB.',
									confirm: 'Duplicate identical queries in DB logs within the same second.'
								},
								{
									title: 'Serialization failure → silent miss.',
									body: "New code can't deserialize old values, treats them as misses and maybe never writes successfully.",
									confirm: 'Error logs in the cache wrapper, write success rate.'
								}
							]
						},
						{
							type: 'p',
							text: '**Fix:** roll back or pre-warm; request coalescing ([[single-flight]]); [[stale-while-revalidate]]; jittered [[ttl|TTLs]]; version the key deliberately and warm before cut-over.'
						}
					]
				},
				{
					id: 'p1q3',
					title: 'Spikes on the hour, every hour',
					tag: 'core',
					prompt: [{ type: 'list', items: ['[[percentiles|p99]] jumps for ~3 minutes at :00 each hour. Rest of the hour is normal.'] }],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Synchronized [[ttl|TTL]] expiry.',
									body: 'Keys all set with a 3600 s TTL at the same time (warm-up job or cache flush) and expire together → [[cache-stampede|stampede]].',
									confirm: 'Miss-rate graph aligned with the spikes.'
								},
								{
									title: 'Scheduled job',
									body: 'Reports, [[etl|ETL]], backups, materialized-view refresh competing for DB I/O or locks.',
									confirm: '[[cron|Cron]] schedules, DB active queries at :00.'
								},
								{
									title: 'Third-party quota window reset or token refresh',
									body: 'All clients refresh auth at once.'
								}
							]
						},
						{ type: 'p', text: '**Fix:** TTL [[jitter]] (±10%), move batch to a [[read-replica|replica]] or off-peak, stagger cron.' }
					]
				},
				{
					id: 'p1q4',
					title: 'Slow creep over six weeks, one endpoint',
					tag: 'core',
					prompt: [
						{
							type: 'list',
							items: ['`GET /orders` went from 80 ms to 2.4 s gradually. Traffic flat. DB span is 95% of request time.']
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Query scales with table size',
									body: 'Missing [[database-index|index]] on the filter/sort column → [[seq-scan|sequential scan]].',
									confirm: '[[explain-analyze|`EXPLAIN ANALYZE`]]; rows scanned vs returned.'
								},
								{
									title: '[[offset-pagination|OFFSET pagination]]',
									body: 'Deep pages scan and discard rows. Fix with [[keyset-pagination|keyset pagination]] (`WHERE id < :cursor ORDER BY id DESC LIMIT 50`).'
								},
								{
									title: 'Unbounded result',
									body: 'No LIMIT, or [[n-plus-one|N+1]] loading line items per order.',
									confirm: 'Query count per request.'
								},
								{
									title: '[[table-bloat|Table/index bloat]]',
									body: 'Postgres dead tuples, autovacuum behind.',
									confirm: '`pg_stat_user_tables.n_dead_tup`.'
								}
							]
						}
					]
				},
				{
					id: 'p1q5',
					title: 'Autoscaling made it worse',
					tag: 'tricky',
					prompt: [
						{
							type: 'list',
							items: [
								'Marketing campaign. Backend [[autoscaling|scaled]] 10 → 40 pods. Latency got *worse*, and errors say `too many connections` / pool timeout.'
							]
						}
					],
					answer: [
						{
							type: 'p',
							text: '**DB connection limit.** Each pod opens a [[connection-pool|pool]] of 20 → 800 connections against `max_connections=500`. Pods block waiting for a connection; Postgres also degrades with many backends (memory per connection, context switching). Scaling the stateless tier moved the bottleneck to the stateful one.'
						},
						{
							type: 'p',
							text: '**Fix:** [[pgbouncer|PgBouncer]] / RDS Proxy (transaction pooling), size pool per pod = budget ÷ max pods, [[read-replica|read replicas]] for reads, cache hot reads. Also set the [[horizontal-pod-autoscaler|HPA]] max based on downstream capacity, not only CPU.'
						}
					]
				},
				{
					id: 'p1q6',
					title: "Backend is fast, users say it's slow",
					tag: 'core',
					prompt: [
						{
							type: 'list',
							items: [
								'Server p95 is 120 ms. [[tti|Real-user TTI]] is 7 s on the dashboard page. The frontend fetches user → org → projects → stats.'
							]
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: '[[request-waterfall|Request waterfall]].',
									body: 'Four dependent round-trips × ([[rtt|RTT]] + TLS + server time). On mobile at 300 ms RTT that alone is seconds.',
									confirm: 'Browser network waterfall. Fix: parallelize independent calls, a [[bff]] / aggregate endpoint, or prefetch on the server.'
								},
								{ title: 'Large JS bundle / render-blocking assets.', confirm: 'Lighthouse, coverage tab.' },
								{
									title: '[[cors-preflight|CORS preflight]]',
									body: 'Doubles round-trips for non-simple requests to another origin. Fix: `Access-Control-Max-Age`, same-origin API.'
								},
								{ title: 'Third-party scripts', body: 'Analytics, chat widget blocking the main thread.' }
							]
						},
						{
							type: 'callout',
							tone: 'warn',
							text: "Lesson: server metrics don't see network or client time. Always ask for [[rum|RUM]] or a browser waterfall."
						}
					]
				},
				{
					id: 'p1q7',
					title: 'Only big customers are slow',
					tag: 'core',
					prompt: [
						{
							type: 'list',
							items: ['p50 is fine. p99 is terrible, and the slow traces all belong to the 5 largest tenants.']
						}
					],
					hints: [
						'What do tenants share if they live in the same database? What grows with tenant size regardless of where they live?',
						'Think about how the database decides *how* to run `WHERE tenant_id = ?` for a tenant with 1,000 rows vs one with 10 million.'
					],
					answer: [
						{
							type: 'callout',
							tone: 'info',
							title: 'Assumptions this question makes',
							text: 'It assumes a [[multi-tenancy|multi-tenant]] SaaS in the common **pool model**: every tenant lives in the same database and tables, separated only by a `tenant_id` column. That separation is *logical*: the rows are isolated, but CPU, memory, locks, the connection pool, indexes and the planner\'s statistics are shared. Even with a database per tenant (silo model), big tenants can still be slow, because work that grows with data size grows everywhere. So list causes in two buckets: **work that scales with the tenant** (any model) and **contention between tenants** (pool model only).'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Work proportional to tenant size',
									body: '[[n-plus-one|N+1]] over members, in-memory aggregation, no pagination. A tenant with 50,000 users loops 50,000 times.',
									confirm: 'Query count and rows returned per request, segmented by tenant.'
								},
								{
									title: '[[hot-partition|Hot partition]] / hot cache key',
									body: 'Data or cache sharded by `tenant_id`, so one big tenant lands entirely on one shard and saturates it.',
									confirm: 'Per-shard CPU/QPS; does the slow shard host the big tenants?'
								},
								{
									title: 'Per-tenant third-party rate limits',
									body: 'Only big tenants make enough calls to hit an upstream quota, then wait on 429 + backoff.',
									confirm: '429 counts per tenant in outbound logs.'
								},
								{
									title: '[[query-plan-flip|Query plan flips]]',
									body: "The planner estimates how many rows `tenant_id = X` matches from [[table-statistics|statistics]]. For a tiny tenant it picks an index scan; once a tenant owns a large share of the table it switches to a [[seq-scan|sequential scan]], which can be far slower for queries that only need the newest 50 rows. See the dedicated page for the full mechanism and fixes.",
									confirm: '[[explain-analyze|`EXPLAIN ANALYZE`]] the same query for a small and a big tenant id and compare plans.'
								}
							]
						},
						{ type: 'p', text: 'Averages hide this. Always segment latency by tenant and payload size: it is a [[tail-latency]] problem, not a median one.' }
					]
				},
				{
					id: 'p1q8',
					title: 'Sawtooth latency, restarts fix it',
					tag: 'core',
					prompt: [
						{
							type: 'list',
							items: ['Latency climbs over ~6 h, drops after each pod restart. Memory graph is a matching [[sawtooth-pattern|sawtooth]].']
						}
					],
					answer: [
						{
							type: 'p',
							text: '**[[memory-leak|Memory leak]] → [[gc-pause|GC]] pressure.** Unbounded in-process cache (a `dict` without eviction), listeners not removed, request-scoped objects held globally. Longer and more frequent GC pauses raise latency until [[oomkilled|OOM-kill]] or restart. Confirm: [[profiling|heap dumps]] at 1 h and 5 h, compare dominant retainers. Other candidates: connection leak (pool slowly drained), file-descriptor leak.'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 2 ─────────────────────────
		{
			id: 'p2',
			nav: '2 · Debug + Write',
			eyebrow: 'Part 2 · 25 minutes · AI allowed · written',
			title: 'Unfamiliar codebase, bug ticket, two write-ups',
			meta: 'support ticket → code → root cause → engineer note + non-tech note',
			minutes: 25,
			intro: [
				{
					type: 'callout',
					tone: 'info',
					title: 'A 25-minute workflow',
					text: '**3 min:** restate the ticket as a testable claim ("contacts created after the 100th are missing from sync"). **8 min:** trace the data path: entry point → service → API client → mapper → DB write. Use AI to summarize files, but read the suspicious function yourself. **4 min:** prove it. Point at the line, explain the mechanism, show which input triggers it. **10 min:** write both notes. Keep the engineer note tight. Keep the non-tech note to a few short, jargon-free paragraphs: who, what now, when, what to say.'
				},
				{
					type: 'callout',
					tone: 'warn',
					title: '"Contribution beyond the AI output": how to show it',
					text: 'Say what you verified and how ("confirmed by reading `sync.py:42`; the AI\'s first suggestion about rate limits was wrong because…"). Quantify impact: which records, since when (`git blame` on the bad line gives the start date). **[[data-remediation|Data remediation]]**: the code fix doesn\'t repair rows already corrupted. AI answers almost always forget this. Prevention: the test that would have caught it, plus monitoring/alerting.'
				}
			],
			questions: [
				{
					id: 'p2q1',
					group: 'Bug-hunt drills',
					title: '"Some of our [[crm|CRM]] contacts never arrive"',
					tag: 'core',
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `def sync_contacts(client, db):
    resp = client.get("/contacts", params={"limit": 100})
    for c in resp.json()["data"]:
        db.upsert_contact(c["id"], c["email"], c["name"])`
						}
					],
					answer: [
						{
							type: 'p',
							text: "**[[keyset-pagination|Pagination]] is ignored.** Only the first 100 contacts are fetched; the response's `next_cursor` / `has_more` is never followed. Customers with fewer than 100 contacts never notice, which is why only some report it."
						},
						{
							type: 'code',
							lang: 'python',
							code: `def iter_contacts(client):
    cursor = None
    while True:
        page = client.get("/contacts", params={"limit": 100, "cursor": cursor}).json()
        yield from page["data"]
        cursor = page.get("next_cursor")
        if not cursor:
            return

def sync_contacts(client, db):
    for c in iter_contacts(client):
        db.upsert_contact(c["id"], c["email"], c["name"])`
						},
						{
							type: 'p',
							text: "Also flag: no error handling on non-200, no rate-limit backoff, sync isn't resumable. Remediation: run a full resync for all customers."
						}
					]
				},
				{
					id: 'p2q2',
					group: 'Bug-hunt drills',
					title: '"Customers were charged twice"',
					tag: 'core',
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `@retry(times=3, on=(Timeout,))
def charge(order):
    resp = payments.post("/charges", json={"amount": order.total, "customer": order.cust_id}, timeout=5)
    db.mark_paid(order.id, resp.json()["charge_id"])`
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Retry on [[timeout]] without an [[idempotency-key]].** A timeout means "unknown", not "failed": the provider may have completed the charge. Retrying creates a second charge.'
						},
						{
							type: 'p',
							text: '**Fix:** send `Idempotency-Key: order-{id}` (stable per logical operation), or check for an existing charge before retrying. Persist a `pending` state before the call so a crash between charge and `mark_paid` can be [[reconciliation|reconciled]]. **Remediation:** query the provider for duplicate charges per order since the decorator was added and refund.'
						}
					]
				},
				{
					id: 'p2q3',
					group: 'Bug-hunt drills',
					title: '"Appointments show on the wrong day"',
					tag: 'core',
					prompt: [
						{
							type: 'code',
							lang: 'javascript',
							code: `// API returns "2026-03-10T23:30:00Z"
const appt = new Date(apiItem.startsAt);
row.date = appt.toISOString().slice(0, 10);   // stored as DATE
render(appt.getDate());`
						}
					],
					answer: [
						{
							type: 'p',
							text: "**Timezone mixing.** Storage uses the [[utc|UTC]] date (2026-03-10), rendering uses the local date (in Cairo, UTC+2/+3, that's March 11). Users east of UTC see late-evening items a day later; west of UTC, early-morning ones a day earlier. Only reported by some users → it depends on time of day and user timezone."
						},
						{
							type: 'p',
							text: "**Fix:** store full UTC timestamps (`timestamptz`), convert to the user's/clinic's [[iana-timezone|IANA timezone]] only at display. Never derive a calendar date from UTC unless the business day is defined in UTC."
						}
					]
				},
				{
					id: 'p2q4',
					group: 'Bug-hunt drills',
					title: '"Invoice totals are 100× too high"',
					tag: 'core',
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `amount = provider_invoice["amount_due"]     # provider returns cents
db.save_invoice(id=inv_id, amount_usd=amount)`
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Unit mismatch**: cents stored in a dollars column. Fix: keep money as integer [[minor-units]] end to end (`amount_cents`) and name columns by unit. Watch for [[zero-decimal-currency|zero-decimal currencies]] (JPY) and 3-decimal ones (KWD, BHD) if converting.'
						}
					]
				},
				{
					id: 'p2q5',
					group: 'Bug-hunt drills',
					title: '"Sync says success but nothing changed"',
					tag: 'core',
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `for item in items:
    try:
        upsert(map_item(item))
    except Exception:
        pass
log.info("sync complete")`
						}
					],
					answer: [
						{
							type: 'p',
							text: '**[[swallowed-exception|Swallowed exceptions]].** A mapping error (e.g. a field renamed in a new API version, a null where a value was assumed) fails every item silently. Fix: catch specific exceptions, log with item id, count failures, report a `partial_failure` status, alert when the failure ratio exceeds a threshold. The "sync complete" log line is actively misleading during support investigations.'
						}
					]
				},
				{
					id: 'p2q6',
					group: 'Bug-hunt drills',
					title: '"Users can\'t log in with SSO after migration"',
					tag: 'core',
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `user = db.query(User).filter(User.email == idp_claims["email"]).first()`
						}
					],
					answer: [
						{
							type: 'p',
							text: "**Case-sensitive email match.** The [[sso|IdP]] sends `Ahmed@Corp.com`, the DB stored `ahmed@corp.com`. Fix: normalize on write and read (lowercase + trim), unique index on `lower(email)` or use `citext`. Better: match on the IdP's stable subject id (`sub`), not email, since emails change."
						}
					]
				},
				{
					id: 'p2q7',
					group: 'Bug-hunt drills',
					title: '"Filter by selected projects shows nothing"',
					tag: 'core',
					prompt: [
						{
							type: 'code',
							lang: 'javascript',
							code: `const selected = new URLSearchParams(location.search).getAll("project"); // ["12","15"]
const visible = rows.filter(r => selected.includes(r.projectId));        // projectId: 12`
						}
					],
					answer: [
						{
							type: 'p',
							text: '**String vs number comparison** ([[type-coercion]]). `includes` uses SameValueZero, so `"12" !== 12`. Parse at the boundary: `getAll("project").map(Number)`, and validate (`Number.isInteger`).'
						}
					]
				},
				{
					id: 'p2q8',
					group: 'Bug-hunt drills',
					title: '"[[webhook|Webhook]] updates sometimes revert a record"',
					tag: 'tricky',
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `@app.post("/webhooks/order")
def on_order(evt):
    order = db.get(evt["order_id"])
    order.status = evt["status"]
    db.save(order)`
						}
					],
					answer: [
						{
							type: 'p',
							text: "**[[out-of-order-delivery|Out-of-order]] and duplicate delivery.** Providers don't guarantee order; a delayed `processing` event arrives after `shipped` and overwrites it. Also [[lost-update|read-modify-write]] [[race-condition|races]] between concurrent deliveries."
						},
						{
							type: 'p',
							text: '**Fix:** store the event timestamp/sequence and only apply if newer (`UPDATE … WHERE updated_at < :evt_ts`), dedupe by event id, or model status as a [[state-machine]] that rejects backward transitions. Verify signatures. Return 2xx quickly and process via a queue.'
						}
					]
				},
				{
					id: 'p2q9',
					group: 'Write-up templates',
					title: 'Model answer: engineer note for the double-charge bug',
					tag: 'template',
					answerLabel: 'Show model note',
					prompt: [{ type: 'p', text: 'Draft yours for drill 2 first, then compare.' }],
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `Summary
Some orders are charged twice when the payments API is slow.

Root cause
billing/charge.py:14 — charge() is wrapped in @retry(on=Timeout).
A client-side timeout (5s) doesn't mean the charge failed; the
provider often completes it. The retry sends a new POST /charges
with no Idempotency-Key, so the provider creates a second charge.
Introduced in a1b2c3d (2026-09-02), when the retry decorator was added.

Evidence
- Ticket #4411: order 8812 has two charge ids 3.1s apart in provider logs.
- Our logs show a Timeout followed by success for the same order.
- Reproduced locally by stubbing the provider with a 6s delay.

Impact
Orders since 2026-09-02 where a timeout occurred. Query to list them
is in the PR description (N≈?? — to be confirmed).

Fix (PR #…)
1. Send Idempotency-Key = f"order-{order.id}-charge".
2. Persist order.payment_state = "pending" before calling the API.
3. Unit test: stub returns timeout then success → exactly one charge.

Remediation
Script to find duplicate charges per order since 09-02 and refund
the later one; dry-run output for review before execution.

Follow-ups
Alert on >1 charge per order. Audit other @retry usages on non-idempotent POSTs.`
						}
					]
				},
				{
					id: 'p2q10',
					group: 'Write-up templates',
					title: 'Model answer: non-technical note for the same bug',
					tag: 'template',
					answerLabel: 'Show model note',
					prompt: [],
					answer: [
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'You',
								role: 'Engineering',
								subject: 'Re: customers charged twice',
								body: `Hi Sara,

We found why some customers were charged twice. When our payment provider was slow to respond, our system tried the payment again without checking whether the first attempt had already gone through.

Who's affected: a small number of orders placed since 2 September during slow periods. We're pulling the exact list today.

What we're doing: a fix is in review and should be live by Thursday. We'll refund every duplicate charge automatically by Friday, and customers will see the refund in 5–10 business days.

What to tell customers who write in: "You were charged twice due to a technical error on our side. The extra charge will be refunded automatically by Friday, with no action needed from you."

I'll send the final list of affected orders by end of day.`
							}
						},
						{
							type: 'p',
							text: 'Notice: no "idempotency", no "timeout", no file names. It answers who, what now, when, and what to say.'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 3 ─────────────────────────
		{
			id: 'p3',
			nav: '3 · RAG',
			eyebrow: 'Part 3 · 20 minutes · scenario',
			title: '[[rag|RAG]] pipeline troubleshooting',
			meta: 'drug side-effect extraction from support calls',
			minutes: 20,
			intro: [
				{
					type: 'table',
					head: ['Stage', 'What breaks', 'Symptom in summaries'],
					rows: [
						[
							'Ingestion / [[asr|ASR]]',
							'Transcription model changed, new accent/language, drug names misheard, audio truncated, [[diarization]] swaps agent and caller',
							"Wrong drug names, side effects attributed to the agent's script"
						],
						['Cleaning / [[pii|PII]]', '[[pii-redaction|Over-redaction]] removes drug names or dosages; regex changes', 'Missing or vague facts'],
						[
							'[[chunking|Chunking]]',
							'Size/overlap changed, negation split from symptom ("denies… / …nausea"), speaker labels lost',
							'Negated symptoms reported as present'
						],
						[
							'[[embedding|Embedding]]',
							'Model upgraded for queries but not re-indexed; truncation of long chunks; normalization changed',
							'Retrieval looks random, relevance scores shift'
						],
						[
							'Index / metadata',
							'Missing `tenant_id` / `call_id` filter, namespace mix-up, stale or duplicate vectors',
							'Facts from other calls or other customers'
						],
						[
							'Retrieval',
							'[[top-k]] too high/low, similarity threshold not recalibrated, [[reranker]] removed, [[hybrid-search]] weights changed',
							'Irrelevant context, missed key passages'
						],
						[
							'Prompt / LLM',
							'Unpinned model alias updated ([[model-pinning]]), prompt edited, [[context-window|context]] overflow truncates instructions, [[llm-temperature|temperature]] raised',
							'Unsupported content, format drift'
						],
						[
							'Async orchestration',
							'Retrieval runs before indexing finishes, [[shared-mutable-state|shared mutable state]] across workers, retries re-ingest, out-of-order queue',
							'Summary built from wrong or previous call'
						]
					]
				},
				{
					type: 'callout',
					tone: 'warn',
					title: 'Prioritize by severity, not just likelihood',
					text: "This is [[pharmacovigilance]] data: health information and regulated adverse-event reporting. A cross-customer leak is a compliance incident even if it's not the most probable cause. Say so explicitly: *\"I'd check [[tenant-isolation|tenant isolation]] first because the cost of being wrong is highest and it's quick to rule out.\"* That's the judgment they're scoring."
				}
			],
			questions: [
				{
					id: 'p3q1',
					title: 'Summaries mention drugs the caller never said',
					tag: 'core',
					prompt: [
						{
							type: 'list',
							items: [
								"Pharma customer A's summaries sometimes reference a drug only customer B sells.",
								'Started after moving the pipeline to a worker pool with 16 concurrent workers.'
							]
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: '[[race-condition|Race condition]] / [[shared-mutable-state|shared mutable state]] in workers',
									body: 'A module-level `current_context`, a reused prompt builder, a cache keyed only by `call_id` that collides across tenants, or a batch whose results get zipped back to the wrong request. Timing (began with concurrency) is the strongest evidence.',
									confirm: 'Log retrieved chunk ids + their tenant for each summary; look for any mismatch.'
								},
								{
									title: 'Missing tenant filter in the [[vector-index|vector]] query',
									body: 'Or a shared namespace.',
									confirm: "Inspect the query; run a probe query with tenant A and see if B's chunks come back."
								},
								{
									title: 'LLM parametric knowledge',
									body: 'The model [[hallucination|"fills in"]] a typical drug for a symptom.',
									confirm: "Check whether B's drug appears in any retrieved chunk."
								}
							]
						},
						{
							type: 'p',
							text: '**Immediate:** stop the pipeline or force concurrency to 1, notify compliance/security, preserve logs. **Fix:** per-request immutable context, mandatory tenant filter enforced in the data-access layer (not by convention), separate indices per tenant, an output check that rejects entities not present in the source transcript.'
						}
					]
				},
				{
					id: 'p3q2',
					title: 'Quality dropped after "just upgrading the embedding model"',
					tag: 'core',
					prompt: [],
					answer: [
						{
							type: 'p',
							text: "**Mixed [[embedding]] spaces.** Queries are embedded with the new model while the index still holds vectors from the old one (or only new calls were re-embedded). Vectors from different models aren't comparable, so nearest neighbours are noise. Also: the old similarity threshold (e.g. 0.78 [[cosine-similarity]]) means something different now, and dimension or normalization may differ."
						},
						{
							type: 'p',
							text: '**Fix:** store `embedding_model_version` per vector, re-index fully into a new index, then cut over atomically ([[blue-green-deployment|blue/green]]), recalibrate thresholds on a labelled eval set.'
						}
					]
				},
				{
					id: 'p3q3',
					title: '"Patient reports nausea", but the patient denied it',
					tag: 'core',
					prompt: [{ type: 'list', items: ['Chunk size was reduced from 800 to 256 [[llm-token|tokens]] with 0 overlap to cut costs.'] }],
					answer: [
						{
							type: 'p',
							text: '**[[chunking|Chunking]] split negation from the symptom.** "Did you experience any nausea? — No, none at all" lands across two chunks; only the question chunk is retrieved. Q&A in calls is turn-based, so the answer is often in the next speaker turn.'
						},
						{
							type: 'p',
							text: "**Fix:** chunk by speaker turns or Q&A pairs, add overlap, keep speaker labels, or skip retrieval entirely: a single call transcript often fits the [[context-window]], and per-call extraction doesn't need RAG at all. That's a good critical point to raise."
						}
					]
				},
				{
					id: 'p3q4',
					title: "Today's summary describes last week's call",
					tag: 'tricky',
					prompt: [
						{
							type: 'list',
							items: ['Ingestion and summarization are separate queue consumers. Summaries are triggered by a "call uploaded" event.']
						}
					],
					answer: [
						{
							type: 'p',
							text: "**Async ordering / [[eventual-consistency]].** Summarization fires on \"uploaded\", but chunks aren't indexed yet (embedding queue backlog, vector DB refresh interval). Retrieval scoped by `patient_id` finds only the previous call's chunks, and the LLM summarizes those confidently."
						},
						{
							type: 'p',
							text: '**Fix:** trigger summarization on an "indexed" event carrying the expected chunk count, filter retrieval by `call_id` not patient, and [[fail-open-closed|fail closed]] if zero chunks for that call are found. Add idempotent job keys so retries don\'t produce duplicates.'
						}
					]
				},
				{
					id: 'p3q5',
					title: 'Accuracy degraded slowly over two months, nothing deployed',
					tag: 'core',
					prompt: [],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: '[[data-drift|Data drift]]',
									body: 'New drug launched (names not in [[asr|ASR]] vocabulary), new call scripts, new language mix, longer calls.',
									confirm: 'Compare distributions (call length, language, out-of-vocabulary terms) month over month.'
								},
								{
									title: 'Unpinned model alias',
									body: '`model-x-latest` silently updated by the provider ([[model-pinning]]).',
									confirm: 'Response model id in logs.'
								},
								{
									title: 'Index growth',
									body: 'More similar documents compete for [[top-k]]; duplicates from retries crowd out real matches.'
								},
								{ title: 'Upstream ASR vendor change.' }
							]
						},
						{
							type: 'p',
							text: 'Mention a **[[golden-eval-set|golden eval set]]** run on a schedule, faithfulness/[[groundedness]] scoring, and per-stage metrics so drift is detected before customers notice.'
						}
					]
				},
				{
					id: 'p3q6',
					title: 'Longer calls produce worse summaries',
					tag: 'core',
					prompt: [],
					answer: [
						{
							type: 'p',
							text: '**[[context-window|Context]] overflow and position effects.** Prompt assembly truncates from the end (dropping late side-effect mentions) or the start (dropping system instructions like "only use provided text"). "[[lost-in-the-middle|Lost in the middle]]": models attend less to middle content. Fix: count tokens before sending, reserve budget for instructions, map-reduce summarization per segment, then merge.'
						}
					]
				},
				{
					id: 'p3q7',
					title: 'Design question: how would you make it detectable next time?',
					tag: 'design',
					prompt: [],
					answer: [
						{
							type: 'list',
							items: [
								'**Traceability:** log for each summary the transcript id, chunk ids, retrieval scores, prompt version, model id, embedding version.',
								'**Structured output with citations:** each extracted side effect must cite a transcript span; a validator rejects any entity not present in the cited text.',
								"**Isolation assertions:** every retrieved chunk's tenant must equal the request tenant; violation = hard fail + alert.",
								'**Evals:** [[golden-eval-set|golden set]] with expected extractions; [[recall-precision|precision/recall]] per side effect; faithfulness score; run in CI on prompt/model changes and nightly.',
								'**Human review** for low-confidence or serious adverse events (a regulatory requirement anyway).'
							]
						}
					]
				}
			]
		},

		// ───────────────────────── PART 4 ─────────────────────────
		{
			id: 'p4',
			nav: '4 · Billing',
			eyebrow: 'Part 4 · 55 minutes · coding',
			title: '[[proration|Prorated]] subscription billing',
			meta: 'activation · deactivation · days in month · cents',
			minutes: 55,
			intro: [
				{
					type: 'code',
					lang: 'python',
					caption: '**Rule:** daily rate = monthly price ÷ days in that month. Charge each user the daily rate for every day they were active in the month. Round the total to the nearest cent.',
					code: `monthly_charge(month: "2019-01", subscription, users) -> int  # cents

subscription = { id, customer_id, monthly_price_in_cents }
user = { id, name, customer_id,
         activated_on: date,
         deactivated_on: date | None }   # last active day, or None = still active`
				},
				{
					type: 'callout',
					tone: 'warn',
					title: 'Assumptions to write as a comment before coding',
					text: 'Is `deactivated_on` [[inclusive-exclusive|inclusive]] (last active day) or exclusive (first inactive day)? The starter\'s docstring will say; quote it. No subscription or no users → return 0. Dates are calendar dates; no timezones involved. Round once at the end, half-up, not per day or per user. Are users already filtered by customer? If not, filter by `customer_id`.'
				}
			],
			questions: [
				{
					id: 'p4q1',
					title: 'Warm-up: compute by hand',
					tag: 'core',
					prompt: [
						{ type: 'p', text: 'Price $50.00/month (5000 cents). Jan 2019 has 31 days. What is the charge for each case?' },
						{
							type: 'list',
							items: [
								'(a) one user active all month',
								'(b) one user activated Jan 15, still active',
								'(c) one user deactivated Jan 10 ([[inclusive-exclusive|inclusive]]), activated last year',
								'(d) Feb 2020, user activated Feb 29',
								'(e) one user activated Jan 31',
								'(f) April 2019, active Apr 15–Apr 20 inclusive'
							]
						}
					],
					answer: [
						{
							type: 'table',
							head: ['Case', 'Active days', 'Exact', 'Cents'],
							numeric: [1, 2, 3],
							rows: [
								['a', '31', '5000.000', '5000'],
								['b · Jan 15–31', '17', '2741.935', '2742'],
								['c · Jan 1–10', '10', '1612.903', '1613'],
								['d · [[leap-year]], 29 days', '1', '172.414', '172'],
								['e', '1', '161.290', '161'],
								['f · 30-day month', '6', '1000.000', '1000']
							]
						},
						{
							type: 'p',
							text: '[[off-by-one|Off-by-one]] check: Jan 15 to Jan 31 is `31 − 15 + 1 = 17` days. The `+ 1` is where most bugs live.'
						}
					]
				},
				{
					id: 'p4q2',
					title: 'Reference solution (Python)',
					tag: 'coding',
					answerLabel: 'Show solution',
					prompt: [
						{
							type: 'p',
							text: 'Write yours against the 55-minute timer first. The solution below is verified against every case in the table above.'
						}
					],
					answer: [
						{
							type: 'code',
							lang: 'python',
							code: `import calendar
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, Sequence


@dataclass(frozen=True)
class Subscription:
    id: int
    customer_id: int
    monthly_price_in_cents: int


@dataclass(frozen=True)
class User:
    id: int
    name: str
    activated_on: date
    deactivated_on: Optional[date]  # last active day (inclusive); None = still active
    customer_id: int


def parse_month(month: str) -> date:
    """'2019-01' -> date(2019, 1, 1)."""
    year, month_number = map(int, month.split("-"))
    return date(year, month_number, 1)


def last_day_of_month(day: date) -> date:
    days_in_month = calendar.monthrange(day.year, day.month)[1]
    return day.replace(day=days_in_month)


def active_days_in_range(user: User, start: date, end: date) -> int:
    """Inclusive count of days in [start, end] on which the user was active."""
    overlap_start = max(user.activated_on, start)
    overlap_end = min(user.deactivated_on or end, end)
    return max(0, (overlap_end - overlap_start).days + 1)


def round_half_up_to_cents(amount: Decimal) -> int:
    return int(amount.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def monthly_charge(month: str,
                   subscription: Optional[Subscription],
                   users: Sequence[User]) -> int:
    if subscription is None or not users:
        return 0

    month_start = parse_month(month)
    month_end = last_day_of_month(month_start)
    days_in_month = (month_end - month_start).days + 1

    billable_user_days = sum(
        active_days_in_range(user, month_start, month_end)
        for user in users
        if user.customer_id == subscription.customer_id
    )

    # Multiply before dividing and round once: avoids float drift and per-day rounding error.
    exact_cents = Decimal(subscription.monthly_price_in_cents) * billable_user_days / days_in_month
    return round_half_up_to_cents(exact_cents)`
						},
						{
							type: 'p',
							text: '**Complexity:** [[big-o-notation|O(U)]] time, O(1) extra space, thanks to [[interval-overlap|interval overlap]]. The naive "loop every day, count active users" version is O(D × U). Both are fine for the expected input sizes; mention the trade-off. Some graders expect to see day-loop helpers (`first_day_of_month`, `next_day`) because the starter suggests them. If the starter ships those helpers, use them and note the faster interval-overlap approach in a comment.'
						}
					]
				},
				{
					id: 'p4q3',
					title: 'Reference solution (TypeScript)',
					tag: 'coding',
					answerLabel: 'Show solution',
					prompt: [],
					answer: [
						{
							type: 'code',
							lang: 'typescript',
							code: `const MS_PER_DAY = 86_400_000;

interface Subscription { id: number; customerId: number; monthlyPriceInCents: number }
interface User {
  id: number; name: string; customerId: number;
  activatedOn: Date;
  deactivatedOn: Date | null; // last active day, inclusive
}

// Work in whole UTC day numbers so local DST/timezone never shifts a date.
function toUtcDayNumber(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / MS_PER_DAY;
}

function monthBounds(month: string): { start: number; end: number } {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = Date.UTC(year, monthNumber - 1, 1) / MS_PER_DAY;
  const end = Date.UTC(year, monthNumber, 0) / MS_PER_DAY; // day 0 of next month = last day
  return { start, end };
}

function activeDaysInRange(user: User, start: number, end: number): number {
  const from = Math.max(toUtcDayNumber(user.activatedOn), start);
  const to = Math.min(user.deactivatedOn ? toUtcDayNumber(user.deactivatedOn) : end, end);
  return Math.max(0, to - from + 1);
}

// Exact integer half-up: floor((2n + d) / 2d). No floating-point rounding.
function divideRoundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export function monthlyCharge(month: string, subscription: Subscription | null, users: User[]): number {
  if (!subscription || users.length === 0) return 0;
  const { start, end } = monthBounds(month);
  const daysInMonth = end - start + 1;
  const userDays = users
    .filter(u => u.customerId === subscription.customerId)
    .reduce((sum, u) => sum + activeDaysInRange(u, start, end), 0);
  return divideRoundHalfUp(subscription.monthlyPriceInCents * userDays, daysInMonth);
}`
						},
						{
							type: 'callout',
							tone: 'warn',
							text: 'JS traps: months are 0-indexed in `Date.UTC`; `new Date("2019-01-15")` parses as [[utc|UTC]] but `new Date(2019, 0, 15)` is local; calling `getDate()` on a UTC-parsed date in UTC−5 gives the 14th.'
						}
					]
				},
				{
					id: 'p4q4',
					title: 'Write the extra test cases',
					tag: 'coding',
					answerLabel: 'Show test list',
					prompt: [{ type: 'p', text: 'List at least ten edge cases before you peek. Reviewers explicitly reward additional tests.' }],
					answer: [
						{
							type: 'code',
							lang: 'python',
							code: `import pytest
from datetime import date as d

SUB = Subscription(id=1, customer_id=1, monthly_price_in_cents=5000)

def user(activated, deactivated=None, customer_id=1):
    return User(id=1, name="u", activated_on=activated,
                deactivated_on=deactivated, customer_id=customer_id)

@pytest.mark.parametrize("month, users, expected", [
    ("2019-01", [user(d(2018, 10, 1))], 5000),                    # full month
    ("2019-01", [user(d(2019, 1, 15))], 2742),                    # joins mid-month
    ("2019-01", [user(d(2018, 1, 1), d(2019, 1, 10))], 1613),     # leaves mid-month
    ("2019-04", [user(d(2019, 4, 15), d(2019, 4, 20))], 1000),    # joins and leaves; 30-day month
    ("2020-02", [user(d(2020, 2, 29))], 172),                     # leap day
    ("2019-02", [user(d(2018, 1, 1))], 5000),                     # 28-day month, full
    ("2019-01", [user(d(2019, 1, 31))], 161),                     # last day only
    ("2019-01", [user(d(2019, 1, 1), d(2019, 1, 1))], 161),       # first day only
    ("2019-01", [user(d(2019, 2, 1))], 0),                        # activates after month
    ("2019-01", [user(d(2018, 1, 1), d(2018, 12, 31))], 0),       # left before month
    ("2019-01", [user(d(2018, 1, 1)), user(d(2018, 1, 1))], 10000),  # multiple users
    ("2019-01", [user(d(2018, 1, 1), customer_id=2)], 0),         # other customer
    ("2019-12", [user(d(2019, 12, 1))], 5000),                    # December boundary
    ("2019-01", [], 0),                                           # no users
])
def test_monthly_charge(month, users, expected):
    assert monthly_charge(month, SUB, users) == expected

def test_no_subscription():
    assert monthly_charge("2019-01", None, [user(d(2018, 1, 1))]) == 0

def test_rounds_half_up_not_bankers():
    one_cent = Subscription(1, 1, 1)
    # 1 cent * 15 / 30 = 0.5 exactly; Python's round() would give 0
    assert monthly_charge("2019-04", one_cent, [user(d(2019, 4, 1), d(2019, 4, 15))]) == 1`
						},
						{
							type: 'p',
							text: "Also mention, even if you don't implement: deactivated before activated (invalid data: raise or treat as 0?), same user reactivated (two records → both counted), negative or zero price."
						}
					]
				},
				{
					id: 'p4q5',
					title: 'Why does this naive version fail one of the tests?',
					tag: 'tricky',
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `daily_rate = sub.monthly_price_in_cents / days_in_month
total = 0
for day in each_day(month):
    total += daily_rate * count_active(users, day)
return round(total)`
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Two problems.** (1) Python 3 `round()` is [[bankers-rounding|banker\'s rounding]] (half to even): `round(0.5) == 0`, `round(2.5) == 2`. For the 1-cent test above it returns 0, not 1. (2) Summing [[floating-point|floats]] accumulates error, so a value that should be exactly `x.5` can come out as `x.4999999`. On the half-cent case the naive version returns 0 while the Decimal version returns 1.'
						},
						{
							type: 'p',
							text: 'If the starter uses this structure, keep it but compute `Decimal` or integer `price × user_days`, divide once, round half-up once. State the policy in a comment.'
						}
					]
				},
				{
					id: 'p4q6',
					title: 'Variant: deactivation is exclusive',
					tag: 'variant',
					prompt: [
						{
							type: 'p',
							text: 'If `deactivated_on` means "first day no longer active", what changes, and what is case (c) now?'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'Overlap end becomes `min(deactivated_on − 1 day, month_end)`. Case (c) drops to 9 days → 5000×9/31 = 1451.6 → 1452. One helper (`last_active_day(user)`) isolates the rule so it changes in one place. Point this out: it\'s the Single Responsibility argument for the helper.'
						}
					]
				},
				{
					id: 'p4q7',
					title: 'Variant: split the charge so per-user line items sum to the total',
					tag: 'tricky',
					prompt: [
						{
							type: 'p',
							text: 'Finance wants one invoice line per user. Rounding each line separately makes the sum differ from the total by a few cents. How do you fix it?'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**[[largest-remainder|Largest remainder allocation]].** Compute exact amounts, floor each, then hand out the leftover cents (`total − Σ floors`) one at a time to the lines with the largest fractional parts. The lines always sum to the rounded total, and it\'s deterministic if you tie-break by user id.'
						},
						{
							type: 'code',
							lang: 'python',
							code: `def allocate(total_cents: int, exact: dict[int, Decimal]) -> dict[int, int]:
    floors = {uid: int(v) for uid, v in exact.items()}
    leftover = total_cents - sum(floors.values())
    by_remainder = sorted(exact, key=lambda uid: (-(exact[uid] - floors[uid]), uid))
    for uid in by_remainder[:leftover]:
        floors[uid] += 1
    return floors`
						}
					]
				}
			]
		},

		// ───────────────────────── TEASERS ─────────────────────────
		{
			id: 'teasers',
			nav: 'Teasers',
			eyebrow: 'Rapid fire · 1–2 min each',
			title: 'Brain teasers',
			meta: 'quick reasoning reps for all four parts',
			questions: [
				{
					id: 't1',
					title: "Little's law",
					tag: 'teaser',
					prompt: [{ type: 'p', text: '200 req/s steady. Latency goes from 50 ms to 2 s. Workers: 64. What happens?' }],
					answer: [
						{
							type: 'p',
							text: 'In-flight = λ × W ([[littles-law]]). Before: 200 × 0.05 = 10. After: 200 × 2 = 400. Only 64 workers, so 336 requests queue, queue time grows without bound, and latency spirals well past 2 s. [[throughput|Throughput]] caps at 64 / 2 s = 32 req/s.'
						}
					]
				},
				{
					id: 't2',
					title: 'Hit rate 99% → 98%',
					tag: 'teaser',
					prompt: [{ type: 'p', text: '"Only a 1-point drop." How much does DB read load change?' }],
					answer: [
						{
							type: 'p',
							text: 'Misses go from 1% to 2%: DB load **doubles**. Always reason in miss rate, not [[cache-hit-rate|hit rate]].'
						}
					]
				},
				{
					id: 't3',
					title: '[[tail-latency|Tail at scale]]',
					tag: 'teaser',
					prompt: [
						{
							type: 'p',
							text: 'A request [[fan-out|fans out]] to 100 shards. Each shard is slow 1% of the time. How often is the whole request slow?'
						}
					],
					answer: [
						{
							type: 'p',
							text: "1 − 0.99¹⁰⁰ ≈ **63%**. One shard's p99 becomes the request's p50-ish. Mitigations: [[hedged-requests]], partial results, reduce fan-out."
						}
					]
				},
				{
					id: 't4',
					title: 'Retry storm math',
					tag: 'teaser',
					prompt: [
						{
							type: 'p',
							text: 'Three layers (frontend → API → service), each retries 3 times. A deep failure causes how many calls to the bottom service per user request?'
						}
					],
					answer: [
						{
							type: 'p',
							text: '(1+3)³ = **64** calls. Retry only at one layer, with a [[retry-budget|retry budget]], backoff and jitter. See [[retry-storm]].'
						}
					]
				},
				{
					id: 't5',
					title: 'Is a timeout a failure?',
					tag: 'teaser',
					prompt: [],
					answer: [
						{
							type: 'p',
							text: "No. It's an **unknown outcome**. Only retry operations that are [[idempotency|idempotent]], or make them idempotent with a key."
						}
					]
				},
				{
					id: 't6',
					title: 'Which bug only some customers see?',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'Name five bug classes that typically affect a subset of users.' }],
					answer: [
						{
							type: 'p',
							text: 'Pagination (big accounts), timezone (users in certain zones/hours), case/encoding (non-ASCII names, mixed-case emails), feature flag/plan tier, race conditions under concurrency, [[locale-formatting|locale number formats]] (`1.234,56`), data created before a migration.'
						}
					]
				},
				{
					id: 't7',
					title: 'Retrieval or generation?',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'A summary contains a wrong fact. What single log line tells you which stage is at fault?' }],
					answer: [
						{
							type: 'p',
							text: 'The **retrieved [[chunking|chunk texts/ids]]** for that request. If the wrong fact is in the context → retrieval/ingestion problem. If not → the LLM produced it ([[hallucination]] or prompt issue).'
						}
					]
				},
				{
					id: 't8',
					title: 'Is a similarity score of 0.82 good?',
					tag: 'teaser',
					prompt: [],
					answer: [
						{
							type: 'p',
							text: 'Meaningless without context. [[cosine-similarity|Score]] distributions differ by model, dimension and normalization. Thresholds must be calibrated per model on labelled data, and re-calibrated after any embedding change.'
						}
					]
				},
				{
					id: 't9',
					title: 'Does this pipeline even need RAG?',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'Task: extract side effects from *one* call transcript of ~4k tokens.' }],
					answer: [
						{
							type: 'p',
							text: 'Probably not. The whole transcript fits in [[context-window|context]]. Retrieval only adds failure modes (missed chunks, cross-call contamination). [[rag|RAG]] makes sense for questions across many calls or lookups against a drug reference database. Raising this shows architectural judgment.'
						}
					]
				},
				{
					id: 't10',
					title: 'Python rounding',
					tag: 'teaser',
					prompt: [{ type: 'p', text: '`round(0.5)`, `round(1.5)`, `round(2.5)`, `round(2.675, 2)`?' }],
					answer: [
						{
							type: 'p',
							text: '`0`, `2`, `2`, `2.67`. [[bankers-rounding|Banker\'s rounding]], and 2.675 is stored as 2.67499999… in binary ([[floating-point]]).'
						}
					]
				},
				{
					id: 't11',
					title: 'Next month in one line',
					tag: 'teaser',
					prompt: [{ type: 'p', text: "What's wrong with `date(d.year, d.month + 1, 1)`?" }],
					answer: [
						{
							type: 'p',
							text: 'Crashes in December (month 13). Use `(d.replace(day=28) + timedelta(days=4)).replace(day=1)` or `calendar.monthrange`. In JS, `new Date(Date.UTC(y, m, 1))` rolls over correctly because Date normalizes overflow.'
						}
					]
				},
				{
					id: 't12',
					title: 'Days in month without a library',
					tag: 'teaser',
					prompt: [],
					answer: [
						{
							type: 'p',
							text: '[[leap-year|Leap year]]: divisible by 4, except centuries unless divisible by 400 (2000 yes, 1900 no). Feb = 29 or 28; Apr, Jun, Sep, Nov = 30; others 31. JS shortcut: `new Date(Date.UTC(y, m, 0)).getUTCDate()` with 1-indexed `m`.'
						}
					]
				},
				{
					id: 't13',
					title: 'Rounding per day vs once',
					tag: 'teaser',
					prompt: [
						{
							type: 'p',
							text: 'Price 1000 cents, 31-day month, one user all month. Round the daily rate first. What\'s the bill?'
						}
					],
					answer: [
						{
							type: 'p',
							text: '1000/31 = 32.258 → 32 cents/day × 31 = **992**, not 1000. A full-month user should pay exactly the monthly price. Round once at the end.'
						}
					]
				}
			]
		},

		// ───────────────────────── DAY OF ─────────────────────────
		{
			id: 'day',
			nav: 'Day of',
			eyebrow: 'Logistics',
			title: 'Day-of checklist',
			intro: [
				{
					type: 'cards',
					items: [
						{
							title: 'Before you start',
							items: [
								"Start within the assessment window with buffer; don't open it in the last hour.",
								'Quiet 2 h block, charger, stable connection.',
								'Pick your Part 4 language now. Use the one where you know the date API without searching.',
								'Have a scratch file ready for the Part 1 and 3 outlines.'
							]
						},
						{
							title: 'Parts 1 & 3',
							items: [
								'Headings: Observations → Hypotheses by layer → Ranked top 3 → How I\'d confirm → Mitigation.',
								'Quote specific numbers from the diagram.',
								"Say what you'd rule out and why."
							]
						},
						{
							title: 'Part 2',
							items: [
								'Name the file and line.',
								'Include data remediation and the test that would have caught it.',
								'Non-tech note: no jargon, give dates.',
								'Note where you overrode the AI.'
							]
						},
						{
							title: 'Part 4',
							items: [
								'Read the starter code and docstrings fully first (5 min).',
								'Assumptions comment → helpers → main → tests.',
								'Run the provided tests early and often.',
								'Leave 10 min for extra tests and cleanup.'
							]
						}
					]
				}
			],
			questions: []
		}
	]
};

export default a1;
