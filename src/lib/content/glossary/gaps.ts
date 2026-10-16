import type { GlossaryTerm } from '../types';

/**
 * Gap terms: concepts the assessments used without explaining, found by an audit pass.
 * The aim is that a reader never has to leave the site to understand a sentence.
 */
const terms: GlossaryTerm[] = [
	// ───────────────────────── datastores & platforms ─────────────────────────
	{
		id: 'redis',
		term: 'Redis',
		aliases: ['Redis Cluster', 'sorted set', 'ZADD', 'HGETALL', 'MULTI/EXEC', 'Lua scripting', 'EVAL'],
		category: 'caching',
		short:
			'An in-memory key-value server used as a cache, rate-limit counter store, queue and lock service. It is fast because data lives in RAM and each node runs commands one at a time on a single thread, which also makes every individual command atomic. That same single thread is why one slow command (a huge `HGETALL`, a long Lua script) stalls every other client on that node.',
		analogy: 'A very fast clerk at one counter: each request is handled completely before the next, so nobody sees a half-done job, but one customer with a giant order holds up the line.',
		related: ['cache-aside', 'crossslot', 'redis-eviction', 'distributed-lock', 'token-bucket'],
		page: [
			{ type: 'heading', text: 'The data types you will meet' },
			{
				type: 'table',
				head: ['Type', 'Example commands', 'Typical use'],
				rows: [
					['String', '`GET`, `SET key val EX 60`, `INCR`', 'cache entries, counters, rate limits'],
					['Hash', '`HSET`, `HGET`, `HGETALL`', 'an object with fields (a user profile)'],
					['List', '`LPUSH`, `BRPOP`', 'simple work queues'],
					['Set', '`SADD`, `SISMEMBER`', 'membership (who is online)'],
					['Sorted set', '`ZADD`, `ZRANGE`, `ZREVRANK`', 'leaderboards, sliding-window rate limits, delayed jobs ordered by time']
				]
			},
			{ type: 'heading', text: 'Atomicity: one command, MULTI/EXEC, Lua' },
			{
				type: 'list',
				items: [
					'**One command** is always atomic. `INCR hits` from 1,000 clients never loses an increment.',
					'**MULTI … EXEC** queues several commands and runs them back to back with nothing interleaved. It is not a rollback-able transaction: if one command fails, the others still ran.',
					'**Lua scripts** (`EVAL`) run a small program on the server atomically: read a value, decide, write. This is how check-then-set logic (like a [[token-bucket]]) is made race-free. Keep them short: the whole node waits while a script runs.'
				]
			},
			{ type: 'heading', text: 'Redis Cluster in one paragraph' },
			{
				type: 'p',
				text: 'A cluster splits keys across nodes using 16,384 **hash slots**: slot = CRC16(key) mod 16384, and each node owns a range of slots. Multi-key commands (`MGET a b`, MULTI/EXEC, Lua touching several keys) only work if all keys are in the same slot, otherwise you get [[crossslot|CROSSSLOT]]. Force keys together with a **hash tag**: only the part inside `{…}` is hashed, so `{user:42}:cart` and `{user:42}:prefs` share a slot.'
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'Common traps',
				text: 'Big keys (a hash with millions of fields) make single commands slow and pin one node. `KEYS *` scans everything and blocks the server. Memory is finite: when full, the eviction policy decides what disappears ([[redis-eviction]]).'
			}
		]
	},
	{
		id: 'postgresql',
		term: 'PostgreSQL',
		aliases: ['Postgres', 'pg'],
		category: 'databases',
		short:
			'A widely used open-source relational database. Most database questions here assume its behaviour: [[mvcc]] for concurrency (readers do not block writers), a [[write-ahead-log]] for durability and replication, and a cost-based [[query-planner]]. Each client connection is a separate server process, which is why connection counts matter so much and poolers like [[pgbouncer]] exist.',
		related: ['mvcc', 'vacuum', 'connection-pool', 'pg-stat-activity', 'write-ahead-log']
	},
	{
		id: 'amazon-rds',
		term: 'Amazon RDS / Aurora',
		aliases: ['RDS', 'Aurora', 'Relational Database Service', 'RDS Proxy'],
		category: 'cloud & infra',
		short:
			'AWS-managed relational databases. RDS runs PostgreSQL or MySQL for you (backups, patching, Multi-AZ failover); Aurora is an AWS re-implementation with a shared distributed storage layer, so replicas and failover are faster. You still own schema, queries, connection counts and capacity. **RDS Proxy** is a managed connection pooler in front of either, playing the role [[pgbouncer]] plays elsewhere.',
		related: ['failover', 'read-replica', 'pgbouncer', 'cpu-credits']
	},
	{
		id: 'dynamodb',
		term: 'DynamoDB',
		aliases: ['WCU', 'RCU', 'write capacity unit', 'adaptive capacity', 'Contributor Insights'],
		category: 'databases',
		short:
			'AWS key-value / document database that scales by splitting a table into partitions by partition key. Capacity is measured in read and write capacity units (one WCU = one write per second of up to 1 KB), and each partition has its own ceiling. A table can be far under its total capacity and still throttle if one key is hot, which is the classic DynamoDB incident.',
		analogy: 'A supermarket with many checkout lanes: plenty of lanes in total, but if everyone queues at lane 4, lane 4 is overloaded.',
		related: ['hot-partition', 'write-sharding', 'partition-key'],
		page: [
			{ type: 'heading', text: 'Capacity units, worked' },
			{
				type: 'table',
				head: ['Operation', 'Item size', 'Cost'],
				rows: [
					['Write', '0.8 KB', '1 WCU'],
					['Write', '3.2 KB', '4 WCU (rounded up to whole KB)'],
					['Strongly consistent read', '6 KB', '2 RCU (4 KB per RCU)'],
					['Eventually consistent read', '6 KB', '1 RCU (half price)']
				]
			},
			{
				type: 'p',
				text: 'A single partition historically tops out around **1,000 WCU and 3,000 RCU per second**. A table provisioned at 40,000 WCU can still throttle at 1,100 writes/s if they all hit one partition key.'
			},
			{ type: 'heading', text: 'Tools that show the hot key' },
			{
				type: 'list',
				items: [
					'**Adaptive capacity** lets a hot partition borrow unused capacity and can split a partition, but it cannot split a *single* key that is hot.',
					'**CloudWatch Contributor Insights** ranks the most-accessed and most-throttled keys. It turns "the table is throttling" into "key `tenant#42` is 60% of writes".',
					'The fix for one hot key is changing the key design, e.g. [[write-sharding]]: append a suffix `#0…#9` and spread writes across 10 keys.'
				]
			}
		]
	},
	{
		id: 'elasticsearch',
		term: 'Elasticsearch',
		aliases: ['OpenSearch', 'primary shard', 'replica shard', 'segment merge'],
		category: 'databases',
		short:
			'A search and log-analytics engine. An index is split into **primary shards** (each a separate Lucene index), and each primary has **replica shards** on other nodes for redundancy and read capacity. New documents are written into small immutable files called segments, which the engine continually **merges** into bigger ones in the background; heavy merging competes with indexing and queries for disk and CPU.',
		related: ['oversharding', 'log-mapping-conflict', 'sharding']
	},
	{
		id: 'kafka',
		term: 'Kafka',
		aliases: ['Apache Kafka', 'topic', 'Kafka partition', 'broker'],
		category: 'messaging',
		short:
			'A distributed log. Producers append messages to a **topic**, which is split into **partitions**; each partition is an ordered, append-only file replicated across **brokers** (servers). Consumers read at their own pace and remember their position as an offset, so messages are not deleted on read and can be replayed. Ordering is only guaranteed within one partition, which is why the [[partition-key]] matters.',
		related: ['consumer-group', 'consumer-lag', 'offset-commit', 'consumer-rebalance', 'partition-key'],
		page: [
			{ type: 'heading', text: 'The moving parts' },
			{
				type: 'flow',
				steps: [
					{ label: 'Producer', note: 'chooses partition by key hash' },
					{ label: 'Topic `orders`', note: '6 partitions' },
					{ label: 'Broker', note: 'stores partitions, replicated ×3' },
					{ label: 'Consumer group', note: 'each partition → exactly one member' }
				]
			},
			{
				type: 'table',
				head: ['Concept', 'What it means for you'],
				rows: [
					['Partition', 'Unit of ordering and parallelism. 6 partitions = at most 6 busy consumers in one group.'],
					['Key', '`hash(key) mod partitions` picks the partition, so the same key always lands in the same partition, in order.'],
					['Offset', 'Position in a partition. Committing an offset says "I have processed everything before this".'],
					['Retention', 'Messages stay for a configured time (e.g. 7 days) whether or not anyone read them.'],
					['Consumer group', 'Several consumers sharing the work; partitions are divided among them ([[consumer-rebalance]] when members join/leave).']
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'Worked example',
				text: 'A topic has 12 partitions and lag is growing. Scaling the consumer group from 12 to 24 pods adds **zero** throughput: the extra 12 sit idle because each partition goes to one consumer. You need more partitions (which changes key→partition mapping) or faster processing per message.'
			}
		]
	},
	{
		id: 'amazon-sqs',
		term: 'Amazon SQS',
		aliases: ['SQS', 'Simple Queue Service'],
		category: 'messaging',
		short:
			'AWS managed message queue. A consumer receives a message, which then becomes invisible for the [[visibility-timeout]]; deleting it marks it done, otherwise it reappears for another try. Standard queues are at-least-once and roughly ordered; FIFO queues add ordering per group and de-duplication at lower throughput.',
		related: ['visibility-timeout', 'dead-letter-queue', 'queue-age', 'at-least-once', 'fifo-queue']
	},
	{
		id: 'fifo-queue',
		term: 'FIFO queue',
		aliases: ['first in, first out'],
		category: 'messaging',
		short:
			'A queue that hands messages out in the order they arrived: first in, first out. Strict ordering limits parallelism (message 2 waits for message 1), so real systems usually order only within a group or key, letting different groups proceed in parallel.',
		related: ['partition-key', 'amazon-sqs', 'message-queue']
	},
	{
		id: 'oltp-vs-olap',
		term: 'OLTP vs OLAP',
		aliases: ['OLTP', 'OLAP', 'online transaction processing', 'analytical database', 'data warehouse'],
		category: 'databases',
		short:
			'OLTP databases serve the application: many small reads and writes of a few rows each, needing low latency and correct concurrency (orders, balances). OLAP systems serve analysis: few huge queries that scan and aggregate millions of rows (revenue by month). Running heavy analytics on the OLTP database is a classic way to slow down the product.',
		related: ['etl', 'read-replica', 'sql-vs-nosql']
	},
	{
		id: 'etl',
		term: 'ETL',
		aliases: ['extract, transform, load', 'ELT', 'data pipeline'],
		category: 'databases',
		short:
			'Extract, transform, load: copying data out of source systems, reshaping it, and loading it somewhere else, usually a warehouse for reporting. ETL jobs run on schedules or streams, and their timing is a frequent source of "the numbers are wrong" reports: a report that runs before the load finished shows a partial day.',
		related: ['oltp-vs-olap', 'snapshot-timing', 'change-data-capture']
	},
	{
		id: 'business-intelligence',
		term: 'BI (business intelligence)',
		aliases: ['BI', 'BI dashboard', 'Looker', 'Tableau'],
		category: 'business',
		short:
			'Reporting and dashboard tools that business teams use to look at company data, usually reading from a warehouse fed by [[etl]] jobs. When a BI number disagrees with the product, check the pipeline delay and the definition (time zone, refunds included?) before the code.',
		related: ['etl', 'day-boundary', 'reconciliation']
	},
	{
		id: 'crm',
		term: 'CRM',
		aliases: ['customer relationship management', 'Salesforce', 'HubSpot'],
		category: 'business',
		short:
			'Customer relationship management: the system sales and support teams use to track customers, contacts, deals and conversations. Engineering usually meets it as an integration that syncs contacts both ways, which brings pagination, rate-limit and duplicate-record bugs.',
		related: ['webhook', 'idempotency']
	},

	// ───────────────────────── PostgreSQL internals ─────────────────────────
	{
		id: 'write-ahead-log',
		term: 'Write-ahead log (WAL)',
		aliases: ['WAL', 'redo log', 'commit log'],
		category: 'databases',
		short:
			'Before a database changes its data files, it appends a description of the change to a sequential log and flushes that to disk; a transaction counts as committed once its log record is durable. After a crash the database replays the log to recover. The same log stream is what replicas copy and what point-in-time recovery replays.',
		analogy: "A shop keeps a running receipt roll. Even if the shelves are a mess after a power cut, replaying the receipts tells you exactly what was sold.",
		related: ['replication-lag', 'pitr', 'replication-slot', 'logical-replication'],
		page: [
			{ type: 'heading', text: 'Why log first?' },
			{
				type: 'p',
				text: 'Writing changed data pages in place means random writes all over the disk, and a crash mid-write leaves a page half-updated. Appending to one sequential file is fast and can be made crash-safe with a single flush. So the order is: **log record → flush → acknowledge commit → (later) update data pages**.'
			},
			{ type: 'heading', text: 'What the WAL is used for' },
			{
				type: 'table',
				head: ['Use', 'How'],
				rows: [
					['Crash recovery', 'Replay records since the last checkpoint.'],
					['Streaming replication', 'Replicas receive the WAL stream and apply it; how far behind they are is [[replication-lag]].'],
					['[[pitr|Point-in-time recovery]]', 'Restore a base backup, then replay archived WAL up to a chosen second.'],
					['[[logical-replication|Logical replication]] / [[change-data-capture|CDC]]', 'Decode WAL into row-level change events.']
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'How it causes incidents',
				text: 'The database keeps WAL until everyone who needs it has consumed it. An abandoned [[replication-slot]] or a stuck archiver means WAL piles up until the disk fills, and a full disk stops all writes. "Disk growing while data size is flat" usually means WAL retention.'
			}
		]
	},
	{
		id: 'pg-stat-activity',
		term: 'pg_stat_activity',
		category: 'databases',
		short:
			'A PostgreSQL system view with one row per connection: who is connected, what query it is running, its state (`active`, `idle`, `idle in transaction`), how long, and what it is waiting on. It is the first place to look when the database is slow or connections are exhausted.',
		related: ['idle-in-transaction', 'lock-wait', 'lock-queue', 'postgresql']
	},
	{
		id: 'serializable-snapshot-isolation',
		term: 'Serializable snapshot isolation (SSI)',
		aliases: ['SSI', 'SERIALIZABLE'],
		category: 'databases',
		short:
			"PostgreSQL's implementation of the SERIALIZABLE isolation level. Transactions run on snapshots as usual, but the database tracks read/write dependencies and aborts one transaction when the combination could not have happened in some serial order. It prevents [[write-skew]] without manual locking, at the cost that the application must retry on [[serialization-failure]].",
		related: ['isolation-level', 'write-skew', 'serialization-failure', 'mvcc']
	},
	{
		id: 'exclusion-constraint',
		term: 'Exclusion constraint',
		aliases: ['EXCLUDE USING gist'],
		category: 'databases',
		short:
			'A PostgreSQL constraint that generalises UNIQUE: no two rows may "conflict" by a chosen operator, typically overlapping ranges. `EXCLUDE USING gist (room WITH =, during WITH &&)` makes it impossible to double-book a room even under concurrency, because the database checks it at insert time.',
		related: ['write-skew', 'interval-overlap', 'race-condition']
	},
	{
		id: 'replication-slot',
		term: 'Replication slot',
		category: 'databases',
		short:
			'A PostgreSQL bookmark that remembers how far a replica or change-data consumer has read, so the server keeps all [[write-ahead-log|WAL]] it still needs. If the consumer disappears, the slot keeps holding WAL forever and the disk fills; abandoned slots are a classic silent disk-space leak.',
		related: ['write-ahead-log', 'logical-replication', 'change-data-capture']
	},
	{
		id: 'logical-replication',
		term: 'Logical replication',
		category: 'databases',
		short:
			'Replicating row-level changes (insert this row, update that one) decoded from the [[write-ahead-log]], rather than copying raw disk blocks. It allows replicating some tables, across major versions, or into other systems, but it does not copy schema changes or sequences automatically.',
		related: ['write-ahead-log', 'replication-slot', 'change-data-capture', 'replication']
	},
	{
		id: 'prepared-transaction',
		term: 'Prepared transaction (two-phase commit)',
		aliases: ['PREPARE TRANSACTION', '2PC', 'two-phase commit'],
		category: 'databases',
		short:
			'The first half of two-phase commit: a transaction is made durable and holds its locks while waiting for a coordinator to say COMMIT or ROLLBACK. If the coordinator dies, the prepared transaction survives restarts, keeps holding locks and blocks vacuum until someone resolves it manually.',
		related: ['vacuum', 'xid-wraparound', 'saga']
	},
	{
		id: 'ddl',
		term: 'DDL',
		aliases: ['data definition language', 'ALTER TABLE', 'schema change'],
		category: 'databases',
		short:
			'Statements that change the schema rather than the data: `CREATE`, `ALTER`, `DROP`. Many DDL statements take strong table locks, so even a fast one can freeze production if it waits behind a long query (see [[lock-queue]]).',
		related: ['lock-queue', 'lock-timeout', 'expand-contract-migration']
	},
	{
		id: 'advisory-lock',
		term: 'Advisory lock',
		aliases: ['pg_advisory_lock', 'pg_try_advisory_lock'],
		category: 'databases',
		short:
			'A lock on an arbitrary number that the database holds for you but never takes automatically; the application decides what it means ("only one worker runs the nightly job"). Session-level advisory locks outlive transactions and are easy to leak through connection poolers.',
		related: ['distributed-lock', 'pgbouncer', 'duplicate-scheduler']
	},
	{
		id: 'partial-index',
		term: 'Partial index',
		aliases: ['filtered index', 'CREATE INDEX … WHERE'],
		category: 'databases',
		short:
			'An index that only covers rows matching a condition, e.g. `WHERE status = \'pending\'`. It is small and cheap to maintain when the interesting rows are a tiny fraction of the table, and the planner uses it only for queries whose WHERE clause implies the same condition.',
		related: ['database-index', 'query-planner']
	},
	{
		id: 'upsert',
		term: 'Upsert',
		aliases: ['INSERT … ON CONFLICT', 'ON CONFLICT DO NOTHING', 'MERGE'],
		category: 'databases',
		short:
			'Insert a row, or do something else if a row with the same unique key already exists: update it, or do nothing. Backed by a unique constraint, it makes "process this event once" race-free, because two concurrent inserts cannot both win.',
		related: ['idempotent-consumer', 'idempotency', 'conditional-update']
	},
	{
		id: 'leader-election',
		term: 'Leader election',
		aliases: ['Patroni', 'Consul', 'etcd', 'ZooKeeper'],
		category: 'distributed systems',
		short:
			'Choosing exactly one node to act as leader (the database primary, the cron runner) and replacing it when it fails. Tools like etcd, Consul and ZooKeeper provide it with leases and [[quorum]]; Patroni uses them to manage PostgreSQL failover. A leader that is slow rather than dead can still believe it leads, which is why [[fencing-token|fencing]] matters.',
		related: ['quorum', 'split-brain', 'fencing-token', 'failover']
	},
	{
		id: 'cqrs-read-model',
		term: 'Read model (projection)',
		aliases: ['projection', 'CQRS', 'materialized view'],
		category: 'distributed systems',
		short:
			'A copy of data reshaped for one way of reading it, built by consuming events or changes (e.g. an "order summary" table rebuilt from order events). Writes go to the source of truth; reads hit the projection, which is fast but lags behind and must handle duplicate and out-of-order events.',
		related: ['eventual-consistency', 'idempotent-consumer', 'event-sourced-ledger', 'change-data-capture']
	},
	{
		id: 'lfu',
		term: 'LFU (least frequently used)',
		aliases: ['LFU'],
		category: 'caching',
		short:
			'A cache eviction policy that throws out the entry used the fewest times. Unlike [[lru]], a one-off scan does not flush popular items, but items that were popular long ago can linger unless counts decay over time.',
		related: ['lru', 'redis-eviction']
	},

	// ───────────────────────── Kubernetes ─────────────────────────
	{
		id: 'kubernetes',
		term: 'Kubernetes basics',
		aliases: ['k8s', 'pod', 'ReplicaSet', 'Deployment', 'node', 'kubelet'],
		category: 'cloud & infra',
		short:
			'A system that runs containers across a fleet of machines and keeps them in the state you declare. The smallest unit is a **pod** (one or more containers sharing a network address); a **Deployment** manages a **ReplicaSet**, which keeps N identical pods running; the scheduler places pods on **nodes** that have room for their [[resource-requests]].',
		related: ['resource-requests', 'readiness-probe', 'liveness-probe', 'horizontal-pod-autoscaler', 'pod-disruption-budget'],
		page: [
			{ type: 'heading', text: 'The objects, from small to big' },
			{
				type: 'table',
				head: ['Object', 'What it is', 'When it bites'],
				rows: [
					['Container', 'Your process in an image', 'OOM-killed at its memory limit ([[oomkilled]])'],
					['Pod', 'Containers scheduled together, one IP', 'Pods are disposable; anything on local disk vanishes'],
					['ReplicaSet', 'Keeps N copies of a pod template alive', 'Deleting a pod just makes it create another'],
					['Deployment', 'Rolls ReplicaSets forward/back on a new image', '[[rolling-update]] settings decide how many pods are down at once'],
					['Service', 'Stable name + load balancing to ready pods', 'Only routes to pods passing [[readiness-probe]]'],
					['Node', 'A VM running the kubelet', 'Draining it evicts every pod ([[cordon-and-drain]])']
				]
			},
			{ type: 'heading', text: 'The three probes' },
			{
				type: 'list',
				items: [
					'**[[startup-probe|Startup]]**: "has it finished booting?" Other probes wait until it passes.',
					'**[[readiness-probe|Readiness]]**: "send it traffic?" Failing removes the pod from load balancing, no restart.',
					'**[[liveness-probe|Liveness]]**: "is it stuck?" Failing restarts the container. Too strict a liveness probe causes restart loops ([[crashloopbackoff]]).'
				]
			},
			{ type: 'heading', text: 'Placement' },
			{
				type: 'p',
				text: 'The scheduler only considers **requests**, not actual usage. Taints keep pods off nodes unless they tolerate them ([[taints-tolerations]]); affinity rules and volume zones further restrict where a pod may run, which is how pods end up Pending while nodes look idle.'
			}
		]
	},
	{
		id: 'startup-probe',
		term: 'Startup probe',
		category: 'cloud & infra',
		short:
			'A Kubernetes check that gives a slow-booting container time to start; liveness and readiness checks are paused until it succeeds. Without it, a liveness probe tuned for a running app kills a JVM that simply needed 90 seconds to warm up.',
		related: ['liveness-probe', 'readiness-probe', 'kubernetes', 'jit-warmup']
	},
	{
		id: 'crashloopbackoff',
		term: 'CrashLoopBackOff',
		category: 'cloud & infra',
		short:
			'The Kubernetes status for a container that keeps exiting and being restarted, with exponentially longer waits between restarts (up to 5 minutes). The cause is in the previous container\'s logs (`kubectl logs --previous`) or its exit code: a crash at startup, a missing config, or a liveness probe killing it.',
		related: ['liveness-probe', 'startup-probe', 'oomkilled', 'kubernetes']
	},
	{
		id: 'prestop-hook',
		term: 'preStop hook',
		category: 'cloud & infra',
		short:
			'A command Kubernetes runs inside a container before sending it SIGTERM during shutdown. A short `sleep` here gives load balancers time to stop routing to the pod, so in-flight and newly routed requests are not dropped during a deploy.',
		related: ['graceful-shutdown', 'connection-draining', 'kubernetes']
	},
	{
		id: 'cordon-and-drain',
		term: 'Cordon and drain',
		aliases: ['kubectl drain', 'kubectl cordon'],
		category: 'cloud & infra',
		short:
			'Taking a Kubernetes node out of service: **cordon** marks it unschedulable, **drain** evicts its pods so they restart elsewhere. Evictions respect [[pod-disruption-budget|PodDisruptionBudgets]], which is why a drain can hang forever when a budget allows zero disruptions.',
		related: ['pod-disruption-budget', 'eviction', 'kubernetes']
	},
	{
		id: 'taints-tolerations',
		term: 'Taints and tolerations',
		aliases: ['taint', 'toleration', 'NoSchedule'],
		category: 'cloud & infra',
		short:
			'A taint on a node repels pods; only pods with a matching toleration may be scheduled there. Used to reserve GPU or spot nodes for particular workloads. A missing toleration leaves pods Pending even though the node has room.',
		related: ['kubernetes', 'cluster-autoscaler', 'resource-requests']
	},
	{
		id: 'conntrack',
		term: 'conntrack (connection tracking)',
		aliases: ['nf_conntrack', 'conntrack table'],
		category: 'frontend & network',
		short:
			'The Linux kernel table that remembers every network connection passing through NAT or firewall rules (Kubernetes Services use it). The table has a size limit; when full, new connections are silently dropped, which looks like random timeouts under load, especially for many short-lived UDP DNS queries.',
		related: ['ndots', 'nat-port-exhaustion', 'ephemeral-ports']
	},

	// ───────────────────────── AWS & cloud ─────────────────────────
	{
		id: 'vpc',
		term: 'VPC (virtual private cloud)',
		aliases: ['VPC', 'subnet'],
		category: 'cloud & infra',
		short:
			'Your private network inside a cloud provider: an IP range you choose, split into subnets (usually public and private per availability zone), with [[route-table|route tables]], [[security-group|security groups]] and [[nacl|NACLs]] deciding what can talk to what. Most cloud networking incidents are a routing or rule mistake inside a VPC.',
		related: ['cidr', 'route-table', 'security-group', 'nacl', 'nat-gateway', 'vpc-endpoint']
	},
	{
		id: 'cidr',
		term: 'CIDR notation',
		aliases: ['CIDR', '/24', 'netmask'],
		category: 'frontend & network',
		short:
			'A way to write an IP range as address/prefix: `10.0.0.0/16` means the first 16 bits are fixed, leaving 16 bits for hosts (65,536 addresses). A larger prefix is a smaller range: `/24` = 256 addresses, `/32` = exactly one. Overlapping CIDR ranges between networks make peering and VPNs impossible.',
		related: ['vpc', 'route-table', 'security-group']
	},
	{
		id: 'vpc-flow-logs',
		term: 'VPC Flow Logs',
		category: 'observability',
		short:
			'Records of network flows in a VPC: source and destination IP and port, bytes, and whether security rules ACCEPTed or REJECTed the traffic. They answer "did the packet arrive and get dropped by a rule?", and their byte counts reveal surprising cross-AZ or NAT traffic.',
		related: ['vpc', 'nacl', 'security-group', 'cross-az-transfer']
	},
	{
		id: 'reachability-analyzer',
		term: 'Reachability Analyzer',
		category: 'cloud & infra',
		short:
			'An AWS tool that checks, without sending traffic, whether one resource can reach another and names the exact route table, security group or NACL rule that blocks it. Faster than guessing rule by rule.',
		related: ['vpc', 'nacl', 'security-group', 'route-table']
	},
	{
		id: 'auto-scaling-group',
		term: 'Auto Scaling group (ASG)',
		aliases: ['ASG', 'mixed instances policy', 'launch template'],
		category: 'cloud & infra',
		short:
			'An AWS group of identical VMs kept at a desired count between a min and max, replacing unhealthy instances and scaling on alarms. A mixed-instances policy lets it use several instance types and spot plus on-demand, which is how you survive one spot pool being reclaimed.',
		related: ['autoscaling', 'spot-instance', 'capacity-pool', 'ami']
	},
	{
		id: 'ami',
		term: 'AMI (Amazon Machine Image)',
		aliases: ['AMI', 'machine image'],
		category: 'cloud & infra',
		short:
			'The disk image an EC2 instance boots from: operating system plus whatever was baked in. New instances in an [[auto-scaling-group]] are launched from the AMI in the launch template, so a change made by hand on running servers disappears on the next scale-out.',
		related: ['auto-scaling-group', 'config-drift']
	},
	{
		id: 'ebs',
		term: 'EBS (Elastic Block Store)',
		aliases: ['EBS', 'gp3', 'io2'],
		category: 'cloud & infra',
		short:
			'AWS network-attached disks for EC2 instances. Performance is bought separately from size (IOPS and throughput), some volume types run on burst credits, and a volume lives in one availability zone, so an instance in another zone cannot attach it.',
		related: ['burst-balance', 'lazy-snapshot-restore', 'availability-zone', 'persistent-volume-claim']
	},
	{
		id: 'lazy-snapshot-restore',
		term: 'Lazy snapshot restore',
		aliases: ['lazy loading of restored volumes', 'EBS snapshot hydration', 'fast snapshot restore'],
		category: 'cloud & infra',
		short:
			'When a disk is restored from a snapshot in object storage, it is usable immediately but each block is fetched from the snapshot the first time it is read. A freshly restored database therefore runs very slowly until it has touched all its data, which can turn a "15 minute" restore into hours of degraded service.',
		related: ['restore-drill', 'rto-rpo', 'ebs', 'pitr']
	},
	{
		id: 'pitr',
		term: 'Point-in-time recovery (PITR)',
		aliases: ['PITR'],
		category: 'reliability practice',
		short:
			'Restoring a database to any chosen second by taking the last full backup and replaying the archived [[write-ahead-log]] up to that moment. It is how you recover from "someone ran DELETE without a WHERE at 14:03": restore to 14:02:59 on a new instance and copy the rows back.',
		related: ['write-ahead-log', 'rto-rpo', 'restore-drill']
	},
	{
		id: 'kms',
		term: 'KMS (key management service)',
		aliases: ['KMS', 'SSE-KMS', 'envelope encryption'],
		category: 'security & compliance',
		short:
			'A managed service that holds encryption keys and performs encrypt/decrypt for you, logging every use and enforcing who may use which key. Data is usually encrypted with a data key that is itself encrypted by the KMS key (envelope encryption). Losing access to the key means losing access to the data; KMS request quotas can also throttle heavy encrypted workloads.',
		related: ['aead', 'nonce-reuse', 'least-privilege']
	},
	{
		id: 'cost-explorer',
		term: 'Cost Explorer',
		aliases: ['AWS Cost Explorer', 'billing breakdown'],
		category: 'cloud & infra',
		short:
			'The AWS billing view that breaks spend down by service, usage type and tag. For cost incidents the usage type is the key column: "NatGateway-Bytes" or "DataTransfer-Regional-Bytes" points at network paths, not instance sizes.',
		related: ['nat-gateway', 'cross-az-transfer', 'telemetry-cost']
	},
	{
		id: 'failover-aware-driver',
		term: 'Failover-aware database driver',
		aliases: ['AWS JDBC wrapper', 'smart driver'],
		category: 'databases',
		short:
			'A database client library that knows the cluster topology and reconnects to the new primary within seconds of a failover, instead of waiting for DNS caches and pooled connections to expire. It shrinks the window in which an app keeps writing to the old, now read-only node.',
		related: ['failover', 'dns-caching', 'connection-pool']
	},
	{
		id: 'vcpu',
		term: 'vCPU',
		aliases: ['virtual CPU'],
		category: 'cloud & infra',
		short:
			'The unit of CPU a cloud provider sells, usually one hardware thread (half a physical core with hyper-threading). Quotas, pricing and Kubernetes CPU requests are all counted in vCPUs, so "2 vCPU" is roughly one physical core.',
		related: ['service-quota', 'resource-requests', 'cpu-credits']
	},

	// ───────────────────────── networking ─────────────────────────
	{
		id: 'tcp',
		term: 'TCP basics',
		aliases: ['TCP', 'retransmission', 'TIME_WAIT', 'SYN'],
		category: 'frontend & network',
		short:
			'The protocol that turns unreliable packets into a reliable ordered byte stream. It sets up a connection with a handshake, numbers bytes, retransmits anything not acknowledged, and closes with a goodbye that leaves the closing side in TIME_WAIT for a while. Retransmissions and TIME_WAIT pile-ups are visible symptoms of network trouble and connection churn.',
		related: ['tcp-handshake', 'rtt', 'ephemeral-ports', 'keep-alive-timeout'],
		page: [
			{ type: 'heading', text: 'A connection, start to finish' },
			{
				type: 'flow',
				steps: [
					{ label: 'SYN → SYN-ACK → ACK', note: '1 RTT before any data' },
					{ label: 'Data + ACKs', note: 'lost segment → retransmit after timeout' },
					{ label: 'FIN / ACK both ways', note: 'graceful close' },
					{ label: 'TIME_WAIT', note: '~60 s on the side that closed first' }
				]
			},
			{ type: 'heading', text: 'Symptoms and what they mean' },
			{
				type: 'table',
				head: ['You see', 'Usually means'],
				rows: [
					['TCP retransmits rising', 'Packet loss: congestion, a bad link, a full conntrack table or NIC queue. Each retransmit adds at least ~200 ms.'],
					['Thousands of sockets in TIME_WAIT', 'Opening a new connection per request instead of reusing ([[keep-alive-timeout|keep-alive]]); can exhaust [[ephemeral-ports]].'],
					['Connection reset (RST)', 'The other side closed or never had that connection, e.g. an idle timeout shorter than yours.'],
					['Slow first request, fast later ones', 'Handshake cost: TCP + TLS add 2–3 [[rtt|RTTs]] before the first byte.']
				]
			},
			{
				type: 'callout',
				tone: 'info',
				text: 'Worked example: at 80 ms RTT, a new HTTPS connection costs ~3 RTT = 240 ms before the request is even sent. Reusing one connection for 50 requests saves ~12 s of handshakes.'
			}
		]
	},
	{
		id: 'rtt',
		term: 'RTT (round-trip time)',
		aliases: ['RTT', 'round trip', 'ping time'],
		category: 'latency & capacity',
		short:
			'The time for a message to reach the other side and a reply to come back: about 1 ms inside a data centre, ~70–150 ms across continents. Protocols that need several back-and-forths (TCP and TLS handshakes, sequential API calls) multiply it, which is why distance dominates latency for chatty clients.',
		related: ['latency-numbers', 'tcp-handshake', 'request-waterfall']
	},
	{
		id: 'ntp',
		term: 'NTP (Network Time Protocol)',
		aliases: ['NTP', 'chrony', 'time sync'],
		category: 'distributed systems',
		short:
			'The protocol machines use to keep their clocks in sync with reference time servers. Even when it works, clocks differ by milliseconds; when it breaks (blocked port, VM pause, bad config) one machine can drift by seconds or minutes, which breaks token expiry checks, log ordering and "last write wins".',
		related: ['clock-skew', 'hybrid-logical-clock', 'last-writer-wins']
	},
	{
		id: 'l4-vs-l7-load-balancing',
		term: 'L4 vs L7 load balancing',
		aliases: ['ALB', 'NLB', 'Application Load Balancer', 'Network Load Balancer', 'layer 7'],
		category: 'frontend & network',
		short:
			'An L4 (transport-level) balancer forwards TCP connections without reading them, so it is fast but can only spread *connections*. An L7 (application-level) balancer, like an AWS ALB, parses HTTP and can route and balance per *request*, retry, and inspect headers. Long-lived connections (HTTP/2, gRPC) through an L4 balancer stay pinned to whichever server they first landed on.',
		related: ['load-balancer', 'http2-connection-reuse', 'load-balancer-5xx']
	},
	{
		id: 'http-status-codes',
		term: 'HTTP status codes',
		aliases: ['4xx', '5xx', '502', '503', '504', '429'],
		category: 'frontend & network',
		short:
			'The three-digit result of an HTTP request. 2xx success; 3xx redirect; **4xx** the client did something wrong (400 bad input, 401/403 auth, 404 missing, 409 conflict, 429 rate-limited); **5xx** the server or something in front of it failed (500 bug, 502 bad gateway, 503 unavailable, 504 gateway timeout). 4xx should usually not be retried; many 5xx and 429 may be, with backoff.',
		related: ['load-balancer-5xx', 'retry-after', 'exponential-backoff']
	},
	{
		id: 'retry-after',
		term: 'Retry-After header',
		category: 'frontend & network',
		short:
			'An HTTP response header, usually on 429 or 503, telling the client how many seconds to wait (or until what time) before trying again. Clients that honour it back off together with the server; clients that ignore it keep hammering an overloaded service.',
		related: ['rate-limiting', 'exponential-backoff', 'http-status-codes']
	},
	{
		id: 'mtls',
		term: 'mTLS (mutual TLS)',
		aliases: ['mutual TLS', 'client certificates'],
		category: 'security & compliance',
		short:
			'TLS where both sides present certificates, so the server also verifies who the client is. Service meshes use it to authenticate service-to-service calls. Every certificate expires, so rotation must be automated and overlap old and new certificates, or calls fail all at once on expiry day.',
		related: ['tls-certificate', 'service-mesh', 'tls-handshake']
	},
	{
		id: 'sni',
		term: 'SNI (Server Name Indication)',
		aliases: ['SNI'],
		category: 'frontend & network',
		short:
			'The hostname a client sends in the clear at the start of a TLS handshake so a server hosting many sites can pick the right certificate. Proxies and firewalls also read it to decide where traffic may go, which is why it matters for egress filtering.',
		related: ['tls-handshake', 'tls-certificate']
	},
	{
		id: 'cname-record',
		term: 'CNAME record',
		aliases: ['CNAME', 'DNS alias'],
		category: 'frontend & network',
		short:
			'A DNS record saying "this name is an alias for that name", e.g. `shop.example.com → stores.provider.net`. Resolvers follow the chain. CNAMEs are how third parties (CDNs, SaaS) are attached to your domain, and in browsers a CNAME to another company can make it look first-party for cookies.',
		related: ['dns', 'dns-ttl', 'third-party-cookie-blocking']
	},
	{
		id: 'asn',
		term: 'ASN (autonomous system number)',
		aliases: ['ASN', 'autonomous system'],
		category: 'frontend & network',
		short:
			'A number identifying a network operator on the internet: an ISP, a cloud provider, a company. Abuse traffic is often grouped by ASN, since a credential-stuffing attack may rotate through thousands of IPs that all belong to a few hosting providers.',
		related: ['waf', 'credential-stuffing', 'cgnat']
	},
	{
		id: 'cgnat',
		term: 'CGNAT (carrier-grade NAT)',
		aliases: ['CGNAT', 'shared IP'],
		category: 'frontend & network',
		short:
			'ISPs, especially mobile carriers, put thousands of customers behind one public IP address. Rate limiting or blocking by IP therefore punishes many innocent users at once, so per-IP rules must be generous and combined with other signals.',
		related: ['rate-limiting-scope', 'waf', 'asn']
	},
	{
		id: 'geo-ip',
		term: 'Geo-IP lookup',
		aliases: ['IP geolocation', 'CF-IPCountry'],
		category: 'frontend & network',
		short:
			'Guessing a visitor\'s country from their IP address using a database, often supplied by the CDN as a header such as `CF-IPCountry`. It is wrong for VPN, corporate and mobile users, so it should pick a default, not lock someone into a currency or language they cannot change.',
		related: ['cdn-cache-key', 'vary-header', 'locale-formatting']
	},
	{
		id: 'wan',
		term: 'WAN',
		aliases: ['wide area network', 'uplink'],
		category: 'frontend & network',
		short:
			'The connection from a site (a factory, a hospital) to the outside world or headquarters. It is slower and less reliable than the local network, so edge systems must buffer data during WAN outages and send it later.',
		related: ['edge-gateway', 'late-arriving-data']
	},

	// ───────────────────────── reliability & ops ─────────────────────────
	{
		id: 'goodput',
		term: 'Goodput vs offered load',
		aliases: ['goodput', 'offered load'],
		category: 'latency & capacity',
		short:
			'Offered load is how many requests arrive; goodput is how many complete successfully *in time to be useful*. Under overload, a system can be busy at 100% while goodput drops toward zero, because it spends its capacity on requests that time out anyway. Load shedding protects goodput.',
		related: ['load-shedding', 'metastable-failure', 'throughput', 'retry-storm']
	},
	{
		id: 'blast-radius',
		term: 'Blast radius',
		category: 'reliability practice',
		short:
			'How much breaks when one thing fails or one change goes wrong. Cells, per-tenant limits, gradual rollouts and least-privilege credentials all shrink it. Asking "what is the blast radius?" before a change is the cheapest reliability habit there is.',
		related: ['bulkhead', 'canary-analysis', 'least-privilege', 'feature-flag']
	},
	{
		id: 'outlier-detection',
		term: 'Outlier detection (ejection)',
		aliases: ['outlier ejection'],
		category: 'reliability practice',
		short:
			'A load balancer or mesh feature that temporarily removes a single backend returning errors or slow responses more often than its peers. It handles the "one bad pod" case automatically, but if every backend degrades together it may eject too many and overload the rest.',
		related: ['health-check', 'service-mesh', 'gray-failure']
	},
	{
		id: 'property-based-testing',
		term: 'Property-based testing',
		aliases: ['Hypothesis', 'QuickCheck', 'fast-check'],
		category: 'reliability practice',
		short:
			'Instead of hand-picking examples, you state a rule that must always hold ("the ledger always balances", "order of events never changes the final state") and a library generates hundreds of random inputs trying to break it, then shrinks any failure to a minimal case. Excellent for ordering, rounding and concurrency logic.',
		related: ['ledger-invariant', 'idempotent-consumer', 'flaky-test']
	},
	{
		id: 'contract-testing',
		term: 'Contract testing',
		aliases: ['Pact', 'consumer-driven contracts'],
		category: 'reliability practice',
		short:
			'Each consumer of an API records exactly which fields and behaviours it relies on, and the provider\'s CI checks it still satisfies every recorded contract. It catches "we renamed a field and the mobile app broke" before deploy, without running every service together.',
		related: ['schema-evolution', 'api-versioning']
	},
	{
		id: 'prometheus',
		term: 'Prometheus',
		aliases: ['scrape', 'PromQL'],
		category: 'observability',
		short:
			'A metrics system that **scrapes** (pulls) numbers from each service\'s `/metrics` endpoint on an interval, typically every 15–30 s, and stores them as time series queried with PromQL. If a pod dies between scrapes, its last moments are never recorded; counters restart from zero after restarts ([[counter-reset]]).',
		related: ['histogram-metric', 'metric-cardinality', 'counter-reset']
	},
	{
		id: 'apm',
		term: 'APM (application performance monitoring)',
		aliases: ['APM', 'tracing agent'],
		category: 'observability',
		short:
			'Agents and services that automatically record traces, errors and timings from your application. They also capture request payloads, headers and SQL, which is useful for debugging and a common way sensitive data leaks into third-party tools.',
		related: ['trace-span', 'phi-in-telemetry', 'trace-sampling']
	},
	{
		id: 'profiling',
		term: 'Profiling (pprof, flame graphs)',
		aliases: ['pprof', 'flame graph', 'heap dump'],
		category: 'observability',
		short:
			'Sampling where a running program spends CPU, memory or waiting time. A flame graph shows call stacks as stacked bars, wider meaning more time; a heap dump or heap profile shows which objects hold memory. Go\'s pprof also lists every goroutine and where it is blocked, which exposes leaks directly.',
		related: ['goroutine-leak', 'memory-leak', 'gc-pause']
	},
	{
		id: 'rss-memory',
		term: 'RSS (resident set size)',
		aliases: ['RSS', 'resident memory'],
		category: 'observability',
		short:
			'How much physical RAM a process is actually occupying. It is what the kernel and Kubernetes compare against memory limits, and it can stay high after a runtime frees memory internally, so "heap is small but RSS is huge" is common in garbage-collected languages.',
		related: ['oomkilled', 'memory-leak', 'gc-pause']
	},
	{
		id: 'jvm',
		term: 'JVM (Java Virtual Machine)',
		aliases: ['JVM', 'HotSpot'],
		category: 'cloud & infra',
		short:
			'The runtime for Java, Kotlin and Scala. It compiles hot code at runtime (so it starts slow and gets faster), manages memory with a garbage collector, and caches DNS lookups, sometimes forever by default. All three show up in incidents: cold-start latency, [[gc-pause|GC pauses]] and [[dns-caching|stale DNS after failover]].',
		related: ['jit-warmup', 'gc-pause', 'dns-caching', 'connection-pool']
	},
	{
		id: 'lsof',
		term: 'lsof',
		category: 'cloud & infra',
		short:
			'A Unix command that lists open files and the processes holding them, including network sockets. Classic use: disk is full but no large files exist, because a deleted log file is still held open by a process (`lsof | grep deleted`) and its space is not freed until that process restarts.',
		related: ['inode', 'filesystem-resize']
	},

	// ───────────────────────── CI/CD & supply chain ─────────────────────────
	{
		id: 'docker-layer-caching',
		term: 'Docker layer caching',
		aliases: ['layer cache', 'lockfile'],
		category: 'cloud & infra',
		short:
			'Container images are built in layers, one per Dockerfile step, and an unchanged step reuses the cached layer. Copying the dependency lockfile and installing before copying source code means dependency layers are reused across builds; reusing a cache that a pull request can write to is how [[ci-cache-poisoning]] happens.',
		related: ['ci-cache-poisoning', 'image-digest', 'npm-lifecycle-scripts']
	},
	{
		id: 'npm-lifecycle-scripts',
		term: 'npm lifecycle scripts',
		aliases: ['postinstall', 'install scripts'],
		category: 'security & compliance',
		short:
			'Commands a package can declare to run automatically when it is installed (`preinstall`, `postinstall`). They run with your CI\'s permissions, so a compromised dependency can read secrets during `npm install`. Disabling them by default and allow-listing the few that need them shrinks supply-chain risk.',
		related: ['slsa', 'ci-cache-poisoning', 'least-privilege']
	},
	{
		id: 'slsa',
		term: 'SLSA',
		aliases: ['Supply-chain Levels for Software Artifacts', 'provenance'],
		category: 'security & compliance',
		short:
			'A framework of levels for trusting how software was built: builds run on hardened, isolated infrastructure and produce signed provenance saying exactly which source and steps produced an artifact. It turns "we think this image came from main" into something you can verify before deploying.',
		related: ['image-digest', 'ci-cache-poisoning', 'npm-lifecycle-scripts']
	},
	{
		id: 'terraform-target',
		term: 'terraform -target',
		category: 'cloud & infra',
		short:
			'A flag that makes Terraform plan or apply only the named resources and their dependencies. Handy in emergencies, dangerous as a habit: it leaves the rest of the configuration unapplied and the state partly out of date, hiding drift until the next full plan surprises someone.',
		related: ['terraform-state', 'config-drift', 'terraform-plan-replace']
	},
	{
		id: 'create-before-destroy',
		term: 'create_before_destroy',
		category: 'cloud & infra',
		short:
			'A Terraform lifecycle setting: when a resource must be replaced, build the new one first and delete the old one after, instead of the default delete-then-create gap. It avoids downtime but fails when names must be unique, since two copies briefly exist.',
		related: ['terraform-forces-replacement', 'prevent-destroy', 'moved-block']
	},

	// ───────────────────────── frontend & web ─────────────────────────
	{
		id: 'tti',
		term: 'TTI (time to interactive)',
		aliases: ['TTI'],
		category: 'frontend & network',
		short:
			'How long until a page not only looks ready but responds to clicks and typing. A page can paint quickly while the main thread is still busy loading JavaScript, so users tap and nothing happens. Measured on real users ([[rum]]) it includes their slow phones and networks.',
		related: ['rum', 'lcp', 'inp', 'main-thread']
	},
	{
		id: 'ttfb',
		term: 'TTFB (time to first byte)',
		aliases: ['TTFB'],
		category: 'frontend & network',
		short:
			'Time from starting a request until the first byte of the response arrives: DNS, connection set-up, the server\'s thinking time and network distance. Everything else in page loading waits on it, so a slow TTFB caps how good [[lcp]] can be.',
		related: ['lcp', 'rtt', 'cdn']
	},
	{
		id: 'main-thread',
		term: 'Main thread',
		category: 'frontend & network',
		short:
			'The single browser thread that runs your JavaScript, calculates layout and handles input. While it is busy (parsing a big bundle, rendering 2,000 rows) the page cannot respond to clicks, which is what [[inp]] measures.',
		related: ['inp', 'event-loop', 'list-virtualization', 'debounce']
	},
	{
		id: 'list-virtualization',
		term: 'List virtualization (windowing)',
		aliases: ['windowing', 'virtual scrolling'],
		category: 'frontend & network',
		short:
			'Rendering only the rows currently visible in a long list plus a small buffer, and recycling them as the user scrolls. A 10,000-row table then costs as much as a 40-row one, which removes huge main-thread work on every filter or sort.',
		related: ['main-thread', 'inp']
	},
	{
		id: 'debounce',
		term: 'Debounce',
		aliases: ['throttle'],
		category: 'frontend & network',
		short:
			'Waiting until input has paused for a short time (say 250 ms) before acting, so typing "kubernetes" triggers one search instead of ten. Debouncing reduces load but does not prevent [[stale-response|out-of-order responses]]; you still need to cancel or ignore old requests.',
		related: ['stale-response', 'main-thread']
	},
	{
		id: 'etag',
		term: 'ETag and If-Match',
		aliases: ['ETag', 'If-Match', 'weak ETag', 'If-None-Match'],
		category: 'frontend & network',
		short:
			'An ETag is a version label a server attaches to a resource. Sending it back with `If-Match` on an update means "only apply this if nobody changed it since I read it"; the server answers 412 if it did. It is [[optimistic-locking]] over HTTP. A weak ETag (`W/"…"`) only promises equivalent content, not byte-identical, and is not meant for safe updates.',
		related: ['optimistic-locking', 'lost-update', 'fhir']
	},
	{
		id: 'nullish-coalescing',
		term: 'Nullish coalescing (??)',
		aliases: ['??'],
		category: 'frontend & network',
		short:
			'JavaScript\'s `a ?? b` returns `b` only when `a` is `null` or `undefined`, whereas `a || b` also replaces `0`, `""` and `false`. Using `||` for defaults silently turns a legitimate zero (quantity 0, price 0) into the default value.',
		related: ['type-coercion']
	},
	{
		id: 'tabular-figures',
		term: 'Tabular figures',
		aliases: ['tabular-nums', 'monospaced digits'],
		category: 'frontend & network',
		short:
			'A font setting that makes every digit the same width, so numbers in columns and live counters line up and do not jiggle as they change. In CSS: `font-variant-numeric: tabular-nums`.',
		related: ['locale-formatting']
	},
	{
		id: 'sparkline',
		term: 'Sparkline',
		category: 'observability',
		short:
			'A tiny chart without axes shown next to a number to give its recent trend at a glance. Because it has no scale, small wiggles can look dramatic; it shows shape, not magnitude.',
		related: ['log-scale', 'stacked-chart']
	},
	{
		id: 'icu-messageformat',
		term: 'ICU MessageFormat',
		aliases: ['ICU message format', 'plural rules'],
		category: 'frontend & network',
		short:
			'A standard syntax for translatable strings that handles plurals, gender and selections per language: `{count, plural, one {# item} other {# items}}`. Languages have different plural categories (Arabic has six), so string concatenation like `count + " items"` cannot be translated correctly.',
		related: ['i18n-pluralization', 'text-expansion', 'locale-formatting']
	},
	{
		id: 'user-gesture',
		term: 'User gesture',
		aliases: ['user activation', 'transient activation'],
		category: 'frontend & network',
		short:
			'Browsers only allow some powerful actions (opening a popup, playing sound, requesting storage access) directly in response to a real click or key press. Doing them after an `await` or a timer loses the "activation", so the browser blocks the action silently.',
		related: ['third-party-cookie-blocking']
	},
	{
		id: 'third-party-cookie-blocking',
		term: 'Third-party cookie blocking',
		aliases: ['ITP', 'Intelligent Tracking Prevention', 'Storage Access API', 'CHIPS', 'partitioned cookies'],
		category: 'frontend & network',
		short:
			'Browsers increasingly refuse cookies for a site embedded inside another site (an iframe, a widget). Safari\'s ITP blocks them by default; CHIPS lets a cookie live in a separate "partition" per top-level site; the Storage Access API lets an embedded site ask, after a user click, for its normal cookies. Embedded logins that worked for years break here first.',
		related: ['samesite-cookie', 'user-gesture', 'csrf']
	},
	{
		id: 'host-cookie-prefix',
		term: '__Host- cookie prefix',
		aliases: ['__Host-', '__Secure-'],
		category: 'security & compliance',
		short:
			'Naming a cookie `__Host-session` makes the browser enforce that it is Secure, has `Path=/` and no Domain attribute, so it cannot be set or overwritten by a sibling subdomain. It closes a class of session-fixation and cookie-tossing attacks cheaply.',
		related: ['samesite', 'csrf']
	},
	{
		id: 'tag-manager',
		term: 'Tag manager',
		aliases: ['Google Tag Manager', 'GTM'],
		category: 'business',
		short:
			'A tool that lets marketing add tracking and advertising scripts to a site without a code deploy, by loading them from a container script. It is effectively remote code execution on your pages, which is why [[content-security-policy]] and performance budgets clash with it.',
		related: ['content-security-policy', 'conversion-pixel']
	},
	{
		id: 'conversion-pixel',
		term: 'Conversion pixel',
		aliases: ['tracking pixel'],
		category: 'business',
		short:
			'A tiny request (originally a 1×1 image) a page fires when a user completes something valuable, like a purchase, telling an ad platform which ad led to it. If the pixel stops firing, the ad platform believes the campaign stopped working.',
		related: ['tag-manager', 'automated-bidding']
	},
	{
		id: 'automated-bidding',
		term: 'Automated bidding',
		aliases: ['smart bidding'],
		category: 'business',
		short:
			'Ad platforms adjust how much to bid for each ad slot using the conversions they observe. When conversion tracking breaks, the algorithm sees "no results" and cuts spend or bids on the wrong audiences, so a tracking bug quietly becomes a revenue problem days later.',
		related: ['conversion-pixel', 'analytics-schema-drift']
	},

	// ───────────────────────── AI & data ─────────────────────────
	{
		id: 'llm',
		term: 'LLM (large language model)',
		aliases: ['LLM', 'language model'],
		category: 'ai & retrieval',
		short:
			'A model trained on large amounts of text to predict the next [[llm-token|token]]; it can follow instructions, summarise and call tools. It has no built-in notion of which text is trusted, so anything placed in its context can steer it ([[prompt-injection]]).',
		related: ['llm-token', 'context-window', 'hallucination', 'prompt-injection', 'rag']
	},
	{
		id: 'llm-token',
		term: 'Token (LLM)',
		aliases: ['tokens', 'tokenization (LLM)'],
		category: 'ai & retrieval',
		short:
			'The chunk of text an LLM reads and writes, roughly ¾ of an English word on average. Context limits, latency and price are all counted in tokens, so a 4,000-word transcript is about 5,300 tokens.',
		related: ['context-window', 'llm']
	},
	{
		id: 'llm-temperature',
		term: 'Temperature (LLM sampling)',
		aliases: ['temperature'],
		category: 'ai & retrieval',
		short:
			'A setting that controls how random an LLM\'s word choices are. Near 0 it almost always picks the most likely next token (consistent, good for extraction); higher values make output more varied and more likely to drift from the source.',
		related: ['llm', 'hallucination']
	},
	{
		id: 'ner',
		term: 'NER (named entity recognition)',
		aliases: ['NER', 'entity extraction'],
		category: 'ai & retrieval',
		short:
			'A model task that finds and labels spans of text such as person names, places, dates and IDs. Redaction pipelines rely on it; its misses are leaks and its false hits remove useful words (a drug or disease named after a person).',
		related: ['pii-redaction', 'recall-precision', 'medical-eponym']
	},
	{
		id: 'ocr',
		term: 'OCR (optical character recognition)',
		aliases: ['OCR'],
		category: 'ai & retrieval',
		short:
			'Turning text in images (scans, screenshots, medical images with burned-in labels) into machine-readable text. It is compute-heavy and imperfect: small, rotated or low-contrast text is missed, so OCR-based redaction needs its own recall measurement.',
		related: ['burned-in-phi', 'de-identification', 'recall-precision']
	},
	{
		id: 'auc',
		term: 'AUC (area under the ROC curve)',
		aliases: ['AUC', 'ROC AUC'],
		category: 'ai & retrieval',
		short:
			'A single number summarising how well a model ranks positives above negatives across all thresholds: 0.5 is random, 1.0 is perfect. It says nothing about the threshold you actually use, latency, or what happens at low prevalence, so a "better AUC" model can still be worse in production.',
		related: ['recall-precision', 'positive-predictive-value', 'base-rate-fallacy']
	},
	{
		id: 'statistical-significance',
		term: 'Statistical significance, p-values and power',
		aliases: ['p-value', 'confidence interval', 'statistical power', 'standard error', 'chi-square test', 'sequential testing', 'always-valid p-values'],
		category: 'business',
		short:
			'A p-value is the probability of seeing a difference at least this large *if there were really no difference*; "significant at 5%" means that probability is under 0.05. Power is the chance an experiment detects a real effect of a given size, and it rises with sample size. A confidence interval gives the range of effect sizes consistent with the data, which is usually more useful than the p-value alone.',
		related: ['ab-test', 'peeking', 'sample-ratio-mismatch', 'simpsons-paradox', 'canary-analysis'],
		page: [
			{ type: 'heading', text: 'The four numbers, in plain words' },
			{
				type: 'table',
				head: ['Term', 'Meaning', 'Common misread'],
				rows: [
					['p-value', 'How surprising the data would be if nothing changed', '"95% chance the variant is better" (wrong)'],
					['Standard error', 'How much an estimate would wobble if you reran the experiment', 'Confused with the spread of individual values'],
					['Confidence interval', 'Estimate ± ~2 standard errors', 'Ignoring that it includes zero or tiny effects'],
					['Power', 'Chance of detecting a real effect of a chosen size', 'Running an underpowered test and calling "no difference"']
				]
			},
			{ type: 'heading', text: 'Worked example: conversion rate' },
			{
				type: 'p',
				text: 'Control: 10,000 users, 500 convert (5.0%). Variant: 10,000 users, 560 convert (5.6%). Standard error of each rate ≈ √(p(1−p)/n) ≈ √(0.05 × 0.95 / 10,000) ≈ 0.22 points. Standard error of the difference ≈ √(0.22² + 0.23²) ≈ 0.32 points. The difference is 0.6 points, about 1.9 standard errors: p ≈ 0.06, not quite significant at 5%. The 95% interval is roughly **0.6 ± 0.63 points**, i.e. from −0.03 to +1.23: anything from no effect to a 25% relative lift is plausible.'
			},
			{ type: 'heading', text: 'Power and sample size' },
			{
				type: 'p',
				text: 'To detect a 0.5-point lift on a 5% baseline with 80% power at 5% significance you need about **31,000 users per arm**. With 5,000 per arm you would miss a real lift of that size most of the time, and "not significant" would mean "too small a test", not "no effect".'
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'Peeking and sequential testing',
				text: 'Checking a fixed-horizon test every day and stopping at the first p < 0.05 inflates false positives several-fold ([[peeking]]). Sequential methods ("always-valid p-values") are designed to be monitored continuously at the cost of needing somewhat more data. A chi-square test is the usual check that traffic was split in the planned ratio ([[sample-ratio-mismatch]]).'
			}
		]
	},
	{
		id: 'ab-test',
		term: 'A/B test',
		aliases: ['A/B testing', 'split test', 'online experiment'],
		category: 'business',
		short:
			'Randomly splitting users into a control group and one or more variants and comparing an outcome metric. Random assignment is the whole point: it makes the groups alike in everything except the change, so a difference can be blamed on the change. Analysis then asks whether the difference is bigger than chance ([[statistical-significance]]).',
		related: ['statistical-significance', 'peeking', 'novelty-effect', 'sample-ratio-mismatch', 'holdout-group']
	},
	{
		id: 'holdout-group',
		term: 'Holdout group',
		aliases: ['holdout', 'control group'],
		category: 'business',
		short:
			'A slice of traffic deliberately kept on the old behaviour (or with a model switched off) to measure what the change really achieves over time. Without a holdout, a fraud model\'s "prevented losses" are a guess, since blocked transactions never show whether they were fraud.',
		related: ['ab-test', 'statistical-significance']
	},
	{
		id: 'percentage-points',
		term: 'Percentage points (pp)',
		aliases: ['pp', 'percentage point'],
		category: 'business',
		short:
			'The arithmetic difference between two percentages. Going from 2% to 3% is +1 percentage point but a +50% relative increase. Mixing the two in reports makes small changes sound huge or huge ones sound small.',
		related: ['basis-point', 'statistical-significance']
	},
	{
		id: 'big-o-notation',
		term: 'Big-O notation',
		aliases: ['O(n)', 'time complexity'],
		category: 'latency & capacity',
		short:
			'A way to describe how work grows with input size, ignoring constants: O(n) doubles when the input doubles, O(n²) quadruples, O(log n) barely grows. It explains why a loop that is fine for 100 records collapses at 100,000.',
		related: ['n-plus-one']
	},
	{
		id: 'windowing',
		term: 'Tumbling and sliding windows',
		aliases: ['tumbling window', 'hopping window', 'event time', 'processing time'],
		category: 'distributed systems',
		short:
			'Stream processors group events into time windows: **tumbling** windows are fixed and non-overlapping (each minute), **sliding/hopping** windows overlap (the last 5 minutes, updated every minute). Windows can be defined by *event time* (when it happened) or *processing time* (when it arrived); only event time gives correct results when data arrives late, which needs a [[watermark]].',
		related: ['watermark', 'late-arriving-data', 'sliding-window']
	},
	{
		id: 'snowflake-id',
		term: 'Snowflake-style IDs',
		aliases: ['64-bit IDs', 'Snowflake ID'],
		category: 'distributed systems',
		short:
			'64-bit IDs built from a timestamp, a machine number and a sequence, so many servers can generate unique, roughly time-ordered IDs without coordinating. They exceed 2^53, the largest integer JavaScript numbers hold exactly, so they must travel as strings to browsers ([[json-number-precision]]).',
		related: ['json-number-precision', 'integer-overflow']
	},
	{
		id: 'xor',
		term: 'XOR',
		aliases: ['exclusive or'],
		category: 'security & compliance',
		short:
			'A bit operation that outputs 1 when its two inputs differ. It undoes itself: (a XOR k) XOR k = a. Stream ciphers encrypt by XOR-ing data with a keystream, so encrypting two messages with the same keystream ([[nonce-reuse]]) lets an attacker XOR the ciphertexts and cancel the key out.',
		related: ['nonce-reuse', 'aead']
	},
	{
		id: 'hmac',
		term: 'HMAC (keyed hash)',
		aliases: ['HMAC', 'keyed hash'],
		category: 'security & compliance',
		short:
			'A hash computed together with a secret key. Without the key, nobody can produce or check the value, so HMAC-SHA256(MRN) gives a stable pseudonym that outsiders cannot reverse by hashing every possible MRN. It is also how webhooks prove they came from the sender.',
		related: ['pseudonymization', 'webhook', 'kms']
	},
	{
		id: 'bcrypt',
		term: 'bcrypt',
		aliases: ['password hashing', 'argon2', 'scrypt'],
		category: 'security & compliance',
		short:
			'A password-hashing function that is deliberately slow and has a tunable cost, so checking one password takes tens of milliseconds. That slowness protects stolen hashes from guessing, but it also means each login attempt costs real CPU: a credential-stuffing flood can saturate login servers.',
		related: ['credential-stuffing', 'waf']
	},
	{
		id: 'pii',
		term: 'PII (personally identifiable information)',
		aliases: ['PII', 'personal data'],
		category: 'security & compliance',
		short:
			'Information that identifies a person directly (name, email, phone, ID numbers) or in combination ([[quasi-identifier|date of birth + ZIP + sex]]). Laws such as GDPR and HIPAA restrict how it is collected, stored, shared and deleted, and it leaks most often through logs, analytics and error trackers rather than the main database.',
		related: ['pii-redaction', 'gdpr', 'phi', 'quasi-identifier']
	},
	{
		id: 'gdpr',
		term: 'GDPR',
		aliases: ['General Data Protection Regulation'],
		category: 'security & compliance',
		short:
			'The EU law on personal data. It requires a lawful reason for processing, data minimisation, the rights to access and erasure, breach notification within 72 hours of awareness, and limits on transfers outside the EU. Engineering meets it as deletion propagation, retention rules and audit trails.',
		related: ['gdpr-erasure', 'personal-data-breach', 'data-protection-officer', 'data-residency']
	},
	{
		id: 'data-protection-officer',
		term: 'DPO (Data Protection Officer)',
		aliases: ['DPO', 'privacy officer'],
		category: 'security & compliance',
		short:
			'The person responsible for an organisation\'s data-protection compliance and the contact point for regulators. Any suspected personal-data exposure goes to them immediately, because legal notification clocks start when the organisation becomes aware.',
		related: ['gdpr', 'personal-data-breach', 'severity-triage']
	},
	{
		id: 'tcpa',
		term: 'TCPA',
		aliases: ['Telephone Consumer Protection Act'],
		category: 'security & compliance',
		short:
			'A US law restricting marketing calls and text messages without prior express consent, with statutory damages per message. Pre-checked SMS marketing boxes or sending to people who opted out can turn into very expensive class actions.',
		related: ['dark-pattern', 'suppression-list']
	},
	{
		id: 'digital-services-act',
		term: 'DSA (Digital Services Act)',
		aliases: ['DSA'],
		category: 'security & compliance',
		short:
			'An EU law regulating online platforms, including a ban on interfaces that deceive or manipulate users into choices ([[dark-pattern|dark patterns]]) and rules on transparency and complaint handling.',
		related: ['dark-pattern', 'gdpr']
	},
	{
		id: 'character-encoding',
		term: 'Character encoding (UTF-8, Latin-1)',
		aliases: ['Latin-1', 'ISO-8859-1', 'UTF-8', 'mojibake'],
		category: 'frontend & network',
		short:
			'The rule for turning characters into bytes. UTF-8 can represent every character; older encodings like Latin-1 only cover Western European letters. Decoding bytes with the wrong encoding produces garbage like "ZoÃ«" ("mojibake"), and systems limited to Latin-1 or ASCII reject or mangle names in other scripts.',
		related: ['unicode-normalization', 'iso-20022']
	},
	{
		id: 'base62',
		term: 'Base62 encoding',
		aliases: ['base62', 'base64url'],
		category: 'distributed systems',
		short:
			'Writing a number with 62 symbols (0–9, a–z, A–Z) to make short, URL-safe strings. 7 base62 characters give 62⁷ ≈ 3.5 trillion combinations, which is why URL shorteners use them.',
		related: ['back-of-envelope']
	},
	{
		id: 'transcoding',
		term: 'Transcoding',
		category: 'cloud & infra',
		short:
			'Converting media from one format, resolution or bitrate to others, e.g. one uploaded video into 1080p, 720p and 480p versions. It is CPU/GPU heavy and slow, so it runs asynchronously from a queue rather than inside the upload request.',
		related: ['message-queue', 'object-storage', 'presigned-url']
	},
	{
		id: 'transactional-email',
		term: 'Transactional email',
		aliases: ['email bounce', 'bounce'],
		category: 'business',
		short:
			'Emails triggered by a user\'s own action (receipts, password resets) as opposed to marketing. They should be sent from separate infrastructure or streams with priority, because a bulk campaign or a bounce-rate penalty can otherwise delay a password reset by hours. A bounce is the receiving server refusing a message; repeated bounces damage sender reputation.',
		related: ['suppression-list', 'queue-age']
	},
	{
		id: 'credit-note',
		term: 'Credit note',
		category: 'fintech',
		short:
			'A document that reduces or cancels an invoice that was already issued. Accounting rules usually forbid editing or deleting an issued invoice, so corrections and refunds are recorded as a new credit note that references it.',
		related: ['sequence-gaps', 'reconciliation', 'audit-trail']
	},

	// ───────────────────────── payments & finance ─────────────────────────
	{
		id: 'foreign-exchange',
		term: 'FX (foreign exchange)',
		aliases: ['FX', 'exchange rate', 'currency conversion'],
		category: 'fintech',
		short:
			'Converting one currency into another at a rate that changes constantly. Engineering issues are which rate (and timestamp) applies, when rounding happens, and where the small differences go, because converting there and back almost never returns the original amount.',
		related: ['fx-revaluation', 'rounding-residue-account', 'minor-units']
	},
	{
		id: 'issuer-acquirer',
		term: 'Issuer and acquirer',
		aliases: ['issuer', 'acquirer', 'issuing bank', 'acquiring bank'],
		category: 'fintech',
		short:
			'In a card payment, the **issuer** is the cardholder\'s bank that approves or declines and bills the customer; the **acquirer** is the merchant\'s bank (often via a [[psp]]) that submits the payment and pays the merchant. Declines come from the issuer, which is why one issuer\'s rules can affect your approval rate on its own.',
		related: ['card-network', 'psp', 'interchange-plus-plus', 'soft-decline']
	},
	{
		id: 'pan',
		term: 'PAN (primary account number)',
		aliases: ['PAN', 'card number', 'Luhn check'],
		category: 'fintech',
		short:
			'The long number on a payment card. Storing, logging or even transmitting it brings systems into [[pci-dss|PCI DSS]] scope. Its last digit is a Luhn checksum that catches typos, which also makes card numbers easy to detect in logs with a regex plus a Luhn check.',
		related: ['pci-dss', 'card-tokenization']
	},
	{
		id: 'payment-intent',
		term: 'Payment intent',
		category: 'fintech',
		short:
			'An object representing one attempt to collect a payment through its whole lifecycle (requires action, processing, succeeded, failed), created once and confirmed possibly several times. Tying retries and webhooks to the same intent, instead of creating new charges, is what keeps a payment from happening twice.',
		related: ['idempotency-key', 'three-ds', 'state-machine', 'psp']
	},
	{
		id: 'merchant-initiated-transaction',
		term: 'Merchant-initiated transaction (MIT)',
		aliases: ['MIT', 'off-session payment'],
		category: 'fintech',
		short:
			'A charge the merchant makes without the customer present, such as a subscription renewal, using a card saved earlier. It must reference the original customer-authenticated transaction; flagged correctly it skips 3-D Secure, flagged wrongly it gets declined.',
		related: ['three-ds', 'soft-decline', 'auth-and-capture']
	},
	{
		id: 'sepa-direct-debit',
		term: 'SEPA Direct Debit',
		aliases: ['SEPA DD', 'direct debit'],
		category: 'fintech',
		short:
			'A European bank payment where the merchant pulls money from the customer\'s account under a mandate. It settles in days rather than seconds, and the customer can reverse it for weeks afterwards, so "succeeded" is not final for a long time.',
		related: ['settlement', 'chargeback', 'iso-20022']
	},
	{
		id: 'trial-balance',
		term: 'Trial balance',
		aliases: ['income-statement accounts', 'balance sheet accounts'],
		category: 'fintech',
		short:
			'A list of every ledger account\'s balance at a moment, which must sum to zero (debits equal credits). Balance-sheet accounts (cash, receivables) carry forward forever; income-statement accounts (revenue, fees, FX gains) measure one period and are closed out at period end.',
		related: ['double-entry-bookkeeping', 'ledger-invariant', 'fx-revaluation']
	},

	// ───────────────────────── healthcare ─────────────────────────
	{
		id: 'dimse',
		term: 'DIMSE services (C-STORE, C-MOVE, C-GET)',
		aliases: ['C-MOVE', 'C-GET', 'C-STORE', 'C-FIND', 'AE title', 'Application Entity'],
		category: 'healthcare',
		short:
			'The classic DICOM network commands between imaging systems, each of which is identified by an **AE title**. C-FIND searches, C-STORE pushes images, C-GET pulls them over the same connection, and C-MOVE asks the archive to *open a new connection back* to a named AE and push the images, which fails through NAT and cloud firewalls that block inbound connections.',
		related: ['dicom', 'dicomweb', 'pacs']
	},
	{
		id: 'hl7-acknowledgements',
		term: 'HL7 acknowledgements (ACK AA/AE/AR)',
		aliases: ['ACK', 'AA', 'AE', 'AR', 'MLLP'],
		category: 'healthcare',
		short:
			'Every HL7 v2 message is answered with an ACK whose code says what happened: **AA** accepted, **AE** error (the receiver understood but could not process it), **AR** rejected. Senders typically retry or stop the whole interface until they get AA, so returning AA for messages you failed to store silently loses clinical data.',
		related: ['hl7-v2', 'adt-message', 'at-least-once'],
		page: [
			{ type: 'heading', text: 'The loop' },
			{
				type: 'flow',
				steps: [
					{ label: 'EHR sends ADT^A08', note: 'over MLLP (TCP)' },
					{ label: 'Interface engine', note: 'parses, routes' },
					{ label: 'Your service', note: 'stores it' },
					{ label: 'ACK MSA|AA|<control id>', note: 'sender moves to next message' }
				]
			},
			{
				type: 'table',
				head: ['Code', 'Meaning', 'What senders usually do'],
				rows: [
					['AA', 'Application accept', 'Send the next message'],
					['AE', 'Application error', 'Retry, alert, or park the message (varies by engine)'],
					['AR', 'Application reject', 'Usually stop the interface queue for a human'],
					['(no ACK)', 'Timeout', 'Resend the same message: duplicates are normal']
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'Two traps',
				text: 'ACK *after* durable storage, never before, or a crash loses messages that the sender considers delivered. And because many senders process strictly in order, one message that keeps failing with AE can block every message behind it, so a dead-letter path for poison messages matters.'
			}
		]
	},
	{
		id: 'mrn',
		term: 'MRN (medical record number)',
		aliases: ['MRN', 'patient identifier'],
		category: 'healthcare',
		short:
			'A hospital\'s identifier for a patient within its own systems. The same person can have different MRNs at different hospitals, or two MRNs at one hospital by mistake until a merge fixes it, so MRNs are not stable global identities.',
		related: ['mrn-merge', 'empi', 'pseudonymization']
	},
	{
		id: 'empi',
		term: 'EMPI (enterprise master patient index)',
		aliases: ['EMPI', 'MPI'],
		category: 'healthcare',
		short:
			'A system that links the different identifiers a patient has across hospitals and systems into one person, using matching on names, dates of birth and addresses. Its link and unlink decisions change who a record belongs to, so downstream systems must react to them.',
		related: ['mrn', 'mrn-merge']
	},
	{
		id: 'mar',
		term: 'MAR (medication administration record)',
		aliases: ['MAR', 'eMAR'],
		category: 'healthcare',
		short:
			'The record of which medication was given to a patient, by whom, at what dose and time. Its timestamps are clinically and legally significant, so time zone and clock errors that reorder "ordered" and "given" events are patient-safety issues.',
		related: ['dst', 'clock-skew', 'audit-trail']
	},
	{
		id: 'ucum',
		term: 'UCUM (units of measure)',
		aliases: ['UCUM', 'units'],
		category: 'healthcare',
		short:
			'A standard code system for units (`mg/dL`, `mmol/L`) so lab values can be compared and converted by machines. Converting between mass and molar units needs the substance\'s molar mass (glucose: 1 mmol/L ≈ 18.016 mg/dL), so a missing or wrong unit makes a value meaningless.',
		related: ['loinc', 'terminology-mapping']
	},
	{
		id: 'medical-eponym',
		term: 'Medical eponym',
		aliases: ['eponym'],
		category: 'healthcare',
		short:
			'A disease, sign or procedure named after a person: Parkinson\'s disease, Down syndrome, Crohn\'s disease. Name-detection models flag them as person names, so naive redaction deletes clinically important words while letting other names through.',
		related: ['ner', 'pii-redaction', 'recall-precision']
	},
	{
		id: 'defacing',
		term: 'Defacing',
		aliases: ['face removal'],
		category: 'healthcare',
		short:
			'Removing or blurring the face from head CT and MRI scans before sharing them, because a 3D reconstruction of the scan can be recognised as the person. Header de-identification alone does not do this.',
		related: ['de-identification', 'burned-in-phi']
	},
	{
		id: 'digital-breast-tomosynthesis',
		term: 'DBT (digital breast tomosynthesis)',
		aliases: ['DBT', 'tomosynthesis', '3D mammography'],
		category: 'healthcare',
		short:
			'A 3D mammography technique that produces dozens of thin image slices per view instead of one picture, so a single study can be gigabytes. Its size breaks systems sized for 2D images, from upload limits to transfer times.',
		related: ['dicom', 'transfer-syntax', 'microcalcifications']
	},
	{
		id: 'microcalcifications',
		term: 'Microcalcifications',
		category: 'healthcare',
		short:
			'Tiny calcium deposits visible on mammograms that can be an early sign of breast cancer. They are a few pixels wide, which is why lossy compression of mammograms is clinically unsafe: it can blur them away.',
		related: ['transfer-syntax', 'digital-breast-tomosynthesis']
	},
	{
		id: 'emergency-department',
		term: 'ED (emergency department)',
		aliases: ['ED', 'ER', 'A&E'],
		category: 'healthcare',
		short:
			'The hospital department for unscheduled urgent care. Data from the ED arrives fast and messy (unknown patients registered as temporary records, merged later), and delays there have direct patient impact.',
		related: ['mrn-merge', 'break-glass']
	},

	// ───────────────────────── manufacturing & printing ─────────────────────────
	{
		id: 'mqtt',
		term: 'MQTT',
		aliases: ['broker', 'topic', 'PUBACK'],
		category: 'manufacturing',
		short:
			'A lightweight publish/subscribe protocol widely used for sensors and machines. Devices publish to topics on a central broker, which forwards messages to subscribers. It offers three delivery levels ([[mqtt-qos|QoS 0/1/2]]), [[retained-message|retained messages]] and a [[last-will-message|last will]], and its broker is a single choke point for thousands of devices.',
		related: ['mqtt-qos', 'retained-message', 'last-will-message', 'edge-gateway', 'pub-sub'],
		page: [
			{ type: 'heading', text: 'A message\'s path' },
			{
				type: 'flow',
				steps: [
					{ label: 'Press PLC', note: 'via edge gateway' },
					{ label: 'PUBLISH plant/line3/temp', note: 'QoS 1' },
					{ label: 'Broker', note: 'stores, forwards' },
					{ label: 'Subscribers', note: 'historian, dashboards, alerting' }
				]
			},
			{
				type: 'table',
				head: ['Feature', 'What it does', 'Gotcha'],
				rows: [
					['QoS 0', 'Fire and forget', 'Lost on any hiccup'],
					['QoS 1', 'Resend until PUBACK', 'Duplicates are normal; consumers must dedupe'],
					['QoS 2', 'Four-step exactly-once handshake', '2× the round trips and broker state per message'],
					['Retained', 'Broker keeps the last message per topic', 'A dead machine\'s last "RUNNING" lives on'],
					['Last will', 'Broker publishes it if a client vanishes', 'Only fires on unclean disconnects']
				]
			},
			{
				type: 'callout',
				tone: 'info',
				text: 'Worked example: 4,000 sensors at 10 readings/s is 40,000 PUBLISH/s. At QoS 1 that is also 40,000 PUBACK/s; at QoS 2 it becomes 160,000 packets/s. Batching 10 readings per message cuts it to 4,000 messages/s at any QoS.'
			}
		]
	},
	{
		id: 'andon',
		term: 'Andon',
		category: 'manufacturing',
		short:
			'A signal (a light, a cord, a button) that a worker uses to flag a problem on a production line, often stopping it. Software andon systems page supervisors and record downtime reasons, which feed [[oee]] calculations.',
		related: ['oee', 'mes']
	},
	{
		id: 'wip',
		term: 'WIP (work in progress)',
		aliases: ['WIP', 'work in process'],
		category: 'manufacturing',
		short:
			'Items that have started production but are not finished. High WIP means queues between stations, longer lead times and more parts at risk if a defect is found; by [[littles-law]], lead time = WIP ÷ throughput.',
		related: ['littles-law', 'theory-of-constraints']
	},
	{
		id: 'theory-of-constraints',
		term: 'Theory of constraints',
		aliases: ['bottleneck', 'drum-buffer-rope'],
		category: 'manufacturing',
		short:
			'A system\'s output is limited by its single slowest step, the constraint. Speeding up anything else just piles up work in front of the constraint, so improvement starts by finding it and keeping it busy. The same logic applies to software pipelines: adding printers does nothing if the slicer is the bottleneck.',
		related: ['wip', 'littles-law', 'throughput']
	},
	{
		id: 'cnc',
		term: 'CNC',
		aliases: ['computer numerical control', 'CNC machining'],
		category: 'manufacturing',
		short:
			'Machines (mills, lathes, routers) that cut material along paths given as G-code. Unlike 3D printing, which adds material, CNC removes it; the same G-code ideas apply, including units, absolute vs relative moves and feed rates.',
		related: ['g-code', 'tolerance-stack-up']
	},
	{
		id: 'hotend',
		term: 'Hotend',
		aliases: ['nozzle', 'extruder'],
		category: 'manufacturing',
		short:
			'The heated part of an FDM 3D printer that melts filament and pushes it through the nozzle. It can only melt plastic so fast, which sets the maximum [[volumetric-flow]] and therefore the top printing speed for a given line width and layer height.',
		related: ['volumetric-flow', 'extrusion-math', 'retraction']
	},
	{
		id: 'retraction',
		term: 'Retraction',
		category: 'manufacturing',
		short:
			'Pulling filament back slightly before the nozzle travels without printing, to stop molten plastic oozing and leaving strings. Retraction shows up in G-code as negative extrusion moves, which filament-usage calculators must not count as consumed material.',
		related: ['g-code', 'extrusion-math', 'hotend']
	},
	{
		id: 'purge-line',
		term: 'Purge line',
		aliases: ['prime line'],
		category: 'manufacturing',
		short:
			'A short line a 3D printer extrudes at the edge of the bed before a print starts, to prime the nozzle with fresh plastic. It uses filament that is not part of the model, a small but real term in material estimates.',
		related: ['extrusion-math', 'g-code']
	},
	{
		id: 'spaghetti-failure',
		term: 'Spaghetti failure',
		category: 'manufacturing',
		short:
			'A failed 3D print where the part detached or collapsed and the printer keeps extruding loose strands of plastic into a tangle. Camera-based detectors look for it so a job can be stopped before it wastes hours of material.',
		related: ['g-code']
	},
	{
		id: 'bootloader',
		term: 'Bootloader',
		aliases: ['SWD', 'serial wire debug', 'firmware flashing'],
		category: 'manufacturing',
		short:
			'The small program that runs first on a microcontroller and can load new firmware. If an update overwrites or breaks it, the device can no longer accept updates over USB or the network and must be re-flashed with a hardware programmer (via a debug port like SWD), which is what "bricked" means.',
		related: ['canary-analysis', 'blast-radius']
	},
	{
		id: 'serial-8n1',
		term: '8N1 serial framing',
		aliases: ['8N1', 'baud rate', 'UART'],
		category: 'manufacturing',
		short:
			'The most common serial-port setting: each byte is sent as 8 data bits, no parity bit, 1 stop bit, plus a start bit, so 10 bits per byte. At 115,200 baud that is at most 11,520 bytes per second, a hard ceiling on how fast G-code can be streamed to a printer.',
		related: ['serial-line-checksum', 'planner-buffer-underrun']
	},
	{
		id: 'adc',
		term: 'ADC (analog-to-digital converter)',
		aliases: ['ADC', 'sample rate'],
		category: 'manufacturing',
		short:
			'Hardware that measures an analog signal (voltage from a sensor) at fixed intervals and turns each sample into a number. Its sample rate decides which frequencies can be captured; anything faster than half the rate is folded into false lower frequencies ([[aliasing]]).',
		related: ['nyquist-rate', 'aliasing', 'rms']
	},
	{
		id: 'rms',
		term: 'RMS (root mean square)',
		aliases: ['RMS'],
		category: 'manufacturing',
		short:
			'A way to summarise an oscillating signal\'s strength: square each sample, average, take the square root. Vibration monitoring reports RMS because positive and negative swings would otherwise average to zero; it also smooths away short spikes.',
		related: ['downsampling', 'adc']
	},
	{
		id: 'iec-62443',
		term: 'IEC 62443',
		category: 'manufacturing',
		short:
			'The main international standard family for securing industrial control systems: network zones and conduits, security levels, and secure development for automation vendors. It is why plant networks keep controllers separated from IT networks and the internet.',
		related: ['safety-interlock', 'plc', 'least-privilege']
	}
];

export default terms;
