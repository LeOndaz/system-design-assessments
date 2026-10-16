import type { GlossaryTerm } from '../types';

/**
 * Foundations glossary: the basic vocabulary of system design, written for someone meeting it
 * for the first time. Assessment 0 links these heavily; the harder assessments assume them.
 */
const terms: GlossaryTerm[] = [
	// ───────────────────────── the request path ─────────────────────────
	{
		id: 'request-lifecycle',
		term: 'Request lifecycle',
		aliases: ['what happens when you type a URL', 'request path'],
		category: 'frontend & network',
		short:
			'Everything between a user pressing Enter and seeing a response: resolve the name ([[dns]]), open a connection ([[tcp-handshake]], [[tls-handshake]]), pass through a [[load-balancer]], run application code, maybe hit a cache and a database, and send bytes back. Each hop adds latency and is a place things break, so debugging means knowing which hop got slower.',
		analogy:
			'Posting a letter: look up the address, walk to the post office, queue at the counter, the sorting office routes it, someone at the other end reads it and writes back. A delay anywhere delays the reply.',
		related: ['latency-numbers', 'dns', 'load-balancer', 'cdn'],
		page: [
			{ type: 'heading', text: 'The hops, in order' },
			{
				type: 'flow',
				steps: [
					{ label: 'Browser', note: 'checks its own caches' },
					{ label: 'DNS resolver', note: 'name → IP (often cached)' },
					{ label: 'CDN edge', note: 'static files, maybe cached pages' },
					{ label: 'Load balancer', note: 'TLS ends here, picks a server' },
					{ label: 'App server', note: 'your code' },
					{ label: 'Cache', note: 'Redis / Memcached' },
					{ label: 'Database', note: 'source of truth' }
				],
				caption: 'Not every request touches every hop. A cached image may stop at the CDN; a write must reach the database.'
			},
			{ type: 'heading', text: 'A worked timing: first visit vs repeat visit' },
			{
				type: 'p',
				text: 'Say the round trip (RTT) between the user and the server is **100 ms** and the server spends **50 ms** working.'
			},
			{
				type: 'table',
				head: ['Step', 'First visit (cold)', 'Repeat visit (warm)'],
				numeric: [1, 2],
				rows: [
					['DNS lookup', '~50 ms', '0 ms (cached)'],
					['TCP handshake', '100 ms (1 RTT)', '0 ms (connection reused)'],
					['TLS 1.3 handshake', '100 ms (1 RTT)', '0 ms (connection reused)'],
					['Send request, get first byte back', '100 ms (1 RTT)', '100 ms (1 RTT)'],
					['Server work', '50 ms', '50 ms'],
					['**Total**', '**~400 ms**', '**~150 ms**']
				],
				caption: 'Most of the first-visit cost is round trips, not server work. That is why connection reuse, CDNs (shorter RTT) and fewer sequential requests matter so much.'
			},
			{
				type: 'callout',
				tone: 'info',
				title: 'How to use this in an interview',
				text: 'When asked "why is it slow?", walk the hops and ask which one grew. When asked "how do we make it faster?", the answer is usually: fewer round trips, shorter round trips (move closer to the user), or less work per hop.'
			}
		]
	},
	{
		id: 'dns',
		term: 'DNS',
		aliases: ['domain name system', 'name resolution'],
		category: 'frontend & network',
		short:
			"The internet's phone book: it turns a name like `api.example.com` into an IP address a computer can connect to. Answers are cached at many layers (browser, OS, resolver) for as long as the record's [[ttl]] says, which makes lookups fast but means changes take time to spread.",
		analogy: 'Looking up a friend\'s number in your contacts instead of asking directory enquiries every time.',
		related: ['dns-ttl', 'dns-caching', 'request-lifecycle']
	},
	{
		id: 'tcp-handshake',
		term: 'TCP handshake',
		aliases: ['three-way handshake', 'SYN SYN-ACK ACK'],
		category: 'frontend & network',
		short:
			'Before any data flows over TCP, client and server exchange three small packets (SYN, SYN-ACK, ACK) to agree the connection exists. That costs one full round trip before the first byte of your request is sent. Reusing an open connection (keep-alive, connection pools) skips it.',
		analogy: '"Can you hear me?" "Yes, can you hear me?" "Yes." Only then does the real conversation start.',
		related: ['tls-handshake', 'connection-pool', 'request-lifecycle']
	},
	{
		id: 'tls-handshake',
		term: 'TLS handshake',
		aliases: ['HTTPS handshake', 'SSL handshake'],
		category: 'frontend & network',
		short:
			'After TCP connects, client and server agree encryption keys and the server proves its identity with a certificate. TLS 1.3 needs one extra round trip (TLS 1.2 needed two). It is also CPU work, which is why TLS is often "terminated" at the [[load-balancer]] or [[cdn]] instead of on every app server.',
		related: ['tcp-handshake', 'tls-certificate', 'request-lifecycle']
	},
	{
		id: 'latency-numbers',
		term: 'Latency numbers every engineer should know',
		aliases: ['latency cheat sheet', 'numbers everyone should know'],
		category: 'latency & capacity',
		short:
			'Rough orders of magnitude for how long basic operations take: memory is nanoseconds, SSD is tens of microseconds, a network hop inside a datacenter is ~0.5 ms, crossing a continent is ~100 ms. You don\'t need exact values; you need to know which is 1,000× slower than which, so you can tell instantly whether a design is plausible.',
		related: ['request-lifecycle', 'back-of-envelope', 'tail-latency'],
		page: [
			{
				type: 'table',
				head: ['Operation', 'Roughly', 'Relative to a memory read'],
				numeric: [1, 2],
				rows: [
					['Read from CPU L1 cache', '~1 ns', '0.01×'],
					['Read from main memory (RAM)', '~100 ns', '1×'],
					['Read 1 MB sequentially from memory', '~10 µs', '100×'],
					['Random read from SSD', '~20–100 µs', '200–1,000×'],
					['Round trip inside one datacenter / zone', '~0.5 ms', '5,000×'],
					['Round trip between zones in a region', '~1–2 ms', '10,000–20,000×'],
					['Disk (spinning HDD) seek', '~5–10 ms', '50,000–100,000×'],
					['Round trip across a continent', '~50–80 ms', '~600,000×'],
					['Round trip Europe ↔ US West', '~150 ms', '~1,500,000×']
				],
				caption: 'Values vary by hardware and network; the ratios are what matter. 1 ms = 1,000 µs = 1,000,000 ns.'
			},
			{ type: 'heading', text: 'Three things this table tells you' },
			{
				type: 'list',
				items: [
					'**A cache in RAM beats a database on SSD across the network** mostly because of the network hop, not the storage.',
					'**Sequential round trips add up fast.** 30 queries × 0.5 ms = 15 ms inside a datacenter. Put the database in another region (~80 ms) and the same page takes 2.4 s. See [[n-plus-one]].',
					'**You cannot beat the speed of light.** A user in Sydney talking to a server in Virginia pays ~200 ms per round trip no matter how fast your code is. Only moving data closer ([[cdn]], regional replicas) helps.'
				]
			}
		]
	},
	{
		id: 'load-balancer',
		term: 'Load balancer',
		aliases: ['LB', 'ALB', 'reverse proxy'],
		category: 'cloud & infra',
		short:
			"A component that receives every incoming request and forwards it to one of several identical servers. It spreads load, stops sending traffic to servers that fail [[health-check|health checks]], and is usually where HTTPS is decrypted. It is what makes [[horizontal-scaling]] possible: clients talk to one address, while servers come and go behind it.",
		analogy: 'The host at a restaurant who seats each new party at whichever waiter has room.',
		related: ['round-robin', 'least-connections', 'health-check', 'sticky-sessions']
	},
	{
		id: 'round-robin',
		term: 'Round robin',
		category: 'cloud & infra',
		short:
			'The simplest [[load-balancer]] strategy: send request 1 to server A, request 2 to B, request 3 to C, then back to A. It is fair when requests cost about the same, and unfair when some requests take 10 ms and others 10 s, because a server stuck with slow ones keeps getting its "fair" share anyway.',
		related: ['least-connections', 'load-balancer']
	},
	{
		id: 'least-connections',
		term: 'Least connections',
		aliases: ['least outstanding requests'],
		category: 'cloud & infra',
		short:
			'A [[load-balancer]] strategy that sends each new request to the server currently handling the fewest. It adapts automatically when some requests are slow or one server is struggling, because a busy server holds more open requests and stops getting new ones.',
		related: ['round-robin', 'load-balancer']
	},
	{
		id: 'health-check',
		term: 'Health check',
		category: 'cloud & infra',
		short:
			'A small request (like `GET /healthz`) that a [[load-balancer]] or orchestrator sends to each server every few seconds. Servers that fail it are taken out of rotation until they pass again. A health check that is too shallow keeps broken servers in; one that checks every dependency can take all servers out at once when a shared database blips.',
		related: ['deep-health-check', 'readiness-probe', 'liveness-probe', 'load-balancer']
	},
	{
		id: 'vertical-scaling',
		term: 'Vertical scaling',
		aliases: ['scale up', 'bigger machine'],
		category: 'cloud & infra',
		short:
			'Handling more load by giving one machine more CPU, RAM or faster disks. It needs no code changes and is often the right first move, but it has a ceiling (the biggest machine you can buy), usually needs a restart, and leaves you with a single machine whose failure is an outage.',
		related: ['horizontal-scaling', 'single-point-of-failure']
	},
	{
		id: 'horizontal-scaling',
		term: 'Horizontal scaling',
		aliases: ['scale out', 'more machines'],
		category: 'cloud & infra',
		short:
			'Handling more load by adding more machines that share the work behind a [[load-balancer]]. It has no hard ceiling and survives individual failures, but only works cleanly when servers are [[stateless-service|stateless]]. Data stores are much harder to scale this way, which is why they need [[replication]] and [[sharding]].',
		related: ['vertical-scaling', 'stateless-service', 'autoscaling']
	},
	{
		id: 'stateless-service',
		term: 'Stateless service',
		category: 'cloud & infra',
		short:
			"A server that keeps nothing between requests that another server would need: no sessions in memory, no files on local disk. Any request can go to any copy, so you can add, remove or restart servers freely. State still exists; it just lives in a shared store (database, cache, object storage) instead of in the server.",
		analogy: 'A call-centre agent who reads your history from the shared system, so it doesn\'t matter which agent picks up.',
		related: ['horizontal-scaling', 'sticky-sessions', 'object-storage']
	},
	{
		id: 'object-storage',
		term: 'Object storage',
		aliases: ['S3', 'blob storage', 'GCS'],
		category: 'cloud & infra',
		short:
			'A service that stores files ("objects") by key over HTTP, with effectively unlimited capacity and very high durability, like S3. It is cheap per GB and great for images, videos, backups and exports, but it is not a filesystem or a database: you fetch whole objects by key, and there are no queries or partial updates.',
		related: ['presigned-url', 'cdn', 'stateless-service']
	},
	{
		id: 'presigned-url',
		term: 'Presigned URL',
		aliases: ['signed URL'],
		category: 'security & compliance',
		short:
			'A temporary link, signed by your server, that lets a client upload or download one specific object directly to or from [[object-storage]] without your servers carrying the bytes. The signature encodes the object, the allowed operation and an expiry, so it can\'t be reused for anything else or after it expires.',
		related: ['object-storage']
	},
	{
		id: 'cdn',
		term: 'CDN',
		aliases: ['content delivery network', 'edge cache'],
		category: 'caching',
		short:
			'A network of servers spread around the world that cache your content close to users. A user in Tokyo gets your images from a Tokyo server instead of crossing the Pacific, which cuts latency and takes load off your origin. Dynamic or personalised responses need care, because caching them by mistake shows one user\'s page to another.',
		related: ['cdn-cache-key', 'cache-control', 'latency-numbers', 'ttl']
	},

	// ───────────────────────── estimation ─────────────────────────
	{
		id: 'back-of-envelope',
		term: 'Back-of-envelope estimation',
		aliases: ['capacity estimation', 'napkin math', 'Fermi estimate'],
		category: 'latency & capacity',
		short:
			'Quick, rounded arithmetic to size a system before designing it: requests per second, storage per year, bandwidth, number of servers. The goal is the right order of magnitude (10 or 10,000?), because that decides the design. Round aggressively, write each step down, and sanity-check the result against something you know.',
		related: ['latency-numbers', 'peak-factor', 'capacity-planning', 'littles-law'],
		page: [
			{ type: 'heading', text: 'The four numbers to memorise' },
			{
				type: 'list',
				items: [
					'**Seconds in a day = 86,400 ≈ 100,000.** Rounding up makes division easy. It under-states QPS by about 14%, which the peak factor more than covers.',
					'**1 million requests/day ≈ 12 requests/second** on average.',
					'**Powers of 1,000:** KB → MB → GB → TB → PB.',
					'**Peak is 2–10× average**, depending on how bursty the product is.'
				]
			},
			{ type: 'heading', text: 'Worked example: a photo-sharing app' },
			{
				type: 'p',
				text: '**Given:** 10 million daily active users. Each opens the app ~20 times a day (20 requests). 10% upload one photo a day, averaging 2 MB. Photos are viewed 10× as often as uploaded.'
			},
			{
				type: 'table',
				head: ['Quantity', 'Arithmetic', 'Result'],
				rows: [
					['Requests per day', '10M users × 20', '200M / day'],
					['Average QPS', '200M ÷ 86,400 s', '≈ 2,300 req/s'],
					['Peak QPS (×3)', '2,300 × 3', '≈ 7,000 req/s'],
					['Uploads per day', '10M × 10%', '1M photos / day'],
					['New storage per day', '1M × 2 MB', '2 TB / day'],
					['Storage per year', '2 TB × 365', '730 TB / year'],
					['…with 3 copies', '730 TB × 3', '≈ 2.2 PB / year'],
					['Photo views per day', '1M × 10', '10M views ≈ 20 TB / day'],
					['Average egress bandwidth', '20 TB ÷ 86,400 s', '≈ 230 MB/s ≈ 1.9 Gbit/s']
				]
			},
			{
				type: 'callout',
				tone: 'info',
				title: 'What the numbers decide',
				text: '7,000 req/s is a handful of app servers, not a supercomputer. 2.2 PB/year rules out "store photos in Postgres": that is [[object-storage]] territory. ~2 Gbit/s of image traffic should be served by a [[cdn]], not your servers. Each number points at a design choice; that is the whole point of estimating.'
			}
		]
	},
	{
		id: 'peak-factor',
		term: 'Peak factor',
		aliases: ['peak-to-average ratio'],
		category: 'latency & capacity',
		short:
			'How much busier the busiest moment is than the average. Traffic follows daily cycles and spikes (lunchtime, a push notification, a sale), so a system sized for the daily average falls over every evening. Typical multipliers are 2–3× for steady consumer apps and 10× or more for event-driven ones.',
		related: ['back-of-envelope', 'headroom', 'autoscaling']
	},

	// ───────────────────────── data ─────────────────────────
	{
		id: 'acid',
		term: 'ACID',
		aliases: ['transactions', 'atomicity', 'durability'],
		category: 'databases',
		short:
			'The four promises of a database transaction. **Atomic:** all of its changes happen or none do. **Consistent:** it can\'t leave data breaking the rules you declared (constraints). **Isolated:** concurrent transactions don\'t see each other\'s half-finished work (how strictly depends on the [[isolation-level]]). **Durable:** once committed, it survives a crash.',
		analogy: 'A bank transfer either moves the money out of one account *and* into the other, or does neither, even if the power fails halfway.',
		related: ['isolation-level', 'sql-vs-nosql']
	},
	{
		id: 'sql-vs-nosql',
		term: 'SQL vs NoSQL',
		aliases: ['relational vs non-relational', 'NoSQL', 'document database', 'key-value store'],
		category: 'databases',
		short:
			'Relational (SQL) databases store tables with a fixed schema, support joins and [[acid]] transactions, and answer queries you didn\'t plan for. "NoSQL" is a family (key-value, document, wide-column, graph) that usually trades flexible queries and joins for easy [[horizontal-scaling]] and predictable speed on a few known access patterns. Choose by how you will read and write the data, not by fashion.',
		related: ['acid', 'normalization', 'denormalization', 'sharding']
	},
	{
		id: 'normalization',
		term: 'Normalization',
		category: 'databases',
		short:
			'Structuring tables so each fact is stored once: a customer\'s address lives in the customers table, and orders refer to the customer by id. Updates are easy and data can\'t disagree with itself, but reads need joins.',
		related: ['denormalization', 'sql-vs-nosql']
	},
	{
		id: 'denormalization',
		term: 'Denormalization',
		category: 'databases',
		short:
			'Deliberately copying data so common reads need no joins, e.g. storing the author\'s name on every post. Reads get faster and simpler; in exchange, every copy must be updated when the original changes, and copies can drift apart if one update fails.',
		related: ['normalization', 'cache-invalidation']
	},
	{
		id: 'replication',
		term: 'Replication',
		category: 'databases',
		short:
			'Keeping copies of the same data on several machines. It gives you more machines to read from, survival when one dies, and copies closer to users. The price is keeping copies in sync: either writes wait for copies (slower) or copies lag behind (stale reads). See [[leader-follower]] and [[replication-lag]].',
		related: ['leader-follower', 'read-replica', 'replication-lag', 'quorum']
	},
	{
		id: 'leader-follower',
		term: 'Leader–follower replication',
		aliases: ['primary–replica', 'master–slave'],
		category: 'databases',
		short:
			'The most common [[replication]] setup: one leader accepts all writes and streams them to followers, which serve reads. It is simple and avoids write conflicts. The leader is the write bottleneck and a [[single-point-of-failure]] until a follower is promoted ([[failover]]), and followers can be slightly behind.',
		related: ['replication', 'read-replica', 'failover', 'split-brain']
	},
	{
		id: 'sharding',
		term: 'Sharding',
		aliases: ['partitioning', 'horizontal partitioning'],
		category: 'databases',
		short:
			'Splitting one big dataset across several databases, each holding a slice chosen by a **shard key** (e.g. `user_id`). Each shard handles a fraction of the reads, writes and storage, so you can grow past one machine. The cost: queries that span shards get hard, and a badly chosen key puts most of the traffic on one shard (a [[hot-partition]]).',
		analogy: 'Splitting a phone book into A–H, I–P and Q–Z volumes. Easy to find "Smith"; awkward to find "everyone on Elm Street".',
		related: ['hot-partition', 'consistent-hashing', 'partition-key', 'replication'],
		page: [
			{ type: 'heading', text: 'Choosing a shard key' },
			{
				type: 'table',
				head: ['Key', 'Spreads evenly?', 'Common queries stay on one shard?', 'Verdict'],
				rows: [
					['`user_id` (hashed)', 'Yes', 'Yes for "my stuff" queries', 'Good default for user-centric apps'],
					['`country`', 'No: one country dominates', 'Yes for per-country queries', 'Hot shard waiting to happen'],
					['`created_at` (date)', 'No: all new writes hit the newest shard', 'Yes for time ranges', 'Write hot spot'],
					['`tenant_id`', 'Only if tenants are similar sized', 'Yes', 'Watch your biggest customer']
				]
			},
			{ type: 'heading', text: 'The hot-key problem, with numbers' },
			{
				type: 'p',
				text: 'A social app shards posts by `author_id` across 10 shards. Average load is 1,000 reads/s per shard. A celebrity with 50 million followers posts, and 40,000 reads/s arrive for that one author. All of them hash to the same shard, which now gets **41×** its normal load while the other nine are idle. Adding shards doesn\'t help: the key still maps to one shard.'
			},
			{
				type: 'list',
				items: [
					'**Cache the hot item** in front of the shard; the same post read 40,000 times a second is the ideal cache hit.',
					'**Split the key:** store the hot author\'s data under `author_id#0` … `author_id#9` and read from all ten.',
					'**Treat celebrities differently** (see [[fan-out-on-write]]).'
				]
			},
			{ type: 'heading', text: 'Why `hash(key) mod N` hurts when N changes' },
			{
				type: 'p',
				text: 'With `shard = id mod 4`, adding a fifth shard changes the answer for about **80%** of keys (a key stays put only when `id mod 4 = id mod 5`, which is 4 out of every 20 ids). That is a full reshuffle of the data. [[consistent-hashing]] moves only about 1/5 of the keys instead.'
			}
		]
	},
	{
		id: 'cap-theorem',
		term: 'CAP theorem',
		aliases: ['CAP', 'consistency availability partition tolerance'],
		category: 'distributed systems',
		short:
			'When a network failure splits your system into parts that can\'t talk (a *partition*), each part must choose: refuse requests until it can confirm it has the latest data (**Consistency**), or keep answering with what it has and risk being stale (**Availability**). Partitions will happen, so the real choice is C or A *during a partition*. [[pacelc]] adds what you trade when there is no partition.',
		related: ['pacelc', 'consistency-models', 'quorum', 'split-brain', 'eventual-consistency'],
		page: [
			{ type: 'heading', text: 'A partition story' },
			{
				type: 'p',
				text: 'A shop keeps inventory in two datacenters, East and West, which replicate to each other. One item has **1 unit left**. The link between East and West goes down. A customer in East and a customer in West both click "Buy" at the same moment.'
			},
			{
				type: 'columns',
				columns: [
					{
						title: 'Choose consistency (CP)',
						blocks: [
							{
								type: 'p',
								text: 'Each side knows it can\'t confirm the other hasn\'t sold the unit. At least one side refuses: "Can\'t complete purchase right now." **No oversell**, but some customers get errors until the link heals.'
							}
						]
					},
					{
						title: 'Choose availability (AP)',
						blocks: [
							{
								type: 'p',
								text: 'Both sides accept the order using their local count. **Both customers succeed** and you have sold 2 of 1. When the link heals you must reconcile: apologise, refund, or backorder.'
							}
						]
					}
				]
			},
			{
				type: 'callout',
				tone: 'info',
				title: 'Neither is "right"',
				text: 'For a bank balance or the last concert ticket, choose consistency. For a "likes" counter or a shopping cart, availability is usually better: a slightly wrong count beats an error page. Good designs choose **per feature**, not per company.'
			},
			{ type: 'heading', text: 'PACELC: the part people forget' },
			{
				type: 'p',
				text: 'Partitions are rare. Most of the time the network is fine, and you still trade **Latency vs Consistency**: waiting for a copy in another region to confirm every write (consistent, +80 ms) or acknowledging immediately and syncing later (fast, briefly stale). That everyday trade-off shapes systems far more often than CAP does. See [[pacelc]].'
			}
		]
	},
	{
		id: 'pacelc',
		term: 'PACELC',
		category: 'distributed systems',
		short:
			'An extension of [[cap-theorem]]: if there is a **P**artition, choose **A**vailability or **C**onsistency; **E**lse (normal operation), choose lower **L**atency or stronger **C**onsistency. It captures the everyday cost of consistency: waiting for other replicas on every write, even when nothing is broken.',
		related: ['cap-theorem', 'consistency-models', 'replication-lag']
	},
	{
		id: 'consistency-models',
		term: 'Consistency models',
		aliases: ['strong consistency', 'linearizability', 'causal consistency', 'monotonic reads'],
		category: 'distributed systems',
		short:
			'The rules for what a reader may see after a write when data has several copies. They form a ladder from "every read sees the latest write, as if there were one copy" (strongest, slowest) down to "copies agree eventually" (weakest, fastest). Picking a rung means deciding which surprises your users can tolerate.',
		related: ['eventual-consistency', 'read-your-writes', 'cap-theorem', 'pacelc'],
		page: [
			{ type: 'heading', text: 'The ladder, strongest first' },
			{
				type: 'table',
				head: ['Model', 'What a reader is promised', 'Example of a surprise it prevents', 'Cost'],
				rows: [
					['**Linearizable** (strong)', 'Every read sees the most recent completed write, everywhere', 'Two people both buying the last ticket', 'Highest: coordination on every operation'],
					['**Sequential**', 'Everyone sees operations in the same order, though maybe slightly late', 'Two users seeing comments in different orders', 'High'],
					['**Causal**', 'If B was a reply to A, nobody sees B without A', 'Seeing "Thanks!" before the question it answers', 'Medium'],
					['**Read-your-writes**', 'You always see your own changes', 'Saving your profile, then seeing the old one', 'Low: route your reads smartly'],
					['**Monotonic reads**', 'You never see data go backwards in time', 'A comment appearing, then vanishing on refresh', 'Low: stick a user to one replica'],
					['**Eventual**', 'If writes stop, copies converge', 'Nothing in the short term', 'Lowest']
				]
			},
			{
				type: 'callout',
				tone: 'info',
				title: 'A practical recipe',
				text: 'Most apps use **eventual consistency** for the bulk of reads, add **[[read-your-writes]]** for the user who just made a change (read from the leader for a few seconds after a write), and reserve **strong consistency** for the few places where a wrong answer costs money (balances, inventory, uniqueness).'
			}
		]
	},

	// ───────────────────────── caching ─────────────────────────
	{
		id: 'caching-strategies',
		term: 'Caching strategies',
		aliases: ['cache patterns'],
		category: 'caching',
		short:
			'The rules for when data enters a cache and how writes reach the database. The common ones are [[cache-aside]] (the app fills the cache on a miss), [[write-through]] (write to cache and DB together) and [[write-back]] (write to cache now, DB later). They differ in staleness, write speed and what happens when the cache dies.',
		related: ['cache-aside', 'write-through', 'write-back', 'ttl', 'lru'],
		page: [
			{
				type: 'table',
				head: ['Strategy', 'On read', 'On write', 'Good for', 'Risk'],
				rows: [
					['[[cache-aside]]', 'Check cache; on miss read DB and store in cache', 'Write DB, then delete the cache key', 'Most read-heavy apps', 'Brief staleness; [[cache-stampede]] on popular misses'],
					['[[write-through]]', 'Read from cache (usually warm)', 'Write cache and DB in the same operation', 'Data read soon after it\'s written', 'Every write is slower; caches data nobody reads'],
					['[[write-back]]', 'Read from cache', 'Write cache only; flush to DB later in batches', 'Very write-heavy counters, metrics', 'Cache crash = **lost writes**'],
					['Read-through', 'Cache library loads from DB itself on miss', '(paired with one of the above)', 'Keeping app code simple', 'Same as cache-aside']
				]
			},
			{
				type: 'heading',
				text: 'Why "delete the key" beats "update the key"'
			},
			{
				type: 'p',
				text: 'With cache-aside, after writing the database you could either update the cached value or delete it. Updating looks efficient, but two concurrent writers can update the DB in one order and the cache in the other, leaving the cache wrong **forever** (until the [[ttl]] expires). Deleting is safe: the next reader loads the fresh value. Always keep a TTL as a safety net.'
			}
		]
	},
	{
		id: 'cache-aside',
		term: 'Cache-aside',
		aliases: ['lazy loading', 'look-aside cache'],
		category: 'caching',
		short:
			'The most common caching pattern: the application checks the cache first; on a miss it reads the database and stores the result in the cache with a [[ttl]]. On a write it updates the database and deletes the cached key. The cache only ever holds data someone actually asked for.',
		related: ['caching-strategies', 'write-through', 'cache-stampede', 'cache-invalidation']
	},
	{
		id: 'write-through',
		term: 'Write-through cache',
		category: 'caching',
		short:
			'Every write goes to the cache and the database together, so the cache is always up to date for anything recently written. Reads are fast and fresh; writes are slower because they wait for both, and the cache fills with data that may never be read.',
		related: ['caching-strategies', 'cache-aside', 'write-back']
	},
	{
		id: 'write-back',
		term: 'Write-back cache',
		aliases: ['write-behind'],
		category: 'caching',
		short:
			'Writes go only to the cache and are flushed to the database later, often in batches. Writes are very fast and the database sees far fewer of them, but if the cache node dies before flushing, those writes are gone. Use it only for data you can afford to lose a little of, like view counters.',
		related: ['caching-strategies', 'write-through']
	},
	{
		id: 'lru',
		term: 'LRU / LFU eviction',
		aliases: ['least recently used', 'least frequently used', 'LFU', 'eviction policy'],
		category: 'caching',
		short:
			'When a cache is full it must throw something out. **LRU** (least recently used) evicts what hasn\'t been touched for the longest; **LFU** (least frequently used) evicts what is accessed least often. LRU adapts quickly to changing traffic; LFU protects long-term favourites but is slow to forget yesterday\'s hits. A big one-off scan can flush a pure-LRU cache of everything useful.',
		related: ['ttl', 'redis-eviction', 'cache-hit-rate']
	},

	// ───────────────────────── messaging ─────────────────────────
	{
		id: 'message-queue',
		term: 'Message queue',
		aliases: ['task queue', 'job queue', 'SQS', 'RabbitMQ'],
		category: 'messaging',
		short:
			'A buffer where one part of a system leaves work for another to pick up later. Each message is processed by **one** consumer, then deleted. Queues let a web request return immediately while slow work (emails, image resizing) happens in the background, and they absorb bursts: if work arrives faster than it is processed, the queue grows instead of the system falling over.',
		analogy: 'The ticket rail in a restaurant kitchen: waiters clip orders up, cooks take the next one when free.',
		related: ['pub-sub', 'event-stream', 'at-least-once', 'dead-letter-queue', 'backpressure']
	},
	{
		id: 'pub-sub',
		term: 'Publish–subscribe',
		aliases: ['pub/sub', 'SNS', 'topic'],
		category: 'messaging',
		short:
			'A messaging style where a sender publishes to a **topic** and **every** subscriber gets its own copy. The sender doesn\'t know or care who is listening, so you can add a new consumer (analytics, search indexing) without touching the producer. Compare a [[message-queue]], where each message goes to exactly one worker.',
		related: ['message-queue', 'event-stream', 'fan-out']
	},
	{
		id: 'event-stream',
		term: 'Event stream / log',
		aliases: ['Kafka', 'Kinesis', 'append-only log'],
		category: 'messaging',
		short:
			'An append-only, ordered log of events kept for days or forever. Unlike a queue, reading doesn\'t delete: each consumer tracks its own position and can rewind to re-process history. Order is guaranteed within a partition. Use it when many independent consumers need the same events, or when you need to replay.',
		related: ['message-queue', 'pub-sub', 'consumer-group', 'partition-key', 'consumer-lag']
	},

	// ───────────────────────── reliability ─────────────────────────
	{
		id: 'sli',
		term: 'SLI',
		aliases: ['service level indicator'],
		category: 'reliability practice',
		short:
			'A measured number that reflects what users experience, such as "the percentage of requests that succeed in under 300 ms". It is the input to an [[slo]]. Good SLIs are measured as close to the user as possible (at the load balancer, or in the browser), not from inside a server that might be the thing that\'s broken.',
		related: ['slo', 'slo-vs-sla', 'golden-signals']
	},
	{
		id: 'slo-vs-sla',
		term: 'SLO vs SLA',
		aliases: ['SLA', 'service level agreement', 'nines', 'availability nines'],
		category: 'reliability practice',
		short:
			'An **SLO** is the internal target you set yourself ("99.9% of requests succeed each month"). An **SLA** is a contract with customers that says what you owe them (credits, refunds) if you miss a promise. The SLA is always looser than the SLO, so you notice and fix problems before they cost money. 99.9% allows about 43 minutes of downtime a month; 99.99% allows about 4.3.',
		related: ['slo', 'sli', 'error-budget']
	},
	{
		id: 'golden-signals',
		term: 'The four golden signals',
		aliases: ['latency traffic errors saturation'],
		category: 'observability',
		short:
			'The four things to monitor first on any user-facing service: **latency** (how long requests take, split into successes and failures), **traffic** (how many requests), **errors** (how many fail), and **saturation** (how full the most constrained resource is). If you can only build one dashboard, build these four panels.',
		related: ['red-method', 'use-method', 'saturation', 'percentiles']
	},
	{
		id: 'single-point-of-failure',
		term: 'Single point of failure',
		aliases: ['SPOF'],
		category: 'reliability practice',
		short:
			'Any one component whose failure takes the whole system down: one database server, one load balancer, one region, one engineer who knows the deploy password. Finding SPOFs means tracing every request path and asking "if this one thing disappears, what still works?"',
		related: ['redundancy', 'failover', 'availability-zone']
	},
	{
		id: 'redundancy',
		term: 'Redundancy',
		category: 'reliability practice',
		short:
			'Running more than one copy of something so a failure doesn\'t become an outage. The maths is powerful: two independent servers that are each up 99% of the time are both down only 0.01% of the time, giving 99.99%. The catch is the word *independent*: two copies on the same rack, power supply or bad config fail together.',
		related: ['single-point-of-failure', 'availability-zone', 'failover']
	},
	{
		id: 'graceful-degradation',
		term: 'Graceful degradation',
		category: 'reliability practice',
		short:
			'Designing so that when a non-essential part fails, the product keeps working with less, rather than failing entirely. If recommendations are down, show the page without them; if the avatar service is slow, show initials. It requires deciding in advance which features are essential and giving every optional call a short [[timeout]] and a fallback.',
		related: ['circuit-breaker', 'timeout', 'load-shedding', 'bulkhead']
	},

	// ───────────────────────── APIs ─────────────────────────
	{
		id: 'rest',
		term: 'REST',
		aliases: ['RESTful API', 'HTTP API'],
		category: 'frontend & network',
		short:
			'An API style built on plain HTTP: resources have URLs (`/orders/42`), and HTTP verbs say what to do (`GET` read, `POST` create, `PUT`/`PATCH` update, `DELETE`). It is easy to understand, works with every tool and cache, and is the default for public APIs. Its weak spots are many round trips for related data, and returning more fields than a client needs.',
		related: ['grpc', 'graphql', 'api-versioning']
	},
	{
		id: 'grpc',
		term: 'gRPC',
		category: 'frontend & network',
		short:
			'A framework for calling functions on another service as if they were local. Messages are compact binary (Protocol Buffers) with a strict, generated schema, over HTTP/2. It is fast and type-safe, and good for service-to-service traffic, but awkward to call directly from browsers and harder to debug by eye than JSON.',
		related: ['rest', 'graphql', 'http2-connection-reuse', 'schema-evolution']
	},
	{
		id: 'graphql',
		term: 'GraphQL',
		category: 'frontend & network',
		short:
			'An API where the client sends a query describing exactly which fields and related objects it wants, and gets just that back in one request. It fixes over-fetching and multiple round trips for complex UIs. The cost moves to the server: one innocent-looking query can trigger thousands of database calls ([[n-plus-one]]), so you need batching, depth limits and cost-based rate limits.',
		related: ['rest', 'grpc', 'n-plus-one']
	},
	{
		id: 'offset-pagination',
		term: 'Offset pagination',
		aliases: ['LIMIT OFFSET', 'page numbers'],
		category: 'databases',
		short:
			'Fetching pages with `LIMIT 50 OFFSET 1000`: "skip 1,000 rows, give me the next 50". It is simple and supports "jump to page 20", but the database still reads and discards every skipped row, so deep pages get slow, and rows inserted while a user pages cause duplicates or skipped items. [[keyset-pagination]] fixes both.',
		related: ['keyset-pagination']
	},
	{
		id: 'api-versioning',
		term: 'API versioning',
		category: 'frontend & network',
		short:
			'A way to change an API without breaking clients that still expect the old shape, e.g. `/v1/orders` vs `/v2/orders`, or a version header. Adding optional fields is usually safe without a new version; removing or renaming fields, or changing their meaning, is a breaking change. Mobile apps make this hard because old versions stay installed for years.',
		related: ['schema-evolution', 'rest']
	},
	{
		id: 'rate-limiting',
		term: 'Rate limiting',
		aliases: ['throttling', 'API quotas', 'fixed window'],
		category: 'latency & capacity',
		short:
			'Capping how many requests a client can make in a period, to protect the system from abuse, bugs and noisy customers. Common algorithms: **fixed window** (count per calendar minute; simple, but allows double bursts at window edges), [[sliding-window]] (smoother) and [[token-bucket]] (allows bursts up to a limit while enforcing an average). Over-limit clients get HTTP `429 Too Many Requests`, ideally with a `Retry-After` header.',
		related: ['token-bucket', 'sliding-window', 'load-shedding'],
		page: [
			{ type: 'heading', text: 'Fixed window: the edge burst' },
			{
				type: 'p',
				text: 'Limit: 100 requests per minute, counted per calendar minute. A client sends 100 requests at 12:00:59 and 100 more at 12:01:00. Both windows are within their limit, so **200 requests pass in 2 seconds**. That is the classic weakness of fixed windows.'
			},
			{ type: 'heading', text: 'Token bucket: worked example' },
			{
				type: 'p',
				text: 'Capacity **10** tokens, refill **2 tokens per second**, bucket starts full. Each request costs 1 token.'
			},
			{
				type: 'table',
				head: ['Time', 'Event', 'Tokens before', 'Result', 'Tokens after'],
				numeric: [2, 4],
				rows: [
					['0.0 s', '15 requests arrive at once', '10', '10 allowed, 5 rejected (429)', '0'],
					['2.5 s', '3 requests', '0 + 2.5 × 2 = 5', '3 allowed', '2'],
					['3.0 s', '4 requests', '2 + 0.5 × 2 = 3', '3 allowed, 1 rejected', '0'],
					['10.0 s', '1 request', 'min(10, 0 + 7 × 2) = 10', 'allowed', '9']
				],
				caption: 'Bursts up to the capacity are allowed; over time the average can\'t exceed the refill rate. Only two numbers are stored per client: tokens and last refill time.'
			}
		]
	},
	{
		id: 'websocket',
		term: 'WebSocket',
		aliases: ['long-lived connection', 'server push'],
		category: 'frontend & network',
		short:
			'A connection that stays open after the first HTTP request so the server can push messages to the client at any time, which is what chat and live dashboards need. Each open connection holds memory on a server, so a million online users means a million open connections to manage and rebalance, and a server restart drops all of its users at once.',
		related: ['heartbeat', 'load-balancer']
	},
	{
		id: 'heartbeat',
		term: 'Heartbeat',
		category: 'distributed systems',
		short:
			'A small "I\'m still here" message sent at a regular interval. If heartbeats stop for long enough, the receiver assumes the sender is gone. Shorter intervals detect failures faster but cost more traffic; the timeout must allow for a few missed beats, or brief network hiccups get treated as deaths.',
		related: ['websocket', 'failover', 'ttl']
	},
	{
		id: 'fan-out-on-write',
		term: 'Fan-out on write vs on read',
		aliases: ['fan-out on read', 'push vs pull feed', 'feed fan-out'],
		category: 'distributed systems',
		short:
			'Two ways to build a social feed. **On write (push):** when someone posts, copy the post into every follower\'s feed right away, so reading a feed is one cheap lookup but a post by someone with 50M followers means 50M writes. **On read (pull):** when you open your feed, fetch recent posts from everyone you follow and merge them. Real systems mix both: push for normal users, pull for celebrities.',
		related: ['fan-out', 'hot-partition', 'sharding']
	}
];

export default terms;
