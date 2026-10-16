import type { Lab, LabState } from '../types';

/**
 * After a two-hour EHR downtime the interface engine holds 50,000 queued HL7 v2 ADT messages.
 * Tempting move: raise the thread count with round-robin dispatch. Throughput rises, but A01/A08/A40
 * for the same patient are applied out of order and records get misfiled.
 * Winning: dispatch by patient key (PID-3) so each patient's messages stay ordered, then add threads.
 */

const PER_THREAD = 40; // messages/s per outbound thread
const ARRIVALS = 30; // live ADT messages/s
const MISFILE_LIMIT = 200;

const n = (s: LabState, k: string) => Number(s[k]);
const keyed = (s: LabState) => s.dispatch === 'Keyed by patient (PID-3)';

/** Keyed dispatch loses ~12% to hot keys (one patient's burst pins one thread). */
const throughput = (s: LabState) => {
	const cap = n(s, 'threads') * PER_THREAD * (keyed(s) ? 0.88 : 1);
	return Math.min(cap, n(s, '_backlog') + ARRIVALS);
};

/** Round-robin with >1 thread reorders messages for the same patient; ~2% per extra thread end up misapplied. */
const misfileRate = (s: LabState) => (keyed(s) ? 0 : throughput(s) * 0.0025 * (n(s, 'threads') - 1));

const lab: Lab = {
	title: 'EHR downtime: ADT replay',
	console: 'cloud',
	scope: 'integration-engine · on-prem DC',
	brief:
		'The EHR was down for two hours for an upgrade. The interface engine queued **50,000** [[hl7-v2|HL7 v2]] [[adt-message|ADT]] messages (admits, transfers, updates, merges) for the downstream lab, pharmacy and imaging systems. Wards are asking why new admissions don\'t show up in the pharmacy system. Drain the queue **without corrupting anyone\'s record**: a patient update applied before their admission, or a merge applied before the duplicate exists, is a misfiled record.',
	resources: [
		{
			id: 'engine',
			service: 'Interfaces',
			name: 'adt-outbound',
			type: 'Interface channel',
			applySeconds: 20,
			details: (s) => [
				['Queued', Math.round(n(s, '_backlog')).toLocaleString('en')],
				['Throughput', `${Math.round(throughput(s))} msg/s`],
				['Mix', 'A08 54% · A01 14% · A03 12% · A02 9% · A04 7% · A40 2% · other 2%'],
				['ACK mode', 'original mode, AA/AE per message']
			],
			status: (s) => (misfileRate(s) > 0 ? { label: 'Out-of-order ACKs', tone: 'crit' } : n(s, '_backlog') > 1000 ? { label: 'Backlogged', tone: 'warn' } : { label: 'Running', tone: 'ok' }),
			fields: [
				{ key: 'threads', label: 'Outbound threads', kind: 'number', min: 1, max: 32, help: 'Each thread delivers ~40 msg/s to the downstream systems.' },
				{
					key: 'dispatch',
					label: 'Dispatch',
					kind: 'select',
					options: ['Round-robin', 'Keyed by patient (PID-3)'],
					help: 'How queued messages are assigned to threads.'
				}
			]
		},
		{
			id: 'pharmacy',
			service: 'Downstream',
			name: 'pharmacy-system',
			type: 'HL7 receiver',
			details: (s) => [
				['Rejected (AE: patient not found)', Math.round(n(s, '_misfiled') * 0.6).toLocaleString('en')],
				['Applied out of sequence', Math.round(n(s, '_misfiled') * 0.4).toLocaleString('en')],
				['Last message', `${Math.round(n(s, '_backlog') / Math.max(1, throughput(s)))} s behind`]
			],
			status: (s) => (n(s, '_misfiled') > 0 ? { label: 'Data errors', tone: 'crit' } : { label: 'Accepting', tone: 'ok' })
		}
	],
	initial: { threads: 1, dispatch: 'Round-robin', _backlog: 50_000, _misfiled: 0 },
	events: [{ at: 5, log: 'Ward 4B: "admitted patients missing in pharmacy, can\'t verify meds"' }],
	step: (s): LabState => ({
		_backlog: Math.max(0, n(s, '_backlog') + ARRIVALS - throughput(s)),
		_misfiled: n(s, '_misfiled') + misfileRate(s)
	}),
	metrics: [
		{ id: 'backlog', label: 'Messages queued', get: (s) => n(s, '_backlog') },
		{ id: 'lag', label: 'Downstream lag', unit: 's', get: (s) => n(s, '_backlog') / Math.max(1, throughput(s)), alarm: 300, max: 2000 },
		{ id: 'tput', label: 'Delivered /s', get: (s) => throughput(s) },
		{ id: 'misfiled', label: 'Misfiled records', get: (s) => n(s, '_misfiled'), alarm: 0, thresholds: [{ value: MISFILE_LIMIT, tone: 'crit', label: 'limit' }] }
	],
	win: {
		text: 'Fewer than 500 messages queued and lag under 30 s, held for 30 s, with no more than a handful of misfiled records.',
		check: (s, m) => m.backlog < 500 && m.lag < 30 && n(s, '_misfiled') < 20
	},
	lose: [
		{
			text: 'Over 200 records were misfiled: updates applied to the wrong encounter, merges applied before the duplicate existed. Clinical informatics now has to reconcile them by hand, and every one is a patient-safety review.',
			check: (s) => n(s, '_misfiled') > MISFILE_LIMIT
		}
	],
	timeLimit: 1200,
	speed: 5,
	solution: [
		{ at: 10, set: { dispatch: 'Keyed by patient (PID-3)' } },
		{ at: 40, set: { threads: 16 } }
	],
	trap: [{ at: 10, set: { threads: 16 } }]
};

export default lab;
