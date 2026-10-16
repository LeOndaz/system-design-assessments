import type { Lab, LabState } from '../types';

/**
 * Traffic triples; the HPA does nothing. The Node.js service is single-threaded (≤ 1 core of useful CPU),
 * but requests 2 cores, so utilization can never exceed 50% against a 70% target.
 * Traps: raising the CPU limit / maxReplicas (neither changes what the HPA sees).
 * Fixes: request what the process can use (1 core), or lower the target below 50%.
 */

const n = (s: LabState, k: string) => Number(s[k]);
const PER_POD = 100; // req/s per pod at one saturated core

const rho = (s: LabState) => n(s, '_rps') / Math.max(1, n(s, '_ready')) / PER_POD;
/** Utilization as the HPA sees it: used CPU ÷ requested CPU. Usable CPU caps at 1 core. */
const util = (s: LabState) => (Math.min(rho(s), 1) * 1000 * 100) / n(s, 'requestM');
const p99 = (s: LabState) => {
	const r = rho(s);
	return r < 0.95 ? 45 / (1 - r) : 900 + (r - 0.95) * 4000;
};
const errors = (s: LabState) => (rho(s) > 1 ? (1 - 1 / rho(s)) * 100 : 0);

const lab: Lab = {
	title: 'Traffic tripled, the autoscaler shrugged',
	console: 'kubernetes',
	scope: 'prod-us cluster · checkout namespace',
	brief:
		'A TV spot lands at T+0:30 and `checkout-web` (Node.js, SSR) goes from ~800 to ~3,000 req/s. It has a [[horizontal-pod-autoscaler|HPA]] on CPU at 70%, min 10, max 40. Nodes are plentiful (the [[cluster-autoscaler]] is healthy). Make it scale.',
	resources: [
		{
			id: 'deploy',
			service: 'Workloads',
			name: 'checkout-web',
			type: 'Deployment',
			applySeconds: 30,
			details: (s) => [
				['Replicas', `${Math.round(n(s, '_ready'))} ready / ${s.replicas} desired`],
				['Container', 'node:22 · server.js (single process)'],
				['CPU usage / pod', `${Math.round(Math.min(rho(s), 1) * 1000)}m`],
				['Throttled periods', `${n(s, 'limitM') < 1000 ? 'high' : '0%'}`]
			],
			status: (s) => (errors(s) > 0 ? { label: 'Saturated', tone: 'crit' } : rho(s) > 0.8 ? { label: 'Hot', tone: 'warn' } : { label: 'Available', tone: 'ok' }),
			fields: [
				{ key: 'requestM', label: 'CPU request', kind: 'number', min: 250, max: 4000, step: 250, unit: 'millicores' },
				{ key: 'limitM', label: 'CPU limit', kind: 'number', min: 500, max: 8000, step: 250, unit: 'millicores' }
			]
		},
		{
			id: 'hpa',
			service: 'Autoscaling',
			name: 'checkout-web',
			type: 'HorizontalPodAutoscaler',
			applySeconds: 5,
			details: (s) => [
				['Metric', `cpu: ${Math.round(util(s))}% / ${s.target}% (of requests)`],
				['Replicas', `${s.replicas} (min 10, max ${s.maxReplicas})`],
				['Condition', util(s) < n(s, 'target') ? 'ScalingActive: the desired count is within the acceptable range' : 'ScalingActive: scaling up']
			],
			status: (s) => (util(s) < n(s, 'target') && errors(s) > 0 ? { label: 'Not scaling', tone: 'warn' } : { label: 'Active', tone: 'ok' }),
			fields: [
				{ key: 'target', label: 'Target CPU utilization', kind: 'number', min: 10, max: 95, unit: '%' },
				{ key: 'maxReplicas', label: 'maxReplicas', kind: 'number', min: 10, max: 80 }
			]
		}
	],
	initial: { requestM: 2000, limitM: 2000, target: 70, maxReplicas: 40, replicas: 10, _ready: 10, _rps: 800, _badRun: 0 },
	events: [{ at: 30, log: 'Traffic: 3× in 20 s (TV campaign)', set: { _rps: 3000 } }],
	step: (s, { t, rand }) => {
		const out: LabState = {};
		let replicas = n(s, 'replicas');
		// HPA sync every 15 s; scale-up capped at +100% per period; scale-down suppressed (stabilization window).
		if (t % 15 === 0) {
			const desired = Math.ceil((n(s, '_ready') * util(s)) / n(s, 'target'));
			replicas = Math.min(n(s, 'maxReplicas'), Math.max(replicas, Math.min(desired, replicas * 2)));
			out.replicas = replicas;
		}
		// Pods become ready ~25 s after creation.
		const ready = n(s, '_ready');
		out._ready = ready < replicas ? Math.min(replicas, ready + (replicas - ready) / 25 + 0.2) : replicas;
		const jitter = 0.97 + rand() * 0.06;
		out._rps = n(s, '_rps') > 1000 ? 3000 * jitter : 800 * jitter;
		out._badRun = errors({ ...s, ...out }) > 2 ? n(s, '_badRun') + 1 : 0;
		return out;
	},
	metrics: [
		{ id: 'p99', label: 'p99 latency', unit: ' ms', get: (s) => p99(s), alarm: 400, max: 3000 },
		{ id: 'errors', label: '503s (shed)', unit: '%', get: (s) => errors(s), alarm: 1, max: 80 },
		{ id: 'util', label: 'HPA CPU utilization', unit: '%', get: (s) => util(s), thresholds: [{ value: 70, tone: 'info' }], max: 110 },
		{ id: 'pods', label: 'Ready pods', get: (s) => n(s, '_ready'), max: 80 }
	],
	win: { text: 'p99 under 300 ms with no shedding, held for 30 s.', check: (_s, m) => m.p99 < 300 && m.errors === 0 },
	lose: [
		{
			text: 'Checkout shed more than 2% of requests for 4 minutes straight: the campaign\'s traffic bounced.',
			check: (s) => n(s, '_badRun') > 240
		}
	],
	cost: (s) => (n(s, 'replicas') * n(s, 'requestM')) / 1000 * 0.034,
	timeLimit: 600,
	speed: 5,
	solution: [{ at: 40, set: { requestM: 1000 } }],
	trap: [{ at: 40, set: { limitM: 4000, maxReplicas: 80 } }]
};

export default lab;
