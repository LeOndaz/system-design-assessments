import type { GlossaryTerm } from '../types';
import { timeAxis, shape, ramp, step } from '../series';

const lqX = timeAxis('10:50', 20);

const terms: GlossaryTerm[] = [
	{
		id: 'lock-queue',
		term: 'Lock queue',
		aliases: ['lock wait queue', 'lock convoy'],
		category: 'databases',
		short:
			"When a session asks for a lock it can't get yet, the database puts it in a line for that table or row. The line is first-come, first-served, so a request that is waiting can block requests behind it **even if they would be compatible with whoever currently holds the lock**. One slow query plus one migration that wants an exclusive lock can freeze every query on a table.",
		analogy:
			'A single-lane bridge with a slow tractor on it. A truck that needs the whole bridge waits at the entrance, and every car behind the truck waits too, even though the cars could have squeezed past the tractor.',
		related: ['lock-timeout', 'expand-contract-migration', 'create-index-concurrently', 'deadlock'],
		page: [
			{ type: 'heading', text: 'Why a "harmless" migration takes the site down' },
			{
				type: 'p',
				text: "Postgres has table-level lock modes. A plain `SELECT` takes `ACCESS SHARE`, which almost everything is compatible with. `ALTER TABLE` takes `ACCESS EXCLUSIVE`, which conflicts with **everything**, including `SELECT`."
			},
			{
				type: 'flow',
				steps: [
					{ label: 'pid 4127', note: 'long report · holds ACCESS SHARE · 50 min', tone: 'info' },
					{ label: 'pid 9981', note: 'ALTER TABLE · wants ACCESS EXCLUSIVE · waiting', tone: 'warn' },
					{ label: 'pids 10012…', note: 'normal SELECT/INSERT · queued behind 9981', tone: 'crit' }
				],
				caption:
					'The new SELECTs are compatible with pid 4127 but not with the ALTER ahead of them in line, so they wait. Locks are granted in order to prevent the ALTER from starving forever.'
			},
			{
				type: 'dashboard',
				dashboard: {
					style: 'grafana',
					title: 'What it looks like',
					range: '10:50 – 11:09',
					panels: [
						{
							kind: 'timeseries',
							title: 'Sessions waiting on a lock',
							span: 3,
							x: lqX,
							series: [{ name: 'waiting', points: shape(20, { base: 0, noise: 0.04, seed: 4 }, ramp(4, 7, 0, 380), step(14, 0)) }],
							markers: [
								{ at: 4, label: 'ALTER starts' },
								{ at: 14, label: 'ALTER cancelled' }
							]
						},
						{
							kind: 'timeseries',
							title: 'DB CPU',
							unit: '%',
							span: 3,
							yMax: 100,
							x: lqX,
							series: [{ name: 'cpu', points: shape(20, { base: 24, noise: 0.1, seed: 5 }, ramp(4, 6, 24, 7), step(14, 26)) }]
						}
					]
				}
			},
			{
				type: 'p',
				text: 'The tell: lock waits climb in a straight line while CPU **drops**. Nothing is working, everything is waiting.'
			},
			{ type: 'heading', text: 'How to spot it' },
			{
				type: 'code',
				lang: 'sql',
				code: `SELECT pid, state, wait_event_type, wait_event,
       pg_blocking_pids(pid) AS blocked_by,
       now() - xact_start AS xact_age, left(query, 60)
FROM pg_stat_activity
WHERE wait_event_type = 'Lock'
ORDER BY xact_start;`
			},
			{ type: 'heading', text: 'How to prevent it' },
			{
				type: 'list',
				items: [
					"Every migration sets `SET lock_timeout = '2s'` and retries with backoff. Failing fast is far better than queuing the whole app behind you.",
					'Give reporting users a `statement_timeout`, or send them to a [[read-replica]].',
					'Use the online variants: `CREATE INDEX CONCURRENTLY`, `ADD CONSTRAINT … NOT VALID` then `VALIDATE CONSTRAINT`.'
				]
			}
		]
	},
	{
		id: 'lock-timeout',
		term: 'lock_timeout',
		aliases: ['lock timeout'],
		category: 'databases',
		short:
			"A Postgres setting that says how long a statement may *wait to acquire* a lock before giving up with an error. It's different from `statement_timeout`, which limits total run time. Setting it low in migrations turns \"freeze the site while I wait\" into \"fail fast and retry later\".",
		related: ['lock-queue', 'timeout']
	},
	{
		id: 'create-index-concurrently',
		term: 'CREATE INDEX CONCURRENTLY',
		category: 'databases',
		short:
			"A normal `CREATE INDEX` blocks every write to the table until the index is built, which can take many minutes on a big table. Reads still work. `CONCURRENTLY` builds the index in several passes without blocking writes. It's slower, can't run inside a transaction block, and if it fails it leaves an `INVALID` index behind that you must drop.",
		related: ['database-index', 'lock-queue', 'expand-contract-migration']
	},
	{
		id: 'deadlock',
		term: 'Deadlock',
		category: 'databases',
		short:
			'Two transactions each hold a lock the other one needs, so neither can ever continue. The database notices the cycle (Postgres checks after `deadlock_timeout`, default 1 s) and kills one of them with an error. Deadlocks almost always come from code that takes the same locks **in a different order** depending on the input.',
		analogy:
			'Two people in a narrow corridor, each refusing to step back until the other does. Someone has to be told to go back.',
		related: ['lock-ordering', 'select-for-update', 'lock-queue']
	},
	{
		id: 'lock-ordering',
		term: 'Lock ordering',
		category: 'databases',
		short:
			'The standard fix for deadlocks: whenever code needs several locks, it always takes them in one global order (for example, ascending account id). A cycle needs A-then-B in one transaction and B-then-A in another, and a fixed order makes that impossible.',
		related: ['deadlock']
	},
	{
		id: 'select-for-update',
		term: 'SELECT … FOR UPDATE',
		aliases: ['for update', 'row lock'],
		category: 'databases',
		short:
			"Reads rows **and locks them** until the current transaction ends, so no one else can change or lock them in the meantime. It's how you make \"read a value, decide, write\" safe. The lock only lasts as long as the transaction. In autocommit mode every statement is its own transaction, so the lock is released the moment the `SELECT` finishes and protects nothing.",
		related: ['lost-update', 'optimistic-locking', 'deadlock', 'autocommit']
	},
	{
		id: 'autocommit',
		term: 'Autocommit',
		category: 'databases',
		short:
			"A connection mode where each statement is committed on its own as soon as it finishes. That's convenient for simple queries, but nothing spans two statements: no locks are held between them and you can't roll them back together. Many drivers and poolers turn it on by default.",
		related: ['select-for-update', 'pgbouncer']
	},
	{
		id: 'lost-update',
		term: 'Lost update',
		category: 'databases',
		short:
			"Two requests read the same value, each computes a new value from what it read, and each writes it back. The second write silently overwrites the first, so one change is gone. Example: two buyers both read `stock = 5` and both write `4`. Two units were sold but only one was subtracted. It's the most common concurrency bug in web apps because the code looks correct line by line.",
		analogy:
			'Two people edit the same spreadsheet copy offline and email it back. Whoever saves last wins and the other person\'s edits disappear.',
		related: ['race-condition', 'select-for-update', 'optimistic-locking', 'atomic-update']
	},
	{
		id: 'atomic-update',
		term: 'Atomic conditional update',
		aliases: ['conditional update', 'compare-and-set update'],
		category: 'databases',
		short:
			'Do the check and the change in **one** statement so there is no gap between them: `UPDATE items SET stock = stock - 1 WHERE sku = $1 AND stock >= 1`. The database locks the row for that statement and re-checks the condition against the latest version. If zero rows changed, the check failed. This is usually the simplest, fastest fix for a lost update.',
		related: ['lost-update', 'select-for-update']
	},
	{
		id: 'optimistic-locking',
		term: 'Optimistic locking',
		aliases: ['version column', 'optimistic concurrency control'],
		category: 'databases',
		short:
			'Instead of locking while you work, you remember the row\'s `version` when you read it and write with `UPDATE … SET …, version = version + 1 WHERE id = $1 AND version = $2`. If someone changed the row in the meantime, zero rows update and you retry or show a conflict. It works well when conflicts are rare and the work between the read and the write is long, like a user editing a form.',
		related: ['lost-update', 'select-for-update']
	},
	{
		id: 'isolation-level',
		term: 'Isolation level',
		aliases: ['transaction isolation', 'read committed', 'repeatable read', 'serializable', 'snapshot isolation'],
		category: 'databases',
		short:
			"How much a transaction is protected from other transactions running at the same time. Stronger levels prevent more weird interleavings but cause more retries. Postgres defaults to **Read Committed**: each *statement* sees fresh data, so two statements in one transaction can see different things. Using a transaction does not make your read-then-write logic safe by itself.",
		related: ['lost-update', 'write-skew', 'mvcc', 'serialization-failure'],
		page: [
			{ type: 'heading', text: 'The three levels you will meet in Postgres' },
			{
				type: 'table',
				head: ['Level', 'What each statement sees', 'Typical surprise'],
				rows: [
					[
						'Read Committed (default)',
						'A fresh snapshot per statement',
						'Two `SELECT`s in one transaction return different rows. Read-then-write logic loses updates.'
					],
					[
						'Repeatable Read (snapshot isolation)',
						'One snapshot for the whole transaction',
						'Concurrent writes to the **same row** fail with a serialization error. Writes to **different rows** based on a shared read ([[write-skew]]) still go through.'
					],
					[
						'Serializable (SSI)',
						'One snapshot plus tracking of read/write dependencies',
						'Everything is safe, but any transaction may fail with SQLSTATE `40001` and **must be retried** by your code.'
					]
				]
			},
			{ type: 'heading', text: 'Anomalies and which level stops them' },
			{
				type: 'table',
				head: ['Anomaly', 'Plain-language example', 'Read Committed', 'Repeatable Read', 'Serializable'],
				rows: [
					['Dirty read', 'You see a value another transaction later rolls back', 'prevented', 'prevented', 'prevented'],
					['Non-repeatable read', 'Read the same row twice, get two values', 'possible', 'prevented', 'prevented'],
					['[[lost-update|Lost update]] (read-modify-write in app code)', 'Two buyers both write `stock = 4`', 'possible', 'prevented (one fails, retry)', 'prevented'],
					['Phantom', '`count(*)` changes because someone inserted a row', 'possible', 'prevented in Postgres', 'prevented'],
					['[[write-skew|Write skew]]', 'Two doctors both go off call because each saw the other on call', 'possible', '**possible**', 'prevented']
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'The interview point',
				text: 'Raising the isolation level is not a free fix. At Repeatable Read and Serializable you **must** catch serialization failures and retry the whole transaction. Without the retry loop you have turned a data bug into an error-rate bug.'
			},
			{ type: 'heading', text: 'Choosing a fix for read-then-write logic' },
			{
				type: 'list',
				ordered: true,
				items: [
					'Can the check and the write be one statement? Use an [[atomic-update]].',
					'Does the decision depend on rows you will also write? Lock them with [[select-for-update]].',
					'Does it depend on rows you **won\'t** write, or on rows that don\'t exist yet? Use Serializable with retries, or turn the rule into a constraint.',
					'Long user think-time between read and write? Use [[optimistic-locking]].'
				]
			}
		]
	},
	{
		id: 'serialization-failure',
		term: 'Serialization failure',
		aliases: ['40001', 'could not serialize access'],
		category: 'databases',
		short:
			"The error (SQLSTATE `40001`) a database raises at Repeatable Read or Serializable when committing your transaction would produce a result no one-at-a-time order could have produced. It isn't a bug, it's the database asking you to **retry the whole transaction from the start**. Code that runs at those levels needs a retry loop.",
		related: ['isolation-level', 'write-skew']
	},
	{
		id: 'write-skew',
		term: 'Write skew',
		category: 'databases',
		short:
			'Two transactions read the **same** set of rows, each checks a rule ("at least one doctor stays on call"), and each updates a **different** row. Neither update conflicts with the other, so snapshot isolation lets both commit, and together they break the rule. Row locks on the rows you write don\'t help, because the conflict is between one transaction\'s read and the other\'s write.',
		analogy:
			'Two parents each check that the other is home before going out. Both see the other at home, both leave, and the kid is alone.',
		related: ['isolation-level', 'serialization-failure', 'select-for-update']
	},
	{
		id: 'mvcc',
		term: 'MVCC',
		aliases: ['multi-version concurrency control', 'dead tuples'],
		category: 'databases',
		short:
			'Postgres never overwrites a row in place. An `UPDATE` writes a new version and marks the old one as dead *as of* that transaction, so readers that started earlier can keep reading the old version without locks. The cost is that old versions pile up as dead rows (tuples) until [[vacuum]] removes them, and vacuum can only remove versions that **no running transaction could still need**.',
		related: ['vacuum', 'table-bloat', 'xid-wraparound', 'idle-in-transaction']
	},
	{
		id: 'vacuum',
		term: 'VACUUM / autovacuum',
		aliases: ['autovacuum', 'vacuum'],
		category: 'databases',
		short:
			"Postgres's garbage collector. It marks space from dead row versions as reusable and \"freezes\" old rows so transaction ids can be recycled. Autovacuum runs it in the background. It can't clean anything newer than the oldest open transaction, so one forgotten transaction makes autovacuum run constantly while achieving nothing. Ordinary vacuum rarely shrinks the file (it can only trim empty pages at the very end). Reliably giving disk back takes `VACUUM FULL` or `pg_repack`.",
		related: ['mvcc', 'table-bloat', 'xid-wraparound', 'idle-in-transaction']
	},
	{
		id: 'xid-wraparound',
		term: 'Transaction ID wraparound',
		aliases: ['xid wraparound', 'datfrozenxid'],
		category: 'databases',
		short:
			"Postgres numbers transactions with a 32-bit counter (about 4 billion, used as a ±2 billion window). Old rows must be \"frozen\" by vacuum before the counter laps them, or they would suddenly look like they're from the future. If freezing falls too far behind, Postgres warns, then **refuses all writes** to protect the data until someone runs vacuum. That's a guaranteed outage, announced weeks in advance by the `age(datfrozenxid)` metric.",
		related: ['vacuum', 'idle-in-transaction', 'mvcc']
	},
	{
		id: 'expand-contract-migration',
		term: 'Expand / contract migration',
		aliases: ['parallel change', 'zero-downtime migration'],
		category: 'reliability practice',
		short:
			'A way to change a schema without downtime. During a rolling deploy, old code and new code run **at the same time** against one database, so every intermediate schema must work with both. You first *expand* (add the new thing alongside the old), migrate code and data across over several deploys, and only *contract* (remove the old thing) once nothing uses it.',
		related: ['lock-queue', 'rollback', 'create-index-concurrently'],
		page: [
			{ type: 'heading', text: 'Renaming a column, safely' },
			{
				type: 'p',
				text: 'The naive `ALTER TABLE users RENAME COLUMN name TO full_name` breaks every old pod the moment it runs, and you can\'t [[rollback|roll back]] the code because the old code expects `name`. The safe version takes several small deploys:'
			},
			{
				type: 'table',
				head: ['Step', 'Schema', 'Code', 'Safe to roll back?'],
				rows: [
					['1 · Expand', 'Add nullable `full_name`', 'unchanged', 'yes'],
					['2 · Dual write', '—', 'Write both `name` and `full_name`; read `name`', 'yes'],
					['3 · Backfill', '`UPDATE … SET full_name = name` in batches', '—', 'yes'],
					['4 · Switch reads', '—', 'Read `full_name`, still write both', 'yes'],
					['5 · Stop old writes', '—', 'Write only `full_name`', 'yes, to step 4'],
					['6 · Contract', 'Drop `name`', '—', 'only by restoring data']
				]
			},
			{
				type: 'callout',
				tone: 'info',
				title: 'The rule',
				text: 'At any moment, the running schema must be compatible with the current code **and** the previous release. Deploy order (migration first or code first) then stops mattering.'
			},
			{ type: 'heading', text: 'Other changes that need the same pattern' },
			{
				type: 'list',
				items: [
					'Changing a column type (`int` → `bigint`): add a new column, dual-write, backfill, swap.',
					'Adding `NOT NULL`: add a `CHECK (col IS NOT NULL) NOT VALID`, backfill, `VALIDATE`, then set `NOT NULL`.',
					'Splitting a table: write to both, backfill, move reads, stop writing to the old one.'
				]
			}
		]
	},
	{
		id: 'integer-overflow',
		term: 'Integer overflow (int4 ids)',
		aliases: ['int4', 'serial overflow', '2147483647'],
		category: 'databases',
		short:
			"A 32-bit signed integer tops out at 2,147,483,647. An `id serial` column, or a sequence created `AS integer`, stops handing out ids at that number and **every insert fails**. Getting there takes 50 days at 500 inserts/s. Converting a big table to `bigint` rewrites it, so this needs to be caught early. Foreign-key columns in other tables and app code that uses 32-bit ints need the same change.",
		related: ['sequence-gaps', 'expand-contract-migration']
	},
	{
		id: 'sequence-gaps',
		term: 'Sequence gaps',
		category: 'databases',
		short:
			"Database sequences hand out numbers **outside** of transactions, so a number is used up even if the transaction that took it rolls back. Sessions may also pre-allocate (cache) a batch, and a crash or failover can skip a few. That's why ids from a sequence are unique and increasing but **never guaranteed gapless**. If the law or an auditor needs consecutive invoice numbers, allocate them from a locked counter row at the moment the invoice is finalized.",
		related: ['integer-overflow', 'rollback']
	},
	{
		id: 'read-your-writes',
		term: 'Read-your-writes consistency',
		aliases: ['read your own writes', 'session consistency'],
		category: 'distributed systems',
		short:
			"The guarantee that after **you** change something, **your** next read shows the change. Reading from an async [[read-replica]] breaks it whenever the replica is behind: you save your address, the page reloads from the replica, and the old address comes back. Other users not seeing it yet is usually acceptable. The author not seeing it looks like a bug.",
		related: ['replication-lag', 'read-replica', 'eventual-consistency']
	},
	{
		id: 'failover',
		term: 'Failover',
		category: 'cloud & infra',
		short:
			"Promoting a standby database to be the new primary when the old one dies or is being patched. The database side takes seconds. The slow part is clients: they have to notice, drop their old connections and reconnect to the new primary, usually through a DNS name that now points somewhere else. Pools that keep stale connections, or DNS answers cached longer than the record's TTL, can stretch a 30-second failover into a 15-minute incident.",
		related: ['connection-storm', 'connection-pool', 'ttl']
	},
	{
		id: 'connection-storm',
		term: 'Connection storm',
		aliases: ['reconnect storm', 'thundering herd of connections'],
		category: 'latency & capacity',
		short:
			"Every client reconnects at the same instant, for example right after a [[failover]] or a deploy, and each opens its full pool at once. Opening a Postgres connection is expensive (it forks a process and authenticates), so a burst of thousands can max out CPU and `max_connections` before any real query runs. Fixes: reconnect with jittered backoff, smaller minimum pool sizes, and a pooler such as [[pgbouncer]] in front.",
		related: ['failover', 'connection-pool', 'retry-storm']
	},
	{
		id: 'dst',
		term: 'Daylight saving time (DST)',
		aliases: ['daylight saving', 'summer time', 'clock change'],
		category: 'money & time',
		short:
			"Twice a year, local wall-clock time jumps. In spring an hour is skipped (02:00 → 03:00, so 02:30 never happens). In autumn an hour repeats (02:00–02:59 happens twice). Anything scheduled or computed in **local** time near those hours can run twice, never run, or measure a \"day\" as 23 or 25 hours.",
		analogy:
			'An alarm set for 02:30 on a clock that someone jumps straight from 01:59 to 03:00 never rings. On the night they wind it back, it rings twice.',
		related: ['utc', 'iana-timezone', 'cron'],
		page: [
			{ type: 'heading', text: 'The two dangerous nights (Europe/Berlin, 2026)' },
			{
				type: 'table',
				head: ['Date', 'What the clock does', 'Local 02:30 happens…', 'Length of that day'],
				rows: [
					['Sun 29 Mar 2026', '01:59:59 CET → 03:00:00 CEST', '**never**', '23 hours'],
					['Sun 25 Oct 2026', '02:59:59 CEST → 02:00:00 CET', '**twice** (00:30 UTC and 01:30 UTC)', '25 hours']
				]
			},
			{ type: 'heading', text: 'Classic bugs' },
			{
				type: 'list',
				items: [
					'A daily job at 02:30 local is skipped in spring and runs twice in autumn, so payouts go out twice.',
					'`start + timedelta(hours=24)` is not "same time tomorrow" across a change. `start + 1 calendar day` is.',
					'Hourly buckets in a local-time report show a missing hour in March and a doubled hour in October.',
					'Storing local times without the zone. "2026-10-25 02:30 Europe/Berlin" is ambiguous unless you also store the UTC offset.'
				]
			},
			{ type: 'heading', text: 'Defences' },
			{
				type: 'list',
				ordered: true,
				items: [
					'Store and compute in [[utc]]. Convert to an [[iana-timezone]] only for display, or when a business rule is genuinely local ("send at 9 am the customer\'s time").',
					'Schedule infrastructure jobs in UTC, or keep them out of the 01:00–03:00 local window.',
					'Make jobs idempotent by **business date**: "payout run for 2026-10-25" can execute only once, however many times the scheduler fires.',
					'Test with the real dates above. A frozen clock in tests makes this cheap.'
				]
			}
		]
	},
	{
		id: 'cron',
		term: 'Cron schedule',
		aliases: ['crontab', 'scheduled job'],
		category: 'reliability practice',
		short:
			"A time-based trigger such as `30 2 * * *` (\"every day at 02:30\"). The expression says nothing about **which timezone** applies, what happens if the machine was down at that minute, or whether two copies may overlap. Each scheduler (classic cron, Kubernetes CronJob, cloud schedulers, app libraries) answers these differently, so jobs should be safe to run twice or late.",
		related: ['dst', 'idempotency']
	},
	{
		id: 'end-of-month-clamping',
		term: 'Month-end clamping',
		aliases: ['add one month', 'anchor day'],
		category: 'money & time',
		short:
			'"Jan 31 plus one month" has no right answer, because Feb 31 doesn\'t exist. Libraries disagree: Python\'s `relativedelta` and Postgres clamp to Feb 28, while JavaScript\'s `setMonth` overflows to Mar 3. For billing, store the customer\'s **anchor day** (31) and compute each renewal as `min(anchor, days in that month)` from the anchor. Never compute it from the previous renewal date, or the date drifts to the 28th forever.',
		related: ['proration', 'off-by-one', 'leap-year']
	},
	{
		id: 'double-entry-bookkeeping',
		term: 'Double-entry bookkeeping',
		aliases: ['double entry', 'ledger', 'journal entries'],
		category: 'money & time',
		short:
			'Money is never created or destroyed by an update. Each movement is recorded as at least two entries that **sum to zero**: −100 from one account, +100 to another. Balances are just the sum of an account\'s entries. Because every transfer balances, the sum of all accounts is always zero, and a non-zero total means there\'s a bug. Mistakes are fixed by adding reversing entries, never by editing old ones.',
		analogy:
			'Moving marbles between jars and writing each move in a notebook, one line for the jar it left and one for the jar it entered. Count the notebook and you can rebuild every jar.',
		related: ['minor-units', 'idempotency', 'ledger-invariant'],
		page: [
			{ type: 'heading', text: 'Why engineers like it' },
			{
				type: 'p',
				text: 'A `balance` column that you `UPDATE` can be wrong with no trace of why. A ledger of immutable entries can always be audited, replayed and checked.'
			},
			{
				type: 'table',
				head: ['Transfer', 'Account', 'Entry (cents)'],
				rows: [
					['T1 · fund Alice', 'external:bank', '−10000'],
					['T1 · fund Alice', 'alice', '+10000'],
					['T2 · Alice pays Bob', 'alice', '−2500'],
					['T2 · Alice pays Bob', 'bob', '+2500']
				],
				numeric: [2]
			},
			{
				type: 'p',
				text: "Balances: external −10000, alice 7500, bob 2500. Sum = 0. The external account is *allowed* to go negative because it stands for money outside the system. That's how money enters a closed ledger without breaking the invariant."
			},
			{ type: 'heading', text: 'Rules that keep it trustworthy' },
			{
				type: 'list',
				items: [
					'Amounts are integers in [[minor-units]]. No floats anywhere.',
					'Entries are append-only. A mistake is undone with a *reversal* transfer that references the original.',
					'Each transfer has an [[idempotency-key]], so a retried request posts once.',
					'All legs of a transfer are written in one database transaction, or none are.',
					'A scheduled job checks the [[ledger-invariant]] and alerts if it ever breaks.'
				]
			},
			{ type: 'heading', text: 'Cross-currency transfers' },
			{
				type: 'p',
				text: 'Each currency must balance on its own. Paying €90 from a USD account at 1 EUR = 1.1111 USD becomes four entries: alice −10000 USD, fx:USD +10000 USD, fx:EUR −9000 EUR, bob +9000 EUR. The FX accounts hold the business\'s currency position.'
			}
		]
	},
	{
		id: 'ledger-invariant',
		term: 'Ledger invariant',
		aliases: ['trial balance'],
		category: 'money & time',
		short:
			'The rule a ledger must always satisfy: for each currency, the sum of every entry (and therefore every balance) is exactly zero. It\'s cheap to check and catches whole classes of bugs, such as half-applied transfers, rounding leaks and double posts. Real systems run it as a scheduled reconciliation and page someone when it fails.',
		related: ['double-entry-bookkeeping']
	},
	{
		id: 'auth-and-capture',
		term: 'Authorization vs capture',
		aliases: ['authorize', 'capture', 'partial capture'],
		category: 'money & time',
		short:
			'Card payments happen in two steps. **Authorization** reserves money on the customer\'s card, and **capture** actually takes it, often days later and sometimes for a smaller amount (an item was out of stock). Refunds can only return what was captured. Code that compares against the authorized amount, or that refunds through a channel the payment provider doesn\'t control (wallet credit, bank transfer), can give back more than it took.',
		related: ['idempotency-key', 'atomic-update']
	},
	{
		id: 'tax-rounding',
		term: 'Tax rounding (per line vs per invoice)',
		aliases: ['vat rounding', 'line-level rounding'],
		category: 'money & time',
		short:
			"Tax can be rounded to the cent on each line and then summed, or computed on the invoice subtotal and rounded once. The two give different totals: 100 lines of $0.99 at 7.5% is $7.00 per line but $7.43 per invoice. Jurisdictions and accounting policies decide which is allowed. The bug is usually two services that each pick a different method, so the checkout quote and the invoice disagree.",
		related: ['bankers-rounding', 'largest-remainder', 'minor-units']
	},
	{
		id: 'token-bucket',
		term: 'Token bucket',
		category: 'latency & capacity',
		short:
			'A rate-limiting scheme: a bucket holds up to *capacity* tokens and refills at a steady *rate*. Each request spends a token, and if the bucket is empty the request is rejected or waits. It allows short bursts up to the capacity while enforcing the average rate. You only store two numbers per client (tokens, last refill time) and compute the refill lazily when a request arrives.',
		analogy: 'An arcade card that gains one credit every minute and holds at most ten.',
		related: ['sliding-window', 'injected-clock', 'retry-storm']
	},
	{
		id: 'sliding-window',
		term: 'Sliding-window rate limit',
		category: 'latency & capacity',
		short:
			'Counts requests in the last N seconds measured from *now*, instead of in fixed calendar buckets. A fixed "100 per minute" window lets a client send 100 at 12:00:59 and 100 more at 12:01:00, which is 200 in one second. A sliding window (an exact log of timestamps, or a weighted blend of two fixed windows) closes that loophole.',
		related: ['token-bucket']
	},
	{
		id: 'injected-clock',
		term: 'Injected clock',
		aliases: ['fake clock', 'clock injection'],
		category: 'reliability practice',
		short:
			'Code that needs the current time gets it from a `clock` you pass in instead of calling `now()` directly. In production it\'s the real clock, and in tests it\'s a fake you move forward by hand. That makes time-based logic (rate limits, expiry, DST, month ends) testable in milliseconds and deterministically, with no `sleep`.',
		related: ['dst', 'token-bucket']
	}
];

export default terms;
