import type { Part } from '../../types';
import pspFailover from '../../labs/a11-psp-failover';

export const lab: Part = {
	id: 'p5',
	nav: '5 · Lab',
	eyebrow: 'Part 5 · 15 minutes · interactive',
	title: 'Fail over without charging anyone twice',
	meta: 'orchestrator · attempt ledger · secondary PSP risk ramp',
	minutes: 15,
	questions: [
		{
			id: 'lab1',
			title: 'Primary payment provider degrading',
			tag: 'tricky',
			minutes: 15,
			prompt: [
				{
					type: 'p',
					text: 'Work the incident in the console. Read every resource\'s details before you change anything: the constraint that decides this incident is written in two of them.'
				},
				{ type: 'lab', lab: pspFailover }
			],
			hints: [
				'What is in flight at PSP-A right now, and what happens to it when you move traffic? Little\'s law gives you the number.',
				'PSP-B is "operational", but read its details. What does its risk engine think of a merchant whose volume triples in one second?'
			],
			answerLabel: 'Show debrief',
			answer: [
				{
					type: 'p',
					text: '**Evidence.** PSP-A: 40% of calls hit the 10 s timeout and ~470 attempts are in flight ([[littles-law]]: 100/s × 4.7 s mean). The routing policy says that with any PSP-B weight, timed-out attempts are retried on PSP-B. The attempt-ledger flag says it was shipped dark. PSP-B\'s risk headroom for us is ~30 tx/s.'
				},
				{
					type: 'ranked',
					items: [
						{
							title: 'The trap: 100% to PSP-B immediately.',
							body: 'Every in-flight PSP-A attempt is re-driven to PSP-B. About 30% of those ~470 in-flight attempts will in fact capture at PSP-A, so ~140 customers are charged twice within seconds. Even with dedupe on, a jump from 0 to 100 tx/s against 30 tx/s of headroom puts us into PSP-B\'s manual risk review, freezing our ramp for five minutes while approvals sit near 28%.'
						},
						{
							title: 'Step 1: turn on cross-PSP dedupe first.',
							body: 'Before re-driving an attempt, ask PSP-A by [[idempotency-key]] whether it captured. It costs ~120 ms per re-drive and 30 s to roll out, and it is the only move that makes any failover safe. Moving any weight before it lands creates duplicates continuously (every PSP-A timeout retried on PSP-B).'
						},
						{
							title: 'Step 2: ramp PSP-B with its risk headroom.',
							body: '30% (inside headroom), then 60% when headroom has grown, then 100%. Each step stays under 2× headroom so the risk engine warms instead of freezing. Approvals reach 92% in about four minutes.'
						}
					]
				},
				{
					type: 'p',
					text: '**After the incident:** reconcile every PSP-A attempt that timed out (query by attempt id, reverse or refund anything captured but not fulfilled); keep PSP-B warm permanently with 5–10% of traffic so failover never starts cold; make "query before re-drive" the default, not a flag; and alert on duplicate captures per payment intent (zero tolerance). This is [[traffic-shifting]] with money: the unknown outcomes are the hard part, not the routing.'
				}
			]
		}
	]
};

export const coding: Part = {
	id: 'p6',
	nav: '6 · Coding',
	eyebrow: 'Part 6 · 55 minutes · coding',
	title: 'An amortization schedule that balances to the cent',
	meta: 'integer cents · basis points · exact rational payment · residue in the last row',
	minutes: 55,
	intro: [
		{
			type: 'code',
			lang: 'python',
			caption:
				'**Task:** given principal (cents), annual rate (basis points) and term (months), return the monthly schedule. Interest each month = balance × rate ÷ 12, rounded half-up to the cent. Payments are level (the standard [[amortization]] formula, rounded half-up) except the last, which pays the remaining balance plus its interest.',
			code: `schedule(principal_cents: int, annual_rate_bps: int, months: int) -> list[Row]

Row(period, payment, interest, principal, balance)   # all ints, cents; balance after payment`
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Assumptions to state before coding',
			text: 'Monthly compounding with a 12-period year (no day-count); half-up rounding, applied to the level payment once and to each period\'s interest; the final row absorbs all residue; 0% loans allowed (equal split, residue last); reject months < 1 and negative inputs; no floats anywhere, including computing the payment.'
		}
	],
	questions: [
		{
			id: 'c1',
			title: 'Warm-up: compute by hand',
			tag: 'core',
			minutes: 10,
			prompt: [
				{ type: 'list', items: ['(a) $10,000.00, 7.5%, 12 months: payment, first row, last row, total interest', '(b) $1,000.00, 12%, 3 months', '(c) $100.00, 0%, 3 months', '(d) $500.00, 6%, 1 month'] }
			],
			answer: [
				{
					type: 'table',
					head: ['Case', 'Level payment', 'Rows (payment / interest / principal / balance)'],
					rows: [
						['a', '867.57', '#1 867.57 / 62.50 / 805.07 / 9,194.93 … #12 **867.62** / 5.39 / 862.23 / 0.00. Total interest 410.89'],
						['b', '340.02', '340.02 / 10.00 / 330.02 / 669.98 · 340.02 / 6.70 / 333.32 / 336.66 · **340.03** / 3.37 / 336.66 / 0.00'],
						['c', '33.33', '33.33 · 33.33 · **33.34**'],
						['d', '502.50', '502.50 / 2.50 / 500.00 / 0.00']
					]
				},
				{
					type: 'p',
					text: '(a) r = 0.075 ÷ 12 = 0.00625; payment = 10,000 × 0.00625 ÷ (1 − 1.00625⁻¹²) = 867.5742 → 867.57. Twelve of those would leave **$0.05** unpaid, which is why the final row is 867.62. (b) r = 0.01: interest on 669.98 is 6.6998 → 6.70.'
				}
			]
		},
		{
			id: 'c2',
			title: 'Reference solution (Python)',
			tag: 'coding',
			answerLabel: 'Show solution',
			prompt: [{ type: 'p', text: 'Write yours against the timer first. This passes every warm-up case and the tests below.' }],
			answer: [
				{
					type: 'code',
					lang: 'python',
					code: `from dataclasses import dataclass

PERIODS_PER_YEAR = 12
BPS_PER_UNIT = 10_000
DENOM = PERIODS_PER_YEAR * BPS_PER_UNIT  # periodic rate = bps / 120_000


@dataclass(frozen=True)
class Row:
    period: int
    payment: int     # cents
    interest: int    # cents
    principal: int   # cents
    balance: int     # cents remaining after this payment


def div_round_half_up(num: int, den: int) -> int:
    """Exact half-up division for non-negative integers."""
    return (2 * num + den) // (2 * den)


def level_payment(principal: int, annual_bps: int, months: int) -> int:
    """P·r / (1 − (1+r)^−n) with r = bps/120000, as an exact ratio of integers."""
    if annual_bps == 0:
        return div_round_half_up(principal, months)
    a = DENOM + annual_bps
    num = principal * annual_bps * a**months
    den = DENOM * (a**months - DENOM**months)
    return div_round_half_up(num, den)


def schedule(principal: int, annual_bps: int, months: int) -> list[Row]:
    if principal < 0 or annual_bps < 0 or months < 1:
        raise ValueError("principal >= 0, annual_bps >= 0, months >= 1")
    payment = level_payment(principal, annual_bps, months)
    balance = principal
    rows: list[Row] = []
    for period in range(1, months + 1):
        interest = div_round_half_up(balance * annual_bps, DENOM)
        if period == months:
            # The final payment clears whatever rounding left behind.
            rows.append(Row(period, balance + interest, interest, balance, 0))
            break
        principal_part = min(payment - interest, balance)
        balance -= principal_part
        rows.append(Row(period, principal_part + interest, interest, principal_part, balance))
    return rows`
				},
				{
					type: 'p',
					text: '**Why the payment formula is exact:** with (1 + r) = a ÷ 120000, the formula P·r·(1+r)ⁿ ÷ ((1+r)ⁿ − 1) becomes P·bps·aⁿ ÷ (120000·(aⁿ − 120000ⁿ)), a ratio of integers. Python integers are unbounded, so the only rounding is the one you choose. O(n) time; aⁿ for 360 months is a ~1,800-digit integer, computed once.'
				}
			]
		},
		{
			id: 'c3',
			title: 'Reference solution (TypeScript)',
			tag: 'coding',
			answerLabel: 'Show solution',
			prompt: [],
			answer: [
				{
					type: 'code',
					lang: 'typescript',
					code: `export interface Row {
  period: number;
  payment: bigint;   // cents
  interest: bigint;
  principal: bigint;
  balance: bigint;   // remaining after this payment
}

const DENOM = 120_000n; // 12 periods × 10_000 bps: periodic rate = bps / 120_000

/** Exact half-up division for non-negative bigints. */
function divRoundHalfUp(num: bigint, den: bigint): bigint {
  return (2n * num + den) / (2n * den);
}

export function levelPayment(principal: bigint, annualBps: bigint, months: number): bigint {
  if (annualBps === 0n) return divRoundHalfUp(principal, BigInt(months));
  const n = BigInt(months);
  const a = DENOM + annualBps;
  const num = principal * annualBps * a ** n;
  const den = DENOM * (a ** n - DENOM ** n);
  return divRoundHalfUp(num, den);
}

export function schedule(principal: bigint, annualBps: bigint, months: number): Row[] {
  if (principal < 0n || annualBps < 0n || !Number.isInteger(months) || months < 1) {
    throw new RangeError("principal >= 0, annualBps >= 0, months >= 1");
  }
  const payment = levelPayment(principal, annualBps, months);
  let balance = principal;
  const rows: Row[] = [];
  for (let period = 1; period <= months; period++) {
    const interest = divRoundHalfUp(balance * annualBps, DENOM);
    if (period === months) {
      rows.push({ period, payment: balance + interest, interest, principal: balance, balance: 0n });
      break;
    }
    let principalPart = payment - interest;
    if (principalPart > balance) principalPart = balance;
    balance -= principalPart;
    rows.push({ period, payment: principalPart + interest, interest, principal: principalPart, balance });
  }
  return rows;
}`
				},
				{
					type: 'callout',
					tone: 'warn',
					text: '`bigint` throughout: `Number` loses integer precision past 2⁵³ and `a ** 360` is far beyond that. If an API must return JSON, serialize cents as strings (see [[json-number-precision]]).'
				}
			]
		},
		{
			id: 'c4',
			title: 'Write the tests',
			tag: 'coding',
			answerLabel: 'Show tests',
			prompt: [{ type: 'p', text: 'List the edge cases and the [[ledger-invariant|invariants]] before you look.' }],
			answer: [
				{
					type: 'code',
					lang: 'python',
					code: `import pytest
from amort import schedule, level_payment, Row

def totals(rows):
    return sum(r.payment for r in rows), sum(r.interest for r in rows), sum(r.principal for r in rows)

def test_reference_loan():
    rows = schedule(1_000_000, 750, 12)
    assert level_payment(1_000_000, 750, 12) == 86_757
    assert rows[0] == Row(1, 86_757, 6_250, 80_507, 919_493)
    assert rows[-1] == Row(12, 86_762, 539, 86_223, 0)
    assert totals(rows) == (1_041_089, 41_089, 1_000_000)

def test_three_months_twelve_percent():
    assert [r.payment for r in schedule(100_000, 1_200, 3)] == [34_002, 34_002, 34_003]

def test_zero_rate_last_payment_absorbs_cent():
    assert [r.payment for r in schedule(10_000, 0, 3)] == [3_333, 3_333, 3_334]

def test_single_month():
    assert schedule(50_000, 600, 1) == [Row(1, 50_250, 250, 50_000, 0)]

def test_zero_principal():
    assert all(r.payment == 0 for r in schedule(0, 750, 6))

@pytest.mark.parametrize("p,bps,n", [(1_000_000, 750, 12), (2_500_000, 1999, 360),
                                     (999, 50, 7), (12_345_678, 4_500, 84), (1, 9_999, 24)])
def test_invariants(p, bps, n):
    rows = schedule(p, bps, n)
    assert len(rows) == n
    assert sum(r.principal for r in rows) == p          # every cent repaid exactly once
    assert rows[-1].balance == 0
    assert all(r.payment == r.interest + r.principal for r in rows)
    assert all(r.balance >= 0 for r in rows)
    assert all(r.payment >= 0 and r.interest >= 0 for r in rows)

def test_rejects_bad_input():
    with pytest.raises(ValueError):
        schedule(100, 500, 0)`
				},
				{
					type: 'p',
					text: 'The invariant tests matter more than the examples: principal repaid sums to the loan exactly, each row balances, the balance never goes negative. Also mention: very small principals where interest rounds to 0 every month; rates so high that the level payment barely exceeds the first month\'s interest.'
				}
			]
		},
		{
			id: 'c5',
			title: 'Why does the naive version fail, and is the 30-year result a bug?',
			tag: 'tricky',
			prompt: [
				{
					type: 'code',
					lang: 'python',
					code: `r = annual_rate / 12
payment = round(principal * r / (1 - (1 + r) ** -months), 2)
balance = principal
for _ in range(months):
    interest = round(balance * r, 2)
    balance -= payment - interest
return balance   # "should be 0.00"`
				},
				{
					type: 'p',
					text: 'Separately, the correct implementation gives a 30-year, 19.99% loan of $25,000 a level payment of **$417.55** but a final payment of **$391.81**. A reviewer files it as a bug.'
				}
			],
			answer: [
				{
					type: 'p',
					text: '**Naive version:** (1) no final-row adjustment: for case (a) it leaves `balance = 0.05`; (2) Python\'s `round` is [[bankers-rounding|banker\'s rounding]], so an interest of exactly x.xx5 rounds to even instead of up; (3) [[floating-point]] dollars: `balance` accumulates binary error across 360 subtractions, so the half-cent cases are not even reliably half.'
				},
				{
					type: 'p',
					text: '**The 30-year result is correct.** The exact level payment is 41,754.90 cents; rounding to 41,755 overpays ~0.098¢ every month. At 1.67% a month for 359 months, that overpayment compounds to about $22; per-period interest rounding adds the rest. The borrower pays $25.74 less at the end because they paid slightly too much all along. Show the reviewer the invariants (principal sums exactly, balance 0) rather than arguing.'
				}
			]
		}
	]
};

export const teasers: Part = {
	id: 'teasers',
	nav: 'Teasers',
	eyebrow: 'Rapid fire · 1–2 min each',
	title: 'Numbers that lie',
	meta: 'compute before you answer',
	questions: [
		{
			id: 't1',
			title: '25 basis points',
			tag: 'teaser',
			prompt: [{ type: 'p', text: 'A lender cuts your rate by 25 bps on a $2,000,000 balance. Monthly saving?' }],
			answer: [{ type: 'p', text: '0.25% × 2,000,000 = **$5,000 a year**, ≈ **$416.67 a month** (ignoring day count). Not 25% of anything. See [[basis-point]].' }]
		},
		{
			id: 't2',
			title: 'The quoted rate is not the rate',
			tag: 'teaser',
			prompt: [{ type: 'p', text: '$100,000 at 5% on ACT/360, simple interest, held for a 365-day year. Interest?' }],
			answer: [
				{
					type: 'p',
					text: '100,000 × 0.05 × 365 ÷ 360 = **$5,069.44**: an effective 5.069%. ACT/360 always pays 365/360 = 1.39% more than the headline over a full year. See [[day-count-convention]].'
				}
			]
		},
		{
			id: 't3',
			title: 'Every issuer got worse; the total got better',
			tag: 'teaser',
			prompt: [
				{
					type: 'p',
					text: 'Issuer X approval 95% → 93%, Issuer Y 75% → 73%. Overall approval went from 83% to 87%. Bug in the dashboard?'
				}
			],
			answer: [
				{
					type: 'p',
					text: 'No: mix shift. Before, traffic was 40% X / 60% Y: 0.4 × 95 + 0.6 × 75 = 83. After, 70% X / 30% Y: 0.7 × 93 + 0.3 × 73 = 87. Both segments degraded; the average rose because more traffic went to the better issuer. [[simpsons-paradox|Simpson\'s paradox]]: always slice approval by issuer and BIN.'
				}
			]
		},
		{
			id: 't4',
			title: 'Fees on refunds',
			tag: 'teaser',
			prompt: [
				{
					type: 'p',
					text: 'Fee 2.9% + $0.30, not returned on refunds. Average order $25; 10% of orders are refunded in full. Fees as a percentage of the revenue you keep?'
				}
			],
			answer: [
				{
					type: 'p',
					text: 'Per 100 orders: fees 100 × (0.725 + 0.30) = $102.50; kept revenue 90 × 25 = $2,250. 102.50 ÷ 2,250 = **4.56%**, not 2.9%. Fixed fees and refunds both hit small tickets hardest.'
				}
			]
		},
		{
			id: 't5',
			title: 'Exactly twice the transaction',
			tag: 'teaser',
			prompt: [{ type: 'p', text: 'A reconciliation break equals exactly 2× one payout. What is your first hypothesis?' }],
			answer: [
				{
					type: 'p',
					text: 'A **sign error**: booked in the wrong direction (+x instead of −x is 2x apart). 1× suggests a missing or duplicate posting; balance × Δrate suggests revaluation; a few cents suggests rounding. The shape of a break is evidence.'
				}
			]
		}
	]
};
