import type { GlossaryTerm } from '../types';

const terms: GlossaryTerm[] = [
	{
		id: 'psp',
		term: 'PSP (payment service provider)',
		aliases: ['payment provider', 'acquirer gateway'],
		category: 'fintech',
		short:
			'The company that takes a card payment from your checkout to the card networks and banks, and later pays you the money. You talk to its API; it talks to the acquiring bank, the network and the issuer. Its responses and its reports are two different views of the same money, and they disagree more often than people expect.',
		analogy: 'A courier you hand parcels to. You get a receipt at the counter (the API response) and a monthly statement (the settlement report); reconciliation is checking they describe the same parcels.',
		related: ['card-network', 'payment-orchestrator', 'auth-and-capture', 'settlement']
	},
	{
		id: 'card-network',
		term: 'Card network',
		aliases: ['scheme', 'card scheme', 'Visa', 'Mastercard'],
		category: 'fintech',
		short:
			'The rails between the merchant\'s bank (acquirer) and the cardholder\'s bank (issuer). The network routes authorizations, clears and settles money between banks, sets the rules (dispute deadlines, retry limits, fees) and fines merchants who break them. "Scheme rules" is the rulebook your retry and dispute logic must obey.',
		related: ['psp', 'interchange-plus-plus', 'representment', 'soft-decline']
	},
	{
		id: 'payment-orchestrator',
		term: 'Payment orchestrator',
		category: 'fintech',
		short:
			'Your own service that sits between checkout and one or more PSPs: it picks a provider, attaches idempotency keys, retries, fails over and records every attempt. It is where duplicate charges are either prevented or created, because it is the only component that sees attempts across providers.',
		related: ['psp', 'idempotency-key', 'traffic-shifting']
	},
	{
		id: 'auth-reversal',
		term: 'Authorization reversal',
		aliases: ['void', 'auth void'],
		category: 'fintech',
		short:
			'A message telling the issuer to release a hold you no longer intend to capture. Without it, an abandoned or duplicate authorization keeps the customer\'s money frozen for days (often up to 7, longer for some card types) and shows as a "pending charge" they will call about. After a timeout of unknown outcome, sending a reversal for that attempt is the safe cleanup.',
		related: ['auth-and-capture', 'auth-expiry', 'timeout']
	},
	{
		id: 'auth-expiry',
		term: 'Authorization expiry',
		category: 'fintech',
		short:
			'An authorization is only guaranteed for a limited window (commonly about 7 days for card-not-present, varying by network, card type and merchant category). Capturing after it lapses may be declined or downgraded to a costlier fee tier. Backorders and split shipments are where this bites.',
		related: ['auth-and-capture', 'multicapture', 'auth-reversal']
	},
	{
		id: 'multicapture',
		term: 'Multicapture (partial captures)',
		aliases: ['partial capture', 'split capture'],
		category: 'fintech',
		short:
			'Capturing one authorization in several pieces, e.g. per shipped parcel. Many PSPs allow only a single capture per authorization unless multicapture is enabled; the first partial capture then releases the remainder. The code works in testing with one parcel and fails on the second.',
		related: ['auth-and-capture', 'auth-expiry']
	},
	{
		id: 'soft-decline',
		term: 'Soft vs hard decline',
		aliases: ['do not honor', 'decline codes'],
		category: 'fintech',
		short:
			'A hard decline (stolen card, closed account) will never succeed; a soft decline (insufficient funds, generic "do not honor", issuer unavailable) might succeed later. Networks limit how often you may retry the same card, and issuers treat rapid identical retries as card-testing, so blind retries of soft declines lower your approval rate instead of raising it.',
		related: ['card-network', 'retry-storm', 'velocity-limit']
	},
	{
		id: 'three-ds',
		term: '3-D Secure (3DS)',
		aliases: ['3DS2', 'SCA challenge'],
		category: 'fintech',
		short:
			'Cardholder authentication where the issuer may challenge the buyer (app approval, one-time code) before authorizing. In browser flows the buyer leaves your site for the issuer\'s page and comes back through a cross-site redirect or POST, which is exactly where session cookies, SameSite rules and in-memory state go missing.',
		related: ['samesite-cookie', 'state-machine', 'payment-orchestrator']
	},
	{
		id: 'representment',
		term: 'Representment',
		aliases: ['dispute response', 'chargeback defense'],
		category: 'fintech',
		short:
			'Fighting a chargeback by sending evidence (delivery proof, logs, receipts) to the issuer through your PSP before a hard deadline. Miss the deadline or fail to formally submit, and the dispute is lost automatically, however good the evidence was.',
		related: ['chargeback', 'card-network']
	},
	{
		id: 'basis-point',
		term: 'Basis point (bp)',
		aliases: ['bps', 'bips'],
		category: 'fintech',
		short:
			'One hundredth of a percent: 1 bp = 0.01% = 0.0001. Rates and fees are quoted in bps because "an increase of 0.25%" is ambiguous (relative or absolute?). 25 bps on $2,000,000 a year is $5,000. Storing rates as integer bps also keeps them out of floating point.',
		related: ['minor-units', 'decimal-arithmetic', 'day-count-convention']
	},
	{
		id: 'day-count-convention',
		term: 'Day-count convention',
		aliases: ['ACT/360', 'ACT/365', '30/360'],
		category: 'fintech',
		short:
			'The rule for turning an annual rate into interest for a period: which days count and what the year length is. ACT/360 uses actual days over a 360-day year (so a full year pays slightly more than the quoted rate), ACT/365 uses 365, 30/360 pretends every month has 30 days. Same loan, same rate, three different interest amounts; a contract always names one.',
		related: ['basis-point', 'amortization', 'leap-year', 'bankers-rounding'],
		page: [
			{ type: 'heading', text: 'One loan, three answers' },
			{
				type: 'p',
				text: '$1,000,000 at 5.25% per year, for January (31 actual days). Interest = principal × rate × (days ÷ year basis).'
			},
			{
				type: 'table',
				head: ['Convention', 'Days', 'Basis', 'Interest'],
				numeric: [1, 2, 3],
				rows: [
					['ACT/360', '31', '360', '$4,520.83'],
					['ACT/365', '31', '365', '$4,458.90'],
					['30/360', '30', '360', '$4,375.00']
				],
				caption: '1,000,000 × 0.0525 × 31 ÷ 360 = 4,520.833…; × 31 ÷ 365 = 4,458.904…; × 30 ÷ 360 = 4,375 exactly.'
			},
			{ type: 'heading', text: 'Where rounding sneaks in' },
			{
				type: 'p',
				text: 'Accruing daily and rounding each day to cents: 1,000,000 × 0.0525 ÷ 360 = 145.8333… → **$145.83** per day, × 31 = **$4,520.73**: ten cents short of the period calculation ($4,520.83). Across 50,000 loans like this one that is $5,000 a month of interest nobody can explain. Accrue the exact value (Decimal or rational), round once when you post or bill, and write down which you do.'
			},
			{ type: 'heading', text: 'Simple vs compounded' },
			{
				type: 'p',
				text: 'Compounding daily on ACT/360 for 31 days: 1,000,000 × ((1 + 0.0525/360)³¹ − 1) = **$4,530.74**, $9.91 more than simple ACT/360. Products like savings accounts compound; most term loans charge simple interest on the outstanding balance each period.'
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'How to spot a day-count bug',
				text: 'Differences that are a fixed fraction (365/360 = 1.0139, so 1.39% high) or that appear only in 31-day months and February point at the convention, not at rounding. Rounding differences are cents and grow with the number of accrual steps.'
			}
		]
	},
	{
		id: 'amortization',
		term: 'Amortization schedule',
		aliases: ['annuity payment', 'loan schedule'],
		category: 'fintech',
		short:
			'The table of equal-ish loan payments where each payment covers that period\'s interest and repays some principal. The level payment is P·r ÷ (1 − (1 + r)⁻ⁿ) with periodic rate r; once you round it to cents, n identical payments no longer clear the balance exactly, so the final payment must absorb the leftover cents.',
		related: ['day-count-convention', 'basis-point', 'minor-units', 'largest-remainder'],
		page: [
			{ type: 'p', text: '$10,000 over 12 months at 7.5% per year: r = 0.075 ÷ 12 = 0.00625.' },
			{
				type: 'p',
				text: 'Payment = 10,000 × 0.00625 ÷ (1 − 1.00625⁻¹²) = 867.5742… → **$867.57**. Each month: interest = balance × r, rounded half-up to cents; principal = payment − interest.'
			},
			{
				type: 'table',
				head: ['#', 'Payment', 'Interest', 'Principal', 'Balance'],
				numeric: [0, 1, 2, 3, 4],
				rows: [
					['1', '867.57', '62.50', '805.07', '9,194.93'],
					['2', '867.57', '57.47', '810.10', '8,384.83'],
					['3', '867.57', '52.41', '815.16', '7,569.67'],
					['…', '…', '…', '…', '…'],
					['11', '867.57', '10.74', '856.83', '862.23'],
					['12', '**867.62**', '5.39', '862.23', '0.00']
				]
			},
			{
				type: 'p',
				text: 'Twelve payments of $867.57 would leave **$0.05** unpaid, because the rounded payment is $0.0042 short every month and that shortfall itself accrues interest. The final payment is "remaining balance + its interest" = 862.23 + 5.39 = $867.62. Total interest: $410.89.'
			},
			{
				type: 'callout',
				tone: 'info',
				text: 'Exact payment in integers: with rate in basis points, (1 + r) = (120000 + bps) ÷ 120000, so payment = P × bps × aⁿ ÷ (120000 × (aⁿ − 120000ⁿ)) where a = 120000 + bps. That is a ratio of big integers: round it half-up once and no float is ever involved.'
			}
		]
	},
	{
		id: 'fx-revaluation',
		term: 'FX revaluation',
		aliases: ['unrealized FX gain/loss', 'remeasurement'],
		category: 'fintech',
		short:
			'Re-expressing balances held in a foreign currency at today\'s exchange rate for reporting, and booking the difference as an unrealized gain or loss. The foreign-currency balance did not change; its value in your reporting currency did. Skip the revaluation entry and the books stop balancing in the reporting currency by exactly that difference.',
		related: ['double-entry-bookkeeping', 'ledger-invariant', 'rounding-residue-account'],
		page: [
			{ type: 'p', text: 'You hold €1,000,000 booked when EUR/USD was 1.0850. At month-end the rate is 1.0920.' },
			{
				type: 'table',
				head: ['', 'EUR', 'Rate', 'USD'],
				numeric: [1, 2, 3],
				rows: [
					['Booked', '1,000,000.00', '1.0850', '1,085,000.00'],
					['Month-end value', '1,000,000.00', '1.0920', '1,092,000.00'],
					['Unrealized gain', '', '', '7,000.00']
				]
			},
			{
				type: 'code',
				lang: 'text',
				caption: 'The revaluation entry. Both lines are in USD; the EUR balance is untouched.',
				code: `Dr  Cash – EUR (USD carrying value)     7,000.00
    Cr  Unrealized FX gain (P&L)               7,000.00`
			},
			{
				type: 'p',
				text: 'Next month you either reverse this entry and revalue again from the original rate, or revalue incrementally from 1.0920. Mixing the two methods double-counts. Which method you use is an accounting policy decision; the engineering job is to make it explicit and idempotent per period.'
			}
		]
	},
	{
		id: 'rounding-residue-account',
		term: 'Rounding residue account',
		aliases: ['rounding account', 'penny account'],
		category: 'fintech',
		short:
			'A ledger account that absorbs the cents created when one amount is split, converted or rounded into several. Splitting €100.00 three ways gives 33.33 × 3 = 99.99; the missing cent must go somewhere explicit, or the ledger stops balancing. A residue account makes it visible and auditable instead of silently given away or lost.',
		related: ['largest-remainder', 'double-entry-bookkeeping', 'fx-revaluation', 'minor-units']
	},
	{
		id: 'available-balance',
		term: 'Available vs ledger balance (holds)',
		aliases: ['pending balance', 'holds'],
		category: 'fintech',
		short:
			'Ledger balance is settled money; available balance is ledger minus holds (authorized but not yet settled debits) and sometimes plus pending credits. Spend decisions must check available, under the same lock or condition that creates the hold, or two concurrent spends both see enough money.',
		related: ['lost-update', 'select-for-update', 'optimistic-locking', 'hot-account']
	},
	{
		id: 'hot-account',
		term: 'Hot account',
		category: 'fintech',
		short:
			'A single ledger account touched by almost every transaction (platform fees, a settlement clearing account). Locking its balance row serializes the whole system: if each transaction holds the lock 1.5 ms, the ceiling is about 666 transactions per second no matter how many servers you add. Fixes split the account into shards or buffer the postings and aggregate.',
		related: ['hot-partition', 'select-for-update', 'littles-law', 'lock-wait']
	},
	{
		id: 'event-sourced-ledger',
		term: 'Event-sourced balances',
		aliases: ['event sourcing', 'projection rebuild'],
		category: 'fintech',
		short:
			'Storing every money movement as an immutable event and computing balances by replaying them (a projection), usually from a snapshot. It gives a perfect audit trail, but a rebuild re-reads years of old events, so every old event format must still be interpreted exactly as it was meant when written.',
		related: ['event-upcasting', 'schema-evolution', 'snapshot-timing']
	},
	{
		id: 'event-upcasting',
		term: 'Event upcasting',
		category: 'fintech',
		short:
			'Converting old event versions into the current shape as they are read, e.g. turning a v1 `amount: 12.50` (dollars) into v2 `amount_minor: 1250` (cents). Without an explicit upcaster per version, a projection rebuild silently mixes units or defaults missing fields.',
		related: ['event-sourced-ledger', 'schema-evolution', 'minor-units']
	},
	{
		id: 'three-way-reconciliation',
		term: 'Three-way reconciliation',
		aliases: ['3-way recon'],
		category: 'fintech',
		short:
			'Matching the same money across three independent records: your ledger, the PSP\'s settlement report and the bank statement. Each pair catches different failures: ledger↔PSP finds missing or duplicate transactions; PSP↔bank finds payouts that never arrived or were netted differently. Every break should be classified (timing, fees, FX, duplicates, genuine loss) rather than "written off".',
		related: ['reconciliation', 'settlement', 'settlement-netting', 'cutoff-time'],
		page: [
			{ type: 'p', text: 'One business day, three sources.' },
			{
				type: 'table',
				head: ['Line', 'Ledger (Berlin day)', 'PSP report (UTC day)', 'Bank statement'],
				numeric: [1, 2, 3],
				rows: [
					['Gross sales', '48,210.00', '47,930.00', ''],
					['Refunds', '−1,150.00', '−1,150.00', ''],
					['Processing fees', '', '−702.15', ''],
					['Chargebacks', '', '−89.90', ''],
					['Net payout', '', '45,987.95', '45,987.95 (two days later)'],
					['Bank receiving fee', '', '', '−15.00']
				]
			},
			{
				type: 'list',
				items: [
					'**Ledger vs PSP gross (+280.00):** different day boundaries. The Berlin day runs 22:00–22:00 UTC in summer; the PSP day runs 00:00–24:00 UTC. The ledger includes €1,630.00 of sales from 22:00–24:00 UTC the previous evening and excludes €1,350.00 from 22:00–24:00 UTC this evening: 1,630 − 1,350 = 280. Timing, not loss.',
					'**Fees and chargebacks:** exist only at the PSP. If they are not booked from the report, the ledger overstates revenue by €792.05 every day.',
					'**PSP vs bank:** amounts match but two days apart (T+2 settlement). The €15.00 is the bank\'s fee and needs its own expense entry.'
				]
			}
		]
	},
	{
		id: 'cutoff-time',
		term: 'Cutoff time',
		aliases: ['end-of-day cutoff', 'business day boundary'],
		category: 'fintech',
		short:
			'The moment each system closes "today". PSPs often cut off in UTC, banks in their local time, your ledger in the company\'s timezone. Items between cutoffs land on different days in different systems, producing daily breaks that net to zero over time and shift by an hour around daylight-saving changes.',
		related: ['day-boundary', 'utc', 'dst', 'three-way-reconciliation']
	},
	{
		id: 'settlement-netting',
		term: 'Settlement netting',
		category: 'fintech',
		short:
			'Paying out the net of a batch (sales − refunds − fees − chargebacks) instead of each item separately. It means the bank receives one number that matches no single transaction, and on days with more refunds than sales the net is negative: the PSP debits your bank account instead of crediting it.',
		related: ['settlement', 'three-way-reconciliation', 'chargeback']
	},
	{
		id: 'iso-20022',
		term: 'ISO 20022',
		aliases: ['pacs.008', 'camt.053', 'camt.054', 'MX messages'],
		category: 'fintech',
		short:
			'The XML standard banks are migrating payment messages to, replacing the older SWIFT MT text formats. It carries richer, structured data (e.g. a creditor reference in its own field instead of free text), so matchers written for the old free-text remittance line can stop finding invoice numbers after a bank switches format.',
		related: ['remittance-information', 'reconciliation', 'unicode-normalization']
	},
	{
		id: 'remittance-information',
		term: 'Remittance information',
		category: 'fintech',
		short:
			'The part of a bank transfer that says what the payment is for, usually an invoice or customer reference. In old SWIFT MT messages it was up to 4 lines of 35 characters of a restricted character set; in ISO 20022 it can be unstructured text or a structured reference. Reconciliation of incoming wires depends on parsing it correctly.',
		related: ['iso-20022', 'reconciliation']
	},
	{
		id: 'interchange-plus-plus',
		term: 'Interchange++ pricing',
		aliases: ['IC++', 'blended pricing', 'effective rate'],
		category: 'fintech',
		short:
			'A card-fee model where you pay the issuer\'s interchange + the network\'s scheme fee + the PSP\'s markup, each varying by card type and region. Your effective rate therefore moves when your customer mix moves (more business or foreign cards), even when no price changed. Blended pricing hides this inside one flat rate.',
		related: ['card-network', 'psp', 'basis-point', 'simpsons-paradox']
	},
	{
		id: 'fail-open-closed',
		term: 'Fail open vs fail closed',
		category: 'fintech',
		short:
			'What a system does when a dependency it consults (fraud score, feature flag, auth) does not answer in time. Fail open allows the action; fail closed blocks it. For payments both are wrong as a blanket rule: fail closed declines good customers during every fraud-service hiccup, fail open is free money for fraudsters. Real policies depend on amount, risk tier and what can be reviewed later.',
		related: ['timeout', 'hedged-requests', 'circuit-breaker']
	},
	{
		id: 'velocity-limit',
		term: 'Velocity limit',
		category: 'fintech',
		short:
			'A cap on how often something may happen per key and time window, e.g. at most 5 card attempts per card per 10 minutes. Enforced separately in each region or with fixed windows, the real limit becomes a multiple of the configured one, which is exactly what card-testing bots probe for.',
		related: ['sliding-window', 'token-bucket', 'card-testing', 'quota-leasing']
	},
	{
		id: 'card-testing',
		term: 'Card testing',
		aliases: ['carding', 'BIN attack'],
		category: 'fintech',
		short:
			'Fraudsters running many small authorizations to discover which stolen card numbers work. Each attempt costs you a fee and raises your decline ratio, which issuers and networks watch; a bad ratio lowers approval rates for your real customers and can trigger monitoring programmes and fines.',
		related: ['velocity-limit', 'soft-decline']
	},
	{
		id: 'sanctions-screening',
		term: 'Sanctions screening',
		category: 'fintech',
		short:
			'Checking names (customers, payees, counterparties) against government sanctions lists before moving money. It uses fuzzy matching because names are transliterated and misspelled, so it produces many false positives that humans must clear. Because true hits are extremely rare, even a 99.5%-specific matcher produces mostly false alerts.',
		related: ['kyc', 'base-rate-fallacy', 'unicode-normalization']
	},
	{
		id: 'base-rate-fallacy',
		term: 'Base-rate fallacy',
		category: 'fintech',
		short:
			'Ignoring how rare the thing you are detecting is. If 3 in 1,000,000 payees are truly sanctioned and your screener flags 0.5% of innocent ones, you get ~5,000 alerts for 3 real hits: 99.94% of alerts are false. Tuning a detector without the base rate makes the alert queue, not the model, the bottleneck.',
		related: ['sanctions-screening', 'percentiles']
	},
	{
		id: 'kyc',
		term: 'KYC (know your customer)',
		aliases: ['identity verification', 'CDD'],
		category: 'fintech',
		short:
			'Verifying who a customer is (documents, liveness, address, ownership for businesses) before and while they use regulated financial features. It is a long-lived state machine, not a one-off check: documents expire, lists update, and vendor webhooks arrive late and out of order.',
		related: ['state-machine', 'out-of-order-delivery', 'sanctions-screening']
	},
	{
		id: 'hash-chain-audit',
		term: 'Hash-chained audit log',
		aliases: ['tamper-evident log'],
		category: 'fintech',
		short:
			'An append-only log where each record stores a hash of the previous record, so altering or deleting any past entry breaks every hash after it. It detects tampering but needs a single, ordered writer per chain: two concurrent writers that both read the same "previous" hash fork the chain and make honest data look tampered.',
		related: ['ledger-invariant', 'race-condition']
	},
	{
		id: 'card-tokenization',
		term: 'Card tokenization',
		aliases: ['vaulting', 'network tokens'],
		category: 'fintech',
		short:
			'Replacing the card number (PAN) with a token so your systems never store or see the real number; the PSP or network keeps the mapping. It shrinks PCI scope only if the raw number never touches your servers at all: one endpoint, log line or mobile path that receives it puts those systems back in scope.',
		related: ['pci-dss', 'pii-redaction']
	},
	{
		id: 'pci-dss',
		term: 'PCI DSS',
		aliases: ['PCI scope'],
		category: 'fintech',
		short:
			'The card industry\'s security standard for anyone who stores, processes or transmits card data. Its cost is driven by scope: every system that touches a card number, plus everything connected to those systems. Engineering for PCI is mostly engineering to keep card numbers out of your systems.',
		related: ['card-tokenization', 'least-privilege-default']
	}
];

export default terms;
