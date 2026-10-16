import type { Assessment } from '../types';
import { payments } from './a11-fintech/p1-payments';
import { ledgers } from './a11-fintech/p2-ledgers';
import { recon } from './a11-fintech/p3-recon';
import { risk } from './a11-fintech/p4-risk';
import { lab, coding, teasers } from './a11-fintech/p5-lab-coding';

const fintech: Assessment = {
	id: 'fintech',
	number: 11,
	title: 'Fintech in distributed systems',
	tagline: 'Payments in flight, ledgers that must balance to the cent, three-way recon, and risk systems that say no correctly.',
	description:
		'Money adds two constraints to every distributed-systems problem: an [[timeout|unknown outcome]] can never be resolved by guessing, and every number must be explainable to an auditor. Expect arithmetic in the answers; compute it, don\'t estimate it.',
	minutes: 225,
	difficulty: 'advanced',
	track: 'core',
	topics: ['payments', 'ledgers', 'reconciliation', 'FX & interest math', 'fraud & compliance', 'PCI', 'live lab', 'coding'],
	overview: [
		{
			type: 'budget',
			items: [
				{ label: '1 · Payments', minutes: 35 },
				{ label: '2 · Ledgers & math', minutes: 40 },
				{ label: '3 · Reconciliation', minutes: 30 },
				{ label: '4 · Risk & compliance', minutes: 35 },
				{ label: '5 · Lab', minutes: 15 },
				{ label: '6 · Coding', minutes: 55 },
				{ label: 'Teasers', minutes: 15 }
			]
		},
		{
			type: 'cards',
			items: [
				{
					title: 'Classify the money',
					items: [
						'Failed that succeeded, succeeded that failed, or counted twice?',
						'Timing, netting, FX, duplicate or real loss?',
						'Revenue problem or regulatory incident?'
					]
				},
				{
					title: 'Show the arithmetic',
					items: ['Formula → numbers → rounding rule → where rounding happens once', 'Integer [[minor-units]], rates in [[basis-point|bps]]', 'Check the result with an invariant (sums, balances)']
				},
				{
					title: 'Fix forward, never delete',
					items: ['Wrong postings get reversing entries', 'Duplicates get refunds, not row deletes', '[[data-remediation|Remediation]] is part of the answer']
				}
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'What a reviewer is grading',
			text: 'Whether you treat a timeout as unknown (not failed), whether your numbers are right to the cent and you say where rounding happens, whether you separate the code fix from cleaning up money already moved, and whether you escalate compliance problems before debugging them.'
		}
	],
	parts: [payments, ledgers, recon, risk, lab, coding, teasers]
};

export default fintech;
