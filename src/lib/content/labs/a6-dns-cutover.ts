import type { Lab, LabState } from '../types';

/**
 * DNS cutover with a scheduled decommission. Caches hold the old answer for up to the TTL, a partner
 * JVM pins DNS forever, and a "delete + recreate" gets NXDOMAIN negatively cached.
 * Tempting: flip the record and let the change calendar delete lb-old. Fix: cancel the deletion,
 * flip, and keep lb-old alive for the long tail.
 */

const PINNED = 0.06; // partner JVM with networkaddress.cache.ttl=-1
const n = (s: LabState, k: string) => Number(s[k]);

/** Share of non-pinned resolvers that have picked up the new answer. Cache ages are uniform over the TTL. */
function moved(s: LabState, t: number) {
	if (n(s, '_flipAt') < 0) return 0;
	return Math.min(1, (t - n(s, '_flipAt')) / Math.max(1, n(s, '_ttlAtFlip')));
}
const newShare = (s: LabState, t: number) => (1 - PINNED) * moved(s, t);
const oldShare = (s: LabState, t: number) => 1 - newShare(s, t);
function errors(s: LabState, t: number) {
	let e = s._oldDeleted ? oldShare(s, t) * 100 : 0;
	if (n(s, '_nx') > 0) e += (100 - e) * 0.4;
	return Math.min(100, e);
}

const lab: Lab = {
	title: 'DNS cutover with a deadline',
	console: 'cloud',
	scope: 'edge · global',
	brief:
		'You are moving `api.example.com` from **lb-old** to **lb-new** (already healthy, already serving a canary). The change calendar has an automated job that **deletes lb-old at T+2:00** to finish the migration ticket. The record has a 300 s TTL. Partners call this API from all sorts of runtimes.',
	resources: [
		{
			id: 'record',
			service: 'Route 53',
			name: 'api.example.com (A, alias)',
			type: 'Record',
			applySeconds: 30,
			details: (s) => [
				['Value', s.target === 'lb-new' ? 'lb-new-81f2.elb.amazonaws.com' : 'lb-old-12ac.elb.amazonaws.com'],
				['TTL', `${s.ttl} s`],
				['Max cached TTL in the wild', `${Math.round(n(s, '_cachedTtl'))} s`],
				['Zone SOA negative TTL', '900 s']
			],
			fields: [
				{ key: 'target', label: 'Routes traffic to', kind: 'select', options: ['lb-old', 'lb-new'] },
				{ key: 'ttl', label: 'TTL', kind: 'number', min: 30, max: 86400, step: 30, unit: 's', help: 'Lowering it only helps resolvers that re-query after the change.' }
			],
			actions: [
				{
					id: 'recreate',
					label: 'Delete & recreate record',
					danger: true,
					confirm: 'The name will not exist for a few seconds while the record is recreated.',
					run: () => ({ set: { _nx: 900 }, log: 'Route 53: DELETE + CREATE api.example.com', delay: 0 })
				}
			]
		},
		{
			id: 'old',
			service: 'EC2',
			name: 'lb-old',
			type: 'Application Load Balancer',
			applySeconds: 5,
			details: (s, ) => [
				['State', s._oldDeleted ? 'deleted' : 'active'],
				['Scheduled deletion', s.scheduledDeletion ? 'T+02:00 (CHG-2291)' : 'cancelled'],
				['Top client by requests', 'Java/1.8.0_202 partner-sync, networkaddress.cache.ttl=-1 (6% of all traffic)']
			],
			status: (s) => (s._oldDeleted ? { label: 'Deleted', tone: 'crit' } : s.scheduledDeletion ? { label: 'Deletion scheduled', tone: 'warn' } : { label: 'Active', tone: 'ok' }),
			fields: [{ key: 'scheduledDeletion', label: 'Scheduled deletion at T+2:00', kind: 'toggle' }],
			actions: [
				{
					id: 'delete',
					label: 'Delete load balancer now',
					danger: true,
					confirm: 'Any client still resolving to lb-old will get connection errors.',
					run: () => ({ set: { _oldDeleted: true }, log: 'EC2: DeleteLoadBalancer lb-old' })
				}
			]
		},
		{
			id: 'new',
			service: 'EC2',
			name: 'lb-new',
			type: 'Application Load Balancer',
			details: () => [
				['State', 'active'],
				['Targets', '12/12 healthy'],
				['Capacity', 'sized for 100% of traffic']
			],
			status: () => ({ label: 'Healthy', tone: 'ok' })
		}
	],
	initial: {
		target: 'lb-old',
		ttl: 300,
		scheduledDeletion: true,
		_oldDeleted: false,
		_flipAt: -1,
		_ttlAtFlip: 300,
		_cachedTtl: 300,
		_lastTarget: 'lb-old',
		_nx: 0,
		_bad: 0
	},
	events: [{ at: 1, log: 'Change calendar: CHG-2291 "delete lb-old" runs automatically at T+02:00' }],
	step: (s, { t }) => {
		const out: LabState = {};
		// Caches converge on a lowered TTL only as their old entries expire.
		out._cachedTtl = Math.max(n(s, 'ttl'), n(s, '_cachedTtl') - 1);
		if (s.target !== s._lastTarget) {
			out._lastTarget = s.target;
			out._flipAt = s.target === 'lb-new' ? t : -1;
			out._ttlAtFlip = n(s, '_cachedTtl');
		}
		if (s.scheduledDeletion && t >= 120 && !s._oldDeleted) out._oldDeleted = true;
		out._nx = Math.max(0, n(s, '_nx') - 1);
		out._bad = errors({ ...s, ...out }, t) > 20 ? n(s, '_bad') + 1 : 0;
		return out;
	},
	metrics: [
		{ id: 'new', label: 'Traffic on lb-new', unit: '%', get: (s, { t }) => newShare(s, t) * 100, max: 100 },
		{ id: 'old', label: 'Traffic on lb-old', unit: '%', get: (s, { t }) => oldShare(s, t) * 100, max: 100 },
		{ id: 'err', label: 'Client connection errors', unit: '%', get: (s, { t }) => errors(s, t), alarm: 1, max: 100 },
		{ id: 'nx', label: 'NXDOMAIN answers', unit: '%', get: (s) => (n(s, '_nx') > 0 ? 40 : 0), max: 100 }
	],
	win: {
		text: 'At least 90% of traffic on lb-new with client errors under 0.5%, held for 60 s.',
		check: (_s, m) => m.new >= 90 && m.err < 0.5,
		hold: 60
	},
	lose: [{ text: 'Over 20% of partner calls failed for 2 minutes. Two partners opened P1 tickets.', check: (s) => n(s, '_bad') > 120 }],
	timeLimit: 900,
	speed: 5,
	solution: [
		{ at: 5, set: { scheduledDeletion: false } },
		{ at: 10, set: { target: 'lb-new', ttl: 60 } }
	],
	trap: [{ at: 5, set: { target: 'lb-new', ttl: 60 } }]
};

export default lab;
