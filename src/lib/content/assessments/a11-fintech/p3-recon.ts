import type { Part } from '../../types';
import { dayAxis, rng } from '../../series';

const days = dayAxis('Oct 15', 28);
/** Daily unmatched amount between ledger and bank: small every day, larger Oct 25–31. */
const breaks = (() => {
	const r = rng(41);
	return days.map((_, i) => {
		const inGap = i >= 10 && i <= 16; // Oct 25 … Oct 31
		return Math.round((inGap ? 1600 : 220) * (0.6 + r() * 0.8));
	});
})();
const unmatchedItems = (() => {
	const r = rng(42);
	return days.map((_, i) => Math.round((i >= 10 && i <= 16 ? 44 : 7) * (0.7 + r() * 0.6)));
})();

export const recon: Part = {
	id: 'p3',
	nav: '3 · Reconciliation',
	eyebrow: 'Part 3 · 30 minutes · reconciliation & reporting',
	title: 'Three systems, three versions of today',
	meta: 'ledger ↔ PSP ↔ bank · cutoffs · netting · ISO 20022 · fees',
	minutes: 30,
	intro: [
		{
			type: 'callout',
			tone: 'info',
			title: 'Classify every break',
			text: 'Every reconciliation difference is one of: **timing** (it will match tomorrow), **netting** (fees, refunds, chargebacks deducted at source), **FX**, **duplicates/missing** (a real bug), or **genuine loss**. Answers that say "write it off" or "investigate" without classifying score poorly. See [[three-way-reconciliation]].'
		}
	],
	questions: [
		{
			id: 'r1',
			title: 'Three sources, one day, none agree',
			tag: 'core',
			minutes: 7,
			prompt: [
				{ type: 'p', text: 'Business day **Wed Oct 14** (Europe/Berlin, [[utc|UTC]]+2). Explain every difference with a number and a category.' },
				{
					type: 'table',
					head: ['Line', 'Ledger (Berlin day)', 'PSP [[settlement|settlement report]] (UTC day)', 'Bank statement'],
					numeric: [1, 2, 3],
					rows: [
						['Gross sales', '48,210.00', '47,930.00', ''],
						['Refunds', '−1,150.00', '−1,150.00', ''],
						['Processing fees', '', '−702.15', ''],
						['Chargebacks', '', '−89.90', ''],
						['Net payout', '', '45,987.95', 'Fri Oct 16: +45,987.95'],
						['Other', '', '', 'Fri Oct 16: −15.00 "INCOMING PMT FEE"']
					]
				},
				{
					type: 'p',
					text: 'Extra data: card sales between 22:00 and 24:00 UTC were €1,630.00 on Oct 13 and €1,350.00 on Oct 14.'
				}
			],
			answer: [
				{
					type: 'table',
					head: ['Difference', 'Amount', 'Category', 'Explanation'],
					numeric: [1],
					rows: [
						[
							'Ledger gross − PSP gross',
							'+280.00',
							'timing ([[cutoff-time|cutoff]])',
							'Berlin\'s Oct 14 is 22:00 UTC Oct 13 → 22:00 UTC Oct 14. It includes Oct 13 22–24 UTC (+1,630) and excludes Oct 14 22–24 UTC (−1,350). 1,630 − 1,350 = 280. Reverses tomorrow.'
						],
						['Fees', '−702.15', 'netting', 'Deducted by the PSP before payout. Must be booked from the report as an expense.'],
						['Chargebacks', '−89.90', 'netting', 'Deducted at source; must reverse revenue and open a dispute record.'],
						['PSP net → bank', '0.00, two days later', 'timing', 'T+2 settlement: match payout id, not date.'],
						['Bank fee', '−15.00', 'bank charge', 'Not in either other system; needs its own expense entry.']
					]
				},
				{
					type: 'p',
					text: 'Check: 47,930.00 − 1,150.00 − 702.15 − 89.90 = **45,987.95** ✓. If the ledger books revenue gross and never books fees and chargebacks, revenue is overstated by €792.05 *every day*, which is the expensive finding here, not the €280.'
				}
			]
		},
		{
			id: 'r2',
			title: 'Breaks every day, and five times worse for one week',
			tag: 'tricky',
			minutes: 6,
			prompt: [
				{
					type: 'p',
					text: 'The ledger (Europe/Berlin day) is matched to the US bank\'s statement (America/New_York booking day). The matcher shifts ledger timestamps by a constant before comparing dates:'
				},
				{ type: 'code', lang: 'python', code: `NY_OFFSET = timedelta(hours=-6)  # New York is 6 hours behind Berlin\nbank_day = (ledger_ts_berlin + NY_OFFSET).date()` },
				{
					type: 'dashboard',
					dashboard: {
						style: 'kibana',
						title: 'recon: ledger ↔ bank (USD)',
						range: 'Oct 15 – Nov 11',
						panels: [
							{ kind: 'bars', title: 'Unmatched amount (absolute, USD)', x: days, series: [{ name: '|break|', points: breaks, color: 1 }], span: 4 },
							{ kind: 'stat', title: 'Net of breaks over period', value: '$0.00', tone: 'ok', span: 2 },
							{ kind: 'bars', title: 'Unmatched items', x: days, series: [{ name: 'items', points: unmatchedItems, color: 2 }], span: 6 }
						]
					}
				}
			],
			answer: [
				{
					type: 'p',
					text: 'The tempting reading, "the bank was slow that week", ignores the dates. The bad window is **Oct 25 – Oct 31**: Europe leaves daylight saving on the last Sunday of October (Oct 25 in 2026) and the US on the first Sunday of November (Nov 1). For that week Berlin is only **5** hours ahead of New York, but the matcher hard-codes 6, so every ledger item in one hour of each day is assigned to the wrong bank day.'
				},
				{
					type: 'p',
					text: 'The small daily breaks outside that week are ordinary [[cutoff-time|cutoff]] timing: items near midnight land on adjacent days in each system and match the next day. The net-of-breaks stat ($0.00) confirms nothing is missing; that is what timing breaks look like.'
				},
				{
					type: 'p',
					text: '**Fix:** never store offsets. Convert instants with [[iana-timezone|IANA zones]] (`ZoneInfo("America/New_York")`), match on stable references (payout id, end-to-end id) first and dates second with a ±1 day tolerance, and categorize unmatched items as "timing, expected to clear by D+1" so real breaks are not buried. Add March and late October/early November to the recon test fixtures; those are the two windows where the US and EU disagree on [[dst]].'
				}
			]
		},
		{
			id: 'r3',
			title: 'The bank says we are €6,429.20 short',
			tag: 'tricky',
			minutes: 5,
			prompt: [
				{
					type: 'p',
					text: 'After a big refund campaign, Tuesday\'s PSP settlement batch had refunds exceeding sales: `net = -3214.60`. Bank reconciliation for that week is off by exactly €6,429.20. The payout booking code:'
				},
				{
					type: 'code',
					lang: 'python',
					code: `def book_payout(p):  # one row of the PSP settlement report
    amount = abs(Decimal(p["net"]))       # amounts must be positive in the ledger
    ledger.post(
        debit="bank:operating",
        credit="psp:clearing",
        amount=amount,
        ref=p["payout_id"],
    )`
				}
			],
			answer: [
				{
					type: 'p',
					text: 'With [[settlement-netting|netting]], a negative net means the PSP **debited** our bank account €3,214.60. `abs()` turned it into a €3,214.60 credit. The ledger is wrong by the amount in the wrong direction twice: +3,214.60 booked vs −3,214.60 actual = **6,429.20** apart. A difference of exactly 2× a transaction is the signature of a sign error.'
				},
				{
					type: 'p',
					text: 'The "amounts must be positive" rule is fine in double-entry, but then the **side** carries the sign: for a negative net, debit `psp:clearing`, credit `bank:operating`. **Fix:** branch on sign; add a test for net < 0 and net = 0 (zero payouts exist and must not be skipped if the report lists them). **Remediation:** a reversing entry for the wrong posting plus the correct one, both referencing the payout id, rather than editing the original line.'
				}
			]
		},
		{
			id: 'r4',
			title: '"Since the bank upgraded, wires don\'t match invoices"',
			tag: 'tricky',
			minutes: 6,
			prompt: [
				{
					type: 'ticket',
					ticket: {
						channel: 'slack',
						from: 'Tomás Ruiz',
						role: 'Accounts Receivable lead',
						time: 'Mon 11:20',
						body: `Since last Monday about 40% of incoming customer wires land in "unmatched" and we match them by hand. The bank says they "moved to ISO 20022" and that nothing changed for us. Customers swear they put the invoice number in the payment reference like always. Anything on your side?`
					}
				},
				{
					type: 'code',
					lang: 'python',
					caption: 'Matcher',
					code: `INVOICE = re.compile(r"INV-\\d{6}")

def match(entry):                     # entry parsed from the bank statement
    ref = entry.get("remittance_unstructured", "")
    m = INVOICE.search(ref)
    return invoices.get(m.group(0)) if m else None`
				},
				{
					type: 'code',
					lang: 'text',
					caption: 'Two unmatched entries from the new camt.054 statement (excerpt)',
					code: `<RmtInf>
  <Strd><CdtrRefInf><Ref>INV-204118</Ref></CdtrRefInf></Strd>
</RmtInf>

<RmtInf>
  <Ustrd>PAYMENT INV 203977 THANK YOU</Ustrd>
</RmtInf>`
				}
			],
			answer: [
				{
					type: 'ranked',
					items: [
						{
							title: 'The reference moved to the structured field.',
							body: '[[iso-20022|ISO 20022]] lets the payer\'s bank send the reference as structured `Strd/CdtrRefInf/Ref`. The old SWIFT MT format only had free text, so the parser only reads `Ustrd`. For these entries `remittance_unstructured` is empty.',
							confirm: 'Count unmatched entries with a non-empty `Strd` reference: expect most of the 40%.'
						},
						{
							title: 'Characters were translated in transit.',
							body: '"INV 203977": payments that crossed a leg still using the old MT network are restricted to the SWIFT character set and get uppercased, with some punctuation replaced. A regex that requires the hyphen misses them.'
						}
					]
				},
				{
					type: 'p',
					text: '**Fix:** read [[remittance-information]] from structured references first, then unstructured; normalize before matching (uppercase, collapse separators: `INV[\\s\\-_.]?\\d{6}`); also match on amount + payer IBAN + date window as a fallback with a confidence score; re-run the matcher over last week\'s unmatched items. "Nothing changed for us" is the bank\'s view of the protocol, not of your parser.'
				}
			]
		},
		{
			id: 'r5',
			title: 'Card fees up 39% with no price change',
			tag: 'tricky',
			minutes: 6,
			prompt: [
				{
					type: 'ticket',
					ticket: {
						channel: 'email',
						from: 'Rafael Mendes',
						role: 'CFO',
						subject: 'PSP overbilling?',
						body: `Our effective card fee went from 0.67% to 0.93% of volume between July and September, on the same ~€2M monthly volume. Our contract hasn't changed. I want engineering to prove the PSP is overcharging before I call them.`
					}
				},
				{
					type: 'p',
					text: 'Pricing is [[interchange-plus-plus|interchange++]]: interchange (by card type) + scheme fee 0.10% + PSP markup 0.15% + €0.05 per transaction. Average ticket €40. July\'s B2B campaign changed who pays.'
				},
				{
					type: 'table',
					head: ['Card type', 'Interchange', 'July mix', 'September mix'],
					numeric: [1, 2, 3],
					rows: [
						['Consumer debit (EEA)', '0.20%', '70%', '50%'],
						['Consumer credit (EEA)', '0.30%', '25%', '25%'],
						['Commercial cards', '1.50%', '3%', '15%'],
						['Non-EEA cards', '1.50%', '2%', '10%']
					]
				}
			],
			answer: [
				{
					type: 'p',
					text: 'Compute the blended rate before blaming the PSP. Fixed fee as a percentage: €0.05 ÷ €40 = 0.125%.'
				},
				{
					type: 'table',
					head: ['', 'Weighted interchange', '+ scheme & markup', '+ fixed = effective', 'Fees on €2M'],
					numeric: [2, 3, 4],
					rows: [
						['July', '0.70×0.20 + 0.25×0.30 + 0.03×1.5 + 0.02×1.5 = 0.29%', '0.54%', '0.665%', '€13,300'],
						['September', '0.50×0.20 + 0.25×0.30 + 0.15×1.5 + 0.10×1.5 = 0.55%', '0.80%', '0.925%', '€18,500']
					]
				},
				{
					type: 'p',
					text: 'The model predicts both observed rates (0.67% → 0.93%) exactly: the **€5,200/month** increase is the customer mix (commercial and non-EEA cards, which carry 7.5× the interchange of domestic debit), not overbilling. Every individual rate is unchanged; the average moved because the weights did, the same structure as [[simpsons-paradox|Simpson\'s paradox]].'
				},
				{
					type: 'p',
					text: 'What engineering should still do: rebuild expected fees per transaction from the PSP\'s interchange++ report (card type, region, interchange paid) and reconcile it monthly. That catches real overbilling (wrong markup tier, fees on refunds that should be returned) and turns this argument into a dashboard. For pricing: B2B customers on commercial cards may be steered to bank transfer, or priced to cover the 1.5%.'
				}
			]
		}
	]
};
