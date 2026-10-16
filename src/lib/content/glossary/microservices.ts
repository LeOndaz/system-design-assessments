import type { GlossaryTerm } from '../types';
import { timeAxis, shape, step, ramp } from '../series';

const mx = timeAxis('10:00', 50);

const terms: GlossaryTerm[] = [
	{
		id: 'dual-write',
		term: 'Dual write',
		category: 'distributed systems',
		short:
			'Code that updates two systems one after the other, for example "save the order to the database, then publish an event to the message broker". There is no transaction spanning both, so a crash, timeout or error between the two leaves them disagreeing: the order exists but nobody downstream ever hears about it, or the reverse.',
		analogy:
			'Writing a cheque and then phoning the bank to say you did. If your phone dies in between, the bank\'s records and yours no longer match, and nothing will fix that by itself.',
		related: ['transactional-outbox', 'saga', 'at-least-once']
	},
	{
		id: 'transactional-outbox',
		term: 'Transactional outbox',
		aliases: ['outbox pattern', 'outbox'],
		category: 'messaging',
		short:
			'A fix for [[dual-write|dual writes]]. Instead of publishing an event directly, the service inserts the event into an `outbox` table *in the same database transaction* as the business change. A separate relay process reads the outbox and publishes to the broker. Because the business row and the event commit or roll back together, an event can never be lost or invented. It can still be published more than once, so consumers must be idempotent.',
		analogy:
			'Instead of phoning the bank after writing a cheque, you staple a carbon copy into the cheque book itself. A courier collects the copies later. Copies can be delivered twice, but none go missing.',
		related: ['dual-write', 'at-least-once', 'idempotent-consumer', 'change-data-capture'],
		page: [
			{ type: 'heading', text: 'The problem it solves' },
			{
				type: 'code',
				lang: 'python',
				caption: 'A dual write. Each line is fine on its own; the gap between them is the bug.',
				code: `def place_order(cmd):
    order = db.insert_order(cmd)          # 1. committed
    bus.publish("order.placed", order)    # 2. broker down? pod killed? → event lost forever
    return order`
			},
			{
				type: 'p',
				text: 'Swapping the order doesn\'t help: publish first and then the insert fails, and downstream services act on an order that doesn\'t exist. Wrapping both in `try/except` doesn\'t help either, because the process can die between the two lines.'
			},
			{ type: 'heading', text: 'The pattern' },
			{
				type: 'code',
				lang: 'python',
				code: `def place_order(cmd):
    with db.transaction() as tx:
        order = tx.insert_order(cmd)
        tx.insert("outbox", {
            "id": uuid4(), "topic": "order.placed",
            "key": order.id, "payload": to_json(order),
        })
    return order   # both rows committed atomically, or neither

# separate relay process (or CDC connector)
def relay_forever():
    while True:
        rows = db.fetch("SELECT * FROM outbox WHERE published_at IS NULL "
                        "ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED")
        for r in rows:
            bus.publish(r.topic, key=r.key, value=r.payload, headers={"event_id": r.id})
            db.execute("UPDATE outbox SET published_at = now() WHERE id = %s", r.id)`
			},
			{
				type: 'flow',
				steps: [
					{ label: 'Order + outbox row', note: 'one DB transaction' },
					{ label: 'Relay / CDC', note: 'reads committed rows' },
					{ label: 'Broker', note: 'at-least-once' },
					{ label: 'Consumers', note: 'dedupe by event id', tone: 'ok' }
				]
			},
			{ type: 'heading', text: 'Things that still go wrong' },
			{
				type: 'list',
				items: [
					'**Duplicates.** The relay can crash after publishing but before marking the row. That\'s fine *only if* consumers are [[idempotent-consumer|idempotent]]. Ship the outbox row id as the event id.',
					'**Polling by `id > last_seen`.** IDs are allocated at insert time, not commit time. A transaction that took id 41 but commits after id 42 was already relayed is skipped forever. Use a `published_at IS NULL` flag, or [[change-data-capture|CDC]] which follows the commit log.',
					'**Ordering.** With several relay workers, two events for the same order can be published out of order. Keep one relay per partition key, or publish with the aggregate id as the [[partition-key]] and a version number.',
					'**Table growth.** Delete or archive published rows, or the relay\'s query gets slower every week.'
				]
			}
		]
	},
	{
		id: 'change-data-capture',
		term: 'Change data capture (CDC)',
		aliases: ['CDC', 'Debezium'],
		category: 'messaging',
		short:
			'Reading a database\'s own replication log (Postgres WAL, MySQL binlog) and turning each committed change into an event. Because it follows the commit log, it sees changes in commit order and never misses one, which makes it a reliable way to feed a [[transactional-outbox]] to a broker.',
		related: ['transactional-outbox', 'replication-lag']
	},
	{
		id: 'saga',
		term: 'Saga',
		aliases: ['compensating transaction', 'compensation'],
		category: 'distributed systems',
		short:
			'A way to run a business operation that spans several services without a distributed transaction. The operation is a sequence of local steps (reserve stock, charge card, book courier), and each step has a **compensating action** that semantically undoes it (release stock, refund card). If step 3 fails, the saga runs the compensations for steps 2 and 1. Compensations are ordinary requests that can themselves fail, so they must be retried until they succeed and must be idempotent.',
		analogy:
			'Booking a trip: flight, then hotel, then car. If no car is available you don\'t "roll back time"; you cancel the hotel and then the flight, and you keep trying until the airline confirms the refund.',
		related: ['state-machine', 'idempotency', 'transactional-outbox', 'dual-write'],
		page: [
			{ type: 'heading', text: 'Orchestrated saga, step by step' },
			{
				type: 'table',
				head: ['Step', 'Action', 'Compensation', 'If this step fails'],
				rows: [
					['1', 'Reserve inventory', 'Release reservation', 'Nothing to undo, fail the order'],
					['2', 'Capture payment', 'Refund payment', 'Run compensation 1'],
					['3', 'Create shipment', 'Cancel shipment', 'Run compensations 2, then 1'],
					['4', 'Mark order confirmed', '—', 'Retry; it\'s a local write']
				]
			},
			{ type: 'heading', text: 'The bugs interviewers look for' },
			{
				type: 'list',
				items: [
					'**Compensation fired once and forgotten.** The refund call times out, the code logs an error, and the customer stays charged. Compensations need durable state (a saga log or [[state-machine]] row) and a retry loop.',
					'**Missing compensations.** A new step is added and nobody adds its undo.',
					'**Wrong order.** Compensate in reverse order; releasing stock before refunding can let the item be resold while the refund is still failing.',
					'**Not idempotent.** A retried refund refunds twice. Use an [[idempotency-key]] derived from the saga id and step.',
					'**Assuming a timeout means failure.** If "capture payment" timed out, the payment may have succeeded. The compensation logic must query or refund safely, not assume nothing happened.',
					'**Visible intermediate states.** Between steps, other readers can see a reserved-but-unpaid order. That\'s expected; design the UI and emails around it (no "confirmed" email until the saga completes).'
				]
			}
		]
	},
	{
		id: 'at-least-once',
		term: 'At-least-once delivery',
		category: 'messaging',
		short:
			'The guarantee most message brokers and webhook senders actually give: every message is delivered, but some may be delivered more than once (after a crash, a timeout, or a consumer rebalance). The consumer is responsible for making duplicates harmless. "At-most-once" is the opposite trade-off: never duplicated, sometimes lost.',
		related: ['exactly-once', 'idempotent-consumer', 'idempotency', 'offset-commit']
	},
	{
		id: 'exactly-once',
		term: 'Exactly-once',
		aliases: ['exactly once semantics', 'EOS'],
		category: 'messaging',
		short:
			'Usually a marketing term. Networks can always lose an acknowledgement, so a sender can never be sure a message arrived exactly once. What systems really offer is *effectively once*: [[at-least-once]] delivery plus an [[idempotent-consumer]] (or a transaction that stores the result and the consumer offset together), so a duplicate has no extra effect. Kafka\'s "exactly-once" only covers Kafka-to-Kafka pipelines, not your call to a payment API.',
		related: ['at-least-once', 'idempotent-consumer', 'idempotency']
	},
	{
		id: 'idempotent-consumer',
		term: 'Idempotent consumer',
		aliases: ['inbox pattern', 'deduplication'],
		category: 'messaging',
		short:
			'A message handler that produces the same end result whether it sees a message once or five times. Typical techniques: record processed event ids in a table in the same transaction as the side effect (an "inbox"), use natural keys with upserts, or compare a version number and ignore anything not newer. It\'s the consumer half of [[exactly-once|effectively-once]] processing.',
		related: ['at-least-once', 'idempotency', 'aggregate-version']
	},
	{
		id: 'aggregate-version',
		term: 'Aggregate version',
		aliases: ['sequence number', 'optimistic concurrency', 'version number'],
		category: 'distributed systems',
		short:
			'A counter stored on an entity (an order, an account) that goes up by one on every change and travels with each event about it. Consumers use it to spot duplicates (version already applied), gaps (version 5 arrived but 4 hasn\'t) and stale writes (`UPDATE … WHERE version = :expected`). Unlike timestamps, versions don\'t suffer from [[clock-skew]].',
		related: ['idempotent-consumer', 'out-of-order-delivery', 'clock-skew']
	},
	{
		id: 'consumer-group',
		term: 'Consumer group',
		category: 'messaging',
		short:
			'A set of consumer processes that share the work of reading a topic. The broker assigns each partition to exactly one member of the group, so a topic with 12 partitions can be processed by at most 12 consumers in parallel; a 13th consumer sits idle. Members prove they\'re alive by polling and heartbeating.',
		related: ['partition-key', 'consumer-rebalance', 'consumer-lag']
	},
	{
		id: 'consumer-lag',
		term: 'Consumer lag',
		category: 'messaging',
		short:
			'How far behind a consumer is: the newest offset written to a partition minus the last offset the consumer group has committed. Lag counted in *messages* is hard to judge; convert it to *time* (lag ÷ consume rate, or the age of the oldest unprocessed message), because that\'s what users feel. Lag growing steadily means you consume slower than you produce; lag in a sawtooth usually means repeated rebalances or batch reprocessing.',
		related: ['consumer-group', 'consumer-rebalance', 'backpressure']
	},
	{
		id: 'consumer-rebalance',
		term: 'Consumer rebalance',
		aliases: ['rebalance storm', 'max.poll.interval.ms'],
		category: 'messaging',
		short:
			'When a [[consumer-group]] member joins, leaves, or is presumed dead, the broker reassigns partitions among the members. During a rebalance, consumption pauses, and any messages a consumer processed but hadn\'t yet committed are handed to someone else and processed again. A "rebalance storm" is when consumers keep getting kicked out (often because one batch takes longer than `max.poll.interval.ms`), so the group spends more time reshuffling than working.',
		related: ['consumer-group', 'consumer-lag', 'offset-commit', 'at-least-once'],
		page: [
			{ type: 'p', text: 'A Kafka consumer loop looks like: poll a batch → process every record → commit → poll again. The broker treats "hasn\'t called poll for longer than `max.poll.interval.ms` (default 5 minutes)" as "this consumer is stuck" and evicts it.' },
			{ type: 'heading', text: 'How a slow dependency turns into a storm' },
			{
				type: 'list',
				ordered: true,
				items: [
					'Batch of `max.poll.records = 500`. Each record calls an API that normally takes 80 ms → 40 s per batch. Comfortably under 300 s.',
					'The API slows to 900 ms → 450 s per batch. The consumer misses the poll deadline and is evicted mid-batch.',
					'Its partitions move to another member, which starts from the last *committed* offset and reprocesses the same records (duplicates) and is just as slow.',
					'The evicted consumer finishes, tries to commit, gets `CommitFailedException`, rejoins → another rebalance.',
					'Lag climbs in a sawtooth, throughput collapses, duplicates pile up downstream.'
				]
			},
			{
				type: 'dashboard',
				dashboard: {
					style: 'grafana',
					title: 'What it looks like',
					range: 'illustrative',
					panels: [
						{
							kind: 'timeseries',
							title: 'Batch processing time',
							unit: 's',
							x: mx,
							series: [{ name: 'p99 batch', points: shape(50, { base: 40, noise: 0.1, seed: 4 }, ramp(15, 22, 40, 450)) }],
							thresholds: [{ value: 300, label: 'max.poll.interval', tone: 'crit' }],
							span: 3
						},
						{
							kind: 'timeseries',
							title: 'Rebalances / min',
							x: mx,
							series: [{ name: 'rebalances', points: shape(50, { base: 0, noise: 0, seed: 2 }, (i, v) => (i > 22 && i % 5 === 0 ? 3 : v)), color: 1 }],
							span: 3
						}
					]
				}
			},
			{ type: 'heading', text: 'Fixes' },
			{
				type: 'list',
				items: [
					'Fewer records per poll, or a `max.poll.interval.ms` sized to the worst realistic batch.',
					'A tight [[timeout]] and [[circuit-breaker]] on the slow dependency, so a batch can\'t take forever.',
					'Process records concurrently within the batch (bounded) or hand them to a worker pool and pause the partition.',
					'Cooperative/incremental rebalancing and static group membership so a restart doesn\'t reshuffle everyone.',
					'Idempotent processing, because some reprocessing after a rebalance is unavoidable.'
				]
			}
		]
	},
	{
		id: 'offset-commit',
		term: 'Offset commit',
		aliases: ['auto-commit', 'enable.auto.commit'],
		category: 'messaging',
		short:
			'A consumer telling the broker "I\'ve handled everything up to here". Commit *before* processing and a crash loses messages (at-most-once). Commit *after* processing and a crash means re-processing (at-least-once). Auto-commit commits on a timer regardless of whether processing finished, so it quietly gives you the lossy version.',
		related: ['at-least-once', 'consumer-rebalance', 'idempotent-consumer']
	},
	{
		id: 'partition-key',
		term: 'Partition key',
		aliases: ['message key', 'shard key'],
		category: 'messaging',
		short:
			'The value a broker hashes to decide which partition a message goes to. All messages with the same key land on the same partition, which is what gives you per-key ordering. The cost: if one key is very busy (one huge tenant), its partition, and the single consumer that owns it, becomes a [[hot-partition]] no matter how many partitions or consumers you add.',
		related: ['hot-partition', 'consumer-group', 'out-of-order-delivery']
	},
	{
		id: 'dead-letter-queue',
		term: 'Dead-letter queue (DLQ)',
		aliases: ['DLQ', 'parking lot'],
		category: 'messaging',
		short:
			'A side queue where a consumer moves messages it can\'t process after a few attempts, along with the error, so the main stream can keep flowing. It turns "one bad message blocks everything" into "one bad message waits for a human". A DLQ nobody monitors is just a slower way to lose data, so alert on its depth and have a replay tool.',
		related: ['poison-message', 'at-least-once']
	},
	{
		id: 'poison-message',
		term: 'Poison message',
		aliases: ['poison pill'],
		category: 'messaging',
		short:
			'A message that makes the consumer fail every time it\'s processed: malformed JSON, a schema it doesn\'t understand, a value that triggers a bug. With ordered partitions and "retry until success", the consumer retries it forever and every message behind it waits. Symptom: lag grows on one partition while consumers look busy and logs repeat the same error with the same offset.',
		related: ['dead-letter-queue', 'schema-evolution', 'consumer-lag']
	},
	{
		id: 'schema-evolution',
		term: 'Schema evolution',
		aliases: ['backward compatibility', 'forward compatibility', 'schema registry'],
		category: 'messaging',
		short:
			'Changing the shape of events or API payloads without breaking the other side. *Backward compatible*: new consumers can read old messages. *Forward compatible*: old consumers can read new messages, which matters because producers usually deploy first. Safe changes add optional fields; unsafe ones rename or remove fields, change types, or add enum values old code will reject. A schema registry can block incompatible changes at publish time.',
		related: ['poison-message', 'dead-letter-queue']
	},
	{
		id: 'backpressure',
		term: 'Backpressure',
		category: 'distributed systems',
		short:
			'A way for a slow component to tell faster upstream components to slow down, instead of silently buffering. Without it, queues between services grow until memory runs out or latency explodes. Examples: bounded queues that block or reject when full, TCP flow control, a consumer pausing partitions, returning 429/503 with `Retry-After`.',
		related: ['load-shedding', 'consumer-lag', 'littles-law']
	},
	{
		id: 'load-shedding',
		term: 'Load shedding',
		category: 'reliability practice',
		short:
			'Deliberately rejecting some requests early and cheaply when a service is over capacity, so the requests you *do* accept finish in time. It sounds wasteful, but an overloaded service that accepts everything ends up finishing nothing: every request waits in a queue until its caller has already given up. Good shedding prefers cheap rejections, drops low-priority traffic first, and drops requests that have already passed their deadline.',
		related: ['backpressure', 'cascading-failure', 'metastable-failure', 'deadline-propagation']
	},
	{
		id: 'cascading-failure',
		term: 'Cascading failure',
		category: 'reliability practice',
		short:
			'One component\'s problem spreads to the components that depend on it, and then to theirs. A slow service holds its callers\' threads and connections, so those callers slow down and hold *their* callers\' resources, until the whole call graph is stuck. Retries, missing timeouts and shared pools are the usual carriers. [[bulkhead|Bulkheads]], [[circuit-breaker|circuit breakers]], [[timeout|timeouts]] and [[load-shedding]] are the firebreaks.',
		related: ['retry-storm', 'metastable-failure', 'bulkhead', 'circuit-breaker']
	},
	{
		id: 'metastable-failure',
		term: 'Metastable failure',
		aliases: ['retry-sustained overload'],
		category: 'reliability practice',
		short:
			'An outage that keeps going after its original cause is gone. A short trigger (a database failover, a deploy) causes timeouts; clients retry; the extra load keeps the system overloaded, which causes more timeouts and more retries. The system has two stable states, healthy and overloaded, and the trigger pushed it from one to the other. Fixing the trigger doesn\'t help; you have to remove the sustaining load (shed traffic, cut retries, drain queues).',
		analogy:
			'A traffic jam after an accident has been cleared. The road is fine, but so many cars are queued that the jam sustains itself until inflow drops.',
		related: ['retry-storm', 'load-shedding', 'retry-budget', 'cascading-failure'],
		page: [
			{ type: 'p', text: 'The signature is **cause and symptom no longer line up in time**. The trigger ends, but errors don\'t.' },
			{
				type: 'dashboard',
				dashboard: {
					style: 'grafana',
					title: 'Metastable failure signature',
					range: 'illustrative',
					panels: [
						{
							kind: 'timeseries',
							title: 'Requests / s',
							unit: ' rps',
							x: mx,
							series: [
								{ name: 'offered (incl. retries)', points: shape(50, { base: 1000, noise: 0.04, seed: 9 }, ramp(5, 10, 1000, 3100), step(38, 1000)), color: 1 },
								{ name: 'goodput (2xx)', points: shape(50, { base: 1000, noise: 0.04, seed: 10 }, ramp(5, 8, 1000, 300), step(38, 980)), color: 0 }
							],
							markers: [{ at: 5, label: 'trigger' }, { at: 9, label: 'trigger gone' }, { at: 38, label: 'shed load' }],
							span: 6
						}
					]
				}
			},
			{ type: 'heading', text: 'Breaking the loop' },
			{
				type: 'list',
				items: [
					'Shed load at the edge (rate limit, return 503 fast) until goodput recovers, then ramp traffic back up.',
					'Use [[retry-budget|retry budgets]] (retries ≤ 10% of requests) and [[exponential-backoff]] with [[jitter]], so retries can\'t multiply load.',
					'Bound queues and drop requests whose deadline has already passed instead of doing work nobody is waiting for.',
					'[[circuit-breaker|Circuit breakers]] so callers stop sending traffic to something that\'s failing.'
				]
			}
		]
	},
	{
		id: 'retry-budget',
		term: 'Retry budget',
		category: 'reliability practice',
		short:
			'A cap on retries as a share of normal traffic, e.g. "retries may add at most 10% extra requests". Per-request retry counts ("retry 3 times") multiply load by 4× exactly when a service is struggling; a budget keeps retries helpful for occasional blips and automatically turns them off during an outage.',
		related: ['retry-storm', 'metastable-failure', 'exponential-backoff']
	},
	{
		id: 'service-mesh',
		term: 'Service mesh',
		aliases: ['sidecar', 'Envoy', 'Istio', 'Linkerd'],
		category: 'cloud & infra',
		short:
			'A proxy (the "sidecar") runs next to every service instance and handles network concerns: TLS between services, load balancing, timeouts and retries, metrics. Useful, but it means a request can be retried by the mesh *and* by the application code, invisibly to each other, so retry counts multiply. Mesh timeouts and app timeouts can also disagree.',
		related: ['retry-storm', 'retry-budget', 'timeout']
	},
	{
		id: 'deadline-propagation',
		term: 'Deadline propagation',
		aliases: ['timeout propagation', 'grpc-timeout'],
		category: 'distributed systems',
		short:
			'Passing the caller\'s remaining time budget down the call chain, so each service knows how long it has left and stops when the original caller has given up. Without it, the gateway times out at 1 s and returns an error, while services underneath keep working for 5 s on a request nobody is waiting for. That wasted work is pure extra load, often doubled because the user retries.',
		related: ['timeout', 'load-shedding', 'cascading-failure'],
		page: [
			{ type: 'heading', text: 'Without propagation' },
			{
				type: 'trace',
				trace: {
					title: 'GET /quote: client gave up at 1 s, servers kept going',
					spans: [
						{ id: 'g', service: 'gateway', name: 'GET /quote', start: 0, duration: 1000, error: true, note: '504 at 1000 ms' },
						{ id: 'q', parent: 'g', service: 'quote-svc', name: 'BuildQuote', start: 15, duration: 3900 },
						{ id: 'p', parent: 'q', service: 'pricing-svc', name: 'GetPrices', start: 40, duration: 2600 },
						{ id: 't', parent: 'q', service: 'tax-svc', name: 'CalcTax', start: 2660, duration: 1200 }
					]
				}
			},
			{ type: 'p', text: 'Everything after 1000 ms is wasted. Under load this is how a slow dependency turns into a capacity problem everywhere.' },
			{ type: 'heading', text: 'With propagation' },
			{
				type: 'list',
				items: [
					'The gateway sets an absolute deadline (`now + 1000 ms`) and sends it in a header (gRPC does this natively with `grpc-timeout`).',
					'Each service subtracts the time it has used and sets its downstream timeouts to `min(own_timeout, remaining − margin)`.',
					'Work checks the deadline before expensive steps and cancels when it passes; queued requests with expired deadlines are dropped.'
				]
			}
		]
	},
	{
		id: 'clock-skew',
		term: 'Clock skew',
		aliases: ['clock drift', 'NTP'],
		category: 'distributed systems',
		short:
			'Different machines disagree about the current time, usually by milliseconds, sometimes by seconds or minutes if time sync (NTP/chrony) breaks on a host. It breaks anything that compares timestamps from different machines: "is this token valid yet?", "which update came last?", "has this lock expired?". Prefer [[aggregate-version|version numbers]] for ordering and allow a small leeway when validating times.',
		related: ['aggregate-version', 'jwt', 'distributed-lock', 'utc']
	},
	{
		id: 'jwt',
		term: 'JWT',
		aliases: ['JSON Web Token', 'iat', 'nbf', 'exp'],
		category: 'security & compliance',
		short:
			'A signed token that carries claims about a user, including times: `iat` (issued at), `nbf` (not valid before) and `exp` (expires). The service that checks the token compares those times with *its own* clock. If its clock is behind the issuer\'s, fresh tokens look like they come from the future and get rejected; if it\'s ahead, tokens expire early. Libraries offer a small "leeway" to absorb normal [[clock-skew]].',
		related: ['clock-skew']
	},
	{
		id: 'distributed-lock',
		term: 'Distributed lock',
		aliases: ['Redis lock', 'SETNX', 'Redlock', 'lease'],
		category: 'distributed systems',
		short:
			'A lock that several machines agree on, usually a key in Redis, ZooKeeper or etcd with an expiry (a *lease*). The expiry is necessary, so a crashed holder doesn\'t lock everyone out forever, but it also means a holder that pauses (a [[gc-pause|GC pause]], a slow network) can lose the lock *without knowing it* and then keep writing. Safe use needs a [[fencing-token]] checked by the resource being protected.',
		related: ['fencing-token', 'clock-skew', 'gc-pause', 'race-condition']
	},
	{
		id: 'fencing-token',
		term: 'Fencing token',
		category: 'distributed systems',
		short:
			'A number that goes up every time a [[distributed-lock]] is granted. The lock holder sends it with every write, and the storage rejects writes carrying a token older than one it has already seen. That way a client that lost its lock during a pause gets refused instead of overwriting the new holder\'s work.',
		related: ['distributed-lock', 'aggregate-version'],
		page: [
			{ type: 'heading', text: 'The failure without fencing' },
			{
				type: 'table',
				head: ['Time', 'Client A', 'Client B', 'Storage'],
				rows: [
					['t0', 'Acquires lock (TTL 10 s)', '', ''],
					['t1', 'Long GC pause starts', '', ''],
					['t11', '(still paused)', 'Lock expired → B acquires it', ''],
					['t12', '', 'Writes file v2', 'v2'],
					['t15', 'Wakes up, believes it holds the lock, writes v1', '', '**v1** (B\'s work lost)']
				]
			},
			{ type: 'heading', text: 'With fencing' },
			{
				type: 'table',
				head: ['Time', 'Client A', 'Client B', 'Storage'],
				rows: [
					['t0', 'Acquires lock, token 33', '', ''],
					['t11', '(paused)', 'Acquires lock, token 34', ''],
					['t12', '', 'Write with token 34', 'accepts, remembers 34'],
					['t15', 'Write with token 33', '', '**rejects** (33 < 34)']
				]
			},
			{ type: 'p', text: 'Checking "do I still hold the lock?" just before writing doesn\'t fix it; the pause can happen between the check and the write. Only the storage side can enforce it. Where the storage can\'t check tokens, use a conditional write on a [[aggregate-version|version column]] instead.' }
		]
	},
	{
		id: 'readiness-probe',
		term: 'Readiness probe',
		category: 'cloud & infra',
		short:
			'A Kubernetes health check that answers "should this pod receive traffic right now?". Failing it removes the pod from the load balancer but does **not** restart it. Good for warm-up and temporary overload. If every pod checks a shared dependency in its readiness probe, a blip in that dependency takes *all* pods out of rotation at once.',
		related: ['liveness-probe', 'graceful-shutdown']
	},
	{
		id: 'liveness-probe',
		term: 'Liveness probe',
		aliases: ['startup probe'],
		category: 'cloud & infra',
		short:
			'A Kubernetes health check that answers "is this process hopelessly stuck?". Failing it gets the container **killed and restarted**. It should only check the process itself (can it answer at all). If it checks the database, a database blip restarts every pod at once, and they all reconnect and warm caches simultaneously, which can turn a 30-second blip into a long outage. Slow-starting apps need a *startup probe* so liveness doesn\'t kill them during boot.',
		related: ['readiness-probe', 'cascading-failure', 'cache-stampede']
	},
	{
		id: 'graceful-shutdown',
		term: 'Graceful shutdown',
		aliases: ['SIGTERM', 'preStop', 'connection draining'],
		category: 'cloud & infra',
		short:
			'Stopping a server without failing requests: stop accepting new work, finish in-flight requests, close idle keep-alive connections, then exit. In Kubernetes the pod gets `SIGTERM` *at the same time* as it\'s being removed from load-balancer endpoints, and that removal takes a few seconds to reach every proxy. An app that exits immediately on SIGTERM gets traffic it can no longer serve, which shows up as 502/503 spikes on every deploy.',
		related: ['readiness-probe', 'blue-green-deployment']
	},
	{
		id: 'http2-connection-reuse',
		term: 'Long-lived connections (HTTP/2, gRPC)',
		aliases: ['gRPC load balancing', 'connection pinning', 'L4 vs L7 load balancing'],
		category: 'frontend & network',
		short:
			'gRPC and HTTP/2 send many requests over one long-lived TCP connection. A connection-level (L4) load balancer, including a plain Kubernetes Service, only balances when a connection is *opened*. Clients that connected before you scaled out keep all their traffic on the old pods; new pods sit idle. Fixes: request-level (L7) balancing via a proxy or [[service-mesh]], client-side load balancing over all endpoints, or a server-side max connection age that forces periodic reconnects.',
		related: ['autoscaling', 'service-mesh']
	},
	{
		id: 'dns-caching',
		term: 'DNS caching',
		aliases: ['networkaddress.cache.ttl', 'stale DNS'],
		category: 'frontend & network',
		short:
			'Clients remember what IP a hostname resolved to. Managed databases fail over by pointing the same hostname at a new IP, so recovery depends on every client looking the name up again. Some runtimes cache lookups far longer than the DNS record\'s TTL (older JVM settings cache forever), and connection pools keep sockets to the old address until they error. The tell: after a failover some services recover in seconds and others only after a restart.',
		related: ['ttl', 'connection-pool']
	},
	{
		id: 'cache-invalidation',
		term: 'Cache invalidation',
		category: 'caching',
		short:
			'Removing or updating cached copies when the source data changes. The hard part is timing: if the "delete the cache key" happens before the database write is visible to the reader that refills the cache (event sent before commit, or the refill reads a lagging [[read-replica]]), the old value is put straight back and then served until its [[ttl]] runs out.',
		related: ['ttl', 'replication-lag', 'eventual-consistency', 'transactional-outbox']
	}
];

export default terms;
