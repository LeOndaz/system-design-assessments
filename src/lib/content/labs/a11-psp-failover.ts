import type { Lab, LabState } from '../types';

/**
 * PSP degradation. The primary payment provider starts timing out. The obvious move (send 100% to the
 * secondary) re-drives every in-flight attempt at the primary — some of which it already captured —
 * so customers get charged twice; and the secondary's risk engine throttles a merchant whose volume
 * jumps 3× in a second. Winning: turn on the attempt-ledger dedupe first, then ramp the weight as the
 * secondary's risk capacity warms.
 */

const TRAFFIC = 100; // checkout attempts per second
const TICKET = 60; // average order, USD
const BASELINE_APPROVAL = 0.93;
const CAPTURED_ON_TIMEOUT = 0.3; // share of PSP-A timeouts that the provider actually completed

const n = (s: LabState, k: string) => Number(s[k]);
const shareB = (s: LabState) => n(s, '_w') / 100;

/** PSP-A behaviour: healthy until T+5, then 40% of calls hit the 10 s timeout. */
function a(s: LabState) {
	const degraded = !!s._degraded;
	return {
		approval: degraded ? 0.55 : BASELINE_APPROVAL,
		timeoutRate: degraded ? 0.4 : 0,
		latency: degraded ? 0.6 * 1.2 + 0.4 * 10 : 0.45 // seconds, mean
	};
}

function loadB(s: LabState) {
	return TRAFFIC * shareB(s);
}

/**
 * PSP-B approves 92% until our volume exceeds what its risk engine has seen from us.
 * A jump past 2× that headroom puts the merchant into manual risk review: headroom stops growing for 5 min.
 */
function approvalB(s: LabState) {
	const load = loadB(s);
	const cap = n(s, '_capB');
	return load <= cap ? 0.92 : (0.92 * cap) / load;
}

function approval(s: LabState) {
	return (1 - shareB(s)) * a(s).approval + shareB(s) * approvalB(s);
}

function inflightA(s: LabState) {
	// Little's law: in-flight = arrival rate × time in system.
	return TRAFFIC * (1 - shareB(s)) * a(s).latency;
}

const lab: Lab = {
	title: 'Primary payment provider degrading',
	console: 'cloud',
	scope: 'payments · eu-central',
	brief:
		"Checkout routes card payments through an orchestrator to two [[psp|PSPs]]: **PSP-A** (primary, 100% of traffic) and **PSP-B** (secondary, contracted but idle). PSP-A's status page just went yellow. Every failed checkout is a lost ~$60 order. Restore approvals without charging anyone twice: a [[timeout]] at PSP-A is an *unknown outcome*, not a decline.",
	resources: [
		{
			id: 'router',
			service: 'Payments',
			name: 'payment-orchestrator',
			type: 'Routing policy',
			applySeconds: 10,
			details: (s) => [
				['PSP-A weight', `${100 - n(s, '_w')}%`],
				['PSP-B weight', `${n(s, '_w')}%`],
				['On timeout', n(s, '_w') > 0 ? 'retry on other PSP' : 'retry same PSP (same key)'],
				['Attempt-ledger check', s.dedupe ? 'on' : 'off']
			],
			status: (s) => (s._degraded && n(s, '_w') === 0 ? { label: 'Primary degraded', tone: 'crit' } : { label: 'Routing', tone: 'ok' }),
			fields: [
				{
					key: 'weightB',
					label: 'Traffic to PSP-B',
					kind: 'number',
					min: 0,
					max: 100,
					step: 5,
					unit: '%',
					help: "When PSP-B weight > 0, attempts that time out at PSP-A are retried on PSP-B, and in-flight PSP-A attempts in the shifted share are re-driven to PSP-B."
				}
			]
		},
		{
			id: 'ledger',
			service: 'Payments',
			name: 'attempt-ledger',
			type: 'Feature flag',
			applySeconds: 30,
			details: (s) => [
				['Flag', 'payments.cross_psp_dedupe'],
				['Behaviour when on', 'before re-driving an attempt, query the original PSP by idempotency key; skip if captured'],
				['State', s.dedupe ? 'enabled' : 'disabled']
			],
			status: (s) => (s.dedupe ? { label: 'Enabled', tone: 'ok' } : { label: 'Disabled', tone: 'info' }),
			fields: [
				{
					key: 'dedupe',
					label: 'Cross-PSP dedupe',
					kind: 'toggle',
					help: 'Adds ~120 ms to re-driven attempts (one status lookup at the original PSP). Shipped dark last quarter.'
				}
			]
		},
		{
			id: 'pspA',
			service: 'Providers',
			name: 'PSP-A',
			type: 'Payment provider (primary)',
			details: (s) => [
				['Status page', s._degraded ? 'Degraded performance: EU acquiring' : 'Operational'],
				['Mean latency', `${a(s).latency.toFixed(2)} s`],
				['Client timeout', '10 s'],
				['In-flight attempts', `${Math.round(inflightA(s))}`]
			],
			status: (s) => (s._degraded ? { label: 'Degraded', tone: 'crit' } : { label: 'Operational', tone: 'ok' })
		},
		{
			id: 'pspB',
			service: 'Providers',
			name: 'PSP-B',
			type: 'Payment provider (secondary)',
			details: (s) => [
				['Status page', 'Operational'],
				['Our volume', `${Math.round(loadB(s))} tx/s`],
				['Risk engine headroom for this merchant', `~${Math.round(n(s, '_capB'))} tx/s (grows as volume ramps)`],
				['Approval when within headroom', '92%'],
				['Merchant risk review', n(s, '_review') > 0 ? `IN REVIEW (${Math.round(n(s, '_review'))} s left): volume spiked > 2× headroom` : 'none']
			],
			status: (s) =>
				n(s, '_review') > 0
					? { label: 'Merchant in risk review', tone: 'crit' }
					: loadB(s) > n(s, '_capB')
						? { label: 'Risk throttling', tone: 'warn' }
						: { label: 'Operational', tone: 'ok' }
		}
	],
	initial: { weightB: 0, dedupe: false, _w: 0, _degraded: false, _capB: 30, _dups: 0, _lost: 0, _review: 0 },
	events: [
		{ at: 5, log: 'PSP-A status: "Investigating elevated latency in EU acquiring"', set: { _degraded: true } },
		{ at: 60, log: 'Support: 14 tickets in 5 min, "card declined, tried again"' }
	],
	step: (s): LabState => {
		const out: LabState = {};
		const target = n(s, 'weightB');
		const prev = n(s, '_w');
		let dups = n(s, '_dups');

		if (target !== prev) {
			// Moving share re-drives the in-flight attempts that were sitting at PSP-A.
			if (target > prev && !s.dedupe) dups += inflightA(s) * ((target - prev) / Math.max(1, 100 - prev)) * CAPTURED_ON_TIMEOUT;
			out._w = target;
		}
		const now = { ...s, ...out };

		// Timed-out PSP-A attempts retried on PSP-B: duplicates whenever PSP-A had in fact captured.
		if (shareB(now) > 0 && !now.dedupe) dups += TRAFFIC * (1 - shareB(now)) * a(now).timeoutRate * CAPTURED_ON_TIMEOUT;
		out._dups = dups;

		// PSP-B's risk engine warms as it sees sustained volume near its ceiling, unless a spike froze it.
		const review = Math.max(0, n(s, '_review') - 1);
		if (review === 0 && loadB(now) > 2 * n(now, '_capB')) out._review = 300;
		else out._review = review;
		if (out._review === 0 && loadB(now) > 0.8 * n(now, '_capB')) out._capB = Math.min(150, n(now, '_capB') + 0.5);

		out._lost = n(s, '_lost') + Math.max(0, BASELINE_APPROVAL - approval(now)) * TRAFFIC * TICKET;
		return out;
	},
	metrics: [
		{ id: 'approval', label: 'Approval rate', unit: '%', get: (s) => approval(s) * 100, max: 100, thresholds: [{ value: 90, tone: 'ok', label: 'target' }] },
		{
			id: 'p95',
			label: 'Checkout p95',
			unit: 'ms',
			get: (s) => ((1 - shareB(s)) * a(s).timeoutRate > 0.05 ? 10_000 : (1 - shareB(s)) > 0.05 && s._degraded ? 4_000 : 950),
			max: 11000,
			alarm: 3000
		},
		{ id: 'dups', label: 'Duplicate captures', get: (s) => Math.floor(n(s, '_dups')), alarm: 0, max: 60 },
		{ id: 'inflight', label: 'In flight at PSP-A', get: (s) => inflightA(s) },
		{ id: 'throttle', label: 'PSP-B risk declines', unit: '%', get: (s) => (loadB(s) > n(s, '_capB') ? (1 - n(s, '_capB') / loadB(s)) * 100 : 0), alarm: 5, max: 100 },
		{ id: 'lost', label: 'Lost orders ($k)', get: (s) => n(s, '_lost') / 1000 }
	],
	win: {
		text: 'Approval rate ≥ 90% held for 60 s, with no more than 25 customers double-charged.',
		check: (_s, m) => m.approval >= 90 && m.dups <= 25,
		hold: 60
	},
	lose: [
		{
			text: 'More than 25 customers were charged twice. Each is a refund, a support ticket and a possible chargeback; at this rate it becomes a scheme-reportable incident. The failover re-drove attempts PSP-A had already captured.',
			check: (_s, m) => m.dups > 25
		},
		{ text: 'Lost orders passed $1.2M: approvals stayed too low for too long.', check: (_s, m) => m.lost > 1200 }
	],
	timeLimit: 900,
	speed: 5,
	solution: [
		{ at: 8, set: { dedupe: true } },
		{ at: 40, set: { weightB: 30 } },
		{ at: 105, set: { weightB: 60 } },
		{ at: 175, set: { weightB: 100 } }
	],
	trap: [{ at: 8, set: { weightB: 100 } }]
};

export default lab;
