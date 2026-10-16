import type { Assessment } from '../types';
import { timeAxis, dayAxis, shape, step, ramp, bump, window_, periodic, scaleFrom } from '../series';

// ───────────────────────── chart data ─────────────────────────

// Q1: ALTER TABLE stuck in the lock queue. 10:40 → 11:19, migration at idx 12, ALTER cancelled at idx 30.
const alterX = timeAxis('10:40', 40);
const alterP99 = shape(40, { base: 140, noise: 0.06, seed: 11 }, ramp(12, 15, 140, 30000), step(30, 150));
const alterConns = shape(40, { base: 62, noise: 0.05, seed: 12 }, ramp(12, 16, 62, 498), step(31, 70));
const alterWaiting = shape(40, { base: 0, noise: 0.03, seed: 13 }, ramp(12, 16, 0, 431), step(30, 0));
const alterCpu = shape(40, { base: 23, noise: 0.12, seed: 14 }, window_(13, 30, 8), bump(30, 32, 30));

// Q2: CREATE INDEX blocks writes, reads fine. 14:00 → 14:29, index at idx 5 for 11 min.
const idxX = timeAxis('14:00', 30);
const idxInsert = shape(30, { base: 9, noise: 0.1, seed: 21 }, window_(5, 16, 30000));
const idxSelect = shape(30, { base: 14, noise: 0.1, seed: 22 }, window_(5, 16, 19));
const idxDisk = shape(30, { base: 40, noise: 0.15, seed: 23 }, window_(5, 16, 610));
const idxErrors = shape(30, { base: 0.2, noise: 0.5, seed: 24, round: 1 }, window_(6, 16, 41));

// Q6: sequence exhausted. 09:00 → 09:44, hits max at idx 20.
const seqX = timeAxis('09:00', 45);
const seqInsertOk = shape(45, { base: 470, noise: 0.06, seed: 31 }, step(20, 0));
const seqInsertErr = shape(45, { base: 0, noise: 0.05, seed: 32 }, step(20, 468));

// Q8: replica lag spikes hourly. 08:00 → 13:55 every 5 min (72 points).
const lagX = timeAxis('08:00', 72, 5);
const lagSeconds = shape(72, { base: 0.04, noise: 0.3, seed: 41, round: 2 }, periodic(12, 2, 5.8, 0));
const lagTickets = shape(72, { base: 0, noise: 0, seed: 42 }, periodic(12, 2, 3, 0), bump(25, 26, 1));

// Q9: idle-in-transaction holding back vacuum. 21 days.
const vacX = dayAxis('Sep 20', 21);
const vacOldestXact = shape(21, { base: 0.1, noise: 0.05, seed: 51, round: 1 }, ramp(1, 20, 0.1, 19 * 24));
const vacDead = shape(21, { base: 1.2, noise: 0.08, seed: 52, round: 1 }, ramp(1, 20, 1.2, 182));
const vacSize = shape(21, { base: 41, noise: 0.01, seed: 53, round: 0 }, ramp(1, 20, 41, 168));
const vacXidAge = shape(21, { base: 160, noise: 0.01, seed: 54 }, ramp(1, 20, 160, 1460));
const vacWorkers = shape(21, { base: 0.4, noise: 0.02, seed: 55, round: 1 }, step(3, 2.95));

// Q11: failover at 03:18, stale connections for 15 min. 03:10 → 03:49.
const foX = timeAxis('03:10', 40);
const foConns = shape(40, { base: 410, noise: 0.04, seed: 61 }, step(8, 0), bump(9, 10, 2380), bump(10, 12, 1450), ramp(12, 16, 900, 430));
const foReadOnly = shape(40, { base: 0, noise: 0.08, seed: 62 }, window_(9, 24, 212), step(24, 0));
const foRefused = shape(40, { base: 0, noise: 0.1, seed: 63 }, window_(8, 10, 940));
const foOk = shape(40, { base: 1500, noise: 0.04, seed: 64 }, window_(8, 10, 40), window_(10, 24, 1050), scaleFrom(24, 1));
const foDbCpu = shape(40, { base: 31, noise: 0.08, seed: 65 }, window_(9, 12, 97), window_(12, 15, 62));

// ───────────────────────── assessment ─────────────────────────

const assessment: Assessment = {
	id: 'data-state-money',
	number: 5,
	title: 'Data, state & money',
	tagline: 'Locks, isolation levels, migrations, time zones and cents. The bugs that corrupt data quietly.',
	description:
		"Database incidents read from dashboards and `pg_stat_activity`, time and money bugs hidden in short snippets, and a 55-minute [[double-entry-bookkeeping|double-entry ledger]] coding task. The common thread: state that ends up wrong without anything crashing.",
	minutes: 115,
	difficulty: 'advanced',
	topics: ['postgres locking', 'isolation levels', 'migrations', 'replication', 'DST', 'money math', 'ledgers', 'idempotency'],
	overview: [
		{
			type: 'budget',
			items: [
				{ label: '1 · DB incidents', minutes: 30 },
				{ label: '2 · Time & money', minutes: 20 },
				{ label: '3 · Ledger code', minutes: 55 },
				{ label: 'Teasers', minutes: 10 }
			]
		},
		{
			type: 'cards',
			items: [
				{
					title: 'What graders look for',
					items: [
						'You read the **wait**, not just the work: lock waits, pool waits, replica lag.',
						'You name the anomaly precisely (lost update vs write skew) and pick the cheapest correct fix.',
						'You separate "stop the bleeding" from "fix it properly" and always mention [[data-remediation]].'
					]
				},
				{
					title: 'Habits that score',
					items: [
						'Quote the exact row or number that proves your hypothesis.',
						'Say what the *tempting* answer is and why it\'s wrong.',
						'For money: integers in [[minor-units]], one rounding policy, written down.'
					]
				}
			]
		}
	],
	parts: [
		// ═══════════════════════ PART 1 ═══════════════════════
		{
			id: 'p1',
			nav: '1 · DB incidents',
			eyebrow: 'Part 1 · 30 minutes · scenarios',
			title: 'Database incidents',
			meta: 'locks · isolation · sequences · replicas · vacuum · migrations · failover',
			minutes: 30,
			intro: [
				{
					type: 'callout',
					tone: 'info',
					title: 'First question for every DB incident',
					text: 'Is the database **busy** or **waiting**? High CPU and I/O mean it\'s doing too much work (plans, indexes, load). Low CPU with rising latency means sessions are waiting on locks, connections or I/O, so go straight to `pg_stat_activity` and look at `wait_event_type`.'
				}
			],
			questions: [
				{
					id: 'p1q1',
					title: 'A one-line migration took the whole site down',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'p',
							text: 'At 10:52 the deploy pipeline ran migration `0142_orders_add_notes.sql`. Within two minutes every page that touches orders timed out at 30 s. The on-call engineer cancelled something at 11:10 and everything recovered instantly.'
						},
						{ type: 'code', lang: 'sql', code: `-- 0142_orders_add_notes.sql\nALTER TABLE orders ADD COLUMN notes text;` },
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'orders-api · postgres-primary',
								range: '10:40 – 11:19 UTC',
								filters: ['env=prod', 'db=orders'],
								panels: [
									{
										kind: 'timeseries',
										title: 'API p99 latency',
										unit: 'ms',
										span: 3,
										log: true,
										x: alterX,
										series: [{ name: 'p99', points: alterP99, color: 0 }],
										markers: [
											{ at: 12, label: 'migrate-0142' },
											{ at: 30, label: 'pg_cancel_backend' }
										]
									},
									{
										kind: 'timeseries',
										title: 'Sessions waiting on locks',
										span: 3,
										x: alterX,
										series: [{ name: 'wait_event_type=Lock', points: alterWaiting, color: 2 }],
										markers: [{ at: 12, label: 'migrate-0142' }]
									},
									{
										kind: 'timeseries',
										title: 'Connections (primary)',
										span: 3,
										x: alterX,
										series: [{ name: 'connections', points: alterConns, color: 1 }],
										thresholds: [{ value: 500, label: 'max_connections', tone: 'crit' }]
									},
									{
										kind: 'timeseries',
										title: 'DB CPU',
										unit: '%',
										span: 3,
										yMax: 100,
										x: alterX,
										series: [{ name: 'cpu', points: alterCpu, color: 3 }]
									},
									{
										kind: 'table',
										title: 'pg_stat_activity snapshot · 10:58',
										span: 6,
										head: ['pid', 'application', 'state', 'wait_event', 'xact_age', 'blocked_by', 'query'],
										numeric: [0],
										highlight: [0, 1],
										rows: [
											['4127', 'metabase', 'active', '—', '53 min', '{}', 'SELECT c.region, sum(o.total) FROM orders o JOIN customers c …'],
											['9981', 'migrate', 'active', 'Lock: relation', '6 min', '{4127}', 'ALTER TABLE orders ADD COLUMN notes text'],
											['10012', 'orders-api', 'active', 'Lock: relation', '5 min', '{9981}', 'SELECT * FROM orders WHERE id = $1'],
											['10013', 'orders-api', 'active', 'Lock: relation', '5 min', '{9981}', 'INSERT INTO orders (customer_id, total, …) VALUES …'],
											['…', '…', '…', '…', '…', '…', '427 more rows: Lock: relation, blocked_by {9981}']
										]
									}
								]
							}
						},
						{ type: 'p', text: 'What happened, what should the on-call have cancelled, and how do you stop it happening again?' }
					],
					hints: [
						'Look at the `blocked_by` column. Who blocks whom?',
						'The API queries are only `SELECT`s and `INSERT`s. Why would they wait for anything?'
					],
					answer: [
						{
							type: 'callout',
							tone: 'warn',
							title: 'The tempting answer',
							text: '"Adding a column rewrites the whole table." That hasn\'t been true for a nullable column with no default for a long time, and since Postgres 11 a constant default is metadata-only too. The `ALTER` itself would take milliseconds. CPU *falling* to 8% also says nothing is being rewritten.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: '[[lock-queue|Lock queue]] behind a long-running report',
									body: '`ALTER TABLE` needs an `ACCESS EXCLUSIVE` lock. The 53-minute Metabase report (pid 4127) holds `ACCESS SHARE` on `orders`, so the ALTER waits. Postgres grants locks in queue order, so every later `SELECT`/`INSERT` lines up **behind the ALTER** (blocked_by `{9981}`), even though it would have been compatible with the report. Waiting sessions climb to 431, connections hit `max_connections`, and the app\'s 30 s timeout fires.',
									confirm: "`pg_blocking_pids(9981)` returns `{4127}`, and the API sessions return `{9981}`. That's exactly the [[pg-stat-activity]] snapshot."
								},
								{
									title: 'Connection exhaustion as a *consequence*',
									body: 'At 498/500 connections, new requests also fail to connect, which spreads the outage to endpoints that don\'t touch `orders`. This is the second domino, not the cause.',
									confirm: 'Errors on non-orders endpoints are "too many connections", not lock timeouts.'
								}
							]
						},
						{
							type: 'p',
							text: '**What to cancel:** the ALTER (`pg_cancel_backend(9981)`), not the report. Cancelling the head of the queue unblocks all 431 sessions instantly and loses nothing, because the migration can be retried. Killing 4127 would also work, but you\'d be guessing whether more long queries are waiting behind it.'
						},
						{
							type: 'p',
							text: '**Ruled out:** CPU, disk and a bad plan. CPU *dropped* (sessions waiting, not working), and the latency is flat at the timeout, which is a waiting signature, not a slowdown curve.'
						},
						{
							type: 'list',
							items: [
								"**Fix the migration runner:** `SET lock_timeout = '3s'` before every [[ddl]] statement, and retry with backoff. A migration that can't get its lock in 3 s fails quietly instead of taking the site down. See [[lock-timeout]].",
								'**Fix the report:** a `statement_timeout` for the BI role, and point BI at a [[read-replica]].',
								'**Guard in CI:** a migration linter that flags `ACCESS EXCLUSIVE` DDL on hot tables and requires the lock timeout.'
							]
						}
					]
				},
				{
					id: 'p1q2',
					title: 'Reads are fine, every write hangs for 11 minutes',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: 'A developer added an [[database-index|index]] to speed up a new admin page. `payments` has 400 M rows. Card payments started failing at 14:05; browsing the shop was fine the whole time.'
						},
						{
							type: 'code',
							lang: 'sql',
							code: `-- 0217_payments_customer_idx.sql (runs inside the framework's migration transaction)\nCREATE INDEX idx_payments_customer ON payments (customer_id);`
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'payments-db',
								range: '14:00 – 14:29 UTC',
								panels: [
									{
										kind: 'timeseries',
										title: 'Query latency by type (payments)',
										unit: 'ms',
										span: 4,
										log: true,
										x: idxX,
										series: [
											{ name: 'INSERT/UPDATE', points: idxInsert, color: 2 },
											{ name: 'SELECT', points: idxSelect, color: 0 }
										],
										markers: [
											{ at: 5, label: 'migrate-0217' },
											{ at: 16, label: 'index done' }
										]
									},
									{ kind: 'stat', title: 'Checkout errors / min (peak)', value: '41', tone: 'crit', span: 2, spark: idxErrors },
									{
										kind: 'timeseries',
										title: 'Disk read throughput',
										unit: ' MB/s',
										span: 6,
										x: idxX,
										series: [{ name: 'read', points: idxDisk, color: 1 }]
									}
								]
							}
						},
						{
							type: 'p',
							text: "Afterwards the developer changed the migration to `CREATE INDEX CONCURRENTLY` and the pipeline failed with: `ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block`. Explain both."
						}
					],
					answer: [
						{
							type: 'p',
							text: "**Plain `CREATE INDEX` takes a `SHARE` lock**, which allows reads but blocks `INSERT`, `UPDATE` and `DELETE` for the entire build. Scanning and sorting 400 M rows took 11 minutes (see disk reads at 600 MB/s), so every payment write queued and timed out. That's exactly the split in the latency panel: writes at the 30 s ceiling, reads barely moved."
						},
						{
							type: 'p',
							text: "**[[create-index-concurrently]]** builds the index without blocking writes, but it needs to wait for and commit between internal phases, so it can't run inside a transaction. Most migration frameworks wrap each file in `BEGIN … COMMIT` by default."
						},
						{
							type: 'list',
							items: [
								'Mark that migration as non-transactional (e.g. `disable_ddl_transaction!` in Rails, `atomic = False` in Django, a `-- +goose NO TRANSACTION` directive).',
								"`CONCURRENTLY` can fail halfway (e.g. a duplicate key on a unique index) and leave an **INVALID** index that still slows down writes. Check `pg_index.indisvalid`, drop it and retry.",
								'Still set a [[lock-timeout]]. Even `CONCURRENTLY` needs a brief lock at the start and waits for older transactions to finish.',
								'Remediation: list checkout attempts that failed between 14:05 and 14:16 and decide with the payments team whether to email those customers.'
							]
						}
					]
				},
				{
					id: 'p1q3',
					title: 'Deadlocks only at month-end settlement',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `def transfer(conn, from_id, to_id, amount):
    with conn.transaction():
        src = conn.execute(
            "SELECT balance FROM accounts WHERE id = %s FOR UPDATE", [from_id]).one()
        conn.execute(
            "SELECT 1 FROM accounts WHERE id = %s FOR UPDATE", [to_id])
        if src.balance < amount:
            raise InsufficientFunds()
        conn.execute("UPDATE accounts SET balance = balance - %s WHERE id = %s", [amount, from_id])
        conn.execute("UPDATE accounts SET balance = balance + %s WHERE id = %s", [amount, to_id])`
						},
						{
							type: 'logs',
							logs: {
								style: 'terminal',
								title: 'postgres.log · last day of the month',
								lines: [
									{ ts: '23:00:04.118', level: 'ERROR', source: 'postgres', msg: 'deadlock detected' },
									{
										ts: '23:00:04.118',
										level: 'INFO',
										source: 'postgres',
										msg: 'DETAIL: Process 812 waits for ShareLock on transaction 99120; blocked by process 815. Process 815 waits for ShareLock on transaction 99118; blocked by process 812.'
									},
									{ ts: '23:00:04.118', level: 'INFO', source: 'postgres', msg: 'CONTEXT: SELECT 1 FROM accounts WHERE id = 7 FOR UPDATE' },
									{ ts: '23:00:04.120', level: 'ERROR', source: 'settlement', msg: 'transfer failed', fields: { from: 'merchant:331', to: 'platform:fees', sqlstate: '40P01' } },
									{ ts: '23:00:04.121', level: 'INFO', source: 'settlement', msg: 'transfer ok', fields: { from: 'platform:fees', to: 'merchant:331', kind: 'fee_rebate' } }
								]
							}
						},
						{ type: 'p', text: '[[settlement]] runs fee collection (merchant → platform) and fee rebates (platform → merchant) in parallel workers. Why only at month-end, and what is the fix? Someone suggests raising `deadlock_timeout`.' }
					],
					answer: [
						{
							type: 'p',
							text: '**Inconsistent lock order.** The function locks `from_id` first, then `to_id`. A fee collection (331 → fees) and a rebate (fees → 331) running at the same moment each grab their first row and wait forever for the other\'s. Month-end is the only time both directions run concurrently for the same pairs, and the platform fee account is a single [[hot-account|hot row]] involved in almost every transfer.'
						},
						{
							type: 'list',
							items: [
								'**Fix:** [[lock-ordering|lock in a global order]]: `for id in sorted([from_id, to_id]): SELECT … FOR UPDATE`. A cycle becomes impossible.',
								'**Also:** retry the whole transaction on [[serialization-failure|SQLSTATE]] `40P01` with jittered backoff. [[deadlock|Deadlocks]] are rare after the fix but not impossible elsewhere.',
								"**Hot row:** the fee account is a contention point even without deadlocks. Consider posting fees to per-merchant sub-accounts and sweeping in batches.",
								'**Red herring:** raising `deadlock_timeout` only makes Postgres wait *longer* before detecting the cycle. It never resolves one.'
							]
						},
						{
							type: 'p',
							text: "**Remediation:** the failed transfers raised errors. Check whether the settlement job retried them or silently skipped them, because a skipped fee is lost revenue that won't show up anywhere."
						}
					]
				},
				{
					id: 'p1q4',
					title: '100 units in stock, 137 orders confirmed',
					tag: 'core',
					minutes: 4,
					prompt: [
						{ type: 'p', text: 'Flash sale. The warehouse had 100 units. 137 orders were confirmed, and the admin page *still* shows 12 in stock.' },
						{
							type: 'code',
							lang: 'python',
							code: `@app.post("/orders")
def place_order(sku: str, qty: int):
    item = db.fetchone("SELECT stock FROM items WHERE sku = %s", [sku])
    if item.stock < qty:
        raise HTTPException(409, "out of stock")
    db.execute("UPDATE items SET stock = %s WHERE sku = %s", [item.stock - qty, sku])
    db.execute("INSERT INTO orders (sku, qty) VALUES (%s, %s)", [sku, qty])
    db.commit()`
						}
					],
					answer: [
						{
							type: 'p',
							text: "**[[lost-update|Lost update]].** Many requests read `stock = 40` at the same moment, each writes `39`, and decrements disappear. That explains both symptoms: oversold (137 orders), *and* stock never reaching zero (12 left) because many decrements were overwritten. The default Read Committed [[isolation-level]] doesn't prevent this."
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Best fix: one [[atomic-update]]',
									body: '`UPDATE items SET stock = stock - %s WHERE sku = %s AND stock >= %s RETURNING stock`. Zero rows means out of stock. No gap between check and write, one round-trip, no extra locks held.'
								},
								{
									title: 'Alternative: `SELECT … FOR UPDATE` in the same transaction',
									body: 'Correct, but holds the row lock for the whole request, so the flash-sale hot row serializes all orders. Fine for low contention. See [[select-for-update]].'
								},
								{
									title: 'Alternative: [[optimistic-locking]] with a version column',
									body: 'Works, but under a flash sale most attempts conflict and retry. That\'s wasteful at the exact moment load peaks.'
								}
							]
						},
						{
							type: 'list',
							items: [
								'Backstop: `CHECK (stock >= 0)`, so a future bug errors instead of overselling.',
								"Nuance: Repeatable Read in Postgres *would* detect this (the second writer gets a [[serialization-failure]]), but only if you also add a retry loop. Bumping the isolation level alone just turns [[oversell|oversells]] into 500s.",
								'[[data-remediation|Remediation]]: reconcile orders against physical stock, decide which 37 orders to cancel (usually last-confirmed first), contact those customers, and correct the `stock` value from the warehouse count.'
							]
						}
					]
				},
				{
					id: 'p1q5',
					title: "Nobody is on call, but we use transactions",
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'p',
							text: 'A hospital scheduling app must always have at least one doctor on call per shift. Two doctors clicked "go off call" within the same second. Both succeeded. The team insists this can\'t happen: "it\'s in a [[isolation-level|Repeatable Read]] transaction."'
						},
						{
							type: 'code',
							lang: 'sql',
							code: `BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT count(*) FROM shift_assignments
 WHERE shift_id = 42 AND on_call;            -- both see 2
-- app: if count < 2 → reject
UPDATE shift_assignments SET on_call = false
 WHERE shift_id = 42 AND doctor_id = :me;     -- different rows
COMMIT;`
						}
					],
					answer: [
						{
							type: 'p',
							text: "**[[write-skew|Write skew]].** Each transaction reads the same two rows, sees 2 on call, and updates **its own** row. Repeatable Read (snapshot isolation) only stops two transactions that write the *same* row. Here the writes don't overlap, so both commit and the invariant breaks. It's the textbook anomaly that snapshot isolation allows."
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Lock the rows the decision depends on',
									body: '`SELECT … FROM shift_assignments WHERE shift_id = 42 AND on_call FOR UPDATE`. The second transaction blocks until the first commits, then re-reads and sees 1. Simple and works at Read Committed.'
								},
								{
									title: 'Run at `SERIALIZABLE` with a retry loop',
									body: "Postgres's [[serializable-snapshot-isolation|SSI]] detects the read/write dependency cycle and aborts one with `40001`. It's general, and protects rules you haven't thought of, but every caller needs a retry wrapper. See [[serialization-failure]]."
								},
								{
									title: 'Materialize the rule',
									body: 'Keep `shifts.on_call_count` and decrement it atomically with `CHECK (on_call_count >= 1)`. Now the conflict is a write to one row, which any level catches.'
								}
							]
						},
						{
							type: 'callout',
							tone: 'info',
							title: 'Variant to mention',
							text: '**Phantoms:** "no two bookings may overlap" can\'t be fixed with `FOR UPDATE`, because the conflicting row doesn\'t exist yet and there\'s nothing to lock. Use an [[exclusion-constraint|exclusion constraint]] (`EXCLUDE USING gist (room WITH =, during WITH &&)`) or Serializable.'
						}
					]
				},
				{
					id: 'p1q6',
					title: '"We already migrated ids to bigint", yet every insert fails',
					tag: 'tricky',
					minutes: 4,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'events-ingest',
								range: '09:00 – 09:44 UTC',
								panels: [
									{
										kind: 'timeseries',
										title: 'Inserts into events',
										unit: '/s',
										span: 4,
										stacked: true,
										area: true,
										x: seqX,
										series: [
											{ name: 'ok', points: seqInsertOk, color: 0 },
											{ name: 'error', points: seqInsertErr, color: 2 }
										]
									},
									{ kind: 'stat', title: 'events.id column type', value: 'bigint', span: 1, tone: 'ok' },
									{ kind: 'stat', title: 'last id issued', value: '2,147,483,647', span: 1, tone: 'crit' }
								]
							}
						},
						{
							type: 'logs',
							logs: {
								style: 'terminal',
								lines: [
									{ ts: '09:20:00.004', level: 'ERROR', source: 'ingest', msg: 'nextval: reached maximum value of sequence "events_id_seq" (2147483647)', fields: { sqlstate: '2200H' } },
									{ ts: '09:20:00.005', level: 'ERROR', source: 'ingest', msg: 'nextval: reached maximum value of sequence "events_id_seq" (2147483647)' }
								]
							}
						},
						{ type: 'p', text: 'Last year someone ran `ALTER TABLE events ALTER COLUMN id TYPE bigint`. What did they miss, how do you get inserts flowing in the next 5 minutes, and what else is about to break?' }
					],
					answer: [
						{
							type: 'p',
							text: "**The sequence, not the column, hit the limit.** `id serial` creates `events_id_seq AS integer` with `MAXVALUE 2147483647`. Changing the column type doesn't change the sequence. See [[integer-overflow]]."
						},
						{
							type: 'list',
							items: [
								'**Mitigate now (seconds, no rewrite):** `ALTER SEQUENCE events_id_seq AS bigint MAXVALUE 9223372036854775807;`. Inserts resume immediately.',
								'**Next to break:** every foreign key that stores this id (`event_attachments.event_id int`) overflows on the first new event that has children. Find them with `information_schema.columns` where the type is `integer` and the name looks like `*event_id`.',
								'**Outside the database:** Java/Go/protobuf `int32` fields, a JSON schema with `"format": "int32"`, and analytics tables. JavaScript is safe up to 2^53.',
								'**Fixing FK columns on big tables** rewrites them, so use [[expand-contract-migration|expand/contract]]: add `event_id_new bigint`, dual-write, backfill in batches, swap.',
								'**Prevent:** a check that alerts when any sequence passes 50% of its type\'s max (`pg_sequences.last_value / max_value`). At 470 inserts/s, int4 lasts about 53 days from zero, so that alert gives you weeks of warning.'
							]
						},
						{
							type: 'callout',
							tone: 'warn',
							title: "Don't",
							text: "Don't \"buy time\" by restarting the sequence at −2,147,483,648. It works, but every query or report that assumes ids are positive and increasing (`ORDER BY id`, [[keyset-pagination|keyset pagination]], \"latest event\") silently breaks."
						}
					]
				},
				{
					id: 'p1q7',
					title: 'Finance: "three invoices are missing"',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'Priya Nair',
								role: 'Finance · Controller',
								subject: 'Gaps in invoice numbering',
								time: 'Tue 10:14',
								body: "Hi team,\n\nOur auditor noticed invoice numbers go INV-10432, then INV-10436. Were three invoices deleted? We are legally required to have consecutive numbering in two of our EU entities, so I need an explanation in writing this week.\n\nThanks,\nPriya"
							}
						},
						{ type: 'code', lang: 'sql', code: `invoice_number bigint NOT NULL DEFAULT nextval('invoice_number_seq')` }
					],
					answer: [
						{
							type: 'p',
							text: '**[[sequence-gaps|Sequences are not transactional.]]** `nextval` is consumed even if the transaction rolls back (failed tax validation, payment declined after the row was inserted). Sequence caching and a crash or [[failover]] can also skip values. Nothing was deleted: the numbers were never used.'
						},
						{
							type: 'list',
							items: [
								'**Confirm:** application logs show rolled-back invoice creations at the times of 10433–10435, and the audit log shows no `DELETE` on `invoices`.',
								"**Fix (where gapless is required):** assign the number when the invoice is *finalized*, inside the same transaction, from a counter row: `UPDATE invoice_series SET next = next + 1 WHERE series = 'DE' RETURNING next - 1`. The row lock serializes finalizations per series, which is fine at invoice volumes. Drafts get internal ids only.",
								"**Don't** use `SELECT max(invoice_number) + 1`. Concurrent requests read the same max and produce duplicates."
							]
						},
						{
							type: 'code',
							lang: 'text',
							caption: 'Model reply to Finance',
							code: `Hi Priya,

No invoices were deleted. Our system reserves an invoice number when it starts
creating an invoice. If creation fails partway (for example the payment is
declined), that number is thrown away rather than reused. That is what
happened to 10433–10435; I've attached the log entries for each one.

For the two EU entities we'll change how numbers are assigned so they are only
given out once an invoice is final, which guarantees no gaps from now on.
That change ships next week, and I'll send a one-page note your auditor can keep.`
						}
					]
				},
				{
					id: 'p1q8',
					title: '"I saved my address and it reverted"',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: 'Support gets bursts of complaints: users save their profile, the page reloads with the old values, and a refresh a few seconds later shows the new ones. The API writes to the primary and reads from a [[read-replica]].'
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'profile-service',
								range: '08:00 – 14:00 UTC',
								panels: [
									{
										kind: 'timeseries',
										title: 'Replica replay lag',
										unit: ' s',
										span: 4,
										x: lagX,
										series: [{ name: 'replica-1', points: lagSeconds, color: 1 }],
										markers: [
											{ at: 0, label: 'etl' },
											{ at: 12, label: 'etl' },
											{ at: 24, label: 'etl' },
											{ at: 36, label: 'etl' },
											{ at: 48, label: 'etl' },
											{ at: 60, label: 'etl' }
										]
									},
									{
										kind: 'bars',
										title: '"Changes not saved" tickets',
										span: 2,
										x: lagX,
										series: [{ name: 'tickets', points: lagTickets, color: 2 }]
									},
									{ kind: 'stat', title: 'Profile cache', value: 'none', span: 2, subtitle: 'reads go straight to the replica' },
									{ kind: 'stat', title: 'Lag p50', value: '0.04 s', span: 2, tone: 'ok' },
									{ kind: 'stat', title: 'Lag max', value: '6.1 s', span: 2, tone: 'warn' }
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: "**Broken [[read-your-writes]].** Normally the replica is 40 ms behind, which is shorter than a page reload. Every hour an [[etl]] job runs one huge `UPDATE`, [[replication-lag|replay lag]] jumps to about 6 s, and any user who saves during that window reads their old row back. The tickets line up exactly with the lag spikes."
						},
						{
							type: 'list',
							items: [
								'**Red herring:** "it\'s a caching bug". The service has no cache, and caching wouldn\'t follow the ETL schedule.',
								'**Mitigate:** route reads that follow a write by the same user to the primary for a few seconds (a short-lived cookie or session flag).',
								'**Fix properly:** after a write, store the primary\'s [[write-ahead-log|WAL]] position (`pg_current_wal_lsn()`) in the session. Read from the replica only if `pg_last_wal_replay_lsn() >= that position`, otherwise use the primary. That\'s exact, not a guess.',
								'**Fix the cause of the lag:** batch the ETL into small transactions (e.g. 5k rows), or run it against a separate replica.',
								'Return the updated object in the `PUT` response, so the UI doesn\'t need to read it back at all.'
							]
						}
					]
				},
				{
					id: 'p1q9',
					title: 'Disk keeps growing and autovacuum never stops',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'p',
							text: 'Over three weeks the `orders` table grew from 41 GB to 168 GB with no change in traffic, queries got steadily slower, and this morning the logs started saying `WARNING: database "shop" must be vacuumed within 687,000,000 transactions`.'
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'postgres-primary · maintenance',
								range: 'Sep 20 – Oct 10',
								panels: [
									{
										kind: 'timeseries',
										title: 'Oldest open transaction age',
										unit: ' h',
										span: 3,
										x: vacX,
										series: [{ name: 'max(now() - xact_start)', points: vacOldestXact, color: 2 }]
									},
									{
										kind: 'timeseries',
										title: 'Dead tuples · orders',
										unit: ' M',
										span: 3,
										x: vacX,
										series: [{ name: 'n_dead_tup', points: vacDead, color: 1 }]
									},
									{
										kind: 'timeseries',
										title: 'Table size · orders',
										unit: ' GB',
										span: 2,
										x: vacX,
										series: [{ name: 'size', points: vacSize, color: 0 }]
									},
									{
										kind: 'timeseries',
										title: 'age(datfrozenxid)',
										unit: ' M',
										span: 2,
										x: vacX,
										series: [{ name: 'xid age', points: vacXidAge, color: 3 }],
										thresholds: [
											{ value: 200, label: 'autovacuum_freeze_max_age', tone: 'warn' },
											{ value: 2000, label: 'writes stop ~2,100', tone: 'crit' }
										]
									},
									{
										kind: 'timeseries',
										title: 'Autovacuum workers busy',
										span: 2,
										yMax: 3,
										x: vacX,
										series: [{ name: 'workers', points: vacWorkers, color: 4 }]
									},
									{
										kind: 'table',
										title: 'pg_stat_activity · oldest sessions',
										span: 6,
										head: ['pid', 'application', 'client', 'state', 'xact_start', 'query'],
										highlight: [0],
										rows: [
											['3310', 'psql', '10.2.4.17 (bastion)', 'idle in transaction', 'Sep 21 09:14', 'SELECT * FROM feature_flags WHERE name = \'checkout_v2\''],
											['8812', 'orders-api', '10.4.0.31', 'idle', '—', 'COMMIT'],
											['8840', 'autovacuum', '—', 'active', 'Oct 10 07:58', 'autovacuum: VACUUM public.orders']
										]
									}
								]
							}
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'A forgotten [[idle-in-transaction]] session (pid 3310) is pinning the vacuum horizon',
									body: "Someone opened `psql` on the bastion on Sep 21, typed a `SELECT` inside a transaction and walked away. Under [[mvcc]], [[vacuum]] can't remove any row version newer than the oldest open snapshot, so every update since Sep 21 left a dead row behind. Dead tuples and size grow linearly, and the oldest-transaction panel rises at exactly wall-clock speed (24 h per day), which is the signature of a session that is doing nothing.",
									confirm: '`SELECT backend_xmin, xact_start FROM pg_stat_activity WHERE pid = 3310`. Its `backend_xmin` equals the cluster\'s oldest xmin.'
								},
								{
									title: 'An abandoned [[replication-slot|replication slot]]',
									body: 'A slot for a decommissioned replica or [[change-data-capture|CDC]] connector also holds back the horizon (and WAL). Same symptoms.',
									confirm: '`SELECT slot_name, active, xmin, catalog_xmin FROM pg_replication_slots`'
								},
								{
									title: 'An orphaned [[prepared-transaction|prepared (two-phase) transaction]]',
									body: 'These survive restarts and are easy to miss.',
									confirm: '`SELECT * FROM pg_prepared_xacts`'
								}
							]
						},
						{
							type: 'p',
							text: '**Red herring:** "autovacuum is running, so maintenance is fine". It\'s running constantly *because* it can\'t make progress: it scans 168 GB and is allowed to remove nothing.'
						},
						{
							type: 'p',
							text: "**Why the warning matters:** [[xid-wraparound]]. Freezing can't advance past pid 3310's snapshot either. If `age(datfrozenxid)` reaches about 2.1 billion, Postgres stops accepting writes until a manual vacuum completes, and that can take hours on a [[table-bloat|bloated table]]."
						},
						{
							type: 'list',
							items: [
								'**Mitigate now:** `SELECT pg_terminate_backend(3310);`, then watch autovacuum shrink `n_dead_tup` and xid age. If it\'s urgent, run a manual `VACUUM (FREEZE, VERBOSE) orders`.',
								"**Disk won't shrink by itself.** Normal vacuum only makes the space reusable inside the file. To give 120 GB back, use `pg_repack` online. `VACUUM FULL` would lock the table.",
								"**Prevent:** `idle_in_transaction_session_timeout = '15min'` for human roles, alerts on oldest-transaction age (> 1 h) and `age(datfrozenxid)` (> 500 M), and read-only humans connected to a replica."
							]
						}
					]
				},
				{
					id: 'p1q10',
					title: 'Rolling deploy, rename migration, and a rollback that made it worse',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'code',
							lang: 'sql',
							code: `-- runs as a pre-deploy step\nALTER TABLE users RENAME COLUMN name TO full_name;`
						},
						{
							type: 'list',
							items: [
								'The migration ran at 16:00. For the next 6 minutes of the [[rolling-update|rolling deploy]], about half of requests failed with `column "name" does not exist`.',
								'On-call hit "rollback" on the app. The *new* pods were replaced by old ones, and now **100%** of requests failed.'
							]
						}
					],
					answer: [
						{
							type: 'p',
							text: "During a rolling deploy, old and new code run side by side against the **same** schema. The rename made the schema incompatible with the old code the instant it ran. Rolling the app back made things worse, because the database wasn't rolled back with it: every pod was now old code against a renamed column."
						},
						{
							type: 'p',
							text: 'Mitigate: rename it back (`RENAME COLUMN full_name TO name`). That\'s a fast metadata change, guarded by a [[lock-timeout]]. Then redo the change as an [[expand-contract-migration]]: add `full_name`, [[dual-write|dual-write]], backfill, switch reads, stop writing `name`, and drop it in a later release.'
						},
						{
							type: 'callout',
							tone: 'info',
							title: 'The general rule to state',
							text: 'Every migration must be compatible with **both** the currently deployed release and the next one. Code rollback is only safe if the schema still supports the old code.'
						}
					]
				},
				{
					id: 'p1q11',
					title: 'Failover finished in 40 seconds; errors lasted 15 minutes',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'p',
							text: 'At 03:18 the managed database cluster failed over during a maintenance window: the reader was promoted to writer, and the old writer came back as a reader. The provider reports [[failover|failover]] complete at 03:18:40. The app runs 60 pods, each with a pool of `min 20 / max 40` connections to the cluster endpoint, `maxLifetime = 15 min`.'
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'checkout · db failover',
								range: '03:10 – 03:49 UTC',
								panels: [
									{
										kind: 'timeseries',
										title: 'DB errors by SQLSTATE',
										unit: '/s',
										span: 3,
										x: foX,
										series: [
											{ name: '25006 read_only_sql_transaction', points: foReadOnly, color: 2 },
											{ name: '08006 connection_failure', points: foRefused, color: 1 }
										],
										markers: [{ at: 8, label: 'failover' }]
									},
									{
										kind: 'timeseries',
										title: 'Successful queries',
										unit: '/s',
										span: 3,
										x: foX,
										series: [{ name: 'ok', points: foOk, color: 0 }],
										markers: [{ at: 8, label: 'failover' }]
									},
									{
										kind: 'timeseries',
										title: 'Connections on new writer',
										span: 3,
										x: foX,
										series: [{ name: 'connections', points: foConns, color: 3 }],
										thresholds: [{ value: 2000, label: 'max_connections', tone: 'crit' }]
									},
									{
										kind: 'timeseries',
										title: 'New writer CPU',
										unit: '%',
										span: 3,
										yMax: 100,
										x: foX,
										series: [{ name: 'cpu', points: foDbCpu, color: 4 }]
									}
								]
							}
						},
						{ type: 'p', text: 'Explain both error series and the connection spike. What do you change?' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Pooled connections still pointing at the old writer (`25006`, 03:19–03:34)',
									body: "Connections opened before the failover [[dns-caching|resolved the cluster DNS name]] to the old writer's IP. That instance came back as a **reader** and accepted the connections, so [[connection-pool|pool]] health checks (`SELECT 1`) passed, while every `INSERT` failed with `cannot execute INSERT in a read-only transaction`. Those connections only went away when `maxLifetime` (15 min) recycled them, which matches the 15-minute error band almost exactly. A JVM or OS DNS cache that ignores the record's TTL makes this worse.",
									confirm: '`SELECT inet_server_addr(), pg_is_in_recovery()` from a pod during the window returns the old IP and `true`.'
								},
								{
									title: '[[connection-storm|Connection storm]] at 03:19 (`08006` and the 2,380 spike)',
									body: 'Every connection to the old writer was cut at once. 60 pods × min 20 reconnected immediately, plus app retries. That\'s more than 2,000 connection attempts in seconds, each a forked backend doing authentication. CPU on the new writer hits 97% before it serves real traffic.'
								}
							]
						},
						{
							type: 'list',
							items: [
								'**Mitigate in the moment:** a rolling restart of pods flushes the stale pool. 5 minutes instead of 15.',
								'**Evict on the error:** treat SQLSTATE `25006` (and `57P01` admin shutdown) as fatal for the *connection*, so the pool discards it and reconnects.',
								'**Validate role, not liveness:** the checkout pool\'s validation query should check `NOT pg_is_in_recovery()`.',
								'**DNS:** respect the record TTL (for the JVM, `networkaddress.cache.ttl=5`), or use the provider\'s smart driver or proxy that tracks the writer.',
								'**Storm:** jittered exponential backoff on reconnect, `min` pool size 2–5 instead of 20, and a pooler or managed proxy so clients don\'t each hold backend connections. See [[pgbouncer]].'
							]
						},
						{
							type: 'p',
							text: '**Remediation:** 15 minutes of failed checkouts at 03:19–03:34. Check whether clients retried. Card payments with an [[idempotency-key]] can be safely re-driven.'
						}
					]
				}
			]
		},

		// ═══════════════════════ PART 2 ═══════════════════════
		{
			id: 'p2',
			nav: '2 · Time & money',
			eyebrow: 'Part 2 · 20 minutes · read the snippet',
			title: 'Time and money bugs',
			meta: 'DST · month ends · floats · FX · tax · refunds · balances',
			minutes: 20,
			intro: [
				{
					type: 'cards',
					items: [
						{
							title: 'Money checklist',
							items: [
								'Integers in [[minor-units]] end to end.',
								'Round **once**, with a named mode, at a named step.',
								'Store the inputs you rounded from (rate, tax %, timestamp).',
								'Every movement is a ledger entry with an [[idempotency-key]].'
							]
						},
						{
							title: 'Time checklist',
							items: [
								'Store [[utc]] instants; keep the [[iana-timezone]] separately.',
								'"Day", "month" and "hour" are *calendar* concepts, not fixed durations.',
								'Schedulers fire twice, late or never. Jobs must be idempotent by business date.',
								'Inject the clock so tests can visit Feb 29 and DST nights.'
							]
						}
					]
				}
			],
			questions: [
				{
					id: 'p2q1',
					title: 'Payouts went out twice on one Sunday in October',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `# scheduler.py (in-app scheduler, evaluates every minute in local time)
TZ = ZoneInfo("Europe/Berlin")

@every_day(at="02:30", tz=TZ)
def run_payouts():
    for merchant in merchants_with_balance():
        send_payout(merchant, merchant.available_balance)`
						},
						{
							type: 'logs',
							logs: {
								style: 'terminal',
								title: 'payout-worker',
								lines: [
									{ ts: '2026-03-28T01:30:00Z', level: 'INFO', msg: 'run_payouts started', fields: { local: '02:30 CET' } },
									{ ts: '2026-03-30T00:30:00Z', level: 'INFO', msg: 'run_payouts started', fields: { local: '02:30 CEST' } },
									{ ts: '2026-10-25T00:30:00Z', level: 'INFO', msg: 'run_payouts started', fields: { local: '02:30 CEST' } },
									{ ts: '2026-10-25T01:30:00Z', level: 'INFO', msg: 'run_payouts started', fields: { local: '02:30 CET' } }
								]
							}
						},
						{ type: 'p', text: 'Explain the missing run in March and the double run in October. Why did the second October run send money at all, if balances were already paid out?' }
					],
					answer: [
						{
							type: 'p',
							text: "**[[dst|Daylight saving time]].** On 29 Mar the clocks jump from 02:00 to 03:00, so local 02:30 never exists and the job doesn't run. On 25 Oct 02:00–02:59 happens twice (CEST, then CET), and the [[duplicate-scheduler|scheduler]] matches 02:30 both times. Not every scheduler behaves like this (classic Vixie [[cron|cron]] has special DST handling), which is exactly why you shouldn't depend on it."
						},
						{
							type: 'p',
							text: "**Why the second run paid again:** probably the [[available-balance|available balance]] (`available_balance`) hadn't been reduced yet. Payouts were \"in flight\" with the provider and are only deducted when the settlement [[webhook|webhook]] arrives. The job has no notion of \"I already ran for this date\"."
						},
						{
							type: 'list',
							items: [
								'**Fix the trigger:** schedule in UTC (`00:30 UTC`), or move it out of the 01:00–03:00 local window.',
								'**Fix the job (the real fix):** make it idempotent by **business date**. Insert `payout_runs(business_date)` with a unique constraint, and each payout gets an [[idempotency-key]] `payout:{merchant}:{business_date}` sent to the provider.',
								'**Fix the balance:** reserve the payout amount (a pending ledger entry) *before* calling the provider.',
								'**[[data-remediation|Remediation]]:** list merchants with two payouts on 25 Oct and claw back or net the second against the next payout, with a message to each merchant first.',
								'**Test:** an [[injected-clock]] test that walks through both 2026 transition nights minute by minute.'
							]
						}
					]
				},
				{
					id: 'p2q2',
					title: 'Customers who joined on the 31st get billed on the 3rd',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'code',
							lang: 'typescript',
							code: `function nextRenewal(current: Date): Date {
  const next = new Date(current);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}
// stored after each charge: sub.renewsOn = nextRenewal(sub.renewsOn)`
						},
						{ type: 'p', text: 'A customer signed up on 2026-01-31. Trace their next four renewal dates. Then a teammate "fixes" it by clamping to the last day of the month. Trace again. What\'s still wrong?' }
					],
					answer: [
						{
							type: 'table',
							head: ['Charge', 'Original code', 'Clamp from previous date', 'Clamp from anchor (correct)'],
							rows: [
								['1', '2026-03-03', '2026-02-28', '2026-02-28'],
								['2', '2026-04-03', '2026-03-28', '2026-03-31'],
								['3', '2026-05-03', '2026-04-28', '2026-04-30'],
								['4', '2026-06-03', '2026-05-28', '2026-05-31']
							]
						},
						{
							type: 'p',
							text: "`setUTCMonth` overflows: \"Feb 31\" becomes Mar 3, and from then on the customer is on the 3rd forever, which skips February entirely. Clamping fixes February but, computed from the *previous* renewal, drifts the customer to the 28th permanently. See [[end-of-month-clamping]]."
						},
						{
							type: 'code',
							lang: 'typescript',
							code: `// Store the anchor day once (31) and derive every renewal from it.
function renewalDate(anchorDay: number, year: number, month0: number): Date {
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month0, Math.min(anchorDay, daysInMonth)));
}`
						},
						{ type: 'p', text: 'Also check: [[proration]] for the short February period, and that customers already shifted to the 3rd get a one-off correction rather than a surprise double charge.' }
					]
				},
				{
					id: 'p2q3',
					title: 'The daily total is off by one cent against the bank',
					tag: 'core',
					minutes: 2,
					prompt: [
						{
							type: 'code',
							lang: 'typescript',
							code: `// amounts arrive from the API as strings: "19.99", "0.10", …
const total = payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
report.total = total.toFixed(2);      // "1204331.17"?  exported CSV shows 1204331.1700000002
report.fee = (total * 0.029).toFixed(2);`
						}
					],
					answer: [
						{
							type: 'p',
							text: "**[[floating-point|Binary floating point]].** `0.10` has no exact binary representation, so summing thousands of them accumulates error. `toFixed` hides it in one place, and the raw value leaks into the CSV in another. `toFixed` also rounds the *binary* value: `(1.005).toFixed(2)` is `\"1.00\"`, and `(0.125 * 3).toFixed(2)` depends on the representation. Those are the one-cent differences."
						},
						{
							type: 'list',
							items: [
								"Parse strings straight to integer cents without going through float: split on `.`, pad to 2 digits, `BigInt` if totals can pass 2^53.",
								'Sum integers. Compute the fee as `(total_cents × 29 + 500) / 1000` with explicit [[bankers-rounding|half-up]] integer rounding, or use a decimal library.',
								'Format only at the edge: `(cents / 100n) + "." + pad(cents % 100n)`.',
								'Add a [[reconciliation|reconciliation]] test: the sum of exported rows equals the sum from the database, to the cent.'
							]
						}
					]
				},
				{
					id: 'p2q4',
					title: "The EUR invoice's lines don't add up to its total",
					tag: 'tricky',
					minutes: 3,
					prompt: [
						{ type: 'p', text: 'Prices are in USD. EU customers see invoices in EUR at the rate of the day, 1 USD = 0.9137 EUR.' },
						{
							type: 'code',
							lang: 'python',
							code: `lines_eur = [round_half_up(l.usd * rate, 2) for l in invoice.lines]   # shown on the PDF
total_eur = round_half_up(invoice.total_usd * rate, 2)              # charged
rate = fx.get_rate("USD", "EUR", at=datetime.now())                 # fetched when the PDF renders`
						},
						{ type: 'p', text: 'Lines: $19.99, $4.99, $0.99. Compute what the customer sees. Then explain why the same invoice downloaded next week shows different numbers.' }
					],
					answer: [
						{
							type: 'table',
							head: ['Line', 'USD', '× 0.9137', 'Rounded EUR'],
							numeric: [1, 2, 3],
							rows: [
								['Plan', '19.99', '18.264863', '18.26'],
								['Add-on', '4.99', '4.559363', '4.56'],
								['Fee', '0.99', '0.904563', '0.90'],
								['**Sum of lines**', '25.97', '', '**23.72**'],
								['**Converted total**', '25.97', '23.728789', '**23.73**']
							]
						},
						{
							type: 'p',
							text: "**Rounding order.** Rounding each line and then summing gives 23.72; converting the total and rounding gives 23.73. Both are \"correct\", but the invoice has to be internally consistent. Pick one rule: usually the total is the **sum of the rounded lines**. If the charged total must be the converted total, spread the difference across lines with [[largest-remainder]]."
						},
						{
							type: 'p',
							text: '**The second bug is worse:** the rate is fetched at *render* time. An invoice is a legal record: store the rate, its source and timestamp, and the EUR amounts **at finalization**, and render from those stored numbers. Never recompute.'
						}
					]
				},
				{
					id: 'p2q5',
					title: 'Checkout quoted $106.00, the invoice says $106.43',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'p',
							text: 'A B2B customer buys 100 small items at $0.99 each. Tax is 7.5%. The checkout service and the invoicing service were written by different teams.'
						},
						{
							type: 'columns',
							columns: [
								{
									title: 'checkout-service',
									blocks: [
										{
											type: 'code',
											lang: 'python',
											code: `# one line per unit
tax = sum(round_half_up(unit.price * TAX, 2)
          for unit in expand_units(lines))`
										}
									]
								},
								{
									title: 'invoice-service',
									blocks: [{ type: 'code', lang: 'python', code: `tax = round_half_up(subtotal * TAX, 2)` }]
								}
							]
						}
					],
					answer: [
						{
							type: 'table',
							head: ['Method', 'Calculation', 'Tax', 'Total'],
							numeric: [2, 3],
							rows: [
								['Per line (checkout)', '0.99 × 0.075 = 0.07425 → 0.07, × 100', '7.00', '106.00'],
								['Per invoice (invoice)', '99.00 × 0.075 = 7.425 → 7.43', '7.43', '106.43']
							]
						},
						{
							type: 'p',
							text: "That's [[tax-rounding|per-line vs per-invoice rounding]]. Each item's 0.425 cents of tax is rounded *down* 100 times. Neither method is wrong in general. Tax rules or the company's accounting policy pick one, but the quote and the invoice must use the **same** function."
						},
						{
							type: 'list',
							items: [
								'One `tax.compute(lines, jurisdiction)` library or service, called by both. Its output (per-line tax and total) is stored with the order and copied to the invoice, not recomputed.',
								'A contract test: for 1,000 random carts, quote total == invoice total.',
								"Remediation: invoices where the charged amount exceeded the quote should be refunded the difference, since charging more than the quoted price is a customer-trust problem (and possibly a legal one)."
							]
						}
					]
				},
				{
					id: 'p2q6',
					title: 'A $100 payment was refunded $160',
					tag: 'tricky',
					minutes: 3,
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `def refund(payment_id: str, amount: int, method: str):
    p = Payment.get(payment_id)
    if p.refunded + amount > p.captured:
        raise RefundTooLarge()
    if method == "card":
        provider.refund(p.provider_charge_id, amount)
    else:  # "wallet": instant store credit
        wallets.credit(p.customer_id, amount)
    p.refunded += amount
    p.save()`
						},
						{
							type: 'list',
							items: [
								'Support agent clicked "Refund $80 to wallet" twice (the button didn\'t disable).',
								'This only ever happens with **wallet** refunds, never card refunds.'
							]
						}
					],
					answer: [
						{
							type: 'p',
							text: "**Check-then-act [[race-condition|race]].** Both requests read `refunded = 0`, both pass the check, and both credit $80. Each then writes `refunded = 80`, a [[lost-update]], so the record even *hides* the over-refund. It only happens for wallets because for cards the payment provider enforces \"total refunded ≤ captured\" and rejects the second refund. Wallet credit is internal, so nothing outside the code checks it. See [[auth-and-capture]]."
						},
						{
							type: 'code',
							lang: 'sql',
							code: `-- One statement does the check and the reservation:
UPDATE payments
   SET refunded = refunded + :amount
 WHERE id = :id AND refunded + :amount <= captured
RETURNING refunded;          -- 0 rows → reject`
						},
						{
							type: 'list',
							items: [
								'Reserve first (the atomic update above), then credit. The wallet credit and the refund row go in the **same transaction**.',
								'The UI generates an [[idempotency-key]] when the refund dialog opens. A unique constraint on `refunds(idempotency_key)` makes a double click a no-op.',
								'Backstop: `CHECK (refunded <= captured)`.',
								'Remediation: `SELECT` payments where the sum of refund rows exceeds captured, *or* where wallet credits for a payment exceed `refunded`. The second query matters, because the lost update means `refunded` itself is wrong.'
							]
						}
					]
				},
				{
					id: 'p2q7',
					title: '"We use SELECT FOR UPDATE", yet wallets go negative',
					tag: 'tricky',
					minutes: 3,
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `# db.py
conn = psycopg.connect(DSN, autocommit=True)   # "required for pgbouncer"

# wallet.py
def withdraw(account_id: int, amount: int):
    bal = conn.execute(
        "SELECT balance FROM wallets WHERE id = %s FOR UPDATE", [account_id]
    ).fetchone()[0]
    if bal < amount:
        raise InsufficientFunds()
    conn.execute(
        "UPDATE wallets SET balance = balance - %s WHERE id = %s", [amount, account_id])`
						},
						{
							type: 'logs',
							logs: {
								style: 'terminal',
								lines: [
									{ ts: '12:01:07.312', level: 'INFO', source: 'wallet', msg: 'withdraw ok', fields: { account: 5521, amount: 5000, balance_seen: 6000 } },
									{ ts: '12:01:07.313', level: 'INFO', source: 'wallet', msg: 'withdraw ok', fields: { account: 5521, amount: 5000, balance_seen: 6000 } },
									{ ts: '12:01:09.020', level: 'WARN', source: 'recon', msg: 'negative balance', fields: { account: 5521, balance: -4000 } }
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: "**The lock is released before it protects anything.** In [[autocommit]] mode every statement is its own transaction. `FOR UPDATE` takes the row lock and the statement commits immediately, releasing it. Then the check runs in Python and the `UPDATE` runs as a separate transaction. Both requests saw 6000, both withdrew 5000. [[select-for-update|FOR UPDATE]] only works inside an explicit transaction that also contains the write."
						},
						{
							type: 'list',
							items: [
								"**Simplest correct fix:** one [[atomic-update]]: `UPDATE wallets SET balance = balance - %s WHERE id = %s AND balance >= %s RETURNING balance`.",
								'**Or** wrap the three steps in `with conn.transaction():`. That\'s fine with [[pgbouncer]] in transaction mode, since the transaction stays on one server connection.',
								'**Backstop:** `CHECK (balance >= 0)`.',
								'**Better model:** a ledger of entries ([[double-entry-bookkeeping]]) with the balance derived or cached, so every movement is auditable and replayable.',
								'**The misconception to call out:** "required for pgbouncer". Transaction pooling breaks *session* state (session-level [[advisory-lock|advisory locks]], `SET`, prepared statements in older versions), not transactions.'
							]
						}
					]
				}
			]
		},

		// ═══════════════════════ PART 3 ═══════════════════════
		{
			id: 'p3',
			nav: '3 · Ledger code',
			eyebrow: 'Part 3 · 55 minutes · coding',
			title: 'Double-entry ledger with idempotent transfers',
			meta: 'accounts · transfers · idempotency keys · invariants · tests',
			minutes: 55,
			intro: [
				{
					type: 'p',
					text: 'Implement an in-memory [[double-entry-bookkeeping|double-entry ledger]]. Money is moved only by `transfer`, every transfer writes balanced entries, and clients may retry any request safely.'
				},
				{
					type: 'code',
					lang: 'python',
					caption: 'The starter shape',
					code: `class Ledger:
    def open_account(self, account_id: str, currency: str, allow_negative: bool = False) -> None: ...
    def transfer(self, key: str, src: str, dst: str, amount_minor: int, currency: str) -> TransferResult: ...
    def balance(self, account_id: str) -> int: ...
    def history(self, account_id: str) -> list[Entry]: ...

# TransferResult(key, status: "posted" | "rejected", reason: str | None)
# Entry(transfer_key, account_id, amount_minor)   # negative = debit, positive = credit`
				},
				{
					type: 'cards',
					items: [
						{
							title: 'Rules from the brief',
							items: [
								'Amounts are positive integers in [[minor-units]].',
								'Both accounts must exist and share the transfer\'s currency.',
								'A transfer that would take a non-`allow_negative` account below zero is **rejected** (a result, not an exception).',
								'Same `key`, same request: return the **original** result, change nothing.',
								'Same `key`, different request: raise `IdempotencyConflict`.'
							]
						},
						{
							title: 'Assumptions to write down first',
							items: [
								'Invalid input (unknown account, zero amount, self-transfer) **raises** and is *not* recorded under the key, so the client can fix it and retry with the same key.',
								'A *rejected* transfer **is** recorded. Replaying it returns "rejected" even if the account has since been funded. Otherwise a retry could move money hours later.',
								'`allow_negative` accounts model money outside the system (bank, card network).',
								'Single-threaded. I\'ll describe the concurrent and SQL version separately.'
							]
						}
					]
				}
			],
			questions: [
				{
					id: 'p3q1',
					title: 'Warm-up: run the script by hand',
					tag: 'core',
					minutes: 5,
					prompt: [
						{ type: 'p', text: 'Accounts: `bank` (USD, allow_negative), `alice` (USD), `bob` (USD), `eve` (EUR). Run these in order. What does each call return, and what are the balances at the end?' },
						{
							type: 'code',
							lang: 'python',
							code: `1  transfer("k1", "bank",  "alice", 10_000, "USD")
2  transfer("k2", "alice", "bob",    2_500, "USD")
3  transfer("k2", "alice", "bob",    2_500, "USD")
4  transfer("k2", "alice", "bob",    3_000, "USD")
5  transfer("k3", "bob",   "alice",  5_000, "USD")
6  transfer("k4", "bank",  "bob",   10_000, "USD")
7  transfer("k3", "bob",   "alice",  5_000, "USD")
8  transfer("k5", "alice", "alice",    100, "USD")
9  transfer("k6", "alice", "eve",      100, "USD")
10 transfer("k7", "alice", "bob",        0, "USD")`
						}
					],
					answer: [
						{
							type: 'table',
							head: ['#', 'Result', 'Why', 'bank', 'alice', 'bob'],
							numeric: [3, 4, 5],
							rows: [
								['1', 'posted', 'bank may go negative', '−10000', '10000', '0'],
								['2', 'posted', '', '−10000', '7500', '2500'],
								['3', 'posted (replay)', 'same key, same request → original result', '−10000', '7500', '2500'],
								['4', '`IdempotencyConflict`', 'same key, different amount', '−10000', '7500', '2500'],
								['5', 'rejected: insufficient_funds', 'bob has 2500', '−10000', '7500', '2500'],
								['6', 'posted', '', '−20000', '7500', '12500'],
								['7', 'rejected (replay)', 'original result stands although bob can now afford it', '−20000', '7500', '12500'],
								['8', '`InvalidTransfer`', 'self-transfer, not recorded', '−20000', '7500', '12500'],
								['9', '`InvalidTransfer`', 'currency mismatch (eve is EUR)', '−20000', '7500', '12500'],
								['10', '`InvalidTransfer`', 'amount must be > 0', '−20000', '7500', '12500']
							]
						},
						{
							type: 'p',
							text: 'Check the [[ledger-invariant]]: −20000 + 7500 + 12500 = **0**. Row 7 is the one people get wrong. Say out loud which behaviour you chose and why.'
						}
					]
				},
				{
					id: 'p3q2',
					title: 'Reference solution (Python)',
					tag: 'coding',
					minutes: 35,
					prompt: [{ type: 'p', text: 'Write yours against the timer first. This version passes every case in the warm-up table.' }],
					answerLabel: 'Show solution',
					answer: [
						{
							type: 'code',
							lang: 'python',
							code: `from dataclasses import dataclass
from enum import Enum
from typing import Optional


class Status(str, Enum):
    POSTED = "posted"
    REJECTED = "rejected"


class LedgerError(Exception): ...
class UnknownAccount(LedgerError): ...
class InvalidTransfer(LedgerError): ...
class IdempotencyConflict(LedgerError): ...


@dataclass(frozen=True)
class Entry:
    transfer_key: str
    account_id: str
    amount_minor: int              # negative = debit, positive = credit


@dataclass(frozen=True)
class TransferRequest:
    src: str
    dst: str
    amount_minor: int
    currency: str


@dataclass(frozen=True)
class TransferResult:
    key: str
    status: Status
    reason: Optional[str] = None


@dataclass
class Account:
    id: str
    currency: str
    allow_negative: bool = False
    balance_minor: int = 0         # cache of sum(entries); see trial_balance()


class Ledger:
    def __init__(self) -> None:
        self._accounts: dict[str, Account] = {}
        self._entries: list[Entry] = []
        self._results: dict[str, tuple[TransferRequest, TransferResult]] = {}

    # ── public API ──────────────────────────────────────────────

    def open_account(self, account_id: str, currency: str, allow_negative: bool = False) -> None:
        if account_id in self._accounts:
            raise InvalidTransfer(f"account {account_id} already exists")
        self._accounts[account_id] = Account(account_id, currency, allow_negative)

    def transfer(self, key: str, src: str, dst: str, amount_minor: int, currency: str) -> TransferResult:
        request = TransferRequest(src, dst, amount_minor, currency)
        if key in self._results:
            return self._replay(key, request)
        self._validate(request)            # raises; nothing recorded under the key
        result = self._post(key, request)  # posted or rejected; both are recorded
        self._results[key] = (request, result)
        return result

    def balance(self, account_id: str) -> int:
        return self._account(account_id).balance_minor

    def history(self, account_id: str) -> list[Entry]:
        self._account(account_id)
        return [e for e in self._entries if e.account_id == account_id]

    def trial_balance(self) -> dict[str, int]:
        """Sum of entries per currency. Must always be all zeros."""
        totals: dict[str, int] = {}
        for e in self._entries:
            currency = self._accounts[e.account_id].currency
            totals[currency] = totals.get(currency, 0) + e.amount_minor
        return totals

    # ── helpers ─────────────────────────────────────────────────

    def _replay(self, key: str, request: TransferRequest) -> TransferResult:
        original_request, original_result = self._results[key]
        if original_request != request:
            raise IdempotencyConflict(f"key {key!r} was already used for a different transfer")
        return original_result

    def _validate(self, r: TransferRequest) -> None:
        if type(r.amount_minor) is not int or r.amount_minor <= 0:
            raise InvalidTransfer("amount_minor must be a positive int")
        if r.src == r.dst:
            raise InvalidTransfer("source and destination must differ")
        src, dst = self._account(r.src), self._account(r.dst)
        if not (src.currency == dst.currency == r.currency):
            raise InvalidTransfer("currency mismatch")

    def _post(self, key: str, r: TransferRequest) -> TransferResult:
        src, dst = self._accounts[r.src], self._accounts[r.dst]
        if not src.allow_negative and src.balance_minor < r.amount_minor:
            return TransferResult(key, Status.REJECTED, "insufficient_funds")
        legs = (Entry(key, src.id, -r.amount_minor), Entry(key, dst.id, r.amount_minor))
        # Everything that can fail has already run; from here on we only mutate.
        self._entries.extend(legs)
        src.balance_minor -= r.amount_minor
        dst.balance_minor += r.amount_minor
        return TransferResult(key, Status.POSTED)

    def _account(self, account_id: str) -> Account:
        try:
            return self._accounts[account_id]
        except KeyError:
            raise UnknownAccount(account_id) from None`
						},
						{
							type: 'list',
							items: [
								'**Validate fully, then mutate.** Both accounts are looked up before any balance changes, so an unknown `dst` can\'t leave money debited and not credited.',
								'`type(x) is not int` rejects `True` (a `bool` *is* an `int` in Python) and `10.0`.',
								'The stored `TransferRequest` is a frozen dataclass, so comparing the replayed request to the original is just `!=`.',
								'Balances are a cache. `trial_balance()` and `sum(history)` let tests prove the cache matches the entries.',
								'Complexity: `transfer` and `balance` are O(1). `history` is O(E). Mention an index per account if it matters.'
							]
						}
					]
				},
				{
					id: 'p3q3',
					title: 'Reference solution (TypeScript)',
					tag: 'coding',
					prompt: [],
					answerLabel: 'Show solution',
					answer: [
						{
							type: 'code',
							lang: 'typescript',
							code: `export type Status = "posted" | "rejected";
export interface Entry { transferKey: string; accountId: string; amountMinor: number }
export interface TransferResult { key: string; status: Status; reason?: string }
interface Request { src: string; dst: string; amountMinor: number; currency: string }
interface Account { id: string; currency: string; allowNegative: boolean; balanceMinor: number }

export class LedgerError extends Error {}
export class UnknownAccount extends LedgerError {}
export class InvalidTransfer extends LedgerError {}
export class IdempotencyConflict extends LedgerError {}

const sameRequest = (a: Request, b: Request) =>
  a.src === b.src && a.dst === b.dst && a.amountMinor === b.amountMinor && a.currency === b.currency;

export class Ledger {
  private accounts = new Map<string, Account>();
  private entries: Entry[] = [];
  private results = new Map<string, { request: Request; result: TransferResult }>();

  openAccount(id: string, currency: string, allowNegative = false): void {
    if (this.accounts.has(id)) throw new InvalidTransfer("account " + id + " already exists");
    this.accounts.set(id, { id, currency, allowNegative, balanceMinor: 0 });
  }

  transfer(key: string, src: string, dst: string, amountMinor: number, currency: string): TransferResult {
    const request: Request = { src, dst, amountMinor, currency };
    const seen = this.results.get(key);
    if (seen) {
      if (!sameRequest(seen.request, request)) throw new IdempotencyConflict("key " + key + " reused");
      return seen.result;
    }
    this.validate(request);
    const result = this.post(key, request);
    this.results.set(key, { request, result });
    return result;
  }

  balance(id: string): number { return this.account(id).balanceMinor; }

  history(id: string): Entry[] {
    this.account(id);
    return this.entries.filter(e => e.accountId === id);
  }

  private validate(r: Request): void {
    // Number.isSafeInteger rejects 10.5, NaN, Infinity and values beyond 2^53.
    if (!Number.isSafeInteger(r.amountMinor) || r.amountMinor <= 0)
      throw new InvalidTransfer("amountMinor must be a positive safe integer");
    if (r.src === r.dst) throw new InvalidTransfer("source and destination must differ");
    const s = this.account(r.src), d = this.account(r.dst);
    if (s.currency !== r.currency || d.currency !== r.currency) throw new InvalidTransfer("currency mismatch");
  }

  private post(key: string, r: Request): TransferResult {
    const s = this.account(r.src), d = this.account(r.dst);
    if (!s.allowNegative && s.balanceMinor < r.amountMinor)
      return { key, status: "rejected", reason: "insufficient_funds" };
    this.entries.push(
      { transferKey: key, accountId: s.id, amountMinor: -r.amountMinor },
      { transferKey: key, accountId: d.id, amountMinor: r.amountMinor },
    );
    s.balanceMinor -= r.amountMinor;
    d.balanceMinor += r.amountMinor;
    return { key, status: "posted" };
  }

  private account(id: string): Account {
    const a = this.accounts.get(id);
    if (!a) throw new UnknownAccount(id);
    return a;
  }
}`
						},
						{
							type: 'callout',
							tone: 'warn',
							title: 'TS traps',
							text: 'Returning the stored result object lets a caller mutate it (`res.status = "posted"`) and corrupt the idempotency record. Return a copy or `Object.freeze` it. And `number` is a [[floating-point|double]], only exact up to 2^53, so for large balances use `bigint`.'
						}
					]
				},
				{
					id: 'p3q4',
					title: 'Write the extra tests',
					tag: 'coding',
					minutes: 10,
					prompt: [{ type: 'p', text: 'List at least twelve before you peek. Reviewers reward edge cases and invariant checks, not just happy paths.' }],
					answerLabel: 'Show test list',
					answer: [
						{
							type: 'code',
							lang: 'python',
							code: `import pytest

@pytest.fixture
def ledger():
    l = Ledger()
    l.open_account("bank", "USD", allow_negative=True)
    l.open_account("alice", "USD")
    l.open_account("bob", "USD")
    l.open_account("eve", "EUR")
    l.transfer("fund", "bank", "alice", 10_000, "USD")
    return l

def test_transfer_moves_money(ledger):
    assert ledger.transfer("t", "alice", "bob", 2_500, "USD").status == Status.POSTED
    assert (ledger.balance("alice"), ledger.balance("bob")) == (7_500, 2_500)

def test_exact_balance_allowed(ledger):                    # boundary: == not <
    assert ledger.transfer("t", "alice", "bob", 10_000, "USD").status == Status.POSTED
    assert ledger.balance("alice") == 0

def test_one_cent_over_rejected_and_nothing_moves(ledger):
    r = ledger.transfer("t", "alice", "bob", 10_001, "USD")
    assert (r.status, r.reason) == (Status.REJECTED, "insufficient_funds")
    assert ledger.balance("alice") == 10_000 and ledger.history("bob") == []

def test_replay_returns_original_and_posts_once(ledger):
    first = ledger.transfer("t", "alice", "bob", 100, "USD")
    assert ledger.transfer("t", "alice", "bob", 100, "USD") == first
    assert len(ledger.history("bob")) == 1

@pytest.mark.parametrize("change", [
    dict(amount_minor=101), dict(dst="bank"), dict(src="bank"), dict(currency="EUR")])
def test_key_reuse_with_different_request_conflicts(ledger, change):
    ledger.transfer("t", "alice", "bob", 100, "USD")
    args = dict(src="alice", dst="bob", amount_minor=100, currency="USD") | change
    with pytest.raises(IdempotencyConflict):
        ledger.transfer("t", **args)

def test_replayed_rejection_stays_rejected_after_funding(ledger):
    assert ledger.transfer("t", "bob", "alice", 500, "USD").status == Status.REJECTED
    ledger.transfer("fund-bob", "bank", "bob", 1_000, "USD")
    assert ledger.transfer("t", "bob", "alice", 500, "USD").status == Status.REJECTED
    assert ledger.balance("bob") == 1_000

def test_invalid_request_is_not_recorded_under_key(ledger):
    with pytest.raises(UnknownAccount):
        ledger.transfer("t", "alice", "nobody", 100, "USD")
    assert ledger.transfer("t", "alice", "bob", 100, "USD").status == Status.POSTED

def test_unknown_destination_does_not_debit_source(ledger):
    with pytest.raises(UnknownAccount):
        ledger.transfer("t", "alice", "nobody", 100, "USD")
    assert ledger.balance("alice") == 10_000

@pytest.mark.parametrize("amount", [0, -1, 10.0, True, "100"])
def test_amount_must_be_positive_int(ledger, amount):
    with pytest.raises(InvalidTransfer):
        ledger.transfer("t", "alice", "bob", amount, "USD")

def test_self_transfer_rejected(ledger):
    with pytest.raises(InvalidTransfer):
        ledger.transfer("t", "alice", "alice", 1, "USD")

@pytest.mark.parametrize("dst, currency", [("eve", "USD"), ("eve", "EUR"), ("bob", "EUR")])
def test_currency_mismatch(ledger, dst, currency):
    with pytest.raises(InvalidTransfer):
        ledger.transfer("t", "alice", dst, 100, currency)

def test_allow_negative_account_can_go_below_zero(ledger):
    assert ledger.balance("bank") == -10_000

def test_duplicate_account_rejected(ledger):
    with pytest.raises(InvalidTransfer):
        ledger.open_account("alice", "USD")

def test_invariants_hold_after_many_transfers(ledger):
    import random
    rnd = random.Random(7)
    for i in range(500):
        a, b = rnd.sample(["bank", "alice", "bob"], 2)
        ledger.transfer(f"r{i}", a, b, rnd.randint(1, 3_000), "USD")
    assert ledger.trial_balance() == {"USD": 0}
    for acc in ["bank", "alice", "bob"]:
        assert ledger.balance(acc) == sum(e.amount_minor for e in ledger.history(acc))
    assert ledger.balance("alice") >= 0 and ledger.balance("bob") >= 0`
						},
						{
							type: 'p',
							text: 'The last test is a mini [[property-based-testing|property test]]: random transfers, then assert the [[ledger-invariant]], cache == entries, and no forbidden negatives. It catches bugs you didn\'t think to write a case for.'
						}
					]
				},
				{
					id: 'p3q5',
					title: 'Why does this naive version pass the happy path and still lose money?',
					tag: 'tricky',
					minutes: 4,
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `def transfer(self, key, src, dst, amount, currency):
    if key in self.seen:
        return "posted"
    if self.balances[src] < amount:
        return "rejected"
    self.balances[src] -= amount
    self.balances[dst] += amount
    self.seen.add(key)
    return "posted"`
						},
						{ type: 'p', text: 'Find at least four bugs. Which one destroys money?' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Half-applied transfer destroys money',
									body: "If `dst` doesn't exist, `self.balances[dst]` raises `KeyError` **after** `src` was already debited. The money is gone and no entry explains it. Always validate everything before the first mutation."
								},
								{
									title: 'Replay returns "posted" for anything',
									body: 'A replay of a different request under the same key silently "succeeds". So does a replay of a transfer that was *rejected*, so the client believes money moved when it didn\'t.'
								},
								{
									title: 'Rejected transfers aren\'t recorded',
									body: "`seen.add` only runs on success. A client retrying a rejected `k3` after the account is funded gets a *new* evaluation and money moves hours later, which is the opposite of what idempotency promises."
								},
								{
									title: 'No currency, amount or self-transfer validation; no entries',
									body: '`amount = -500` reverses the direction and bypasses the balance check. With no entries there\'s no audit trail, so the [[ledger-invariant]] can\'t even be checked.'
								}
							]
						}
					]
				},
				{
					id: 'p3q6',
					title: 'Variant: make it safe with concurrent requests and Postgres',
					tag: 'design',
					minutes: 5,
					prompt: [{ type: 'p', text: 'Now 20 API pods call `transfer` concurrently, backed by Postgres. Sketch the schema and the transaction.' }],
					answer: [
						{
							type: 'code',
							lang: 'sql',
							code: `CREATE TABLE transfers (
  idempotency_key text PRIMARY KEY,
  src text NOT NULL, dst text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  status text NOT NULL, reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE entries (
  id bigserial PRIMARY KEY,
  transfer_key text NOT NULL REFERENCES transfers,
  account_id text NOT NULL REFERENCES accounts,
  amount_minor bigint NOT NULL
);

BEGIN;
-- 1. Claim the key. A concurrent duplicate blocks here, then sees the row.
INSERT INTO transfers (...) VALUES (...) ON CONFLICT (idempotency_key) DO NOTHING;
--    0 rows inserted → SELECT the stored row, compare params, return or 409.
-- 2. Lock both accounts in a fixed order (no deadlocks).
SELECT id, balance_minor, allow_negative FROM accounts
 WHERE id IN (:src, :dst) ORDER BY id FOR UPDATE;
-- 3. Check funds; write two entries; update cached balances; set status.
COMMIT;`
						},
						{
							type: 'list',
							items: [
								'The **primary key on the idempotency key** is the real guard. In-memory "seen" sets don\'t work across pods.',
								'[[lock-ordering|Ordered locking]] (`ORDER BY id FOR UPDATE`) prevents the [[deadlock]] from Part 1.',
								'Hot accounts (the platform fee account) serialize every transfer. Shard them into N sub-accounts, or post asynchronously and net in batches.',
								'A constraint trigger or nightly job asserts `sum(amount_minor) = 0` per transfer and per currency.'
							]
						}
					]
				},
				{
					id: 'p3q7',
					title: 'Variant: a cross-currency transfer',
					tag: 'variant',
					minutes: 3,
					prompt: [{ type: 'p', text: 'Alice (USD) pays Eve (EUR) €90.00 at 1 EUR = 1.1111 USD. How many entries, and how do you keep the ledger balanced?' }],
					answer: [
						{
							type: 'table',
							head: ['Account', 'Currency', 'Entry'],
							numeric: [2],
							rows: [
								['alice', 'USD', '−10000'],
								['fx:USD', 'USD', '+10000'],
								['fx:EUR', 'EUR', '−9000'],
								['eve', 'EUR', '+9000']
							]
						},
						{
							type: 'p',
							text: "Four entries: each currency balances **on its own** (USD: 0, EUR: 0). You can never add USD to EUR. The [[foreign-exchange|FX]] accounts hold the company's currency position. Store the rate, its source and timestamp on the transfer. Rounding (9000 × 1.1111 = 9999.9 → 10000) is decided once, in one named place, and the 0.1 cent of rounding is the company's FX gain or loss."
						}
					]
				}
			]
		},

		// ═══════════════════════ TEASERS ═══════════════════════
		{
			id: 'teasers',
			nav: 'Teasers',
			eyebrow: 'Rapid fire · 1–2 min each',
			title: 'Brain teasers',
			meta: 'quick reasoning reps',
			questions: [
				{
					id: 't1',
					title: 'How long does an int4 id last?',
					tag: 'teaser',
					prompt: [{ type: 'p', text: '400 inserts/s, 24/7, starting from 1.' }],
					answer: [
						{
							type: 'p',
							text: '2,147,483,647 ÷ 400 ≈ 5.37 M seconds ≈ **62 days**. At 40/s it\'s about 1.7 years, which is long enough for everyone to forget. See [[integer-overflow]].'
						}
					]
				},
				{
					id: 't2',
					title: 'How long is "one day" in Berlin on 25 Oct 2026?',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'And what does `start + timedelta(hours=24)` give if `start` is 25 Oct 00:00 local?' }],
					answer: [
						{
							type: 'p',
							text: "**25 hours** (an hour repeats). 24 hours after 00:00 local is 23:00 on the same day, not midnight on the 26th. Use calendar arithmetic (`+1 day` in the zone) when you mean \"tomorrow\", and durations when you mean \"24 hours\". See [[dst]]."
						}
					]
				},
				{
					id: 't3',
					title: 'Two concurrent conditional updates',
					tag: 'teaser',
					prompt: [
						{
							type: 'p',
							text: 'Balance is 15. Two sessions at [[isolation-level|Read Committed]] run `UPDATE wallets SET balance = balance - 10 WHERE id = 1 AND balance >= 10` at the same instant. Final balance?'
						}
					],
					answer: [
						{
							type: 'p',
							text: "**5.** The second `UPDATE` waits for the first one's row lock, then Postgres **re-evaluates the `WHERE` against the new row version** (balance 5), so it updates 0 rows. That's why an [[atomic-update]] is safe even at the default isolation level, while a `SELECT` followed by an `UPDATE` in app code isn't."
						}
					]
				},
				{
					id: 't4',
					title: 'Replica lag says 10 minutes, but nothing is stale',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'Lag is measured as `now() - pg_last_xact_replay_timestamp()`. It\'s 03:00 and nobody is writing.' }],
					answer: [
						{
							type: 'p',
							text: 'With no new transactions on the primary, the last replayed commit simply *is* 10 minutes old. The replica is fully caught up. Compare WAL positions (`pg_last_wal_receive_lsn()` vs `pg_last_wal_replay_lsn()`) or write a heartbeat row every few seconds. See [[replication-lag]].'
						}
					]
				},
				{
					id: 't5',
					title: 'Jan 31 + 1 month',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'In 2026: Python `relativedelta(months=1)`, Postgres `date + interval \'1 month\'`, JS `setUTCMonth(m + 1)`?' }],
					answer: [
						{
							type: 'p',
							text: '**Feb 28**, **Feb 28**, **Mar 3**. Two clamp and one overflows. Never trust "plus one month" without knowing the library. See [[end-of-month-clamping]].'
						}
					]
				},
				{
					id: 't6',
					title: 'Why not `max(id) + 1`?',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'A teammate proposes `SELECT max(invoice_no) + 1` to get gapless invoice numbers.' }],
					answer: [
						{
							type: 'p',
							text: 'Two concurrent transactions read the same max and both insert the same number. With a unique constraint one fails at random, and without one you get duplicates. It also needs an index scan every time. A locked counter row assigned at finalization is both gapless and safe. See [[sequence-gaps]].'
						}
					]
				},
				{
					id: 't7',
					title: 'Which is the deadlock fix?',
					tag: 'teaser',
					prompt: [{ type: 'p', text: '(a) raise `deadlock_timeout`, (b) lock rows in id order, (c) switch to Serializable, (d) add an index.' }],
					answer: [
						{
							type: 'p',
							text: "**(b).** (a) only delays detection. (c) changes which errors you get, not the lock cycle. (d) can *reduce* deadlocks caused by scans locking too many rows, but doesn't fix inconsistent ordering. See [[lock-ordering]]."
						}
					]
				}
			]
		}
	]
};

export default assessment;
