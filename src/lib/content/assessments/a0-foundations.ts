import type { Assessment } from '../types';
import { shape, step, ramp, timeAxis } from '../series';

// Golden-signals dashboard for the reliability part: a dependency slows at 10:20, saturation follows.
const gx = timeAxis('10:00', 40);

const a0: Assessment = {
	id: 'foundations',
	number: 0,
	title: 'System design foundations',
	tagline: 'The on-ramp: every basic the harder assessments assume, taught through short scenarios with the arithmetic shown.',
	description:
		'Start here if any of the other assessments made you reach for a search engine. Each question is a small, concrete scenario; each answer explains *why*, not just *what*. Almost every term is underlined: hover it. By the end you should be able to estimate a system\'s size on a napkin, sketch its request path, pick a database and a caching strategy, and explain the trade-offs out loud.',
	minutes: 180,
	difficulty: 'foundation',
	track: 'core',
	topics: ['request path', 'estimation', 'scaling', 'databases', 'caching', 'messaging', 'reliability', 'APIs', 'classic designs'],
	overview: [
		{
			type: 'budget',
			items: [
				{ label: '1 · Request path', minutes: 15 },
				{ label: '2 · Estimation', minutes: 20 },
				{ label: '3 · Stateless tier', minutes: 15 },
				{ label: '4 · Data', minutes: 25 },
				{ label: '5 · Caching', minutes: 15 },
				{ label: '6 · Async', minutes: 15 },
				{ label: '7 · Reliability', minutes: 15 },
				{ label: '8 · APIs', minutes: 15 },
				{ label: '9 · Mini-designs', minutes: 35 },
				{ label: '10 · Spot the flaw', minutes: 10 }
			]
		},
		{
			type: 'callout',
			tone: 'info',
			title: 'How to use this set',
			text: 'Don\'t race it. Write your answer first, even one line, then open the model answer and compare the **reasoning**. The goal is a toolkit of mental models: the [[request-lifecycle|request path]], [[back-of-envelope|napkin maths]], [[littles-law|Little\'s law]], the [[cap-theorem|CAP]] trade-off, and [[caching-strategies|caching patterns]]. Every harder assessment reuses them.'
		},
		{
			type: 'cards',
			items: [
				{
					title: 'A design answer has a shape',
					items: [
						'**Requirements:** what must it do, for how many users?',
						'**Estimates:** requests/s, storage, bandwidth.',
						'**API:** the few calls clients make.',
						'**Data model:** what is stored, keyed by what.',
						'**Diagram:** boxes and arrows for the request path.',
						'**Bottlenecks & trade-offs:** what breaks first, and what you chose not to do.'
					]
				},
				{
					title: 'Words that earn points',
					items: [
						'"It depends on the access pattern, so let me state it."',
						'"Let me estimate before choosing."',
						'"The trade-off here is…"',
						'"This is a [[single-point-of-failure]]; here\'s the fix."',
						'"I\'d start simple and change this when we hit X."'
					]
				},
				{
					title: 'Common beginner traps',
					items: [
						'Designing for Google scale when the numbers say one server.',
						'Adding a cache without saying how it gets invalidated.',
						'Doing slow work (emails, image processing) inside the web request.',
						'Saying "NoSQL scales" without naming the access pattern.',
						'Forgetting what happens when a component fails.'
					]
				}
			]
		}
	],
	parts: [
		// ───────────────────────── PART 1 ─────────────────────────
		{
			id: 'p1',
			nav: '1 · Request path',
			eyebrow: 'Part 1 · 15 minutes',
			title: 'How a request travels',
			meta: 'DNS · TCP · TLS · load balancer · app · cache · DB',
			minutes: 15,
			intro: [
				{
					type: 'flow',
					steps: [
						{ label: 'Browser', note: 'local caches' },
						{ label: '[[dns|DNS]]', note: 'name → IP' },
						{ label: '[[cdn|CDN]] edge', note: 'static & cacheable' },
						{ label: '[[load-balancer|Load balancer]]', note: 'TLS, pick a server' },
						{ label: 'App server', note: 'business logic' },
						{ label: 'Cache', note: 'hot data in RAM' },
						{ label: 'Database', note: 'source of truth' }
					],
					caption: 'Keep this picture in your head for every question in this set. Debugging = "which hop got slower?". Designing = "which hops can I remove, shorten or skip?".'
				}
			],
			questions: [
				{
					id: 'f-p1q1',
					title: 'Why is the first visit so much slower than the second?',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'p',
							text: 'A user in Lisbon opens your app (servers in Frankfurt, round trip ≈ 40 ms). The first page load takes ~250 ms before the first byte arrives; a refresh a few seconds later takes ~90 ms. The server spends 50 ms on each request both times. Where did the extra 160 ms go?'
						}
					],
					hints: ['Count round trips. What has to happen before the request itself can even be sent?'],
					answer: [
						{
							type: 'table',
							head: ['Step', 'First visit', 'Refresh'],
							numeric: [1, 2],
							rows: [
								['[[dns|DNS]] lookup (resolver cache miss)', '~40 ms', '0 (cached)'],
								['[[tcp-handshake|TCP handshake]]', '40 ms (1 [[rtt|RTT]])', '0 (connection kept open)'],
								['[[tls-handshake|TLS 1.3 handshake]]', '40 ms (1 RTT)', '0 (reused)'],
								['Request → first byte', '40 ms', '40 ms'],
								['Server work', '50 ms', '50 ms'],
								['**Total**', '**~210–250 ms**', '**~90 ms**']
							]
						},
						{
							type: 'p',
							text: 'The difference is **setup round trips**, not server work. That is why browsers keep connections open (keep-alive), why servers use [[connection-pool|connection pools]] to databases, and why a [[cdn]] helps even for uncacheable pages: TLS and TCP handshakes finish against a nearby edge (5 ms RTT) instead of a far-away origin. See the [[request-lifecycle]] page.'
						}
					]
				},
				{
					id: 'f-p1q2',
					title: 'Read the trace: which hop would you fix first?',
					tag: 'core',
					minutes: 4,
					prompt: [
						{ type: 'p', text: '`GET /dashboard` takes 640 ms at the server. Here is one typical [[trace-span|trace]].' },
						{
							type: 'trace',
							trace: {
								title: 'GET /dashboard',
								traceId: '4bf92f35',
								spans: [
									{ id: 'a', service: 'load-balancer', name: 'GET /dashboard', start: 0, duration: 640 },
									{ id: 'b', parent: 'a', service: 'api', name: 'handler', start: 4, duration: 632 },
									{ id: 'c', parent: 'b', service: 'api', name: 'auth: verify session', start: 6, duration: 12 },
									{ id: 'd', parent: 'b', service: 'redis', name: 'GET user:42:prefs', start: 20, duration: 1 },
									{ id: 'e', parent: 'b', service: 'postgres', name: 'SELECT projects (×1)', start: 24, duration: 18 },
									{ id: 'f', parent: 'b', service: 'postgres', name: 'SELECT tasks WHERE project_id=? (×40, one per project)', start: 44, duration: 560, note: '40 sequential queries of ~14 ms each' },
									{ id: 'g', parent: 'b', service: 'api', name: 'render JSON', start: 606, duration: 28 }
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: '**The 40 sequential task queries (560 ms of 640).** This is the [[n-plus-one|N+1 query]] pattern: one query for the list, then one more per item. Each query is individually fast (~14 ms, mostly the network round trip plus a small lookup), but 40 of them in a row add up.'
						},
						{
							type: 'list',
							items: [
								'**Fix:** one query for all tasks: `SELECT * FROM tasks WHERE project_id = ANY($1)`, then group in code. 560 ms → ~20 ms.',
								'**Don\'t start with:** [[redis|Redis]] (1 ms) or auth (12 ms). Optimising a span that is 2% of the time can save at most 2%.',
								'**Rule of thumb:** in a trace, fix the widest bar first, and look for many identical small bars in a row; that is almost always a loop doing I/O.'
							]
						}
					]
				},
				{
					id: 'f-p1q3',
					title: 'Same code, database in another region',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'p',
							text: 'A page makes 30 sequential database queries. With the database in the same zone as the app (round trip ≈ 0.5 ms), the page takes ~30 ms. To "save costs", someone moves the app to a different region from the database (round trip ≈ 80 ms). Estimate the new page time before anyone deploys it.'
						}
					],
					answer: [
						{
							type: 'p',
							text: '30 queries × 80 ms ≈ **2.4 seconds**, up from ~30 ms: roughly 80× slower with zero code change. Network round trips dominate when calls are sequential. [[latency-numbers|Latency numbers]] matter precisely because they turn "a small move" into an outage.'
						},
						{
							type: 'callout',
							tone: 'info',
							text: 'Rule: keep chatty components (app ↔ database, app ↔ cache) in the same zone or region. If you must cross a long distance, make fewer, bigger calls.'
						}
					]
				},
				{
					id: 'f-p1q4',
					title: 'What does the load balancer actually do for you?',
					tag: 'core',
					minutes: 3,
					prompt: [{ type: 'p', text: 'List four jobs a [[load-balancer]] does in a typical web stack, and one new risk it introduces.' }],
					answer: [
						{
							type: 'list',
							items: [
								'**Spreads requests** across servers ([[round-robin]], [[least-connections]]).',
								'**Removes unhealthy servers** using [[health-check|health checks]], so a crashed server stops getting traffic within seconds.',
								'**Terminates TLS**, so app servers speak plain HTTP inside the private network and the certificate lives in one place.',
								'**Gives one stable address** while servers are added, removed and replaced (deploys, [[autoscaling]]).'
							]
						},
						{
							type: 'p',
							text: '**New risk:** it is in front of everything, so it can be a [[single-point-of-failure]]. Managed cloud load balancers run as redundant fleets across [[availability-zone|zones]] for exactly this reason; a self-run one needs at least two instances and a failover mechanism.'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 2 ─────────────────────────
		{
			id: 'p2',
			nav: '2 · Estimation',
			eyebrow: 'Part 2 · 20 minutes · show your arithmetic',
			title: '[[back-of-envelope|Back-of-envelope]] estimation',
			meta: 'QPS · storage · bandwidth · servers · peak factor',
			minutes: 20,
			intro: [
				{
					type: 'cards',
					items: [
						{
							title: 'Constants',
							items: ['1 day = 86,400 s ≈ 10⁵ s', '1M req/day ≈ 12 req/s', '1 month ≈ 2.6M s', '1 year ≈ 3.15 × 10⁷ s']
						},
						{
							title: 'Sizes',
							items: ['A tweet-sized text row ≈ 300 B', 'A small JSON API response ≈ 2–10 KB', 'A phone photo ≈ 2–4 MB', '1 min of HD video ≈ 50–100 MB']
						},
						{
							title: 'Habits',
							items: ['Round to 1–2 significant figures.', 'Write units on every line.', 'Apply a [[peak-factor]] (2–10×).', 'Multiply storage by the number of copies.']
						}
					]
				}
			],
			questions: [
				{
					id: 'f-p2q1',
					title: 'How many servers for 50M daily users?',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'p',
							text: '50 million daily active users, ~30 API requests each per day. Traffic peaks at 3× the daily average. One app server handles 1,000 req/s at most, and you want each running at no more than 70% of that at peak. How many app servers?'
						}
					],
					answer: [
						{
							type: 'table',
							head: ['Step', 'Arithmetic', 'Result'],
							rows: [
								['Requests per day', '50M × 30', '1.5 billion'],
								['Average [[throughput|QPS]]', '1.5B ÷ 86,400', '≈ 17,400 req/s'],
								['Peak QPS', '17,400 × 3', '≈ 52,000 req/s'],
								['Usable capacity per server', '1,000 × 70%', '700 req/s'],
								['Servers at peak', '52,000 ÷ 700', '≈ 75']
							]
						},
						{
							type: 'p',
							text: 'Then add [[headroom]] for failure: if you run in 3 [[availability-zone|zones]] and must survive losing one, the remaining two-thirds must carry the peak, so 75 ÷ (2/3) ≈ **113 servers**. Stating that last step is what separates a good estimate from a merely correct one.'
						}
					]
				},
				{
					id: 'f-p2q2',
					title: 'How much storage does a chat app need per year?',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: '20 million daily users send 40 messages each per day. A message is ~100 bytes of text plus ~200 bytes of metadata (ids, timestamps, flags). Messages are kept forever, stored with 3 copies. Estimate: writes per second, and storage added per year.'
						}
					],
					answer: [
						{
							type: 'table',
							head: ['Quantity', 'Arithmetic', 'Result'],
							rows: [
								['Messages per day', '20M × 40', '800M'],
								['Average writes/s', '800M ÷ 86,400', '≈ 9,300 /s'],
								['Bytes per day', '800M × 300 B', '240 GB'],
								['Per year', '240 GB × 365', '≈ 88 TB'],
								['With 3 copies', '88 TB × 3', '≈ 260 TB / year']
							]
						},
						{
							type: 'p',
							text: '**What it tells you:** ~9,000 writes/s (more at peak) and hundreds of TB per year is beyond one comfortable database server. You will need [[sharding]] (probably by conversation id, so a chat\'s messages live together), and an archiving plan for old messages. The text itself is small; it is the volume that matters.'
						}
					]
				},
				{
					id: 'f-p2q3',
					title: 'Can we serve the live stream from our own servers?',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'p',
							text: 'A product launch will be streamed live. Marketing expects 1 million concurrent viewers at 5 Mbit/s each. The team plans to serve it from 20 servers with 10 Gbit/s network cards. Will it work?'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'Demand: 1M × 5 Mbit/s = **5,000,000 Mbit/s = 5 Tbit/s**. Supply: 20 × 10 Gbit/s = **0.2 Tbit/s**. You are short by **25×**, before counting that network cards can\'t run at 100%.'
						},
						{
							type: 'p',
							text: 'This is a [[cdn]] job. Video is the same bytes for everyone, so edge servers near viewers cache each segment once and serve it millions of times. Your origin serves a few copies to the CDN instead of a million to viewers. One multiplication killed a bad plan in 30 seconds; that is the value of estimating.'
						}
					]
				},
				{
					id: 'f-p2q4',
					title: 'Does the hot data fit in one cache server?',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'p',
							text: 'A shop has 100 million product pages, each rendered from ~2 KB of data. Analytics show 1% of products get 90% of views. You have Redis nodes with 64 GB of RAM. How many nodes do you need to cache the popular products? All products?'
						}
					],
					answer: [
						{
							type: 'list',
							items: [
								'**Hot set:** 1% × 100M = 1M products × 2 KB = **2 GB**. That fits comfortably in **one** node, and it captures ~90% of reads.',
								'**Everything:** 100M × 2 KB = 200 GB, so 4 nodes at 64 GB (more with overhead, maybe 5–6). Possible, but it buys only the last 10% of hits.'
							]
						},
						{
							type: 'p',
							text: 'Real access patterns are skewed, so a small cache usually gets most of the benefit. Size the cache for the hot set, use a [[ttl]] and an [[eviction|eviction]] policy ([[lru]]), and let the long tail go to the database.'
						}
					]
				},
				{
					id: 'f-p2q5',
					title: "Little's law: how many workers do we need?",
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: 'A service receives a steady 100 requests/s. Each request takes 200 ms of processing, and each worker handles one request at a time. How many workers keep up? What happens if latency rises to 1 s because a dependency slows down?'
						}
					],
					answer: [
						{
							type: 'p',
							text: '[[littles-law|Little\'s law]]: requests in flight = arrival rate × time each spends in the system. 100/s × 0.2 s = **20 requests in flight**, so you need at least 20 workers (plus headroom, say 30).'
						},
						{
							type: 'p',
							text: 'At 1 s latency: 100 × 1 = **100 in flight**. With 30 workers, 70 requests wait in a queue; the queue grows every second, and every request, even fast ones, now waits behind it. This is how one slow dependency takes down a whole service: it doesn\'t use more CPU, it holds [[worker-pool|workers]] longer. Short [[timeout|timeouts]] are the defence.'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 3 ─────────────────────────
		{
			id: 'p3',
			nav: '3 · Stateless tier',
			eyebrow: 'Part 3 · 15 minutes',
			title: 'Scaling the stateless tier',
			meta: 'vertical vs horizontal · load balancing · sessions · health checks · autoscaling',
			minutes: 15,
			questions: [
				{
					id: 'f-p3q1',
					title: 'Bigger machine or more machines?',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'p',
							text: 'A young product has one app server (4 [[vcpu|vCPU]], 80% CPU at peak) and one Postgres server (4 vCPU, 85% CPU at peak). Traffic will double in three months. What do you do for each, and why might the answers differ?'
						}
					],
					answer: [
						{
							type: 'list',
							items: [
								'**App server → [[horizontal-scaling|scale out]].** Make sure it is [[stateless-service|stateless]], put two or more behind a [[load-balancer]], and you gain capacity *and* survive one failing. You needed a second server for reliability anyway.',
								'**Database → [[vertical-scaling|scale up]] first.** Moving from 4 to 16 vCPU is a single change with no application rewrite. Scaling a database out ([[read-replica|read replicas]], [[sharding]]) is real engineering work; do it when the biggest reasonable machine is no longer enough, or when reads clearly dominate.'
							]
						},
						{
							type: 'p',
							text: 'The interview point: stateless things scale out cheaply; stateful things are expensive to scale out, so buy time with bigger hardware and caching first.'
						}
					]
				},
				{
					id: 'f-p3q2',
					title: '"Users get logged out randomly since we added servers"',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'p',
							text: 'Login worked fine on one server. After scaling to three behind a [[round-robin]] load balancer, users report being logged out every few clicks. Nothing else changed. What happened, and what are your options?'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Sessions are stored in each server\'s memory.** You log in on server A; your next request goes to B, which has never heard of you. Two out of three requests land on a server that doesn\'t know you, which matches "every few clicks".'
						},
						{
							type: 'table',
							head: ['Option', 'How', 'Trade-off'],
							rows: [
								['Shared session store', 'Sessions in Redis or the database; any server can read them', 'Best default; one more dependency'],
								['Signed token in a cookie', 'Session data signed by the server (e.g. a [[jwt|JWT]]); nothing stored server-side', 'Hard to revoke before expiry; keep it small'],
								['[[sticky-sessions|Sticky sessions]]', 'Load balancer pins each user to one server', 'Quick fix, but users lose sessions when their server dies, and load becomes uneven']
							]
						},
						{ type: 'p', text: 'Making servers [[stateless-service|stateless]] is the real fix; sticky sessions only hide the state.' }
					]
				},
				{
					id: 'f-p3q3',
					title: 'Round robin keeps overloading one server',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'p',
							text: 'Most requests take ~20 ms, but "export report" takes ~30 s. With [[round-robin]], one server sometimes ends up with several exports at once and becomes very slow, while the others are nearly idle. Why, and what would you change?'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'Round robin counts **requests**, not **work**. It keeps handing the busy server its "fair share" of new requests even while it is stuck on three 30-second exports. [[least-connections|Least connections]] fixes the symptom: a server holding long requests has more open connections and receives fewer new ones.'
						},
						{
							type: 'p',
							text: 'The better fix is to stop doing 30-second work in a web request at all: put exports on a [[message-queue]], process them with background workers, and email or notify the user when the file is ready. Mixed request sizes on the same servers is a design smell.'
						}
					]
				},
				{
					id: 'f-p3q4',
					title: 'The health check that took everything down',
					tag: 'tricky',
					minutes: 3,
					prompt: [
						{
							type: 'p',
							text: 'To be thorough, `/health` checks the database, Redis and the payments API, and returns 500 if any of them fail. One afternoon the payments API has a 2-minute blip. Every page on the site returns 503, including pages that never touch payments. Why?'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'All servers share the same payments dependency, so all of them failed the [[health-check]] at the same time. The [[load-balancer]] removed **every** server from rotation and had nothing left to send traffic to, hence 503 everywhere. A partial problem became a total outage.'
						},
						{
							type: 'list',
							items: [
								'The load balancer\'s check should ask "**can this process serve requests?**" (it is running and not [[deadlock|deadlocked]]), not "is everything I depend on healthy?".',
								'Handle a failing dependency **inside** the request: [[timeout]], [[circuit-breaker]], [[graceful-degradation|degrade]] the features that need it.',
								'Report dependency health on a separate endpoint for dashboards and alerts. See [[deep-health-check]] and [[readiness-probe]].'
							]
						}
					]
				},
				{
					id: 'f-p3q5',
					title: '[[autoscaling|Autoscaling]] on CPU didn\'t scale',
					tag: 'tricky',
					minutes: 3,
					prompt: [
						{
							type: 'p',
							text: 'An API autoscales when average CPU exceeds 70%. During a traffic surge, latency goes from 100 ms to 3 s, yet CPU stays at 25% and no servers are added. Most of each request is spent waiting for the database.'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'The servers aren\'t busy computing; they are **waiting**. Workers sit idle on database calls, so CPU stays low while every worker is occupied ([[saturation]] of the [[worker-pool]], not of CPU). The autoscaler is watching the wrong signal.'
						},
						{
							type: 'p',
							text: 'Two lessons. (1) Scale on a signal that reflects saturation for this workload: in-flight requests per server, queue length, or latency. (2) **More servers wouldn\'t help here anyway**: if the database is the bottleneck, more app servers only send it more concurrent queries. Find the real bottleneck before adding capacity; this is the same trap as the "autoscaling made it worse" question in Assessment 1.'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 4 ─────────────────────────
		{
			id: 'p4',
			nav: '4 · Data',
			eyebrow: 'Part 4 · 25 minutes',
			title: 'Data basics',
			meta: 'SQL vs NoSQL · indexes · normalization · ACID · replication · sharding · CAP · consistency',
			minutes: 25,
			questions: [
				{
					id: 'f-p4q1',
					title: 'Pick a database for each access pattern',
					tag: 'core',
					minutes: 5,
					prompt: [
						{ type: 'p', text: 'For each feature, pick a storage type and say why in one line.' },
						{
							type: 'list',
							ordered: true,
							items: [
								'Account balances and money transfers.',
								'Shopping carts, read and written by session id, gone after 7 days.',
								'A product catalogue where shoes, laptops and sofas have very different attributes.',
								'Server metrics: millions of numeric points per minute, queried by time range.',
								'User-uploaded profile photos.'
							]
						}
					],
					answer: [
						{
							type: 'table',
							head: ['Feature', 'Choice', 'Why'],
							rows: [
								['1. Balances', 'Relational ([[postgresql|Postgres]], MySQL)', '[[acid]] transactions and constraints; a wrong answer costs money'],
								['2. Carts', 'Key-value store (Redis, [[dynamodb|DynamoDB]])', 'Always fetched by one key; [[ttl]] handles expiry; no joins needed'],
								['3. Catalogue', 'Document store, or Postgres with a JSON column', 'Flexible attributes per product; relational is still fine if you also need joins'],
								['4. Metrics', 'Time-series database', 'Optimised for appends and time-range scans, with compression and downsampling'],
								['5. Photos', '[[object-storage|Object storage]] + [[cdn|CDN]]', 'Large binary files; store only the URL in the database']
							]
						},
						{
							type: 'p',
							text: 'Notice the method: name the **access pattern** first (by key? by range? with joins? transactional?), then pick. See [[sql-vs-nosql]]. "Postgres for everything until it hurts" is also a respectable answer for a young product: one system to run and back up.'
						}
					]
				},
				{
					id: 'f-p4q2',
					title: 'Which index makes this query fast?',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'code',
							lang: 'sql',
							code: `-- orders: 50 million rows, ~2,000 per customer on average
SELECT * FROM orders
WHERE customer_id = 42
ORDER BY created_at DESC
LIMIT 20;`
						},
						{ type: 'p', text: 'There is currently an index on `created_at` only. The query takes 4 seconds. What index would you add, and why does column order matter?' }
					],
					answer: [
						{
							type: 'code',
							lang: 'sql',
							code: `CREATE INDEX orders_customer_created ON orders (customer_id, created_at DESC);`
						},
						{
							type: 'p',
							text: 'A composite [[database-index|index]] is sorted by `customer_id` first, then by `created_at` within each customer. The database jumps straight to customer 42\'s section, already in newest-first order, and reads exactly 20 entries. Done in about a millisecond.'
						},
						{
							type: 'p',
							text: 'Reversed (`created_at, customer_id`) it would be sorted by time first, so customer 42\'s rows would be scattered across the whole index. Rule of thumb: **equality filters first, then the sort or range column.** And check with [[explain-analyze|`EXPLAIN ANALYZE`]] rather than guessing.'
						}
					]
				},
				{
					id: 'f-p4q3',
					title: 'Copy the author name onto every post?',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'p',
							text: 'The feed page shows 50 posts with each author\'s name and avatar. Currently that needs a join from `posts` to `users`. A teammate proposes copying `author_name` and `author_avatar` onto every post row. Good idea?'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'It is [[denormalization]]: faster, simpler reads in exchange for harder writes. When an author renames themselves, every one of their posts must be updated (a prolific author may have 100,000). If that update half-fails, posts disagree about the author\'s name.'
						},
						{
							type: 'list',
							items: [
								'**First check the join is actually slow.** Joining 50 posts to users by primary key is cheap; a [[normalization|normalised]] schema plus an index is usually fine.',
								'**If reads really need it**, cache rendered author info by user id (one cache entry per author, not per post), or denormalise and update the copies asynchronously, accepting brief staleness.',
								'**Denormalise facts that never change** (the post\'s creation time, the price at purchase) freely: no update problem.'
							]
						}
					]
				},
				{
					id: 'f-p4q4',
					title: 'The transfer that lost money',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `def transfer(src, dst, amount):
    db.execute("UPDATE accounts SET balance = balance - %s WHERE id = %s", (amount, src))
    db.execute("UPDATE accounts SET balance = balance + %s WHERE id = %s", (amount, dst))`
						},
						{ type: 'p', text: 'The server crashed once between the two lines. What happened, and what is the fix?' }
					],
					answer: [
						{
							type: 'p',
							text: 'With [[autocommit|autocommit]], each statement commits on its own. The crash left the money **taken from `src` and never added to `dst`**: it vanished. Wrap both in one transaction so they are [[acid|atomic]]: both happen or neither does.'
						},
						{
							type: 'code',
							lang: 'python',
							code: `def transfer(src, dst, amount):
    with db.transaction():
        db.execute("UPDATE accounts SET balance = balance - %s WHERE id = %s AND balance >= %s",
                   (amount, src, amount))
        if db.rowcount == 0:
            raise InsufficientFunds()
        db.execute("UPDATE accounts SET balance = balance + %s WHERE id = %s", (amount, dst))`
						},
						{
							type: 'p',
							text: 'The `balance >= amount` condition also stops two concurrent transfers from overdrawing the account; checking in Python first and updating later would be a [[race-condition]].'
						}
					]
				},
				{
					id: 'f-p4q5',
					title: '"I saved my profile and it shows the old one"',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'p',
							text: 'Writes go to the primary database; reads go to [[read-replica|read replicas]] that are usually 0.5–2 seconds behind. After saving their profile, users are redirected to the profile page and sometimes see their old bio. Refreshing a second later fixes it.'
						}
					],
					answer: [
						{
							type: 'p',
							text: '[[replication-lag|Replication lag]]: the redirect\'s read hit a replica that hadn\'t received the write yet. The data isn\'t lost; the replica is just behind. The guarantee the user expects is [[read-your-writes]].'
						},
						{
							type: 'list',
							items: [
								'After a user writes, route **that user\'s** reads to the primary for a few seconds (store "last write time" in their session).',
								'Or read from a replica only if it has caught up to the write\'s position (many databases expose this).',
								'Or show the value you just saved straight from the form response, without re-reading.'
							]
						},
						{ type: 'p', text: 'Everyone else can keep reading from replicas; a few seconds of staleness is fine for other people\'s views of the profile.' }
					]
				},
				{
					id: 'f-p4q6',
					title: 'Adding a fifth shard moved almost everything',
					tag: 'tricky',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: 'Users are spread across 4 database shards with `shard = user_id % 4`. Adding a fifth shard (`% 5`) required moving most of the data. Roughly what fraction of users moved, and how could you avoid it next time?'
						}
					],
					hints: ['Look at user ids 0 to 19 and compare `id % 4` with `id % 5`.'],
					answer: [
						{
							type: 'p',
							text: 'A user stays put only if `id % 4 == id % 5`. Across any 20 consecutive ids that happens for 4 of them (0, 1, 2, 3), so **~80% of users moved**. Changing N in `hash % N` reshuffles nearly everything.'
						},
						{
							type: 'list',
							items: [
								'**[[consistent-hashing|Consistent hashing]]** places shards on a ring; adding a fifth shard takes over only its slice, so ~1/5 = 20% of keys move.',
								'**Many logical shards, few machines:** start with e.g. 256 logical shards mapped onto 4 servers. Growing means moving whole logical shards to a new server; the `hash % 256` never changes.',
								'**A lookup table** (user range → shard) gives full control, at the cost of one more thing to keep available.'
							]
						},
						{ type: 'p', text: 'See [[sharding]] for choosing the key in the first place.' }
					]
				},
				{
					id: 'f-p4q7',
					title: 'CAP in practice: likes vs tickets',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: 'Your app runs in two regions that replicate to each other. The link between them fails for 10 minutes (a network partition). Users keep using both regions. For each feature, should each region keep accepting writes or refuse them? (a) liking a post, (b) buying one of the last concert tickets, (c) adding an item to a cart.'
						}
					],
					answer: [
						{
							type: 'table',
							head: ['Feature', 'During the partition', 'Why'],
							rows: [
								['(a) Likes', 'Keep accepting (**availability**)', 'Counts that are briefly off are harmless; merge later'],
								['(b) Last tickets', 'Refuse or queue in one region (**consistency**)', 'Selling seat 14C twice costs real money and trust'],
								['(c) Cart', 'Keep accepting (**availability**)', 'Merge carts after (union of items); a refused "add to cart" loses a sale']
							]
						},
						{
							type: 'p',
							text: 'That is the [[cap-theorem]]: during a partition you choose, **per feature**, between answering (and maybe being wrong) and being right (and maybe refusing). The rest of the time you still trade latency for consistency ([[pacelc]]). The full story is on the CAP page.'
						}
					]
				},
				{
					id: 'f-p4q8',
					title: 'The comment that appears, then disappears',
					tag: 'tricky',
					minutes: 3,
					prompt: [
						{
							type: 'p',
							text: 'A user sees a new comment from a friend, refreshes, and the comment is gone. Refreshing again brings it back. Nothing was deleted. Reads are load-balanced across three replicas.'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'Each refresh hit a different replica, and they are behind by different amounts. The first replica had the comment; the second hadn\'t received it yet. Time appears to run backwards for the user. The missing guarantee is **monotonic reads**: once you\'ve seen something, you never see an older state.'
						},
						{
							type: 'p',
							text: 'The fix is cheap: route each user to the same replica (hash the user id), or only read from replicas at least as fresh as the last state the user saw. See the ladder on [[consistency-models]]. Under plain [[eventual-consistency]] this behaviour is allowed, just confusing.'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 5 ─────────────────────────
		{
			id: 'p5',
			nav: '5 · Caching',
			eyebrow: 'Part 5 · 15 minutes',
			title: 'Caching basics',
			meta: 'cache-aside · write-through · write-back · TTL · eviction · CDN',
			minutes: 15,
			questions: [
				{
					id: 'f-p5q1',
					title: 'What does a cache actually buy you?',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'p',
							text: 'A cache lookup takes 1 ms; the database query takes 20 ms. On a miss you check the cache, then query the DB, then store the result. (a) What is the average latency with a 90% [[cache-hit-rate|hit rate]]? (b) With 80%? (c) How does database load change between them?'
						}
					],
					answer: [
						{
							type: 'list',
							items: [
								'(a) 0.9 × 1 ms + 0.1 × (1 + 20) ms = 0.9 + 2.1 = **3.0 ms**.',
								'(b) 0.8 × 1 + 0.2 × 21 = 0.8 + 4.2 = **5.0 ms**.',
								'(c) Misses go from 10% to 20% of requests: the **database load doubles**, even though the hit rate only "dropped 10 points".'
							]
						},
						{
							type: 'p',
							text: 'Always reason in **miss rate**. The database sees only the misses, so a cache\'s real value is protecting the database. A cold or emptied cache can overload it instantly.'
						}
					]
				},
				{
					id: 'f-p5q2',
					title: 'Spot the bug in this cache code',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `def get_product(pid):
    cached = redis.get(f"product:{pid}")
    if cached:
        return json.loads(cached)
    product = db.fetch_product(pid)
    redis.set(f"product:{pid}", json.dumps(product))      # (1)
    return product

def update_price(pid, price):
    redis.set(f"product:{pid}", json.dumps({**get_product(pid), "price": price}))  # (2)
    db.update_price(pid, price)                                                    # (3)`
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'No TTL on line (1).',
									body: 'If any update path forgets the cache, or a write fails halfway, the wrong value stays **forever**. A [[ttl]] (minutes to hours) is the safety net that makes every other mistake temporary.'
								},
								{
									title: 'Cache updated before the database, lines (2)–(3).',
									body: 'If the DB write fails, the cache shows a price that was never saved. If two updates race, cache and DB can end up in different orders, again permanently.'
								},
								{
									title: 'Updating the cached value instead of deleting it.',
									body: 'The [[cache-aside]] rule: **write the database, then delete the key**. The next read reloads the truth. Deleting can\'t leave an older value behind the way a racing set can.'
								}
							]
						},
						{
							type: 'code',
							lang: 'python',
							code: `def update_price(pid, price):
    db.update_price(pid, price)
    redis.delete(f"product:{pid}")   # next read repopulates from the DB

# and in get_product:  redis.set(key, value, ex=3600)`
						},
						{ type: 'p', text: 'Compare the patterns on [[caching-strategies]].' }
					]
				},
				{
					id: 'f-p5q3',
					title: 'What should the CDN cache, and for how long?',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: 'Decide a caching rule for each: (a) `/assets/app.3f9a1c.js` (the hash changes every deploy), (b) `/` the homepage HTML, (c) `/api/me` (the logged-in user\'s profile), (d) `/images/products/123.jpg`.'
						}
					],
					answer: [
						{
							type: 'table',
							head: ['Resource', 'Rule', 'Why'],
							rows: [
								['(a) Hashed JS bundle', '`Cache-Control: public, max-age=31536000, immutable`', 'The filename changes when the content does, so cache it for a year'],
								['(b) Homepage HTML', 'Short TTL (e.g. 60 s), or `no-cache` (revalidate)', 'It points to the current bundle names; a stale page loads old code'],
								['(c) `/api/me`', '`Cache-Control: private, no-store`', 'Personal data. A shared cache would show one user\'s profile to another'],
								['(d) Product image', 'Long TTL, change the URL when the image changes', 'Same bytes for everyone; ideal for the [[cdn]]']
							]
						},
						{
							type: 'callout',
							tone: 'crit',
							text: 'The dangerous mistake is (c): a CDN caching a personalised response. It is a data leak, not a performance bug. See [[cache-control]] and [[cdn-cache-key]].'
						}
					]
				},
				{
					id: 'f-p5q4',
					title: 'Why is the site slow every morning at 9?',
					tag: 'tricky',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: 'The product cache is a fixed-size Redis using [[lru|LRU]] eviction. Every night at 02:00 a report job reads all 5 million products once, through the same cache helper. Each morning the database is hammered until about 09:30, then things settle.'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**The nightly scan flushed the cache.** LRU evicts whatever was used least recently. Reading 5 million products once makes every one of them "recently used", pushing out the few thousand genuinely popular products. In the morning the cache is full of products nobody wants, the popular ones miss, and the database takes the load until the cache [[cache-warming|re-warms]].'
						},
						{
							type: 'list',
							items: [
								'Have batch jobs **bypass the cache** (read from the DB or a [[read-replica]] directly). This is the real fix.',
								'An [[lfu|LFU]] policy (see [[lru]]) resists one-off scans, since one read doesn\'t outweigh thousands.',
								'Keep separate caches for separate workloads.'
							]
						}
					]
				}
			]
		},

		// ───────────────────────── PART 6 ─────────────────────────
		{
			id: 'p6',
			nav: '6 · Async',
			eyebrow: 'Part 6 · 15 minutes',
			title: 'Async work and messaging',
			meta: 'queues · pub/sub · streams · at-least-once · backpressure · retries',
			minutes: 15,
			questions: [
				{
					id: 'f-p6q1',
					title: 'Signup takes 4 seconds',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'p',
							text: '`POST /signup` creates the user (30 ms), sends a welcome email via an email provider (~1.5 s), resizes the uploaded avatar (~1 s) and notifies the [[crm|CRM]] (~1.5 s), all before responding. When the email provider is slow, signups time out. Redesign it.'
						}
					],
					answer: [
						{
							type: 'flow',
							steps: [
								{ label: 'POST /signup', note: 'create user (30 ms)' },
								{ label: 'Publish "user.created"', note: '~2 ms', tone: 'info' },
								{ label: 'Respond 201', tone: 'ok' },
								{ label: 'Workers', note: 'email · avatar · CRM, each with retries' }
							]
						},
						{
							type: 'p',
							text: 'Do only what the user needs to see right now inside the request; push everything else onto a [[message-queue]] (or a [[pub-sub]] topic so each of the three consumers gets its own copy). Signup now takes ~35 ms, and a slow email provider delays the email instead of breaking signup.'
						},
						{
							type: 'p',
							text: 'One catch to mention: publish the event **in a way that can\'t be lost if the server crashes right after the user is saved**. The simple pattern is writing the event to an outbox table in the same transaction ([[transactional-outbox]]), which Assessment 2 covers in depth.'
						}
					]
				},
				{
					id: 'f-p6q2',
					title: 'Queue, pub/sub or stream?',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'list',
							ordered: true,
							items: [
								'Resize each uploaded image exactly once, using a pool of 10 workers.',
								'When an order is placed: send a receipt, update analytics, and update the search index.',
								'Keep 30 days of click events so a new fraud model can be trained on history.'
							]
						}
					],
					answer: [
						{
							type: 'table',
							head: ['Need', 'Choice', 'Why'],
							rows: [
								['1. Work shared by workers', '[[message-queue|Queue]]', 'Each message goes to one worker, then disappears'],
								['2. Several independent reactions', '[[pub-sub|Pub/sub]] (one queue per subscriber)', 'Each consumer gets its own copy; add consumers without touching the producer'],
								['3. History to replay', '[[event-stream|Stream / log]]', 'Reading doesn\'t delete; a new consumer can start from 30 days ago']
							]
						}
					]
				},
				{
					id: 'f-p6q3',
					title: 'Customers got two welcome emails',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: 'The email worker takes a message, sends the email, then acknowledges (deletes) the message. Occasionally a worker is killed during a deploy right after sending but before acknowledging. What does the queue do, and how do you prevent duplicate emails?'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'The message was never acknowledged, so after its [[visibility-timeout]] the queue hands it to another worker, which sends the email again. This is normal: most queues promise [[at-least-once]] delivery, meaning duplicates are expected, not a bug.'
						},
						{
							type: 'p',
							text: 'Make the handler [[idempotency|idempotent]]: record "welcome email sent for user 42" (a unique row keyed by `message_id` or `user_id + email_type`) and skip if it already exists. The general rule: **assume every message can arrive twice**, and design so twice has the same effect as once. See [[idempotent-consumer]].'
						}
					]
				},
				{
					id: 'f-p6q4',
					title: 'The provider is down: retry how?',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: 'The SMS provider returns errors for 5 minutes. Each of 2,000 queued messages is retried immediately, up to 100 times. When the provider recovers, it is flooded and goes down again. What should the retry policy be?'
						}
					],
					answer: [
						{
							type: 'list',
							items: [
								'**[[exponential-backoff|Exponential backoff]]:** wait 1 s, 2 s, 4 s, 8 s… so a struggling service gets breathing room.',
								'**[[jitter|Jitter]]:** randomise each wait (e.g. 0–8 s instead of exactly 8 s) so 2,000 messages don\'t all retry in the same instant.',
								'**A cap:** after N attempts (or a few hours), move the message to a [[dead-letter-queue]] for inspection instead of retrying forever.',
								'**Only retry what can succeed:** a timeout or 503 is worth retrying; a "phone number invalid" error will never succeed.'
							]
						},
						{
							type: 'p',
							text: 'Immediate, unlimited retries turn a short outage into a [[retry-storm]]. If the queue keeps growing because consumers can\'t keep up, that is [[backpressure]] telling you to slow producers or add capacity, not to retry harder.'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 7 ─────────────────────────
		{
			id: 'p7',
			nav: '7 · Reliability',
			eyebrow: 'Part 7 · 15 minutes',
			title: 'Reliability basics',
			meta: 'SLI/SLO/SLA · redundancy · SPOFs · timeouts · circuit breakers · golden signals',
			minutes: 15,
			questions: [
				{
					id: 'f-p7q1',
					title: 'What availability do three components in a row give you?',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: 'A request passes through a load balancer (99.99% available), an app tier (99.9%) and a database (99.95%), and fails if any of them is down. (a) Overall availability? (b) Downtime per 30-day month? (c) If you ran two independent copies of a component that is 99% available, and either can serve, what do you get?'
						}
					],
					answer: [
						{
							type: 'list',
							items: [
								'(a) In series, multiply: 0.9999 × 0.999 × 0.9995 ≈ **0.9984 → 99.84%**. The chain is weaker than its weakest link.',
								'(b) 30 days = 43,200 minutes. 0.16% of that ≈ **69 minutes** a month.',
								'(c) In parallel, both must fail: 0.01 × 0.01 = 0.0001, so **99.99%**. [[redundancy|Redundancy]] turns two mediocre parts into one excellent one, *if* their failures are independent (different zones, not the same rack).'
							]
						},
						{
							type: 'p',
							text: 'Useful reference for [[slo-vs-sla|SLOs]]: 99.9% ≈ 43 min/month, 99.95% ≈ 22 min, 99.99% ≈ 4.3 min.'
						}
					]
				},
				{
					id: 'f-p7q2',
					title: 'Spending the error budget',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'p',
							text: 'Your [[slo]] is 99.9% of requests succeed each month, and you serve 1 billion requests a month. An incident fails 50% of requests for 20 minutes at 400 requests/s. How much of the month\'s [[error-budget]] did it use?'
						}
					],
					answer: [
						{
							type: 'list',
							items: [
								'Budget: 0.1% × 1,000,000,000 = **1,000,000** failed requests allowed per month.',
								'Incident: 20 min × 60 s × 400 req/s = 480,000 requests; half failed = **240,000**.',
								'Used: 240,000 ÷ 1,000,000 = **24%** of the monthly budget in 20 minutes.'
							]
						},
						{
							type: 'p',
							text: 'The budget turns "reliability vs features" into a number. With 76% left, the team can keep shipping; if a few more incidents burn it, the agreed rule is to slow releases and fix reliability. That is the point of the [[sli]] → [[slo]] → error budget chain.'
						}
					]
				},
				{
					id: 'f-p7q3',
					title: 'Find the single points of failure',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'flow',
							steps: [
								{ label: '[[dns|DNS]] (one provider)' },
								{ label: 'One load balancer VM' },
								{ label: '6 app servers', note: 'all in zone a' },
								{ label: 'Redis (one node)', note: 'sessions live here' },
								{ label: 'Postgres primary', note: 'nightly backups, no replica' }
							]
						},
						{ type: 'p', text: 'List every [[single-point-of-failure]] and the cheapest reasonable fix for each.' }
					],
					answer: [
						{
							type: 'table',
							head: ['SPOF', 'What breaks', 'Fix'],
							rows: [
								['One load balancer VM', 'Everything', 'Managed load balancer, or two with failover'],
								['All app servers in zone a', 'Everything, when the zone has an outage', 'Spread across 2–3 [[availability-zone|zones]]'],
								['One Redis node holding sessions', 'Everyone is logged out', 'Replicated Redis, or sessions in the database'],
								['Postgres with no replica', 'All writes and reads; recovery = restore last night\'s backup, losing up to a day', 'A standby replica in another zone with automatic [[failover]]'],
								['One DNS provider', 'Rare, but total', 'Accept the risk at first; a second provider is a later step']
							]
						},
						{
							type: 'p',
							text: 'Note the database row: backups protect against **data loss**, not **downtime**. A restore takes hours; a replica takes over in under a minute.'
						}
					]
				},
				{
					id: 'f-p7q4',
					title: 'Read the golden signals',
					tag: 'core',
					minutes: 4,
					prompt: [
						{ type: 'p', text: 'The checkout service dashboard, laid out as the [[golden-signals|four golden signals]]. What happened, and in what order?' },
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'checkout · golden signals',
								range: '10:00 – 10:39',
								panels: [
									{
										kind: 'timeseries',
										title: 'Latency',
										unit: 'ms',
										x: gx,
										series: [
											{ name: 'p50', points: shape(40, { base: 80, noise: 0.06, seed: 1 }, ramp(20, 24, 80, 900)), color: 0 },
											{ name: 'p99', points: shape(40, { base: 240, noise: 0.08, seed: 2 }, ramp(20, 24, 240, 5000)), color: 1 }
										],
										markers: [{ at: 20, label: 'payments slow' }]
									},
									{
										kind: 'timeseries',
										title: 'Traffic',
										unit: ' req/s',
										x: gx,
										series: [{ name: 'requests', points: shape(40, { base: 300, noise: 0.05, seed: 3 }), color: 2 }]
									},
									{
										kind: 'timeseries',
										title: 'Errors',
										unit: '%',
										x: gx,
										series: [{ name: '5xx', points: shape(40, { base: 0.2, noise: 0.2, seed: 4, round: 1 }, step(25, 18)), color: 4 }]
									},
									{
										kind: 'timeseries',
										title: 'Saturation: worker pool in use',
										unit: '%',
										x: gx,
										series: [{ name: 'busy workers', points: shape(40, { base: 15, noise: 0.03, seed: 5 }, ramp(20, 25, 15, 97)), color: 3 }],
										yMax: 100,
										thresholds: [{ value: 100, label: 'pool full' }]
									}
								]
							}
						}
					],
					answer: [
						{
							type: 'list',
							ordered: true,
							items: [
								'**10:20 latency rises first** (p50 80 → ~900 ms, [[percentiles|p99]] → ~5 s), right at the "payments slow" marker.',
								'**[[saturation|Saturation]] climbs with it** and hits 100% around 10:25: each request now holds a worker longer ([[littles-law|Little\'s law]]: same traffic × longer time = more in flight).',
								'**Errors jump at 10:25**, when the pool is full: new requests can\'t get a worker and time out.',
								'**Traffic is flat**: this is not a load spike. Adding servers isn\'t the first move.'
							]
						},
						{
							type: 'p',
							text: 'Diagnosis: a slow dependency exhausted the worker pool. Fix: a short [[timeout]] and a [[circuit-breaker]] on the payments call so the pool can\'t fill up, plus [[graceful-degradation]] (e.g. "we\'ll confirm your payment by email"). Reading the four panels **in time order** is the whole skill.'
						}
					]
				},
				{
					id: 'f-p7q5',
					title: 'Make the product page survive a broken dependency',
					tag: 'design',
					minutes: 3,
					prompt: [
						{
							type: 'p',
							text: 'The product page calls: catalogue (name, price), inventory (in stock?), reviews, recommendations, and the user\'s wishlist status. Which failures should break the page, and what should the page do for each of the others?'
						}
					],
					answer: [
						{
							type: 'table',
							head: ['Dependency', 'If it fails…', 'Why'],
							rows: [
								['Catalogue', 'Show an error page', 'Without name and price there is no product page'],
								['Inventory', 'Show the page; "check availability at checkout"', 'Re-check at checkout, where it matters'],
								['Reviews', 'Hide the section', 'Nice to have'],
								['Recommendations', 'Hide or show generic bestsellers', 'Nice to have'],
								['Wishlist status', 'Show an empty heart', 'Cosmetic']
							]
						},
						{
							type: 'p',
							text: 'This is [[graceful-degradation]]. It needs two things in code: every optional call has a short [[timeout]] (say 200 ms) and a fallback, and a [[circuit-breaker]] stops calling a dependency that is clearly down. Without timeouts, "optional" dependencies still take the page down by making it wait.'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 8 ─────────────────────────
		{
			id: 'p8',
			nav: '8 · APIs',
			eyebrow: 'Part 8 · 15 minutes',
			title: 'API basics',
			meta: 'REST · gRPC · GraphQL · pagination · versioning · rate limiting',
			minutes: 15,
			questions: [
				{
					id: 'f-p8q1',
					title: 'REST, gRPC or GraphQL?',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'list',
							ordered: true,
							items: [
								'A public API for third-party developers.',
								'High-volume calls between your own backend services.',
								'A mobile app screen that needs a user, their last 5 orders, and each order\'s items, on a slow network.'
							]
						}
					],
					answer: [
						{
							type: 'table',
							head: ['Case', 'Pick', 'Why'],
							rows: [
								['1. Public API', '[[rest|REST]]', 'Universally understood, works with any tool, easy to cache and document'],
								['2. Internal services', '[[grpc|gRPC]]', 'Compact binary, generated typed clients, efficient connections; you control both ends'],
								['3. Mobile screen', '[[graphql|GraphQL]] (or a [[bff|BFF]] endpoint)', 'One round trip returning exactly the needed fields']
							]
						},
						{
							type: 'p',
							text: 'There is no universal winner; the question is who the client is and what it needs. A dedicated REST endpoint for that screen (a [[bff]]) is a perfectly good alternative to GraphQL.'
						}
					]
				},
				{
					id: 'f-p8q2',
					title: 'Items repeat when scrolling the feed',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'code',
							lang: 'text',
							code: `GET /posts?limit=20&offset=0    → posts 1–20 (newest first)
   ...5 new posts are published...
GET /posts?limit=20&offset=20   → ?`
						},
						{ type: 'p', text: 'Users see duplicates when scrolling. Why, and what pagination style avoids it?' }
					],
					answer: [
						{
							type: 'p',
							text: 'With [[offset-pagination|offset pagination]], "skip 20" is counted against the list *as it is now*. Five new posts pushed everything down, so the second page starts with 5 posts the user already saw (old 16–20). Deletions cause the opposite: skipped items. Deep offsets are also slow, since the database reads and discards every skipped row.'
						},
						{
							type: 'code',
							lang: 'text',
							code: `GET /posts?limit=20                          → posts + next_cursor = "2026-10-16T09:12:03Z_8841"
GET /posts?limit=20&cursor=2026-10-16T09:12:03Z_8841
   → WHERE (created_at, id) < ('2026-10-16T09:12:03Z', 8841) ORDER BY created_at DESC, id DESC`
						},
						{
							type: 'p',
							text: '[[keyset-pagination|Cursor (keyset) pagination]] says "give me what comes after *this item*", so inserts and deletes elsewhere don\'t shift the page, and it stays fast at any depth. The `id` tiebreaker handles two posts with the same timestamp. The trade-off: no "jump to page 37".'
						}
					]
				},
				{
					id: 'f-p8q3',
					title: 'Is this a breaking change?',
					tag: 'core',
					minutes: 4,
					prompt: [
						{ type: 'p', text: 'For each change to `GET /orders/{id}`, is it safe for existing clients?' },
						{
							type: 'list',
							ordered: true,
							items: [
								'Add a new optional field `gift_message`.',
								'Rename `total` to `total_amount`.',
								'Change `total` from dollars (`12.50`) to cents (`1250`).',
								'Add a new value `"on_hold"` to the `status` field.',
								'Start returning 404 instead of 200 with `null` for deleted orders.'
							]
						}
					],
					answer: [
						{
							type: 'table',
							head: ['Change', 'Safe?', 'Why'],
							rows: [
								['1. New optional field', 'Safe', 'Well-behaved clients ignore fields they don\'t know'],
								['2. Rename', '**Breaking**', 'Old clients read `total`, get nothing'],
								['3. Units change', '**Breaking, and silent**', 'Same name, same type, 100× different meaning. The worst kind: nothing crashes, invoices are wrong'],
								['4. New enum value', '**Often breaking**', 'Clients with a `switch` over known statuses may crash or show nothing'],
								['5. 404 instead of null', '**Breaking**', 'Clients treating non-200 as "server down" now show errors']
							]
						},
						{
							type: 'p',
							text: 'Breaking changes need a new [[api-versioning|version]] (or a new field alongside the old one), a migration period, and usage metrics showing when the old version is no longer called. Mobile apps make this slow: old versions stay installed for years.'
						}
					]
				},
				{
					id: 'f-p8q4',
					title: 'Token bucket by hand',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: 'A [[token-bucket]] limiter: capacity **5** tokens, refill **1 token per second**, starts full; each request costs 1 token. A client sends: 7 requests at t = 0 s, 2 at t = 3 s, 4 at t = 4 s, and 1 at t = 20 s. Which are allowed?'
						}
					],
					answer: [
						{
							type: 'table',
							head: ['Time', 'Tokens available', 'Requests', 'Allowed', 'Rejected (429)', 'Tokens left'],
							numeric: [1, 2, 3, 4, 5],
							rows: [
								['0 s', '5', '7', '5', '2', '0'],
								['3 s', '0 + 3 = 3', '2', '2', '0', '1'],
								['4 s', '1 + 1 = 2', '4', '2', '2', '0'],
								['20 s', 'min(5, 0 + 16) = 5', '1', '1', '0', '4']
							]
						},
						{
							type: 'p',
							text: 'Total: 10 allowed, 4 rejected. Note the refill is **capped at capacity** (t = 20 s gives 5, not 16): that cap is what limits bursts. Compare the algorithms on [[rate-limiting]].'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 9 ─────────────────────────
		{
			id: 'p9',
			nav: '9 · Mini-designs',
			eyebrow: 'Part 9 · 35 minutes · design',
			title: 'Classic mini-designs, done properly',
			meta: 'requirements → estimates → API → data → diagram → bottlenecks → trade-offs',
			minutes: 35,
			intro: [
				{
					type: 'callout',
					tone: 'info',
					title: 'Spend ~6 minutes per design',
					text: 'Write the six headings (requirements, estimates, API, data model, diagram, bottlenecks & trade-offs) and fill each with two or three lines. A complete small answer beats a brilliant half answer.'
				}
			],
			questions: [
				{
					id: 'f-p9q1',
					title: 'Design a URL shortener',
					tag: 'design',
					minutes: 6,
					prompt: [
						{
							type: 'p',
							text: 'Users submit a long URL and get a short one like `sho.rt/aZ3kQ9x`. Visiting it redirects. Expect 100 million new links a month, 100 reads per write, links kept for 5 years.'
						}
					],
					answer: [
						{ type: 'heading', text: 'Estimates' },
						{
							type: 'table',
							head: ['Quantity', 'Arithmetic', 'Result'],
							rows: [
								['Writes/s', '100M ÷ (30 × 86,400 s)', '≈ 39 /s'],
								['Reads/s', '39 × 100', '≈ 3,900 /s (peak maybe 10k)'],
								['Links in 5 years', '100M × 12 × 5', '6 billion'],
								['Storage', '6B × ~500 B', '≈ 3 TB'],
								['Code length ([[base62|base62]])', '62⁶ ≈ 57 billion, 62⁷ ≈ 3.5 trillion', '7 characters: plenty of room, hard to guess']
							]
						},
						{ type: 'heading', text: 'API and data' },
						{
							type: 'code',
							lang: 'text',
							code: `POST /links   {"url": "https://…"}   → 201 {"code": "aZ3kQ9x"}
GET  /{code}                        → 301/302 Location: https://…

links(code PRIMARY KEY, long_url, owner_id, created_at, expires_at)`
						},
						{ type: 'heading', text: 'Diagram' },
						{
							type: 'flow',
							steps: [
								{ label: 'Client' },
								{ label: '[[cdn|CDN]] / [[load-balancer|LB]]' },
								{ label: 'Redirect service', note: 'stateless' },
								{ label: 'Cache', note: 'code → URL' },
								{ label: 'Key-value DB', note: 'source of truth' }
							]
						},
						{ type: 'heading', text: 'Key decisions & trade-offs' },
						{
							type: 'list',
							items: [
								'**Generating codes:** a random 7-character code plus "insert if not exists" (collisions are rare; retry on conflict), or a counter encoded in base62 (no collisions, but codes are guessable and the counter must be coordinated). Random is simpler to scale.',
								'**Reads dominate (100:1)**, and popular links are very popular, so cache code → URL with [[cache-aside]]. Most redirects never touch the database.',
								'**301 vs 302:** 301 (permanent) lets browsers cache the redirect, saving traffic but hiding clicks from analytics. 302 keeps every click visible. Pick based on whether click counting is a feature.',
								'**Storage:** 3 TB of simple key → value lookups fits a key-value store, or Postgres with [[sharding]] by code later. No joins are needed.',
								'**Abuse:** [[rate-limiting|rate-limit]] link creation per user/IP and scan URLs for malware; shorteners are a favourite tool for phishing.'
							]
						}
					]
				},
				{
					id: 'f-p9q2',
					title: 'Design an API [[rate-limiting|rate limiter]]',
					tag: 'design',
					minutes: 6,
					prompt: [
						{
							type: 'p',
							text: 'Limit each API key to 100 requests per minute with short bursts allowed, across 20 API servers. 10 million API keys exist. Return 429 when over the limit.'
						}
					],
					answer: [
						{
							type: 'list',
							items: [
								'**Algorithm:** [[token-bucket]], capacity 100, refill 100/60 ≈ 1.67 tokens/s. It allows bursts and enforces the average; only two numbers per key (tokens, last refill time).',
								'**Where state lives:** in a shared Redis, not in each server\'s memory. With 20 servers each counting alone, a client spread across all of them would get 20 × 100 = 2,000 requests a minute.',
								'**Atomicity:** read-refill-decrement must be one operation (a Redis [[redis|Lua script]] or atomic command), or two concurrent requests can both spend the last token.',
								'**Memory:** 10M keys × ~50 bytes ≈ 500 MB, and only active keys need entries (expire idle ones with a [[ttl]]). One Redis node is enough; replicate it for availability.',
								'**Failure mode:** if Redis is down, *[[fail-open-closed|fail open]]* (allow requests and log it) for a normal API, or *fail closed* for an expensive or abuse-prone endpoint. Say which and why.',
								'**Client experience:** return `429` with `Retry-After` (the [[retry-after|Retry-After header]] says how long to wait) and headers like `RateLimit-Remaining`, so well-behaved clients can slow down instead of hammering.'
							]
						},
						{
							type: 'flow',
							steps: [
								{ label: 'Request' },
								{ label: 'API server', note: 'middleware' },
								{ label: 'Redis', note: 'atomic take-token' },
								{ label: 'Allowed → handler', tone: 'ok' },
								{ label: 'Denied → 429', tone: 'warn' }
							]
						}
					]
				},
				{
					id: 'f-p9q3',
					title: 'Design a news feed: push or pull?',
					tag: 'design',
					minutes: 6,
					prompt: [
						{
							type: 'p',
							text: '100 million users, each following ~200 accounts on average. 10 million posts a day. A few accounts have 50 million followers. Opening the app shows the latest posts from everyone you follow, fast.'
						}
					],
					answer: [
						{
							type: 'columns',
							columns: [
								{
									title: '[[fan-out-on-write|Fan-out on write]] (push)',
									blocks: [
										{
											type: 'p',
											text: 'When someone posts, insert the post id into each follower\'s precomputed feed list. Reading a feed = one lookup. Cost: 10M posts × 200 followers = **2 billion feed inserts a day (~23,000/s)**. One post by a 50M-follower account is 50M inserts by itself: at 100,000 inserts/s that is over 8 minutes of lag.'
										}
									]
								},
								{
									title: 'Fan-out on read (pull)',
									blocks: [
										{
											type: 'p',
											text: 'When you open the app, fetch recent posts from the 200 accounts you follow and merge them. Posting is cheap. Cost: every feed open is ~200 lookups plus a merge, and feeds are opened far more often than posts are written.'
										}
									]
								}
							]
						},
						{
							type: 'p',
							text: '**The standard answer is a hybrid.** Push for normal accounts (most of the volume, cheap per post). For accounts above a follower threshold, don\'t fan out; when a user opens their feed, merge their precomputed list with recent posts from the few celebrities they follow. This avoids the [[hot-partition|hot-key]] blast from celebrity posts.'
						},
						{
							type: 'list',
							items: [
								'**Feed storage:** a capped list per user (latest ~500 post ids) in Redis or a [[sql-vs-nosql|wide-column store]]; hydrate post contents from a post cache.',
								'**Inactive users:** don\'t push to users who haven\'t opened the app in 30 days; rebuild their feed on read if they come back.',
								'**Writes are async:** posting returns immediately; fan-out runs on a queue, so feeds are [[eventual-consistency|eventually consistent]], usually within seconds.'
							]
						}
					]
				},
				{
					id: 'f-p9q4',
					title: 'Design "who\'s online" for a chat app',
					tag: 'design',
					minutes: 6,
					prompt: [
						{
							type: 'p',
							text: 'Show a green dot next to contacts who are online. 10 million users are connected at peak, via [[websocket|WebSockets]] to a fleet of gateway servers. A user who closes the app should turn grey within about a minute.'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Naive:** each client sends a [[heartbeat]] every 30 s and you write `last_seen` to a database. That is 10M ÷ 30 ≈ **333,000 writes/s**, mostly saying "nothing changed".'
						},
						{
							type: 'list',
							items: [
								'**Store presence in memory with a [[ttl]]:** `SET online:{user} 1 EX 90`, refreshed by heartbeats. A user who stops heartbeating expires on their own, so no "went offline" event is needed for crashes or dead phone batteries.',
								'**Heartbeat less, tolerate misses:** every 60 s with a 90 s TTL halves the writes to ~167,000/s and survives one lost heartbeat. Many systems refresh only on the gateway (which already knows the socket is open), not from every client.',
								'**Push changes, don\'t poll:** when a user flips online↔offline, publish an event to the gateways holding their contacts\' connections. Only *changes* travel, which are far rarer than heartbeats.',
								'**Accept fuzziness:** presence is a classic [[eventual-consistency|eventually consistent]] feature. A dot that is 30 s late is fine; don\'t spend strong-consistency money on it.'
							]
						}
					]
				},
				{
					id: 'f-p9q5',
					title: 'Design video upload',
					tag: 'design',
					minutes: 5,
					prompt: [
						{
							type: 'p',
							text: 'Users upload videos up to 2 GB from phones on flaky connections. Videos must be transcoded into several resolutions before they can be watched. The first version streams uploads through the API servers to disk.'
						}
					],
					answer: [
						{
							type: 'flow',
							steps: [
								{ label: 'App: "I want to upload"' },
								{ label: 'API', note: 'returns [[presigned-url|presigned]] multipart URLs' },
								{ label: 'Client → [[object-storage|object storage]]', note: 'parts in parallel, resumable' },
								{ label: '"Upload complete" event' },
								{ label: 'Transcode workers', note: 'queue, several resolutions' },
								{ label: '[[cdn|CDN]] serves outputs', tone: 'ok' }
							]
						},
						{
							type: 'list',
							items: [
								'**Don\'t pass bytes through API servers.** 2 GB uploads tie up servers for minutes and fill their disks. A presigned URL lets the client upload straight to object storage; your servers handle only small JSON calls.',
								'**Multipart, resumable uploads:** split into ~10 MB parts, upload in parallel, retry failed parts only. A dropped connection at 1.9 GB doesn\'t restart from zero.',
								'**[[transcoding|Transcoding]] is slow, CPU-heavy, async work:** a [[message-queue]] feeds a scalable worker pool; status goes `uploaded → processing → ready`, and the app shows "processing" meanwhile.',
								'**Local disk on API servers** also broke [[stateless-service|statelessness]]: the file lived on one server, so the next request to a different server couldn\'t find it.'
							]
						}
					]
				},
				{
					id: 'f-p9q6',
					title: 'Design a notification system',
					tag: 'design',
					minutes: 6,
					prompt: [
						{
							type: 'p',
							text: 'Send password resets, order updates and marketing campaigns by email, SMS and push. A marketing campaign targets 50 million users. The email provider accepts at most 2,000 emails/s from you. Password resets must arrive within a minute, always.'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**First, the arithmetic:** 50M emails ÷ 2,000/s = 25,000 s ≈ **7 hours** to send one campaign. If resets share that pipe, a reset requested at 09:05 waits behind 50M marketing emails. That is the core design problem.'
						},
						{
							type: 'list',
							items: [
								'**Separate queues by priority:** transactional (resets, receipts) and bulk (marketing). Workers always drain transactional first, and bulk sending is throttled to leave room under the provider limit (e.g. bulk ≤ 1,700/s, keeping 300/s for transactional).',
								'**[[rate-limiting|Rate-limit]] toward the provider**, not just from clients: a [[token-bucket]] in front of each channel.',
								'**User preferences and [[suppression-list|suppression]]:** check opt-outs, quiet hours and channel choice before sending; marketing to unsubscribed users is a legal problem, not just a UX one.',
								'**Idempotency:** a notification id per (user, event, channel), so retries after timeouts don\'t send twice ([[idempotency]]).',
								'**Templates and fan-out:** an event like "order shipped" becomes one message per channel the user enabled ([[pub-sub]] → per-channel queues).',
								'**Track delivery:** provider [[webhook|webhooks]] for [[transactional-email|bounces]] and failures; retry with [[exponential-backoff|backoff]]; [[dead-letter-queue]] after N attempts.'
							]
						}
					]
				}
			]
		},

		// ───────────────────────── PART 10 ─────────────────────────
		{
			id: 'p10',
			nav: '10 · Spot the flaw',
			eyebrow: 'Part 10 · 10 minutes',
			title: 'Spot the flaw, then quick checks',
			meta: 'one-minute design reviews and rapid fire',
			minutes: 10,
			questions: [
				{
					id: 'f-p10q1',
					group: 'Spot the flaw',
					title: 'One database for everything',
					tag: 'core',
					prompt: [
						{
							type: 'p',
							text: 'The production Postgres serves the website, and also the [[business-intelligence|BI]] team\'s dashboards, which run big aggregate queries over two years of orders whenever someone opens them. Every Monday morning the site slows down.'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'Analytical queries scan huge amounts of data and compete with the site\'s small, latency-sensitive queries for CPU, disk and cache. Monday morning is when everyone opens their dashboards. Move analytics to a [[read-replica]] (quick fix) or, properly, to a separate analytics warehouse fed by a nightly or streaming copy ([[change-data-capture]]). Keep the [[oltp-vs-olap|OLTP]] database for the product.'
						}
					]
				},
				{
					id: 'f-p10q2',
					group: 'Spot the flaw',
					title: 'Prices in the cache never change',
					tag: 'core',
					prompt: [
						{
							type: 'p',
							text: 'Product data is cached with `SET product:123 …` (no expiry). An admin tool updates prices directly in the database. Customers see old prices until someone restarts Redis.'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'Two flaws: **no [[ttl]]**, so stale entries live forever, and **a write path that skips invalidation** (the admin tool writes to the DB but doesn\'t delete the cache key). Fix both: delete on every write path (or publish a "product changed" event that the cache layer listens to) *and* set a TTL as a backstop for the write path you forgot. See [[cache-invalidation]].'
						}
					]
				},
				{
					id: 'f-p10q3',
					group: 'Spot the flaw',
					title: 'Checkout sends the receipt synchronously',
					tag: 'core',
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `def checkout(cart):
    order = create_order(cart)          # 40 ms
    charge_card(order)                  # 600 ms
    send_receipt_email(order)           # 1–30 s, depends on the provider
    return order`
						}
					],
					answer: [
						{
							type: 'p',
							text: 'The email is inside the request path, so a slow email provider makes checkout slow and, if it errors, can make a **paid** checkout look failed to the customer (who then pays again). Charge the card in the request (the user needs that answer), then enqueue the receipt on a [[message-queue]] and return. Bonus: make the charge [[idempotency|idempotent]] so a retry never charges twice.'
						}
					]
				},
				{
					id: 'f-p10q4',
					group: 'Spot the flaw',
					title: '"We\'re highly available: 12 servers"',
					tag: 'core',
					prompt: [
						{
							type: 'p',
							text: 'Twelve app servers, a replicated database and two load balancers, all in one availability zone, all deployed at once by a script that updates every server simultaneously.'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'The copies aren\'t **independent**. One zone outage takes everything down at once, and so does one bad deploy pushed to all 12 servers at the same moment. [[redundancy]] only helps when failures are uncorrelated: spread across [[availability-zone|zones]] and deploy gradually (one server or a small percentage first, then the rest) so a bad release hits a few servers, not all of them. See [[blue-green-deployment]].'
						}
					]
				},
				{
					id: 'f-p10q5',
					group: 'Quick checks',
					title: '1 million requests a day is about how many per second?',
					tag: 'teaser',
					prompt: [],
					answer: [{ type: 'p', text: '1,000,000 ÷ 86,400 ≈ **12 req/s**. Useful anchor: "a million a day" is small; a single server handles it easily.' }]
				},
				{
					id: 'f-p10q6',
					group: 'Quick checks',
					title: 'Which is slower: reading 1 MB from RAM or one round trip across a datacenter?',
					tag: 'teaser',
					prompt: [],
					answer: [
						{
							type: 'p',
							text: 'The round trip (~500 µs) is roughly **50× slower** than reading 1 MB from memory (~10 µs). Networks, not CPUs, usually set your latency budget. See [[latency-numbers]].'
						}
					]
				},
				{
					id: 'f-p10q7',
					group: 'Quick checks',
					title: 'Can you just retry a failed POST /payments?',
					tag: 'teaser',
					prompt: [],
					answer: [
						{
							type: 'p',
							text: 'Only if it is [[idempotency|idempotent]]. A timeout doesn\'t mean the payment failed; it means you don\'t know. Send an [[idempotency-key]] so the server can recognise the retry and return the first result instead of charging again.'
						}
					]
				},
				{
					id: 'f-p10q8',
					group: 'Quick checks',
					title: '[[cache-hit-rate|Hit rate]] 95% → 90%: how much more database load?',
					tag: 'teaser',
					prompt: [],
					answer: [{ type: 'p', text: 'Misses go from 5% to 10%: the database load **doubles**. Think in miss rate.' }]
				},
				{
					id: 'f-p10q9',
					group: 'Quick checks',
					title: 'What is the difference between an SLO and an SLA?',
					tag: 'teaser',
					prompt: [],
					answer: [
						{
							type: 'p',
							text: 'The SLO is your internal target; the SLA is the contract with penalties. The SLA is set looser than the SLO so you fix problems before they cost money. See [[slo-vs-sla]].'
						}
					]
				},
				{
					id: 'f-p10q10',
					group: 'Quick checks',
					title: 'Why can\'t you average p99 latencies from two servers?',
					tag: 'teaser',
					prompt: [],
					answer: [
						{
							type: 'p',
							text: 'A [[percentiles|percentile]] describes a whole distribution, and averaging two of them doesn\'t give the percentile of the combined data. Server A p99 = 100 ms and server B p99 = 900 ms doesn\'t mean the fleet p99 is 500 ms. Merge the raw data or histograms, then compute.'
						}
					]
				}
			]
		}
	]
};

export default a0;
