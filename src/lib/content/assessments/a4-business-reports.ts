import type { Assessment, Block } from '../types';
import { shape, timeAxis, window_, step, ramp } from '../series';

// ───────────────────────── shared answer helpers ─────────────────────────

/** "Reply to the reporter" block: plain-language text shown as an outgoing message. */
function reply(to: string, body: string): Block {
	return {
		type: 'ticket',
		ticket: { channel: 'email', from: 'You', role: `Reply to ${to}`, body }
	};
}

// ───────────────────────── chart data ─────────────────────────

// MRR snapshot race: 23:55 → 00:49, one point per minute.
const mrrX = timeAxis('23:55', 55);
const renewalsPerMin = shape(55, { base: 0, noise: 0.12, seed: 41 }, window_(10, 52, 200));
const activeSubs = mrrX.map((_, i) => {
	if (i < 5) return 20000;
	if (i < 10) return 11700;
	return Math.min(20000, 11700 + (i - 10) * 200);
});
const providerLatency = shape(55, { base: 310, noise: 0.15, seed: 42 });

// Demo env slow in the afternoon: 72 hourly points, Mon 00:00 → Wed 23:00 UTC.
const demoX = ['Mon', 'Tue', 'Wed'].flatMap((d) =>
	Array.from({ length: 24 }, (_, h) => `${d} ${String(h).padStart(2, '0')}:00`)
);
const qaHours = (i: number) => i % 24 >= 12 && i % 24 < 19;
const salesHours = (i: number) => i % 24 >= 7 && i % 24 < 16;
const dbCpu = shape(72, { base: 17, noise: 0.15, seed: 7 }, (i, v) => (qaHours(i) ? 88 : v));
const demoP95 = shape(72, { base: 240, noise: 0.12, seed: 8 }, (i, v) => (qaHours(i) ? 3400 : v));
const demoRpm = shape(72, { base: 6, noise: 0.2, seed: 9 }, (i, v) => (salesHours(i) ? 85 : v));
const connDemo = shape(72, { base: 18, noise: 0.08, seed: 10 });
const connQa = shape(72, { base: 0, noise: 0.1, seed: 11 }, (i, v) => (qaHours(i) ? 140 : v));

// Password resets arriving late: 09:30 → 10:59, one point per minute.
const resetX = timeAxis('09:30', 90);
const queueDepth = resetX.map((_, i) => (i < 30 ? 12 + (i % 4) * 3 : Math.max(0, 240000 - (i - 30) * 2500)));
const queueAge = shape(90, { base: 4, noise: 0.2, seed: 21 }, ramp(30, 89, 4, 3540));
const sentPerMin = shape(90, { base: 45, noise: 0.15, seed: 22 }, step(30, 2500));
const espLatency = shape(90, { base: 180, noise: 0.1, seed: 23 });

// Shipping labels: hit histogram for carrier errors over a week.
const labelX = ['Oct 06', 'Oct 07', 'Oct 08', 'Oct 09', 'Oct 10', 'Oct 11', 'Oct 12'];

// ───────────────────────── assessment ─────────────────────────

const assessment: Assessment = {
	id: 'business-reports',
	number: 4,
	title: 'Reports from the business',
	tagline: 'Vague, non-technical reports from finance, sales, legal and customers. Translate, triage, fix, explain.',
	description:
		'Every scenario starts with a message from a human who isn\'t an engineer: finance, sales, support, legal, the warehouse, the CEO, or a customer. They describe symptoms in their own words and are sometimes confidently wrong about the cause. Your job: turn it into a testable claim, ask the right questions back, find the real cause, and reply in language they can act on.',
	minutes: 105,
	difficulty: 'intermediate',
	topics: ['Finance & billing', 'Timezones', 'Caching & CDN', 'Privacy & GDPR', 'Concurrency', 'Communication'],
	overview: [
		{
			type: 'budget',
			items: [
				{ label: '1 · Money', minutes: 25 },
				{ label: '2 · Customers', minutes: 30 },
				{ label: '3 · Operations', minutes: 20 },
				{ label: '4 · Writing', minutes: 20 },
				{ label: 'Teasers', minutes: 10 }
			]
		},
		{
			type: 'cards',
			items: [
				{
					title: '1 · Translate',
					items: [
						'Restate the report as one sentence you could test: *who*, *what exactly*, *since when*, *expected vs actual*.',
						'Separate the symptom ("the dashboard is wrong") from the reporter\'s theory ("engineering broke it").'
					]
				},
				{
					title: '2 · Ask back',
					items: [
						'Two to five questions, each one capable of eliminating a hypothesis.',
						'Ask for identifiers (order id, email, time with timezone, screenshot), not opinions.'
					]
				},
				{
					title: '3 · Investigate',
					items: [
						'Ranked hypotheses with the single check that confirms or kills each.',
						'Look for the pattern in *who* is affected: it usually names the cause.'
					]
				},
				{
					title: '4 · Reply',
					items: [
						'What happened, who is affected, what we\'re doing, when, and what they should tell customers.',
						'No jargon, no blame, concrete dates.'
					]
				}
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'What graders look for',
			text: 'Triage by impact, not by who is shouting. In this assessment the scariest-sounding report (the CEO\'s) is the least severe, and a calm one-line customer email is the most severe. Saying that out loud, with reasons, is the point. See [[severity-triage]].'
		}
	],
	parts: [
		// ═══════════════════════════ PART 1 ═══════════════════════════
		{
			id: 'p1',
			nav: '1 · Money',
			eyebrow: 'Part 1 · 25 minutes · finance, billing, HR',
			title: 'The numbers don\'t add up',
			meta: 'revenue reports · trials · invoices · payroll · disputes',
			intro: [
				{
					type: 'callout',
					title: 'First question for every "numbers don\'t match" report',
					text: 'Are both numbers measuring the **same thing**, over the **same window**, in the **same timezone**, in the **same unit**? Most finance mismatches are definition mismatches, not bugs. When they are bugs, the [[reconciliation]] list tells you which one.'
				}
			],
			questions: [
				{
					id: 'p1q1',
					title: '"Our revenue dashboard is wrong"',
					tag: 'core',
					minutes: 8,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'slack',
								from: 'Priya Raman',
								role: 'Finance · Revenue Operations',
								time: 'Tue 09:14',
								body:
									"Hi team, the revenue dashboard you built says Monday was $48,210 but the payment provider says $51,930. That's almost $4k missing!! I need the right number for the weekly board pack by Thursday.\n\nI think something broke when you did the release last week. Can someone fix the dashboard please?"
							}
						},
						{
							type: 'p',
							text: 'You pull last week from both systems. The dashboard query is `SELECT date(created_at), sum(amount_cents) FROM charges GROUP BY 1`. The company\'s provider account is set to `America/Los_Angeles`.'
						},
						{
							type: 'table',
							head: ['Day', 'Our dashboard', 'Provider', 'Difference'],
							numeric: [1, 2, 3],
							rows: [
								['Mon', '$48,210', '$51,930', '−$3,720'],
								['Tue', '$53,400', '$50,050', '+$3,350'],
								['Wed', '$49,880', '$49,610', '+$270'],
								['Thu', '$50,120', '$51,240', '−$1,120'],
								['Fri', '$57,300', '$54,990', '+$2,310'],
								['Sat', '$41,050', '$42,170', '−$1,120'],
								['Sun', '$38,900', '$38,140', '+$760'],
								['**Week**', '**$338,860**', '**$338,130**', '**+$730**']
							]
						},
						{ type: 'p', text: 'Refunds issued last week, per the provider: **$730**.' }
					],
					hints: [
						'Look at the signs of the daily differences. What does it mean that they alternate?',
						'Compare the weekly difference with the refunds line.'
					],
					answer: [
						{
							type: 'p',
							text: '**Testable claim:** "The dashboard\'s daily revenue differs from the provider\'s daily *net volume* for the same calendar day." Note that Priya\'s theory (the release broke it) is a hypothesis, not a fact.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Different [[day-boundary|day boundaries]]: our SQL groups by [[utc|UTC]] date, the provider by Los Angeles date.',
									body: 'The daily differences alternate in sign and mostly cancel over the week. Money isn\'t missing, it\'s moving between neighbouring days. UTC midnight is 17:00 in LA, so Monday-evening US sales count as Tuesday on our side.',
									confirm: 'Re-run the query grouped by `(created_at AT TIME ZONE \'America/Los_Angeles\')::date`. Daily rows should then match to within refunds.'
								},
								{
									title: 'Gross vs net: we sum charges, the provider\'s headline number subtracts refunds.',
									body: 'The week is off by exactly $730, which equals the refunds total. Timezone shifts can\'t explain a weekly gap; a definition difference can.',
									confirm: 'Subtract refunds by refund date in the new query; the week should reconcile to $0.'
								},
								{
									title: 'Data actually missing (failed webhook, release regression).',
									body: 'Less likely: missing data only ever makes our number *lower*, but we\'re higher on four days.',
									confirm: 'Count charge ids on both sides for the week; an id-level diff lists anything missing.'
								}
							]
						},
						{
							type: 'p',
							text: '**Ruled out:** the release. Last month\'s data shows the same alternating pattern, so the mismatch has existed since the dashboard was built.'
						},
						{
							type: 'p',
							text: '**Fix:** add a "net revenue, Pacific time" view that matches the provider\'s definition, and title every chart with its definition and timezone. Keep the UTC gross view for engineering.'
						},
						reply(
							'Priya',
							"Hi Priya, good news: no revenue is missing.\n\nThe two systems count a \"day\" differently. The payment provider uses Pacific time and subtracts refunds. Our dashboard used international time (UTC, 7 hours ahead of Pacific) and didn't subtract refunds. So Monday-evening sales showed up under Tuesday on our side. Over the full week the two agree once you take off last week's $730 of refunds.\n\nFor the board pack, the provider's numbers are the right ones to use. By tomorrow noon I'll add a \"Net revenue (Pacific time)\" view to the dashboard that matches them day for day, and label each chart with how it's calculated."
						)
					]
				},
				{
					id: 'p1q2',
					title: '"MRR dropped 30% overnight. Are we losing customers?"',
					tag: 'tricky',
					minutes: 10,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'Daniel Okafor',
								role: 'CFO',
								subject: 'URGENT: October MRR',
								time: 'Wed Oct 1, 07:02',
								body:
									"The automated MRR report this morning shows $412k. September was $588k. That's a 30% drop in one night. The same thing happened in July and it \"fixed itself\" a day later, which nobody could explain.\n\nI have an investor call at 11. I need to know whether this number is real."
							}
						},
						{
							type: 'p',
							text: 'The MRR report is a [[cron|cron]] job at **00:15 UTC on the 1st** that sums `price` for `status = \'active\'` subscriptions. Monthly renewals are processed by a separate batch that starts at 00:05 and moves each subscription from `renewal_pending` back to `active`.'
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'billing / renewals',
								range: 'Sep 30 23:55 – Oct 1 00:49 UTC',
								filters: ['env=prod', 'job=renewal-batch'],
								panels: [
									{
										kind: 'timeseries',
										title: 'Renewals processed / min',
										span: 3,
										x: mrrX,
										series: [{ name: 'processed', points: renewalsPerMin, color: 0 }],
										markers: [
											{ at: 10, label: 'batch start' },
											{ at: 20, label: 'MRR snapshot' }
										]
									},
									{
										kind: 'timeseries',
										title: 'Subscriptions with status=active',
										span: 3,
										x: mrrX,
										series: [{ name: 'active', points: activeSubs, color: 1 }],
										markers: [{ at: 20, label: 'MRR snapshot' }],
										yMin: 0
									},
									{
										kind: 'timeseries',
										title: 'Payment provider p95 latency',
										span: 3,
										unit: 'ms',
										x: mrrX,
										series: [{ name: 'p95', points: providerLatency, color: 2 }],
										yMin: 0
									},
									{
										kind: 'table',
										title: 'Renewal batch history',
										span: 3,
										head: ['Month', 'Renewing on 1st', 'Batch done', 'Snapshot', 'MRR reported'],
										numeric: [1, 4],
										highlight: [2, 5],
										rows: [
											['May', '4,100', '00:13', '00:15', '$541k'],
											['Jun', '4,600', '00:14', '00:15', '$556k'],
											['Jul', '6,900', '00:39', '00:15', '$398k'],
											['Aug', '5,200', '00:15', '00:15', '$571k'],
											['Sep', '5,600', '00:14', '00:15', '$588k'],
											['Oct', '8,300', '00:46', '00:15', '$412k']
										]
									}
								]
							}
						}
					],
					hints: ['When does the snapshot run relative to the batch? What state are un-processed renewals in at that moment?'],
					answer: [
						{
							type: 'p',
							text: '**Testable claim:** "The 00:15 report counted fewer active subscriptions than actually exist." The CFO\'s real question is binary: *is the drop real?* Answer that first.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Race between two scheduled jobs: the [[snapshot-timing|snapshot]] runs while the renewal batch is still working.',
									body: 'At 00:00 the 8,300 subscriptions renewing today flip to `renewal_pending`. The batch starts at 00:05 and processes ~200/min, so at 00:15 only ~2,000 are back to `active`. Active subs at the snapshot ≈ 13,700 of 20,000, which is about 69%, matching the 30% drop. In July and October the batch was large (summer promo cohort, then that cohort\'s annual renewals), so it ran past 00:15. In other months it finished just in time, which is why it looked random.',
									confirm: 'Re-run the MRR query now (batch finished at 00:46). It should return ≈ $590k.'
								},
								{
									title: 'Mass cancellation or failed payments.',
									body: 'Would show as `canceled` or `past_due`, not `renewal_pending`, and wouldn\'t "fix itself".',
									confirm: 'Count by status at 00:15 and now.'
								},
								{
									title: 'Payment provider slowness made the batch late.',
									body: 'Red herring: provider [[percentiles|p95]] is flat at ~310 ms. The batch is late because it\'s bigger, not because it\'s slower per item.'
								}
							]
						},
						{
							type: 'p',
							text: '**Fix:** count `renewal_pending` as active for [[mrr|MRR]] (it\'s contractual revenue unless the payment fails), and make the report depend on the batch\'s completion event instead of a fixed clock time. Near-term: move the cron to 03:00. Also add a check: a >10% month-over-month drop should hold the email and page someone.'
						},
						{
							type: 'callout',
							tone: 'warn',
							text: 'Don\'t answer "the number is wrong" without a corrected number. The CFO has a call at 11; give them the re-run figure and the one-line reason.'
						},
						reply(
							'Daniel',
							"Daniel, the drop isn't real. October MRR is $591k (re-run at 07:30).\n\nThe report runs at 00:15 on the 1st, while renewals for that day are still being processed. Subscriptions mid-renewal were counted as not paying. This only shows up in months with an unusually large number of renewals, July and October, which is why it seemed to come and go.\n\nToday I'm changing the report so it waits for renewals to finish, and adding an alert so a sudden drop is checked before the report goes out. You're safe to use $591k on the call."
						)
					]
				},
				{
					id: 'p1q3',
					title: '"Australian trial users are being charged a day early"',
					tag: 'core',
					minutes: 7,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'slack',
								from: 'Mia Chen',
								role: 'Sales · APAC',
								time: 'Thu 10:40 AEST',
								body:
									"Hey! Three customers in Sydney and Melbourne have complained this week that we charged them on day 14 of their 14-day free trial, so they didn't get the full trial. One was cancelling and is now asking for a refund + is pretty angry.\n\nUS customers never mention this. Is the trial shorter in Australia??"
							}
						},
						{
							type: 'code',
							lang: 'python',
							code: `TRIAL_DAYS = 14

def trial_end(signup_at: datetime) -> date:   # signup_at is UTC
    return signup_at.date() + timedelta(days=TRIAL_DAYS)   # first paid day

# billing worker, runs daily at 00:05 UTC
for sub in Subscription.where(status="trialing", trial_end__lte=date.today()):
    charge(sub)`
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Testable claim:** "Customers east of UTC who sign up in their local morning are charged before the end of their 14th local day."'
						},
						{
							type: 'p',
							text: '**Clarifying questions:** signup time *with timezone* for the three accounts; the charge timestamp; did any of them sign up in the evening?'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Trial dates are computed from the [[utc]] calendar date, not the customer\'s.',
									body: 'A Sydney customer signs up Oct 1 at 08:00 local = **Sep 30** 22:00 UTC. `trial_end` = Sep 30 + 14 = Oct 14. The worker charges at Oct 14 00:05 UTC = Oct 14 10:05 in Sydney, on the morning of their 14th local day. A Los Angeles customer signing up Oct 1 at 20:00 local is already Oct 2 in UTC, so they get an *extra* half day and never complain. Who\'s affected is the clue.',
									confirm: 'Query trial charges where `charged_at` is earlier than `signup_at + 14 days`. They will cluster in UTC+8…+13.'
								},
								{
									title: '[[off-by-one]] in the definition of "14 days".',
									body: 'Worth checking separately: is day 1 the signup day? Here `+14` gives the first paid *calendar date*, which is fine. The bug is the timezone, not the count.'
								}
							]
						},
						{
							type: 'p',
							text: '**Fix:** store `trial_ends_at = signup_at + interval \'14 days\'` as an exact timestamp and charge when `now() >= trial_ends_at`. No calendar dates, no timezone. Run the worker hourly so nobody waits up to 24 h. **[[data-remediation|Remediation]]:** find every charge made before `signup_at + 14 days`, refund the customers who cancelled, and send the others a short apology.'
						},
						reply(
							'Mia',
							"Hi Mia, the trial isn't shorter in Australia on purpose. It's a bug in how we counted the days, and you're right that it mostly hits Australia and Asia.\n\nOur system worked out the trial end date using international time (UTC) instead of the customer's own time, so people in Australia who signed up in the morning were charged a few hours before their trial was really over.\n\nWe're fixing it today so every trial lasts exactly 14 × 24 hours. I'm also pulling a list of everyone it affected. Anyone who had cancelled gets a full refund. Please tell the angry customer their refund is being processed today."
						)
					]
				},
				{
					id: 'p1q4',
					title: '"The payroll export is missing the new hires"',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'Grace Mensah',
								role: 'People Ops',
								subject: 'October payroll file — 4 people missing',
								time: 'Oct 24, 16:20',
								body:
									"Hello, the payroll export for October is missing four of our new starters. They all started on October 1st. The two people who started on October 6th ARE in the file, so it's not all new hires.\n\nPayroll closes Monday. Could you please re-run it? Maybe the system didn't have their details yet?"
							}
						},
						{
							type: 'code',
							lang: 'sql',
							code: `-- :period_start = '2026-10-01', :period_end = '2026-10-31'
SELECT id, name, salary
FROM employees
WHERE start_date > :period_start
   OR start_date < :period_start AND (end_date IS NULL OR end_date >= :period_start);`
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Testable claim:** "Employees whose `start_date` equals the first day of the period are excluded." Everyone who started on Oct 1 is missing; everyone else is present. That\'s a boundary.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: '[[inclusive-exclusive|Exclusive bound]] on both branches: `> period_start` and `< period_start`.',
									body: 'Someone starting exactly on the 1st matches neither branch. Classic: someone wrote "new hires" and "existing staff" as two cases and the boundary day fell between them.',
									confirm: 'Run the query with `start_date = \'2026-10-01\'` employees only. Zero rows.'
								},
								{
									title: 'Data not entered yet (Grace\'s theory).',
									body: 'Plausible for HR systems, but the Oct-6 starters are present and were likely entered later than the Oct-1 starters.',
									confirm: 'Check `created_at` for the four employees: all before the export ran.'
								},
								{
									title: 'Bonus bug: `end_date` and `period_end` are never compared to `start_date`.',
									body: 'Someone starting **after** the period (Nov 3) also matches `start_date > period_start` and would be paid for October. Check the file for future starters.'
								}
							]
						},
						{
							type: 'code',
							lang: 'sql',
							caption: 'One overlap test replaces both branches: the employment [[interval-overlap|interval overlaps]] the pay period.',
							code: `WHERE start_date <= :period_end
  AND (end_date IS NULL OR end_date >= :period_start)`
						},
						{
							type: 'p',
							text: 'Add tests for: starts on first day, starts on last day, leaves on first day, leaves on last day, starts after period. The same four boundary tests apply to every date-range filter in the codebase.'
						},
						reply(
							'Grace',
							"Hi Grace, thanks for spotting the pattern, it pointed straight at the cause. Your new starters' details were fine. The export had a mistake that left out anyone whose start date was exactly the 1st of the month.\n\nI've fixed it and attached a corrected October file with all four people. While checking, I found one person starting in November who was wrongly included last month. I've flagged them on the attached sheet so payroll can adjust.\n\nThe fix is permanent, so November's export will be right too."
						)
					]
				},
				{
					id: 'p1q5',
					title: '"Did we undercharge every customer in Japan?"',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'Kenji Watanabe',
								role: 'Finance · APAC',
								subject: 'JPY invoices',
								body:
									"A customer in Osaka forwarded us their invoice PDF. It says ¥50.00 for the Pro plan, which is ¥5,000. Have we been charging Japanese customers 1% of the price since we launched yen pricing in August?? If so, how much have we lost?"
							}
						},
						{
							type: 'code',
							lang: 'ts',
							code: `// invoice-pdf/format.ts
export function formatAmount(amountMinor: number, currency: string) {
  return currencySymbol(currency) + (amountMinor / 100).toFixed(2);
}

// billing/charge.ts
await provider.charges.create({ amount: plan.priceMinor, currency: plan.currency });`
						}
					],
					answer: [
						{
							type: 'p',
							text: '**The tempting answer** is "yes, display bug, nothing lost". Don\'t say that until you\'ve checked the *charge* path, because a unit bug in display often has a twin in billing.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Display bug: the PDF divides every currency by 100.',
									body: 'JPY is a [[zero-decimal-currency]]: 5000 [[minor-units]] = ¥5,000. Dividing by 100 prints ¥50.00. The same function shows Kuwaiti dinar (3 decimals) 10× too large.',
									confirm: 'Compare the provider\'s charge record for this invoice: `amount: 5000, currency: jpy` → the customer paid ¥5,000.'
								},
								{
									title: 'Charge path is actually correct, *if* `priceMinor` was stored correctly.',
									body: 'If whoever set up yen pricing entered ¥5,000 as `500000` (thinking "multiply by 100 like dollars") the customer was charged ¥500,000. Check the price table, not just the code.',
									confirm: '`SELECT plan, price_minor FROM prices WHERE currency = \'JPY\'`. Expect 5000.'
								}
							]
						},
						{
							type: 'code',
							lang: 'ts',
							caption: 'Let the platform know each currency\'s decimals.',
							code: `export function formatAmount(amountMinor: number, currency: string, locale = 'en') {
  const fmt = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  return fmt.format(amountMinor / 10 ** digits);
}`
						},
						{
							type: 'p',
							text: '**Remediation:** re-issue every non-2-decimal invoice since August. Invoices are often legal documents, so finance must confirm whether a corrected copy or a [[credit-note|credit note]] is needed.'
						},
						reply(
							'Kenji',
							"Hi Kenji, no money was lost. I've checked the payment records: every Japanese customer was charged the correct amount (¥5,000 for Pro).\n\nThe mistake is only on the invoice PDF, which displayed yen as if it had cents. So ¥5,000 printed as ¥50.00. The same issue affects our handful of customers billed in Kuwaiti dinar, whose invoices show 10× the real amount.\n\nThe fix goes live today. I'll send you a list of affected invoices since August (about 140) by tomorrow. Could you tell me whether we should re-issue them or send credit notes? I'm not sure what's required for invoices in Japan."
						)
					]
				},
				{
					id: 'p1q6',
					title: '"The two refund reports never agree, and the auditor is asking"',
					tag: 'core',
					minutes: 6,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'Lucas Ferreira',
								role: 'Accounting',
								subject: 'Refund report vs ledger export',
								body:
									"Every month the Refunds report and the accounting ledger export differ by a few cents, usually between 1 and 9 cents. It's small, but our auditor wants a written explanation and wants to know which one is right."
							}
						},
						{
							type: 'columns',
							columns: [
								{
									title: 'Refunds report',
									blocks: [
										{
											type: 'code',
											lang: 'python',
											code: `total = 0.0
for r in refunds:
    total += round(r.amount_cents * r.ratio / 100, 2)
return total`
										}
									]
								},
								{
									title: 'Ledger export',
									blocks: [
										{
											type: 'code',
											lang: 'python',
											code: `total = sum(r.amount_cents * r.ratio for r in refunds)
return round(total / 100, 2)`
										}
									]
								}
							]
						},
						{ type: 'p', text: '`ratio` is the refunded fraction for partial refunds (e.g. `0.3333` for one month of a quarterly plan).' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Round-per-line vs round-once.',
									body: 'The report rounds every refund to cents, then adds. The ledger adds exact values, then rounds once. With thousands of partial refunds, the per-line rounding errors (each up to ±0.5¢) add up to a few cents. Neither is "wrong" arithmetically; they implement different policies.',
									confirm: 'Compute both on last month\'s data and diff refund-by-refund; the gap is the sum of per-line rounding residues.'
								},
								{
									title: '[[floating-point]] accumulation and [[bankers-rounding|banker\'s rounding]].',
									body: 'Both use floats, and Python\'s `round()` rounds half to even, so 0.125 → 0.12 while a human expects 0.13. Even round-once can differ from the provider by a cent.',
									confirm: 'Find refunds whose exact value ends in .5 cents.'
								}
							]
						},
						{
							type: 'p',
							text: '**Which is right?** Neither, by default. The right number is **what was actually refunded to customers**, which is an integer number of cents per refund, as recorded by the payment provider. Store that integer when the refund happens and have both reports sum it. Then there is nothing to round.'
						},
						reply(
							'Lucas',
							"Hi Lucas, here's an explanation you can give the auditor.\n\nFor partial refunds, the two reports round at different stages. The refunds report rounds each refund to the cent before adding them up. The ledger adds the exact amounts and rounds once at the end. Over a few thousand partial refunds a month, that adds up to a few cents.\n\nThe correct figure is the amount actually returned to customers, which the payment provider records to the cent for each refund. From next month both reports will add up exactly those recorded amounts, so they'll match each other and the provider. I can also re-run the last 12 months on that basis if the auditor needs it."
						)
					]
				},
				{
					id: 'p1q7',
					title: '"Disputes tripled. Is someone using stolen cards on us?"',
					tag: 'tricky',
					minutes: 7,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'Priya Raman',
								role: 'Finance · Revenue Operations',
								subject: 'FW: Dispute rate warning',
								body:
									"The payment provider emailed saying our dispute rate is 0.9% and if it goes over 1% we could be put in a monitoring program or lose card processing. It was 0.3% in August.\n\nI'm guessing it's fraud. Can we turn on stricter fraud checks?"
							}
						},
						{
							type: 'table',
							caption: 'Disputes by reason code, per week',
							head: ['Week of', 'Fraudulent', 'Unrecognized', 'Duplicate', 'Product not received', 'Total'],
							numeric: [1, 2, 3, 4, 5],
							rows: [
								['Aug 25', '6', '4', '1', '2', '13'],
								['Sep 01', '5', '5', '0', '3', '13'],
								['Sep 08', '7', '4', '1', '2', '14'],
								['Sep 15', '6', '29', '1', '2', '38'],
								['Sep 22', '5', '34', '0', '3', '42'],
								['Sep 29', '6', '31', '1', '2', '40']
							]
						},
						{
							type: 'p',
							text: 'Deploy log, **Sep 14**: "Rebrand: new company name and logo in app, emails and checkout." The payment config now reads `statement_descriptor: "NBX*SUB 8841"`. It used to be `"LEDGERLY PRO"`.'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**The tempting answer** is Priya\'s: fraud, turn on stricter checks. The table says otherwise: "Fraudulent" is flat, and the entire increase is "Unrecognized", starting the week of the rebrand.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'The rebrand changed the [[billing-descriptor]] to something customers don\'t recognise.',
									body: 'Customers see "NBX*SUB 8841" on their card statement, don\'t connect it to the product, and tell their bank it isn\'t theirs. Those are legitimate customers filing [[chargeback|chargebacks]].',
									confirm: 'Sample 10 "unrecognized" disputes: are they long-standing customers with normal usage? Check when the descriptor config changed.'
								},
								{
									title: '[[card-testing|Card-testing]] fraud.',
									body: 'Would show as many small authorisations, high decline rates, new accounts, and "fraudulent" reason codes. None of those moved.',
									confirm: 'Decline rate and new-signup volume since Sep 14.'
								}
							]
						},
						{
							type: 'p',
							text: '**Why stricter fraud checks would hurt:** they block new legitimate customers and do nothing for existing subscribers who don\'t recognise the charge.'
						},
						{
							type: 'p',
							text: '**Fix:** set the descriptor to the brand customers know (e.g. "NEWBRAND.COM"), add a support URL or phone number if the provider supports it, send renewal-reminder emails that mention exactly what will appear on the statement, and respond to open disputes with usage evidence, since many can be won.'
						},
						reply(
							'Priya',
							"Hi Priya, I don't think this is fraud, and stricter fraud checks would make it worse.\n\nAlmost all the new disputes are customers telling their bank they don't recognise the charge. Since the rebrand on Sep 14, card statements say \"NBX*SUB 8841\", which customers don't connect to us. Fraud disputes haven't changed.\n\nToday I'm changing the statement text to our new brand name plus our website. Support could also send a short note to customers renewing this month saying what their statement will show. For disputes already open, we can send the bank evidence that the customer used the product, and we should win many of those. I'll check the rate again next Friday."
						)
					]
				}
			]
		},

		// ═══════════════════════════ PART 2 ═══════════════════════════
		{
			id: 'p2',
			nav: '2 · Customers',
			eyebrow: 'Part 2 · 30 minutes · support, legal, warehouse, CEO',
			title: 'It only happens to some people',
			meta: 'locale · caching · privacy · unicode · DNS · queues',
			intro: [
				{
					type: 'callout',
					text: '"Only some customers" is the most useful phrase in a bug report. Write down the dimension that separates affected from unaffected: country, language, name, network, time of day, account age, plan, device. That dimension usually *is* the cause.'
				}
			],
			questions: [
				{
					id: 'p2q1',
					title: '"Americans are seeing euro prices"',
					tag: 'core',
					minutes: 7,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'support',
								from: 'Support queue',
								role: 'Tier 1 · 6 tickets merged',
								subject: 'Pricing page showing wrong currency',
								body:
									"Several US customers say the pricing page shows \"12,99 €\" instead of $14.99. One German customer said she saw dollars this morning. When they refresh a few minutes later it's usually fine again. Customers think we're changing prices on them.\n\nWe assume it's a VPN thing? Can engineering confirm?"
							}
						},
						{
							type: 'logs',
							logs: {
								style: 'kibana',
								title: 'CDN access logs',
								query: 'path:"/pricing"',
								total: '18,204 hits',
								lines: [
									{ ts: '10:02:11.402', source: 'edge-fra', msg: 'GET /pricing 200', fields: { cache: 'MISS', country: 'DE', origin_variant: 'de-EUR' } },
									{ ts: '10:02:14.019', source: 'edge-fra', msg: 'GET /pricing 200', fields: { cache: 'HIT', country: 'US', age: 3 } },
									{ ts: '10:03:40.770', source: 'edge-fra', msg: 'GET /pricing 200', fields: { cache: 'HIT', country: 'US', age: 89 } },
									{ ts: '10:07:02.115', source: 'edge-fra', msg: 'GET /pricing 200', fields: { cache: 'MISS', country: 'US', origin_variant: 'us-USD' } },
									{ ts: '10:07:09.551', source: 'edge-fra', msg: 'GET /pricing 200', fields: { cache: 'HIT', country: 'DE', age: 7 } }
								]
							}
						},
						{
							type: 'p',
							text: 'Last week a [[cdn]] rule was added: `path /pricing → cache 300s` "to speed up the marketing launch". The origin chooses currency from the `CF-IPCountry`-style geo header.'
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'The CDN caches `/pricing` by path only, but the origin varies the page by country.',
									body: 'The [[cdn-cache-key]] doesn\'t include the country. Whoever misses first on an edge (a German visitor at 10:02) fills it, and everyone else on that edge gets euros for up to 300 s. The logs show it exactly: a DE MISS, then US HITs with `age` 3 and 89. It\'s "fine after a refresh" because the [[ttl]] expires. US travellers and VPN users share edges with Europeans, but plenty of affected users aren\'t on VPNs at all.',
									confirm: '`curl -H "CF-IPCountry: US" …/pricing` right after a DE request on the same edge: you get EUR and `x-cache: HIT`.'
								},
								{
									title: 'VPN / [[geo-ip|geo-IP]] inaccuracy (support\'s theory).',
									body: 'Would be consistent per user and wouldn\'t flip on refresh.'
								}
							]
						},
						{
							type: 'p',
							text: '**Mitigate now:** remove the cache rule (or set the [[cache-control]] header to `private` on `/pricing`). **Fix:** country in the URL (`/us/pricing`), or add country to the CDN cache key, or emit a [[vary-header]] the CDN honours. Prices are a trust issue, so also confirm checkout always charged the correct currency: did anyone *pay* in the wrong one?'
						},
						reply(
							'the support team',
							"Thanks for merging these, the pattern made it easy to find. It isn't a VPN issue, and prices haven't changed.\n\nLast week we started temporarily saving a copy of the pricing page to make it load faster. The copy didn't take the visitor's country into account, so for up to five minutes people could see the version made for whoever visited just before them. I switched that off at 11:20 and everyone now sees their own currency.\n\nCheckout was never affected: I checked, and everyone was charged in their own currency. You can tell customers it was a display error on our side, now fixed, and their price hasn't changed."
						)
					]
				},
				{
					id: 'p2q2',
					title: '"After I uploaded the new price list, EU prices lost their cents"',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'slack',
								from: 'Jonas Becker',
								role: 'Sales Operations · Berlin',
								time: 'Mon 08:55',
								body:
									"Morning! I uploaded the 2027 price list CSV on Friday. US prices are perfect but all EUR prices lost the cents: €12,99 became €12,00. Also the Enterprise add-on is now €1,30 which is obviously wrong (should be €1.299,00). I exported the CSV from Excel like always."
							}
						},
						{
							type: 'code',
							lang: 'ts',
							code: `for (const row of parseCsv(file)) {
  const amount = parseFloat(row.price);           // "12,99" | "1.299,00" | "14.99"
  await prices.upsert({ sku: row.sku, currency: row.currency,
                        amountMinor: Math.round(amount * 100) });
}`
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Cause:** the CSV comes from a German-locale Excel, which writes numbers with a decimal comma and a dot as thousands separator ([[locale-formatting]]). `parseFloat` stops at the first character it doesn\'t understand: `parseFloat("12,99")` = `12`, and `parseFloat("1.299,00")` = `1.299` → 130 [[minor-units|minor units]] = €1.30. No error, no warning. This is [[type-coercion]] failing silently.'
						},
						{
							type: 'list',
							items: [
								'**Fix the parser:** require prices in minor units (`1299`) in the template, or parse with an explicit locale per file, and **reject** any value that doesn\'t fully match `^\\d+([.,]\\d{2})?$` instead of guessing.',
								'**Validate before applying:** show a preview diff ("142 prices change; 38 change by more than 50%") and require confirmation.',
								'**Remediation:** restore EUR prices from Thursday\'s values, then **check orders placed since Friday** at the wrong price. That\'s the question sales leadership will ask first.'
							]
						},
						reply(
							'Jonas',
							"Morning Jonas, you did everything right. Our upload tool didn't understand the German number format (comma for cents, dot for thousands), so it cut the numbers off at the comma.\n\nAt 09:30 I put the EUR prices back to Thursday's values, so the site is correct again. Over the weekend 23 orders went through at the wrong price, list attached. Could you and your manager decide whether we honour those or contact the customers?\n\nBy Wednesday the tool will understand both formats and will show you a preview of all price changes before anything goes live. Until then, please send me the file and I'll upload it."
						)
					]
				},
				{
					id: 'p2q3',
					title: '"I opened my account page and saw someone else\'s address"',
					tag: 'tricky',
					minutes: 8,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'support',
								from: 'h.lindqvist@example.se',
								role: 'Customer',
								subject: 'weird',
								time: 'Fri 14:31',
								body:
									"Hi, not sure if this is important but when I clicked My Account it showed a different name (Thomas something) and an address in Lyon. After a refresh it was my account again. Just thought you should know."
							}
						},
						{
							type: 'code',
							lang: 'http',
							caption: 'Response headers you capture from /account',
							code: `HTTP/2 200
content-type: text/html; charset=utf-8
cache-control: public, max-age=300
x-cache: HIT
age: 212`
						},
						{
							type: 'code',
							lang: 'diff',
							caption: 'Merged Thursday 17:40 in shared middleware: "perf: enable [[cdn]] caching for HTML"',
							code: `- res.setHeader('Cache-Control', 'private, no-store');
+ res.setHeader('Cache-Control', 'public, max-age=300');`
						}
					],
					answer: [
						{
							type: 'callout',
							tone: 'crit',
							title: 'This is the most severe report in the assessment',
							text: 'A polite, low-key customer email describing a [[personal-data-breach]]. Name, address, possibly orders and payment details of one customer shown to another. Treat it as **[[severity-triage|SEV1]]** immediately. Don\'t wait to finish the investigation.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'A shared CDN cached a personalised page.',
									body: 'The middleware change made *every* HTML response\'s [[cache-control]] header `public, max-age=300`, including `/account`. The CDN stores the first user\'s page under the [[cdn-cache-key|key]] `/account` and serves it to everyone hitting that edge for 5 minutes. `x-cache: HIT` with `age: 212` proves the response came from cache.',
									confirm: 'Two different logged-in sessions request `/account` within 5 minutes and get the same body.'
								},
								{
									title: 'Session mix-up in the app (shared mutable state, a [[race-condition]] in session handling).',
									body: 'Possible in general, but the headers already explain it. Still check after mitigation, because the fix differs.'
								}
							]
						},
						{
							type: 'heading',
							text: 'First hour, in order'
						},
						{
							type: 'list',
							ordered: true,
							items: [
								'**Contain:** [[rollback|roll back]] the middleware change, then **purge the CDN cache** (the rollback alone doesn\'t evict pages already stored).',
								'**Escalate:** security lead and the data protection officer / legal, now. The regulator notification clock (72 h under [[gdpr]]) starts from awareness.',
								'**Preserve evidence:** CDN logs from Thursday 17:40 to the purge. They show which cached copies were served to whom.',
								'**Scope:** every path that returned personalised content with `public` caching. Count requests that were HITs on those paths, and which users\' pages were in cache.',
								'**Prevent:** default to `private, no-store` for authenticated responses, and add a test that fails if any route with a session returns `public`.'
							]
						},
						reply(
							'the customer',
							"Hi, thank you for telling us. It was important and we acted on it straight away.\n\nA change we made on Thursday caused some account pages to be temporarily stored and shown to the wrong person. We fixed it within an hour of your message. Your account and password weren't changed, and nobody could make changes to your account.\n\nWe're now checking exactly whose details were shown to whom. If your information was shown to anyone else, we'll contact you directly. Sorry for the worry, and thanks again for reporting it."
						),
						{
							type: 'p',
							text: 'Note what the reply doesn\'t do: it doesn\'t promise "your data was not exposed" before you know, and it doesn\'t share Thomas\'s details or confirm he exists. Legal reviews it before it\'s sent.'
						}
					]
				},
				{
					id: 'p2q4',
					title: '"Someone who asked to be deleted got our newsletter"',
					tag: 'tricky',
					minutes: 7,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'Amara Diallo',
								role: 'Legal & Compliance',
								subject: 'Erasure request — complaint received',
								body:
									"We received a complaint from a person who submitted a deletion request on 22 September. We confirmed deletion to them on the 23rd. Yesterday (14 Oct) they received our October newsletter.\n\nThey are threatening to go to the data protection authority. I need to know (1) how this happened, (2) whether it affects other people, (3) what we can say to them. Please treat as urgent."
							}
						},
						{
							type: 'logs',
							logs: {
								style: 'terminal',
								title: 'Timeline assembled from job logs',
								lines: [
									{ ts: 'Sep 22 10:14', source: 'privacy-svc', level: 'INFO', msg: 'erasure request received', fields: { request: 'ER-2291' } },
									{ ts: 'Sep 23 02:00', source: 'privacy-svc', level: 'INFO', msg: 'erasure complete: users, orders.pii, crm', fields: { request: 'ER-2291' } },
									{ ts: 'Oct 02 03:40', source: 'ops', level: 'WARN', msg: 'migration 0412 failed; restoring prod DB from snapshot', fields: { snapshot: '2026-09-20T00:00Z' } },
									{ ts: 'Oct 02 05:10', source: 'ops', level: 'INFO', msg: 'restore complete; WAL archive gap Sep 20 → Oct 01, replayed Oct 01 → 03:39', fields: { restored: true } },
									{ ts: 'Oct 03 01:00', source: 'esp-sync', level: 'INFO', msg: 'upserted contacts to email platform', fields: { contacts: 48311, created: 17 } },
									{ ts: 'Oct 14 09:00', source: 'email-platform', level: 'INFO', msg: 'campaign "October newsletter" sent', fields: { recipients: 48311 } }
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: '**The obvious guess** is "the erasure job missed the email platform". The log says it ran fine on Sep 23. Look at Oct 2.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'A backup restore brought deleted people back, and the nightly sync re-subscribed them.',
									body: 'The restore used the Sep 20 snapshot and, because of a gap in the [[write-ahead-log|WAL]] archive, could only replay changes from Oct 1. Everything written Sep 20 → Oct 1 was lost, including the Sep 23 erasure. The 17 contacts *created* on Oct 3 are the smoking gun: they existed in the restored DB but not in the email platform, i.e. people erased in that window.',
									confirm: 'Compare the 17 created contacts against erasure requests completed between Sep 20 and Oct 2.'
								},
								{
									title: 'The email platform keeps its own copy and erasure only deleted from our DB.',
									body: 'The erasure log lists `users, orders.pii, crm` (the stores holding [[pii|personal data]]): **no `email-platform`**. If erasure never reached the email platform, every erased person who was a subscriber is still on the list, a much bigger set.',
									confirm: 'Search the email platform for a sample of erased emails from any month.'
								}
							]
						},
						{
							type: 'p',
							text: 'Both may be true; check both before answering Legal\'s question (2). The structural fix for both is a **[[suppression-list]]**: on erasure, store a hash of the email in a "never contact / never import" list that every sync and send checks, and re-apply erasures after any restore. See [[gdpr-erasure]].'
						},
						reply(
							'Amara',
							"Amara, here's what we know so far. I'll confirm the full numbers by 4pm.\n\n1. How it happened: the deletion on 23 September worked. On 2 October we had to restore our database from a backup after a failed update, and the restore brought back some people who had been deleted in late September. The next night our system copied them back onto the newsletter list.\n\n2. Who else: 17 people were re-added the same way. I'm also checking whether deletions ever reached the newsletter tool for earlier requests, since that could be a larger group.\n\n3. Today: I've removed those 17 from the newsletter tool and deleted their data again. We're adding a permanent \"never contact\" list that survives restores, so this can't happen again.\n\nFor what to tell the person, I'll leave the wording to you. Factually: their data was deleted, briefly restored by a backup on 2 October, and deleted again today."
						)
					]
				},
				{
					id: 'p2q5',
					title: '"Orders for some customers never get shipping labels"',
					tag: 'core',
					minutes: 6,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'Tomasz Nowak',
								role: 'Warehouse Lead',
								subject: 'Stuck orders AGAIN',
								body:
									"We have 31 orders stuck in \"awaiting label\" this week. The system never prints the label so we have to type them into the carrier website by hand. It seems to be mostly customers with foreign names?? Also one lady with a really long name.\n\nNobody gets an error, they just sit there."
							}
						},
						{
							type: 'logs',
							logs: {
								style: 'kibana',
								query: 'service:fulfillment AND carrier.status:400',
								total: '31 hits',
								histogram: { x: labelX, counts: [4, 6, 3, 5, 7, 2, 4] },
								lines: [
									{ ts: 'Oct 12 09:14', level: 'WARN', source: 'fulfillment', msg: 'label request rejected', fields: { order: 88120, recipient: 'Zoë Ångström', error: 'recipient.name: unsupported characters' } },
									{ ts: 'Oct 11 16:02', level: 'WARN', source: 'fulfillment', msg: 'label request rejected', fields: { order: 88077, recipient: 'Łukasz Wiśniewski', error: 'recipient.name: unsupported characters' } },
									{ ts: 'Oct 10 11:47', level: 'WARN', source: 'fulfillment', msg: 'label request rejected', fields: { order: 88001, recipient: 'Maria Fernanda Gonçalves de Albuquerque', error: 'recipient.name: max length 35' } },
									{ ts: 'Oct 09 08:30', level: 'WARN', source: 'fulfillment', msg: 'label request rejected', fields: { order: 87950, recipient: 'José Martínez', error: 'recipient.name: unsupported characters' } }
								]
							}
						},
						{
							type: 'code',
							lang: 'python',
							code: `try:
    label = carrier.create_label(order.recipient_name, order.address)
    order.attach_label(label)
except CarrierError as e:
    log.warning("label request rejected", extra={"error": str(e)})
    # order stays in awaiting_label; will retry tonight`
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'The carrier API accepts only [[character-encoding|Latin-1]] and max 35 characters; we send the raw Unicode name.',
									body: '"Foreign names" is really "names with characters outside the carrier\'s character set". Interesting detail: "José Martínez" *is* valid Latin-1, but it was rejected. That name was probably stored in decomposed form (`e` + combining accent) from a macOS form submission. See [[unicode-normalization]].',
									confirm: 'Print `repr()` / code points of the rejected names; the José one will contain `U+0301`.'
								},
								{
									title: 'The failure is invisible: warning log, no alert, retry tonight forever.',
									body: 'A 400 is not transient. Retrying never helps. This is a polite [[swallowed-exception]]: the error is "handled" but nobody is told.'
								}
							]
						},
						{
							type: 'list',
							items: [
								'Normalize names to NFC on save.',
								'For the carrier only: transliterate (`Ł→L`, `ø→o`) and truncate to 35 with a deterministic rule. Keep the original name in our DB and on the packing slip.',
								'Treat [[http-status-codes|4xx]] as permanent: move the order to `label_failed`, show it on the warehouse screen with the reason, and alert on count > 0.',
								'**Remediation:** re-run the 31 stuck orders through the new path today.'
							]
						},
						reply(
							'Tomasz',
							"Hi Tomasz, you were right about the names. The carrier's system only accepts basic Latin letters and up to 35 characters. Names like Łukasz or Zoë, or very long names, were rejected, and our system quietly kept waiting instead of telling anyone.\n\nToday I've generated labels for all 31 stuck orders, so they're ready to print. From Thursday, names are automatically converted to a carrier-friendly spelling (Łukasz → Lukasz) on the label only. If a label still fails, the order will appear in red on your screen with the reason, instead of sitting there silently."
						)
					]
				},
				{
					id: 'p2q6',
					title: '"The website is DOWN" (from the CEO)',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'slack',
								from: 'Elena Varga',
								role: 'CEO',
								time: 'Wed 08:47',
								body:
									"The website is down!!! I've tried 3 times. I have a customer demo at 10. Who is on this??\n\n(my husband says it works on his phone, but I don't trust that)"
							},
						},
						{
							type: 'code',
							lang: 'text',
							caption: 'From the office network vs a phone on 4G',
							code: `office$ dig +noall +answer app.example.com
app.example.com.   71203   IN  A   203.0.113.10      ← old load balancer (switched off 06:15 today)

4g$ dig +noall +answer app.example.com
app.example.com.   281     IN  A   198.51.100.24     ← new load balancer`
						},
						{
							type: 'p',
							text: 'At 06:00 today infra moved the site to a new [[load-balancer|load balancer]] and switched the old one off at 06:15. The old DNS record had a TTL of 86400 (24 h). Monitoring from three regions shows 100% uptime.'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Triage first:** monitoring is green and other networks work, so this is not a site outage. It\'s urgent *for one person*, because of the 10:00 demo. Severity is about impact, and this is a SEV3 with a deadline. See [[severity-triage]].'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'The office DNS resolver still remembers the old IP ([[dns-ttl]]).',
									body: 'The record had a 24-hour TTL when it was changed. The office resolver fetched it at about 04:30, before the 06:00 change, and 71,203 s (≈ 19.8 h) remain, so it keeps sending everyone in the office to the old, switched-off load balancer until tomorrow morning. Phones on 4G use the carrier\'s resolver, which fetched the new record.',
									confirm: 'The two `dig` outputs above. Also ask: is anyone else in the office affected?'
								},
								{
									title: 'Expired [[tls-certificate]] on one edge, or corporate proxy blocking.',
									body: 'Would show a browser certificate warning or a proxy block page, not a timeout. Ask her what she sees: a screenshot settles it in one message.'
								}
							]
						},
						{
							type: 'list',
							items: [
								'**Now:** tell her to use her phone hotspot for the demo. Ask IT to flush the office resolver cache. Optionally put the old load balancer back temporarily to forward traffic.',
								'**Lesson:** lower the TTL to 300 s a day *before* a migration, and keep the old target alive for at least one old TTL afterwards.'
							]
						},
						reply(
							'Elena',
							"Elena, the site is up for customers. Monitoring is green and it works outside our office. The problem is only our office network, which is still pointing at the old server we switched off this morning.\n\nFor your 10:00 demo: please use your phone's hotspot. It'll work right away. IT is clearing the office network setting now and it should be fixed for everyone in the office within 30 minutes. I'll message you when it is."
						)
					]
				},
				{
					id: 'p2q7',
					title: '"Password reset emails arrive after they\'ve expired"',
					tag: 'core',
					minutes: 6,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'support',
								from: 'Support queue',
								role: 'Tier 2 · 40+ tickets this morning',
								subject: 'Reset links "expired"',
								body:
									"Since around 10am customers say the password reset link says \"expired\" when they click it, even though they click it as soon as the email arrives. Some say the email took ages. The email provider status page is all green. Did the links get shorter?"
							}
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'cloudwatch',
								title: 'email-outbound',
								range: 'Today 09:30 – 11:00',
								filters: ['Queue: email-outbound', 'Region: eu-west-1'],
								panels: [
									{
										kind: 'timeseries',
										title: 'ApproximateNumberOfMessagesVisible',
										span: 3,
										x: resetX,
										series: [{ name: 'visible', points: queueDepth, color: 0 }],
										markers: [{ at: 30, label: '10:00' }]
									},
									{
										kind: 'timeseries',
										title: 'ApproximateAgeOfOldestMessage',
										span: 3,
										unit: 's',
										x: resetX,
										series: [{ name: 'age', points: queueAge, color: 1 }],
										thresholds: [{ value: 900, label: 'reset link TTL 15 min', tone: 'crit' }]
									},
									{
										kind: 'timeseries',
										title: 'NumberOfMessagesDeleted / min',
										span: 3,
										x: resetX,
										series: [{ name: 'sent', points: sentPerMin, color: 2 }]
									},
									{
										kind: 'timeseries',
										title: 'Email provider API latency',
										span: 3,
										unit: 'ms',
										x: resetX,
										series: [{ name: 'p95', points: espLatency, color: 3 }],
										yMin: 0
									}
								]
							}
						},
						{ type: 'p', text: 'Marketing scheduled the autumn campaign (240,000 recipients) for 10:00.' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: '[[transactional-email|Transactional]] and marketing email share one [[fifo-queue|FIFO]]-ish queue; resets wait behind 240k newsletters.',
									body: 'At 10:00 queue depth jumps to 240k and the workers run at full capacity (~2,500/min, the flat ceiling), so they are not broken. The [[queue-age]] climbs linearly and crosses the 15-minute link [[ttl|TTL]] around 10:15. A reset requested at 10:30 sits behind ~165k campaign emails and arrives ~65 min later, long expired.',
									confirm: 'Sample reset emails: enqueue time vs provider "accepted" time.'
								},
								{
									title: 'Provider slowness (support\'s "status page" check).',
									body: 'Red herring: provider latency is flat at ~180 ms. The time is spent *before* we call the provider.'
								},
								{
									title: 'Reset link TTL changed.',
									body: 'Cheap to rule out with a config diff. But the age chart already explains the symptom.'
								}
							]
						},
						{
							type: 'p',
							text: '**Now:** pause the campaign; resets drain immediately. **Fix:** separate queues (or priorities) for transactional vs bulk email with dedicated workers, [[rate-limiting|rate-limit]] bulk sends, alert on age of oldest *transactional* message > 60 s. Optionally start the reset link\'s TTL when the email is sent, not when it\'s requested.'
						},
						reply(
							'support',
							"Thanks, this one's fixed as of 10:52. The links didn't get shorter. At 10:00 a 240,000-person marketing email started sending, and password reset emails were stuck waiting behind it. So by the time they arrived, the 15-minute link had expired.\n\nWe paused the campaign, and reset emails are arriving within seconds again. Please ask affected customers to request a new link, and it'll work. We're moving reset emails onto their own channel this week so a big campaign can't slow them down again."
						)
					]
				}
			]
		},

		// ═══════════════════════════ PART 3 ═══════════════════════════
		{
			id: 'p3',
			nav: '3 · Operations',
			eyebrow: 'Part 3 · 20 minutes · marketing, sales, ops',
			title: 'The business is growing and things are breaking',
			meta: 'scheduled jobs · shared environments · stock · experiments · search',
			questions: [
				{
					id: 'p3q1',
					title: '"The newsletter went out twice. Some people got it three times."',
					tag: 'core',
					minutes: 6,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'slack',
								from: 'Sofia Russo',
								role: 'Marketing',
								time: 'Tue 09:20',
								body:
									"Our Tuesday newsletter went to everyone TWICE this morning and I'm getting angry replies. A few people say they got it three times. This has never happened before. Nothing changed on our side, I scheduled it exactly like every week!!"
							}
						},
						{
							type: 'logs',
							logs: {
								style: 'kibana',
								query: 'message:"newsletter"',
								lines: [
									{ ts: '09:00:00.012', source: 'api-7f9c-a', level: 'INFO', msg: 'scheduler: starting job send_weekly_newsletter' },
									{ ts: '09:00:00.019', source: 'api-7f9c-b', level: 'INFO', msg: 'scheduler: starting job send_weekly_newsletter' },
									{ ts: '09:00:41.880', source: 'api-7f9c-a', level: 'WARN', msg: 'batch 212 send timed out after 30s, retrying', fields: { batch: 212, size: 500 } },
									{ ts: '09:00:43.104', source: 'api-7f9c-a', level: 'INFO', msg: 'batch 212 sent', fields: { batch: 212 } },
									{ ts: '09:06:12.551', source: 'api-7f9c-b', level: 'INFO', msg: 'newsletter complete', fields: { recipients: 48311 } },
									{ ts: '09:06:15.002', source: 'api-7f9c-a', level: 'INFO', msg: 'newsletter complete', fields: { recipients: 48311 } }
								]
							}
						},
						{ type: 'p', text: 'Last Thursday the API was moved from one VM to an [[autoscaling]] group with a minimum of 2 instances.' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'The scheduler runs inside the app, so every instance sends the newsletter.',
									body: 'Two pods both log "starting job" at 09:00:00. With one VM there was one scheduler; with two pods there are two. Marketing is right that nothing changed *on their side*. See [[duplicate-scheduler]].',
									confirm: 'Instance count at 09:00 = 2 = number of copies most people got.'
								},
								{
									title: 'Third copy: retry after [[timeout]] without an [[idempotency-key]].',
									body: 'Batch 212 timed out and was resent. The provider had accepted the first attempt, so those 500 people got a third copy. A timeout means "unknown", not "failed".',
									confirm: 'The ~500 "three times" complaints should all be in batch 212.'
								}
							]
						},
						{
							type: 'p',
							text: '**Fix:** run scheduled jobs from one place (an external scheduler, or a [[distributed-lock|DB lock]] / [[leader-election|leader election]] so only one instance runs it), record each send as `(campaign_id, recipient_id)` with a unique constraint so a second run is a no-op, and pass an [[idempotency-key]] per batch to the email provider.'
						},
						reply(
							'Sofia',
							"Hi Sofia, you're right, nothing changed on your side. It was us.\n\nLast week we started running the system on two servers instead of one, so it could handle more traffic. Both servers sent the scheduled newsletter. One batch of about 500 people also hit a network hiccup and was sent a third time.\n\nBefore next Tuesday, newsletter sending will run in only one place, and the system will refuse to send the same campaign to the same person twice. If it would help with the replies, I can draft a short apology line you could use."
						)
					]
				},
				{
					id: 'p3q2',
					title: '"The demo environment is unusable every afternoon"',
					tag: 'tricky',
					minutes: 7,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'slack',
								from: 'Lena Hoffmann',
								role: 'Sales · Berlin',
								time: 'Wed 16:05',
								body:
									"The demo site is unbearably slow every afternoon. Mornings are fine. I've lost two demos this week because pages take 5+ seconds. Is it because we have too many sales people using it in the afternoon? Can we get a bigger server?"
							}
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'demo environment',
								range: 'Mon 00:00 – Wed 23:00 UTC',
								filters: ['env=demo', 'db=shared-nonprod-pg'],
								panels: [
									{
										kind: 'timeseries',
										title: 'Demo p95 latency',
										span: 3,
										unit: 'ms',
										x: demoX,
										series: [{ name: 'p95', points: demoP95, color: 1 }]
									},
									{
										kind: 'timeseries',
										title: 'Demo requests / min',
										span: 3,
										x: demoX,
										series: [{ name: 'rpm', points: demoRpm, color: 0 }]
									},
									{
										kind: 'timeseries',
										title: 'shared-nonprod-pg CPU',
										span: 3,
										unit: '%',
										x: demoX,
										series: [{ name: 'cpu', points: dbCpu, color: 2 }],
										yMax: 100
									},
									{
										kind: 'timeseries',
										title: 'DB connections by application',
										span: 3,
										stacked: true,
										area: true,
										x: demoX,
										series: [
											{ name: 'demo-app', points: connDemo, color: 0 },
											{ name: 'staging-e2e', points: connQa, color: 3 }
										]
									}
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Testable claim:** "Demo latency is high 12:00–19:00 [[utc|UTC]] on weekdays (14:00–21:00 Berlin)." Lena\'s theory (too many sales people) is checkable against the request-rate panel.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Demo shares its database with staging, and the US QA team\'s end-to-end suite hammers it in their morning.',
									body: 'DB CPU goes from ~17% to ~88% at 12:00 UTC, which is 08:00 in New York. `staging-e2e` connections jump from 0 to 140 at the same time. Demo latency tracks DB CPU exactly. Lena\'s afternoon is QA\'s morning.',
									confirm: 'QA test schedule; [[pg-stat-activity|pg_stat_activity]] grouped by `application_name` at 13:00 UTC.'
								},
								{
									title: 'Too many sales users (Lena\'s theory).',
									body: 'Red herring: demo traffic is flat across 07:00–16:00 UTC (Berlin business hours), just as high in the fast morning as in the slow afternoon, and the slow window lasts until 19:00 UTC, after most of the sales team has logged off.'
								},
								{
									title: 'Undersized server.',
									body: 'A bigger *demo app* server wouldn\'t help; the bottleneck is the shared DB. A bigger DB would mask it, at a cost, until QA adds more tests.'
								}
							]
						},
						{
							type: 'p',
							text: '**Fix:** give demo its own small database (it\'s customer-facing, so it deserves production-like isolation) or move the E2E suite to its own ephemeral DB. Short term: ask QA to run the heavy suite before 12:00 UTC or cap its connections.'
						},
						reply(
							'Lena',
							"Hi Lena, sorry about the lost demos. It's not the sales team: demo usage is actually highest in your mornings, when it's fast.\n\nThe demo site shares a database with our testing environment. Every afternoon your time, the US testing team starts their automated tests (it's their morning) and they slow the shared database down a lot.\n\nFrom tomorrow the tests run on a separate copy, so afternoons should be as fast as mornings. Next week the demo site gets its own database for good. Ping me straight away if a demo is slow after tomorrow."
						)
					]
				},
				{
					id: 'p3q3',
					title: '"Inventory shows minus three. How is that even possible?"',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'Omar Haddad',
								role: 'Operations',
								subject: 'Negative stock after flash sale',
								body:
									"After yesterday's flash sale the limited-edition backpack shows -3 in stock. We only had 200. So we sold 203 and now I have to email 3 customers that we can't ship. The warehouse counted twice, there were definitely 200. Is the website counting wrong?"
							}
						},
						{
							type: 'code',
							lang: 'python',
							code: `def place_order(sku, qty):
    item = db.query("SELECT qty_available FROM stock WHERE sku = %s", sku)
    if item.qty_available < qty:
        raise SoldOut()
    db.execute("UPDATE stock SET qty_available = %s WHERE sku = %s",
               item.qty_available - qty, sku)
    create_order(sku, qty)`
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Cause:** check-then-act [[race-condition]] → [[oversell]]. Two requests both read `1`, both pass the check, both write `0`, and both create an order. The "write the value I computed" form also [[lost-update|loses updates]], so stock can go negative once a later restock or adjustment subtracts from a wrong base. It only shows under flash-sale concurrency.'
						},
						{
							type: 'code',
							lang: 'sql',
							caption: 'Check and change in one atomic statement. If 0 rows are updated, it\'s sold out.',
							code: `UPDATE stock
SET qty_available = qty_available - :qty
WHERE sku = :sku AND qty_available >= :qty
RETURNING qty_available;`
						},
						{
							type: 'p',
							text: 'Do the [[conditional-update]] and the order insert in the same transaction, and add `CHECK (qty_available >= 0)` as a safety net. Test: 50 concurrent buyers against stock of 10 must produce exactly 10 orders.'
						},
						reply(
							'Omar',
							"Hi Omar, the warehouse count was right. The website sold three backpacks it didn't have.\n\nWhen hundreds of people buy in the same second, two customers could both see \"1 left\" and both be allowed to buy it. It only happens under very heavy traffic, which is why the flash sale was the first time we've seen it.\n\nThe fix will be live before the next sale: the stock check and the purchase now happen as a single step, so the last item can only go to one person. For the 3 customers, I'd suggest a full refund plus a discount code. Happy to pull their order numbers for you."
						)
					]
				},
				{
					id: 'p3q4',
					title: '"The new checkout converts 40% better! Why hasn\'t revenue moved?"',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'Ravi Patel',
								role: 'Head of Growth',
								subject: 'Checkout A/B test — roll out to 100%?',
								body:
									"Our checkout experiment has been running two weeks. Variant B (the new one-page checkout) shows 5.6% conversion vs 4.0% for A. That's +40%!! But finance says revenue is flat. I think finance is looking at the wrong period. Can we roll B out to everyone this week?"
							}
						},
						{
							type: 'table',
							head: ['Variant', 'Users assigned', '`checkout_completed` events', 'Orders in DB', 'Revenue'],
							numeric: [1, 2, 3, 4],
							rows: [
								['A (old)', '50,120', '2,005', '2,001', '$160,200'],
								['B (new)', '44,870', '2,512', '1,795', '$143,900']
							]
						},
						{
							type: 'p',
							text: 'The [[ab-test|A/B test]] split is configured as 50/50. Variant B\'s confirmation page fires the analytics event in `onMount`, and B redirects through `/checkout/v2` before assignment is logged.'
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'The event is over-counted in B: it fires on every view of the confirmation page.',
									body: 'B has 2,512 events but only 1,795 orders: 1.4 events per order, vs ~1.0 in A. Refreshes, back-button and re-opened tabs each fire `onMount` again. Measured by **orders**, conversion is A 3.99% vs B 4.00%. No difference.',
									confirm: 'Count distinct `order_id` per event in B.'
								},
								{
									title: '[[sample-ratio-mismatch]]: 50,120 vs 44,870 on a 50/50 split.',
									body: 'That gap (~5%) is far outside random chance for these sizes. Some B users are lost before assignment is logged, probably bouncing during the extra redirect. The experiment is invalid regardless of the metric.',
									confirm: '[[statistical-significance|Chi-square test]] on the counts; check B users who hit `/checkout/v2` without an assignment log.'
								}
							]
						},
						{
							type: 'p',
							text: '**Recommendation:** don\'t roll out on this data. Fix the event (fire once per `order_id`, server-side), log assignment before the redirect, re-run, and use orders/revenue per assigned user as the primary metric.'
						},
						reply(
							'Ravi',
							"Hi Ravi, I looked into it, and finance is right this time. I'd hold the rollout.\n\nThe new checkout records a \"purchase\" every time someone views the confirmation page, including refreshes, so it's counted about 1.4 purchases per real order. Counting actual orders, both versions convert at 4.0%.\n\nThe test also didn't split visitors evenly (50k vs 45k). That usually means some visitors to the new version get lost before we record them, so the results can't be fully trusted.\n\nBoth issues can be fixed by Friday. Then I'd suggest re-running the test for two weeks. The new checkout may still be better, we just can't tell from this data."
						)
					]
				},
				{
					id: 'p3q5',
					title: '"New products take hours to show up in search"',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'jira',
								from: 'Hannah Kim',
								role: 'Merchandising',
								subject: 'MERCH-311: Search is slow to update',
								body:
									"When we add products, they don't appear in search for hours. Customers email us asking where the new collection is. It started a few weeks ago. Can search be made faster?"
							}
						},
						{
							type: 'table',
							caption: 'Products created in the last two days',
							head: ['sku', 'created_at', 'created_via', 'indexed_at'],
							rows: [
								['CL-1001', 'Oct 13 10:02', 'admin form', 'Oct 13 10:02'],
								['CL-1002', 'Oct 13 10:05', 'admin form', 'Oct 13 10:05'],
								['CL-2040', 'Oct 13 11:30', 'csv bulk upload', 'Oct 14 03:00'],
								['CL-2041', 'Oct 13 11:30', 'csv bulk upload', 'Oct 14 03:00'],
								['CL-2042', 'Oct 14 09:12', 'csv bulk upload', '—'],
								['CL-1003', 'Oct 14 09:40', 'admin form', 'Oct 14 09:40']
							]
						}
					],
					answer: [
						{
							type: 'p',
							text: '**The obvious guess** is index lag (a slow consumer, [[eventual-consistency]]). But the table shows two populations: admin-form products are indexed within seconds; bulk-upload products only appear at **03:00**, the nightly full reindex. So search isn\'t slow; it\'s never told about bulk uploads.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'The bulk upload bypasses the code path that publishes "product created" events.',
									body: 'The admin form saves through the model layer, whose `after_save` hook notifies the indexer. The CSV tool (added "a few weeks ago", matching the report) uses a bulk insert for speed, which skips model hooks.',
									confirm: 'Read the bulk-upload code for `INSERT … SELECT` / `bulk_create` / `COPY`; check the indexer\'s input events for CL-2040.'
								}
							]
						},
						{
							type: 'p',
							text: '**Fix:** publish events explicitly after the bulk insert (one batch event with all SKUs), or move the "notify indexer" responsibility out of model hooks into an [[transactional-outbox|outbox]] the DB write itself populates. Add a check: products older than 10 min with `indexed_at IS NULL` → alert.'
						},
						reply(
							'Hannah',
							"Hi Hannah, search itself is fast. Products added one at a time appear within seconds. The problem is products added with the spreadsheet upload: that tool doesn't tell search about them, so they only show up after the nightly refresh at 3am.\n\nUntil the fix is out on Thursday, I've set up a button on the upload page that refreshes search. Press it after an upload and new products appear within a minute. Today's collection is already visible."
						)
					]
				}
			]
		},

		// ═══════════════════════════ PART 4 ═══════════════════════════
		{
			id: 'p4',
			nav: '4 · Writing',
			eyebrow: 'Part 4 · 20 minutes · written',
			title: 'Writing it back',
			meta: 'triage · clarifying questions · escalation · status updates',
			intro: [
				{
					type: 'cards',
					items: [
						{
							title: 'Always include',
							items: ['What happened, in one sentence', 'Who is affected (number, or "we\'re counting")', 'What we\'ve done already', 'What happens next, with a time', 'What they should do or say'],
						},
						{
							title: 'Never include',
							items: ['Jargon: "TTL", "race condition", "cache key", "idempotent"', 'Blame on a person or another team', 'Promises you can\'t verify yet ("no data was exposed")', 'Guesses dressed as facts'],
						},
						{
							title: 'Tone',
							items: ['Lead with the answer to their real question', 'Thank them for specifics; it encourages good reports', 'Short paragraphs, concrete dates', 'One clear ask, if you need something back']
						}
					]
				}
			],
			questions: [
				{
					id: 'p4q1',
					title: 'Triage six reports in two minutes',
					tag: 'core',
					minutes: 4,
					prompt: [
						{ type: 'p', text: 'All arrive on Monday morning. Assign [[severity-triage|SEV1–4]] and say which you\'d pick up first.' },
						{
							type: 'list',
							ordered: true,
							items: [
								'CEO: "The site is down for me."',
								'Customer: "I saw another person\'s order history."',
								'Finance: "The dashboard is $4k off the payment provider for yesterday."',
								'Marketing: "Newsletter went out twice."',
								'Support: "Checkout fails for everyone paying with Amex since 08:00."',
								'Warehouse: "6 orders stuck without labels."'
							]
						}
					],
					answer: [
						{
							type: 'table',
							head: ['#', 'Severity', 'Why'],
							rows: [
								['2', '**SEV1**', 'Possible [[personal-data-breach]]: legal clock running, possibly ongoing. First.'],
								['5', '**SEV1/2**', 'Money lost every minute for a whole segment, ongoing. Second, or in parallel with a second engineer.'],
								['4', 'SEV3', 'Already happened, can\'t be undone; prevent next send. Apologise today.'],
								['6', 'SEV3', 'Small, workaround exists (manual labels). Fix this week.'],
								['1', 'SEV3', 'If monitoring is green: one person, workaround available. Reply within minutes; that costs nothing.'],
								['3', 'SEV4', 'Definition mismatch until proven otherwise. No customer impact.']
							]
						},
						{
							type: 'p',
							text: 'The interview signal: you rank by **impact × ongoing**, you say why the CEO\'s report is low *and* you still reply to it immediately, because a fast reply is cheap and seniority is a real constraint on communication, not on severity.'
						}
					]
				},
				{
					id: 'p4q2',
					title: 'Rewrite this reply',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'slack',
								from: 'An engineer',
								role: 'Reply to Finance (draft)',
								body:
									"This isn't a bug. Our dashboard uses UTC and the PSP uses PST so obviously the daily aggregates differ, plus their net volume excludes refunds. If you need it to match you should've specified the TZ in the requirements. I can maybe add a tz param to the query at some point."
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: 'Problems: jargon (UTC, [[psp|PSP]], aggregates, tz param), blame ("you should\'ve"), "obviously", no reassurance about the actual worry (is money missing?), and no commitment ("at some point").'
						},
						reply(
							'Finance',
							"Hi Priya, no money is missing. The two systems count a \"day\" and \"revenue\" a little differently: the payment provider uses Pacific time and takes off refunds, and our dashboard used international time (UTC) and didn't. Over a whole week they match.\n\nBy Wednesday I'll add a view that uses the same rules as the provider, so the daily numbers match exactly. Until then, the provider's figures are the right ones for the board pack."
						)
					]
				},
				{
					id: 'p4q3',
					title: 'Template: clarifying questions before you touch code',
					tag: 'template',
					minutes: 3,
					prompt: [
						{ type: 'p', text: 'Write a reusable reply asking a non-technical reporter for what you need. It must be easy to answer from a phone.' }
					],
					answerLabel: 'Show template',
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `Thanks for flagging this, I'm looking into it now.

To find it faster, could you send whichever of these you have?

1. One example: an order number, customer email, or link
2. Roughly when it happened (and which timezone, if you know)
3. What you expected to see, and what you saw instead
4. A screenshot, if it's on screen
5. Does it happen every time, or only sometimes?

No need to answer everything, even one example helps.
I'll update you by [time] either way.`
						},
						{
							type: 'p',
							text: 'Each question kills hypotheses: an identifier lets you trace one case end to end; the time with timezone separates [[day-boundary]] and deploy issues; "every time or sometimes" separates deterministic bugs from races and caches.'
						}
					]
				},
				{
					id: 'p4q4',
					title: 'Template: escalation message for a suspected data exposure',
					tag: 'template',
					minutes: 4,
					prompt: [
						{ type: 'p', text: 'For the "saw someone else\'s address" incident (a [[severity-triage|SEV1]]): write the first message to the security lead and the data protection officer.' }
					],
					answerLabel: 'Show template',
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `SEV1 — suspected personal data exposure (account pages)
Reported: Fri 14:31 by a customer via support (ticket #55120)
Status:   CONTAINED at 15:20 (change rolled back, CDN cache purged)

What we know
- From Thu 17:40 to Fri 15:20, logged-in account pages could be
  cached by our CDN and shown to other users for up to 5 minutes.
- Data visible on that page: name, email, shipping address, last 5 orders.
  No passwords or card numbers are on that page.

What we don't know yet
- How many users saw another user's page. CDN logs preserved; estimate by 18:00.

Asks
- DPO: please start the notification assessment (72h clock from Fri 14:31).
- Support: hold replies to the reporter until legal approves wording.

Next update: 17:00 or sooner. Incident channel: #inc-account-cache`
						},
						{
							type: 'p',
							text: 'It separates known from unknown, gives the clock start time, lists exactly what data was on the page, and asks named people for named actions.'
						}
					]
				},
				{
					id: 'p4q5',
					title: 'Template: status update to leadership during an incident',
					tag: 'template',
					minutes: 4,
					prompt: [{ type: 'p', text: 'Checkout has been failing for Amex cards for 40 minutes. Write the update for the leadership channel.' }],
					answerLabel: 'Show template',
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `[UPDATE 2 · 08:40] Amex payments failing at checkout

Impact: customers paying with Amex can't complete checkout since 08:00.
        ~12% of orders; roughly $3k/hour in delayed sales. Other cards work.
Cause:  confirmed with our payment provider: an Amex-specific outage on their side.
Doing:  showing "please use another card" on checkout for Amex (live 08:35).
        Provider ETA for their fix: 09:30.
Customer comms: support has a macro; no proactive email unless it passes 2 hours.
Next update: 09:15.`
						},
						{
							type: 'p',
							text: 'Leadership wants: impact in customers and money, whether it\'s getting worse, what\'s mitigating it, and when they\'ll hear next. Cause can be "unknown, investigating". That\'s fine to say.'
						}
					]
				}
			]
		},

		// ═══════════════════════════ TEASERS ═══════════════════════════
		{
			id: 'teasers',
			nav: 'Teasers',
			eyebrow: 'Rapid fire · 1–2 min each',
			title: 'Brain teasers',
			meta: 'quick reasoning reps for human-reported bugs',
			questions: [
				{
					id: 't1',
					title: 'Weekly totals match, daily totals don\'t',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'Two revenue reports agree over a month but differ day to day, with alternating signs. Most likely cause?' }],
					answer: [{ type: 'p', text: 'Different [[day-boundary|day boundaries]] (timezones). Missing data makes one side *consistently* lower; alternating signs mean money is moving between days.' }]
				},
				{
					id: 't2',
					title: '"It fixes itself if I refresh after a few minutes"',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'What class of cause does that phrase point to?' }],
					answer: [{ type: 'p', text: 'Something with a [[ttl]]: a cache (CDN, app cache), DNS, or a token. The few minutes is the TTL. Ask exactly how long; it often matches a config value.' }]
				},
				{
					id: 't3',
					title: '"Only since we started growing"',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'Name four bugs that appear when you go from one server to several.' }],
					answer: [
						{
							type: 'list',
							items: [
								'In-process scheduled jobs run once per instance ([[duplicate-scheduler]]).',
								'In-memory sessions or caches differ per instance ("logged out randomly").',
								'Check-then-act races become real ([[oversell]]).',
								'Local file uploads saved on one instance, missing on the others.'
							]
						}
					]
				},
				{
					id: 't4',
					title: '`parseFloat("1.299,00")`',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'What does it return, and why is that worse than an error?' }],
					answer: [{ type: 'p', text: '`1.299`. It parses until the comma and silently ignores the rest. An exception would stop the import; a plausible-looking wrong number goes live. See [[locale-formatting]].' }]
				},
				{
					id: 't5',
					title: '"Charged twice": what do you ask for?',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'One message back to the customer. Which two things?' }],
					answer: [{ type: 'p', text: 'The order number (or account email) and the two charge dates/amounts from their statement. Often one is a pending [[auth-and-capture|authorisation]] that will drop off, not a second charge, and only the statement shows that.' }]
				},
				{
					id: 't6',
					title: 'Who\'s affected is the clue',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'Match: (a) only Australia, (b) only names like Zoë, (c) only the office, (d) only big accounts, (e) only on the 1st.' }],
					answer: [
						{
							type: 'list',
							items: [
								'(a) UTC-based date math, see [[utc]].',
								'(b) Character set / [[unicode-normalization]].',
								'(c) DNS resolver cache, proxy, or firewall ([[dns-ttl]]).',
								'(d) Pagination, timeouts, or limits that scale with data size.',
								'(e) Monthly batch jobs and [[snapshot-timing]].'
							]
						}
					]
				},
				{
					id: 't7',
					title: 'The reporter says "it\'s the database"',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'How do you respond?' }],
					answer: [{ type: 'p', text: 'Take the *symptom* seriously and the *diagnosis* as one hypothesis. Thank them, ask what they saw, and don\'t correct them until you know. Sometimes they\'re right.' }]
				},
				{
					id: 't8',
					title: '"Since yesterday": your first three checks',
					tag: 'teaser',
					prompt: [],
					answer: [
						{
							type: 'list',
							ordered: true,
							items: [
								'Deploys and config/feature-flag changes (ours) in the window.',
								'Infra or vendor changes (DNS, CDN rules, provider status/incidents).',
								'The calendar: month end, [[dst|DST]] change, a holiday, a big campaign, a scheduled job that only runs weekly or monthly.'
							]
						}
					]
				},
				{
					id: 't9',
					title: 'Does a $0.01 difference matter?',
					tag: 'teaser',
					prompt: [],
					answer: [{ type: 'p', text: 'To an auditor, yes. Not because of the amount, but because an unexplained difference means you can\'t prove the process is correct. The answer is a mechanism ("rounding per line vs once"), not "it\'s small". See [[reconciliation]].' }]
				}
			]
		}
	]
};

export default assessment;
