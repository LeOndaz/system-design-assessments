import type { Part } from '../../types';
import { shape, step, timeAxis } from '../../series';

const x = timeAxis('11:40', 50, 1);

export const ledgers: Part = {
	id: 'p2',
	nav: '2 · Ledgers',
	eyebrow: 'Part 2 · 40 minutes · ledgers & money math',
	title: 'Where the cents go',
	meta: 'FX · residue · holds · hot accounts · event sourcing · interest',
	minutes: 40,
	intro: [
		{
			type: 'callout',
			tone: 'info',
			title: 'Show your arithmetic',
			text: 'Money questions are graded on the numbers. Write the formula, plug in, state the rounding rule and where it is applied once. A right conclusion with a wrong figure reads as a guess. Integer [[minor-units]] and [[basis-point|basis points]] keep the arithmetic exact.'
		}
	],
	questions: [
		{
			id: 'l1',
			title: '"The trial balance is off by exactly $7,000.00"',
			tag: 'core',
			minutes: 6,
			prompt: [
				{
					type: 'ticket',
					ticket: {
						channel: 'email',
						from: 'Helen Okafor',
						role: 'Financial Controller',
						subject: 'September close: USD trial balance does not balance',
						time: 'Oct 2, 08:31',
						body: `The September trial balance in USD is out by $7,000.00 exactly: debits exceed credits. In EUR everything balances to the cent, and the bank balances match the bank statements.

Nothing unusual happened in September except that we started holding EUR at the treasury level instead of converting it daily (€1,000,000 sitting in the EUR operating account since Sept 3, booked when EUR/USD was 1.0850). Month-end rate was 1.0920.

Is the ledger corrupted? We need to close by Friday.`
					}
				},
				{
					type: 'code',
					lang: 'python',
					caption: 'How the reporting job builds the USD trial balance',
					code: `for acct in accounts:
    for line in acct.lines(period="2026-09"):
        usd = line.amount * fx.rate(line.currency, "USD", at=period_end)  # month-end rate
        tb[acct.code][line.side] += usd`
				}
			],
			answer: [
				{
					type: 'p',
					text: 'Not corruption. **An [[fx-revaluation]] entry is missing**, and the report hides it by revaluing some lines but not their counterparts.'
				},
				{
					type: 'p',
					text: '€1,000,000 × (1.0920 − 1.0850) = **$7,000.00** exactly, which is why the break is a round number. The EUR cash line is translated at the month-end rate ($1,092,000), while its funding entry (the USD it came from, or equity/clearing in USD) stays at $1,085,000. The difference is an unrealized FX gain that should be booked: Dr EUR cash (USD carrying value) $7,000, Cr unrealized FX gain $7,000.'
				},
				{
					type: 'p',
					text: 'The report has a second bug the controller will hit next month: translating every *historical* line at the period-end rate is wrong for income-statement accounts (they use the transaction-date or average rate). Fix the job so monetary balances are revalued by explicit, idempotent month-end entries (one per account per period, keyed so re-running the close does not double them), and reports read booked USD amounts rather than re-translating on the fly.'
				},
				{
					type: 'callout',
					tone: 'warn',
					text: 'Interview tell: the moment a break equals balance × rate change, say "revaluation". Breaks that equal a single transaction point to a missing posting; breaks of a few cents point to rounding.'
				}
			]
		},
		{
			id: 'l2',
			title: 'The invoice lines do not add up to the total',
			tag: 'tricky',
			minutes: 6,
			prompt: [
				{
					type: 'p',
					text: 'A US customer buys three €10.00 add-ons; we display and charge in USD at our rate **1.08745**. The invoice shows each line converted and the total converted separately. Support says customers complain the lines sum to $32.61 but they were charged $32.62. The PSP then settles our USD charge into EUR at its own rate, and the ledger posts each line separately.'
				},
				{ type: 'list', items: ['What are the exact numbers?', 'Which figure is "right"?', 'How do you make the invoice, the charge and the ledger agree, permanently?'] }
			],
			answer: [
				{
					type: 'table',
					head: ['Method', 'Exact', 'Rounded', 'Sum'],
					numeric: [1, 2, 3],
					rows: [
						['Each line × 1.08745', '10.8745', '10.87', '32.61'],
						['Total €30.00 × 1.08745', '32.6235', '32.62', '32.62']
					]
				},
				{
					type: 'p',
					text: 'Neither is wrong arithmetic; they round at different granularities. The rule: **convert at the level money actually moves** (the charge: $32.62), then *allocate* that total back to lines so they sum to it. With [[largest-remainder]]: floors 10.87 × 3 = 32.61, one cent left, all remainders tie at 0.0045, so tie-break by line id: $10.88, $10.87, $10.87.'
				},
				{
					type: 'p',
					text: 'The ledger has the same problem twice: per-line postings vs one charge, and our rate vs the PSP\'s settlement rate (which includes their markup). Post the charge, allocate deterministically, and book any difference between expected and settled EUR to an explicit FX difference or [[rounding-residue-account|rounding residue account]], so the books balance and the residue is visible. Never let "a cent here and there" vanish: at 1.2 million charges a month, a cent per charge is $12,000 a month of unexplained money.'
				}
			]
		},
		{
			id: 'l3',
			title: 'Adding database capacity did nothing',
			tag: 'tricky',
			minutes: 6,
			prompt: [
				{
					type: 'p',
					text: 'Every transfer credits the platform fee account (`accounts.id = 1`) in the same transaction as the customer debit. Throughput plateaus at ~650 transfers/s during a promotion. The team scaled the DB from 16 to 32 vCPU at 12:05. p99 kept climbing.'
				},
				{
					type: 'dashboard',
					dashboard: {
						style: 'grafana',
						title: 'ledger-db',
						range: '11:40 – 12:29',
						panels: [
							{
								kind: 'timeseries',
								title: 'Transfers committed /s',
								x,
								markers: [{ at: 25, label: '16 → 32 vCPU' }],
								series: [
									{ name: 'committed', points: shape(50, { base: 420, noise: 0.03, seed: 31 }, step(10, 655)) },
									{ name: 'requested', points: shape(50, { base: 420, noise: 0.03, seed: 32 }, step(10, 1500)), dashed: true }
								],
								span: 3
							},
							{
								kind: 'timeseries',
								title: 'Transfer p99',
								unit: 'ms',
								x,
								log: true,
								series: [{ name: 'p99', points: shape(50, { base: 18, noise: 0.05, seed: 33 }, (i, v) => (i < 10 ? v : 40 + (i - 10) * 210)) }],
								span: 3
							},
							{
								kind: 'timeseries',
								title: 'DB CPU',
								unit: '%',
								x,
								yMax: 100,
								markers: [{ at: 25, label: 'resize' }],
								series: [{ name: 'cpu', points: shape(50, { base: 24, noise: 0.05, seed: 34 }, step(10, 31), step(25, 16)) }],
								span: 2
							},
							{
								kind: 'timeseries',
								title: 'Sessions waiting on locks',
								x,
								series: [{ name: 'Lock:transactionid', points: shape(50, { base: 2, noise: 0.2, seed: 35 }, (i, v) => (i < 10 ? v : Math.min(480, 30 + (i - 10) * 12))) }],
								span: 2
							},
							{
								kind: 'table',
								title: 'Top blocked statement',
								head: ['waiting', 'query'],
								numeric: [0],
								rows: [
									['412', 'UPDATE accounts SET balance = balance + $1 WHERE id = 1'],
									['3', 'UPDATE accounts SET balance = balance - $1 WHERE id = $2']
								],
								highlight: [0],
								span: 2
							}
						]
					}
				}
			],
			answer: [
				{
					type: 'p',
					text: 'A **[[hot-account]]**. Every transfer must update one row; Postgres row locks are held until commit, so transfers on that row run one at a time. CPU at 16–31% says the database is idle and waiting, not busy; the resize (CPU halves, throughput unchanged) is the proof.'
				},
				{
					type: 'p',
					text: '[[littles-law|Little\'s law]] gives the ceiling: if each transaction holds the fee-row lock for ~1.5 ms (update, the rest of the transaction, commit, network round trip to the app), the row supports at most 1 ÷ 0.0015 ≈ **666 transfers/s**. Requests at 1,500/s against a 655/s server is a queue that grows without bound, hence p99 climbing linearly.'
				},
				{
					type: 'ranked',
					items: [
						{ title: 'Shorten the lock hold.', body: 'Update the hot row last, right before commit, with no network calls after it. Cuts the hold time, raises the ceiling, does not remove it.' },
						{ title: 'Shard the account.', body: 'Split the fee account into N sub-accounts (`fee:0…fee:15`), pick one by hash of the transfer id; the reported balance is the sum. 16 shards ≈ 16× the ceiling.' },
						{
							title: 'Don\'t update a balance on the hot path at all.',
							body: 'Insert immutable entry rows (append-only, no contention) and maintain the fee balance by periodic aggregation. Safe for accounts that are only credited; customer accounts that can\'t go negative still need a checked update (next question).'
						}
					]
				}
			]
		},
		{
			id: 'l4',
			title: 'Negative wallet balances with "proper" transactions',
			tag: 'tricky',
			minutes: 6,
			prompt: [
				{
					type: 'p',
					text: 'Wallets have a settled balance and holds for pending card authorizations; [[available-balance|available = balance − active holds]]. Users must never go below zero. A few accounts per day end up negative after two near-simultaneous card purchases. The team\'s proposals: (a) switch to `SERIALIZABLE`, (b) add `FOR UPDATE` to the holds query.'
				},
				{
					type: 'code',
					lang: 'sql',
					code: `BEGIN;  -- READ COMMITTED
SELECT balance FROM accounts WHERE id = :acct;                       -- 100.00
SELECT COALESCE(SUM(amount), 0) FROM holds
 WHERE account_id = :acct AND status = 'active';                     -- 0.00
-- app: if balance - held >= :amount (80.00) then
INSERT INTO holds (account_id, amount, status) VALUES (:acct, :amount, 'active');
COMMIT;`
				}
			],
			answer: [
				{
					type: 'p',
					text: 'Two transactions both read balance 100 and holds 0, both see 100 ≥ 80, both insert a hold. Available = 100 − 160 = **−60**. They never write the same row, so row locks never meet: this is [[write-skew]], not a classic lost update.'
				},
				{
					type: 'ranked',
					items: [
						{
							title: '(b) does not work.',
							body: '`FOR UPDATE` locks rows that exist. When there are no active holds, there is nothing to lock; the conflicting row is the one being inserted (a phantom). It can\'t be locked in advance.'
						},
						{
							title: '(a) works, at a price.',
							body: '`SERIALIZABLE` detects the dependency and aborts one transaction with a [[serialization-failure]]. Correct, but every caller must retry, and under load the abort rate climbs.'
						},
						{
							title: 'Best: make the invariant a single-row condition.',
							body: 'Keep a `held` column on the account and reserve atomically: `UPDATE accounts SET held = held + :amt WHERE id = :acct AND balance - held >= :amt` → if 1 row updated, insert the hold row in the same transaction; if 0, decline. One row, one lock, no read-then-decide gap. (Equivalently: `SELECT … FOR UPDATE` on the **account** row first to serialize per account.)'
						}
					]
				},
				{
					type: 'p',
					text: 'Pessimistic per-account locking is fine here because a single customer wallet sees a few writes a second. The hot fee account in the previous question is the opposite case, which is why "always lock" and "never lock" are both wrong as policies. Add a nightly check `available >= 0` per account as a [[ledger-invariant]] alarm, and fix existing negatives with explicit adjustment entries.'
				}
			]
		},
		{
			id: 'l5',
			title: 'The projection rebuild "lost" $1,227.60',
			tag: 'tricky',
			minutes: 5,
			prompt: [
				{
					type: 'p',
					text: 'Balances are [[event-sourced-ledger|event-sourced]]. A bug fix required rebuilding all projections from events. After the rebuild, account `w_4417` shows **$322.90**; the old projection said **$1,550.50**, and the customer agrees with the old number. In 2023 the `Deposited` event changed shape.'
				},
				{
					type: 'columns',
					columns: [
						{
							title: 'Events for w_4417',
							blocks: [
								{
									type: 'code',
									lang: 'text',
									code: `v1 Deposited {"amount": 1000.00}      2022-11-02
v1 Deposited {"amount": 240.00}       2023-01-15
v2 Deposited {"amount_minor": 31050}  2024-06-30`
								}
							]
						},
						{
							title: 'Projection code',
							blocks: [
								{
									type: 'code',
									lang: 'typescript',
									code: `for (const e of events) {
  if (e.type === "Deposited") {
    balanceMinor += e.data.amount_minor ?? e.data.amount;
  }
}`
								}
							]
						}
					]
				}
			],
			answer: [
				{
					type: 'p',
					text: 'v1 events stored **dollars** in `amount`; v2 stores **cents** in `amount_minor`. The `??` fallback adds v1 dollar values as if they were cents: 1,000 + 240 + 31,050 = 32,290 cents = $322.90. Correct: 100,000 + 24,000 + 31,050 = 155,050 cents = $1,550.50. Missing: 155,050 − 32,290 = **122,760 cents = $1,227.60**, which is exactly the v1 deposits ($1,240.00) minus what they contributed ($12.40).'
				},
				{
					type: 'p',
					text: 'The old projection was right only because it was built incrementally by the code that existed when each event arrived. **Fix:** explicit [[event-upcasting|upcasters]] per event version (`v1 → v2: amount_minor = round_half_up(amount × 100)`, converting through Decimal, never float), a version field on every event, and a rebuild that runs in shadow and diffs against the live projection before cut-over. Any account whose balance changes in a rebuild should be a reviewed exception, not a silent overwrite.'
				}
			]
		},
		{
			id: 'l6',
			title: 'The borrower says we overcharged $145.83',
			tag: 'core',
			minutes: 6,
			prompt: [
				{
					type: 'ticket',
					ticket: {
						channel: 'email',
						from: 'Dana Whitfield',
						role: 'CFO at a borrowing customer',
						subject: 'January interest statement is wrong',
						body: `Our facility is $1,000,000 at 5.25%. 5.25% of a million is $52,500 a year; divided by 12 that is $4,375.00 a month. Your January statement charges $4,520.83. Please refund the $145.83 overcharge.`
					}
				},
				{
					type: 'p',
					text: 'The facility agreement says interest accrues on an **ACT/360** basis. Separately, your accounting team notices the general ledger shows January interest income of **$4,520.73** for this loan.'
				}
			],
			answer: [
				{
					type: 'table',
					head: ['Basis', 'Calculation', 'Interest'],
					numeric: [2],
					rows: [
						['ACT/360 (contract)', '1,000,000 × 0.0525 × 31 ÷ 360', '4,520.83'],
						['30/360 (borrower\'s math)', '1,000,000 × 0.0525 × 30 ÷ 360', '4,375.00'],
						['ACT/365', '1,000,000 × 0.0525 × 31 ÷ 365', '4,458.90']
					]
				},
				{
					type: 'p',
					text: 'The statement is correct under the contract. The borrower assumed equal months; January has 31 days, and $145.83 is exactly one day of interest (1,000,000 × 0.0525 ÷ 360 = 145.8333…). Reply with the clause, the formula and this table; offer the February statement preview, where they will see *less* than $4,375 (28 days → $4,083.33). See [[day-count-convention]].'
				},
				{
					type: 'p',
					text: '**The real bug is the ledger.** The accrual job rounds daily interest to cents: 145.83 × 31 = $4,520.73, ten cents below billing. Ten cents per loan per 31-day month across a 40,000-loan book is about $4,000 of interest income that never reaches the GL. Accrue the exact amount (Decimal or rational), round once per billing period, and reconcile accrued vs billed monthly so a mismatch is caught in the first month, not the audit.'
				}
			]
		}
	]
};
