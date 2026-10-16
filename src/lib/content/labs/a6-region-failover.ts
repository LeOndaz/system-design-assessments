import type { Lab, LabState } from '../types';

/**
 * Regional evacuation into a cold DR region. The DR ASG is capped by max size AND the account's vCPU quota.
 * Tempting: shift 100% of traffic immediately (drowns 4 warm instances, then can only grow to 16).
 * Fix: request quota, raise ASG max/desired, shift weights in steps as capacity comes up.
 */

const RPS = 4000;
const PER_INSTANCE = 100; // rps per instance
const VCPU_PER = 4;
const n = (s: LabState, k: string) => Number(s[k]);

const quotaInstances = (s: LabState) => Math.floor(n(s, '_quota') / VCPU_PER);
const westTarget = (s: LabState) => Math.min(n(s, 'desired'), n(s, 'max'), quotaInstances(s));
const eastErr = (s: LabState) => (s._degraded ? 0.6 : 0.002);

function westErr(s: LabState) {
	const load = RPS * (n(s, 'westWeight') / 100);
	if (load === 0) return 0;
	const cap = n(s, '_west') * PER_INSTANCE;
	return load <= cap ? 0.002 : (load - cap) / load;
}

function totalErr(s: LabState) {
	const w = n(s, 'westWeight') / 100;
	return ((1 - w) * eastErr(s) + w * westErr(s)) * 100;
}

const lab: Lab = {
	title: 'Evacuate a degraded region',
	console: 'cloud',
	scope: 'checkout · us-east-1 → us-west-2',
	brief:
		'At T+0:05 a dependency in **us-east-1** starts failing ~60% of checkout requests (a regional gray failure; the provider has no ETA). **us-west-2** is your [[warm-standby]]: 4 instances, data already replicated. Checkout traffic is ~4,000 req/s and each instance handles ~100 req/s. Get checkout healthy.',
	resources: [
		{
			id: 'dns',
			service: 'Route 53',
			name: 'checkout.example.com',
			type: 'Weighted records',
			applySeconds: 20,
			details: (s) => [
				['us-east-1 weight', `${100 - n(s, 'westWeight')}`],
				['us-west-2 weight', `${s.westWeight}`],
				['TTL', '30 s']
			],
			fields: [{ key: 'westWeight', label: 'Weight to us-west-2', kind: 'number', min: 0, max: 100, step: 5, unit: '%', help: 'Share of traffic sent to the DR region.' }]
		},
		{
			id: 'east',
			service: 'EC2 · us-east-1',
			name: 'checkout-east',
			type: 'Auto Scaling group',
			details: (s) => [
				['Instances', '40 healthy (EC2 checks pass)'],
				['Request errors', `${Math.round(eastErr(s) * 100)}%`],
				['Cause', s._degraded ? 'payments-tokenizer endpoint timing out (regional)' : '—']
			],
			status: (s) => (s._degraded ? { label: 'Degraded', tone: 'crit' } : { label: 'Healthy', tone: 'ok' })
		},
		{
			id: 'west',
			service: 'EC2 · us-west-2',
			name: 'checkout-west',
			type: 'Auto Scaling group',
			applySeconds: 10,
			details: (s) => [
				['Running', `${n(s, '_west')}`],
				['Target (min of desired, max, quota)', `${westTarget(s)}`],
				['Last activity', westTarget(s) < n(s, 'desired') ? (quotaInstances(s) < Math.min(n(s, 'desired'), n(s, 'max')) ? 'VcpuLimitExceeded: You have requested more vCPU capacity than your current vCPU limit of 64' : 'Desired capacity above max size') : 'Launching'],
				['Boot to InService', '~4 s per instance (pre-baked AMI)']
			],
			status: (s) => (westErr(s) > 0.05 ? { label: 'Overloaded', tone: 'crit' } : { label: 'InService', tone: 'ok' }),
			fields: [
				{ key: 'desired', label: 'Desired capacity', kind: 'number', min: 0, max: 100 },
				{ key: 'max', label: 'Max size', kind: 'number', min: 0, max: 100 }
			]
		},
		{
			id: 'quota',
			service: 'Service Quotas · us-west-2',
			name: 'Running On-Demand Standard instances',
			type: 'vCPU quota',
			details: (s) => [
				['Applied value', `${s._quota} vCPU (${quotaInstances(s)} × c7i.xlarge)`],
				['Pending request', n(s, '_quotaAt') > 0 ? 'CASE_OPENED (auto-approval ~2.5 min)' : 'none']
			],
			status: (s) => (n(s, '_quotaAt') > 0 ? { label: 'Increase pending', tone: 'info' } : { label: `${s._quota} vCPU`, tone: 'warn' }),
			actions: [
				{
					id: 'request',
					label: 'Request increase to 240 vCPU',
					run: (_s, { t }) => ({ set: { _quotaAt: t + 150 }, log: 'Service Quotas: requested 240 vCPU in us-west-2' })
				}
			]
		}
	],
	initial: { westWeight: 0, desired: 4, max: 10, _west: 4, _quota: 64, _quotaAt: 0, _degraded: false, _bad: 0 },
	events: [{ at: 5, log: 'CloudWatch: checkout-east 5xx rate 58% (payments-tokenizer timeouts)', set: { _degraded: true } }],
	step: (s, { t }) => {
		const out: LabState = {};
		if (n(s, '_quotaAt') > 0 && t >= n(s, '_quotaAt')) {
			out._quota = 240;
			out._quotaAt = 0;
		}
		const target = westTarget({ ...s, ...out });
		let w = n(s, '_west');
		if (w < target && t % 4 === 0) w += 1;
		if (w > target) w = target;
		out._west = w;
		out._bad = totalErr({ ...s, ...out }) > 30 ? n(s, '_bad') + 1 : 0;
		return out;
	},
	metrics: [
		{ id: 'err', label: 'Checkout errors (global)', unit: '%', get: (s) => totalErr(s), alarm: 2, max: 100 },
		{ id: 'west', label: 'us-west-2 instances', get: (s) => n(s, '_west') },
		{ id: 'westErr', label: 'us-west-2 shed', unit: '%', get: (s) => westErr(s) * 100, max: 100 },
		{ id: 'weight', label: 'Traffic to us-west-2', unit: '%', get: (s) => n(s, 'westWeight'), max: 100 }
	],
	win: { text: 'Global checkout errors under 2%, held for 60 s.', check: (_s, m) => m.err < 2, hold: 60 },
	lose: [{ text: 'Checkout errors stayed above 30% for 5 minutes. Revenue impact crossed the SEV1 line.', check: (s) => n(s, '_bad') > 300 }],
	cost: (s) => n(s, '_west') * 0.18 + 40 * 0.18,
	timeLimit: 900,
	speed: 5,
	solution: [
		{ at: 10, action: { resource: 'quota', id: 'request' } },
		{ at: 12, set: { max: 60, desired: 45 } },
		{ at: 15, set: { westWeight: 40 } },
		{ at: 190, set: { westWeight: 60 } },
		{ at: 230, set: { westWeight: 80 } },
		{ at: 270, set: { westWeight: 100 } }
	],
	trap: [
		{ at: 10, set: { westWeight: 100 } },
		{ at: 12, set: { max: 60, desired: 45 } }
	]
};

export default lab;
