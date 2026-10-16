import type { Lab, LabState } from '../types';

/**
 * Spot interruption wave. One instance pool gets reclaimed; the ASG can't refill from the same pool.
 * Tempting: move everything to on-demand (blows the budget). Fix: diversify pools + honour the 2-minute notice.
 */

const NEED = 40; // instances needed for current traffic
const SPOT_PRICE = 0.068;
const OD_PRICE = 0.17;
const BUDGET = 5; // $/h

const n = (s: LabState, k: string) => Number(s[k]);
const diversified = (s: LabState) => s.pools !== '1 pool: c6i.xlarge';

/** Spot capacity the market will give us right now. */
function available(s: LabState) {
	if (!s._wave) return 200;
	return diversified(s) ? 200 : 14 - Math.min(10, Math.floor(n(s, '_afterWave') / 90) * 2);
}

const capacity = (s: LabState) => n(s, '_spot') + n(s, '_od');
const rate = (s: LabState) => n(s, '_spot') * SPOT_PRICE + n(s, '_od') * OD_PRICE;
const errorRate = (s: LabState) => Math.min(100, (Math.max(0, NEED - capacity(s)) / NEED) * 100 + n(s, '_burst'));

const lab: Lab = {
	title: 'Spot interruption wave',
	console: 'cloud',
	scope: 'prod · us-east-1',
	brief:
		'The `api` fleet runs 40 [[spot-instance|spot instances]] from a single instance type. At about T+0:30 the market starts reclaiming capacity. Finance has a hard ceiling of **$5/h** for this fleet. Every interrupted instance gets a 2-minute warning; whether the app uses it is up to you.',
	resources: [
		{
			id: 'asg',
			service: 'EC2',
			name: 'api-fleet',
			type: 'Auto Scaling group',
			applySeconds: 15,
			details: (s) => [
				['Spot running', `${n(s, '_spot')}`],
				['On-demand running', `${n(s, '_od')}`],
				['Capacity needed', `${NEED}`],
				['Last activity', s._wave && !diversified(s) ? 'InsufficientInstanceCapacity: c6i.xlarge in use1-az2' : 'Launching instances'],
				['Allocation', diversified(s) ? 'price-capacity-optimized' : 'lowest-price']
			],
			status: (s) =>
				capacity(s) < NEED ? { label: `${NEED - capacity(s)} short`, tone: 'crit' } : { label: 'InService', tone: 'ok' },
			fields: [
				{
					key: 'pools',
					label: 'Instance types (mixed policy)',
					kind: 'select',
					options: ['1 pool: c6i.xlarge', '6 pools: c6i/c7i/m6i/m7i/c6a/m6a .xlarge'],
					help: 'Each type × AZ is a separate spot capacity pool.'
				},
				{ key: 'spotTarget', label: 'Spot capacity', kind: 'number', min: 0, max: 120, unit: 'instances' },
				{ key: 'odBase', label: 'On-demand base capacity', kind: 'number', min: 0, max: 120, unit: 'instances', help: 'Always-on on-demand instances under the spot layer.' }
			]
		},
		{
			id: 'app',
			service: 'EC2',
			name: 'api launch template',
			type: 'Launch template v14',
			applySeconds: 30,
			details: (s) => [
				['Interruption handler', s.drain ? 'enabled (deregister + drain on notice)' : 'none'],
				['In-flight at reclaim', s.drain ? 'drained' : 'dropped (502 to clients)']
			],
			status: (s) => (s.drain ? { label: 'Drain on notice', tone: 'ok' } : { label: 'No handler', tone: 'warn' }),
			fields: [
				{
					key: 'drain',
					label: 'Handle 2-min interruption notice',
					kind: 'toggle',
					help: 'On notice: fail the LB health check, stop taking requests, finish in-flight work.'
				}
			]
		}
	],
	initial: { pools: '1 pool: c6i.xlarge', spotTarget: 40, odBase: 0, drain: false, _spot: 40, _od: 0, _wave: false, _afterWave: 0, _burst: 0, _over: 0, _bad: 0 },
	events: [
		{ at: 30, log: 'EC2 Spot: rebalance recommendations for c6i.xlarge across use1-az1/az2', set: { _wave: true } },
		{ at: 32, log: '26 instances received 2-minute interruption notices' }
	],
	step: (s, { t }) => {
		const avail = available(s);
		let spot = n(s, '_spot');
		let lost = 0;
		if (spot > avail) {
			lost = spot - avail;
			spot = avail;
		} else if (s._wave && diversified(s) && t % 45 === 0 && spot > 0) {
			// Spot is still spot: occasional single reclaims even when diversified.
			lost = 1;
			spot -= 1;
		}
		const target = Math.min(n(s, 'spotTarget'), avail);
		if (spot < target && t % 2 === 0) spot += 1;
		if (spot > n(s, 'spotTarget')) spot = n(s, 'spotTarget');
		let od = n(s, '_od');
		if (od < n(s, 'odBase') && t % 2 === 0) od += 1;
		if (od > n(s, 'odBase')) od = n(s, 'odBase');
		const burst = n(s, '_burst') * 0.85 + (s.drain ? 0 : lost * 6);
		const next = { ...s, _spot: spot, _od: od };
		return {
			_spot: spot,
			_od: od,
			_burst: burst < 0.05 ? 0 : burst,
			_afterWave: s._wave ? n(s, '_afterWave') + 1 : 0,
			_over: rate(next) > BUDGET ? n(s, '_over') + 1 : 0,
			_bad: errorRate(next) > 25 ? n(s, '_bad') + 1 : 0
		};
	},
	metrics: [
		{ id: 'cap', label: 'Healthy instances', get: (s) => capacity(s), thresholds: [{ value: NEED, tone: 'ok', label: 'need' }] },
		{ id: 'err', label: '5xx rate', unit: '%', get: (s) => errorRate(s), alarm: 1, max: 100 },
		{ id: 'cost', label: 'Fleet spend', unit: ' $/h', get: (s) => rate(s), alarm: BUDGET },
		{ id: 'spot', label: 'Spot share', unit: '%', get: (s) => (capacity(s) ? (n(s, '_spot') / capacity(s)) * 100 : 0), max: 100 }
	],
	win: {
		text: 'At least 40 healthy instances, [[http-status-codes|5xx]] under 1%, spend under $5/h, held for 60 s.',
		check: (_s, m, t) => t > 60 && m.cap >= NEED && m.err < 1 && m.cost <= BUDGET,
		hold: 60
	},
	lose: [
		{ text: 'Spend sat above the $5/h ceiling for 2 minutes and finance froze the account’s on-demand quota.', check: (s) => n(s, '_over') > 120 },
		{ text: 'More than a quarter of requests failed for 3 minutes: the SLO for the month is gone.', check: (s) => n(s, '_bad') > 180 }
	],
	cost: rate,
	timeLimit: 600,
	speed: 5,
	solution: [
		{ at: 35, set: { pools: '6 pools: c6i/c7i/m6i/m7i/c6a/m6a .xlarge' } },
		{ at: 40, set: { drain: true } }
	],
	trap: [{ at: 35, set: { odBase: 40, spotTarget: 0 } }]
};

export default lab;
