import type { Lab, LabState } from '../types';

/**
 * A pricing service tops out below peak demand. Pods are capped by a namespace quota, CPU sits at ~35%,
 * and every request goes through one in-process LRU cache guarded by a single mutex.
 * Throughput per pod follows the Universal Scalability Law, so threads past ~15 make it slower.
 * Traps: more threads (retrograde scaling), a read-write lock (LRU "get" mutates recency, so every access
 * takes the write side), a longer cache TTL (helps hit rate, not the lock).
 * Fix: a striped (sharded) cache lock.
 */

const n = (s: LabState, k: string) => Number(s[k]);
const PODS = 6;
const CPU_CAP = 1600; // req/s per pod: 4 vCPU ÷ 2.5 ms CPU per request

const MODES: Record<string, { sigma: number; kappa: number; x1: number }> = {
	'global mutex': { sigma: 0.08, kappa: 0.004, x1: 100 },
	'read-write lock': { sigma: 0.075, kappa: 0.0042, x1: 92 },
	'striped (64 shards)': { sigma: 0.01, kappa: 0.0002, x1: 100 }
};
const TTL_FACTOR: Record<string, number> = { '30 s': 0.92, '5 min': 1, '30 min': 1.04 };

/** Universal Scalability Law: X(N) = N·X1 / (1 + σ(N−1) + κN(N−1)). */
function perPod(s: LabState) {
	const m = MODES[String(s.lockMode)];
	const N = n(s, 'threads');
	const x = (N * m.x1 * TTL_FACTOR[String(s.cacheTtl)]) / (1 + m.sigma * (N - 1) + m.kappa * N * (N - 1));
	return Math.min(x, CPU_CAP);
}
const capacity = (s: LabState) => perPod(s) * PODS;
/** Little's law inside the pod: time per request = threads ÷ throughput. */
const serviceMs = (s: LabState) => (n(s, 'threads') / perPod(s)) * 1000;
const p99 = (s: LabState) => serviceMs(s) * 3 + (n(s, '_backlog') / capacity(s)) * 1000;
const served = (s: LabState) => Math.min(capacity(s), n(s, '_arr') + n(s, '_backlog'));

const lab: Lab = {
	title: 'More threads, less throughput',
	console: 'kubernetes',
	scope: 'prod-eu cluster · pricing namespace',
	brief:
		'Sale traffic starts at T+0:05: `pricing-api` goes from ~2,800 to ~3,600 req/s. The namespace [[resource-requests|ResourceQuota]] caps it at 6 pods (already reached). Each pod is a JVM with a fixed [[worker-pool|worker thread pool]] and an in-process LRU price cache. Requests that wait more than 2 s in the queue time out. Keep errors from piling up.',
	resources: [
		{
			id: 'deploy',
			service: 'Workloads',
			name: 'pricing-api',
			type: 'Deployment',
			applySeconds: 90,
			details: (s) => [
				['Replicas', `${PODS} / ${PODS} (quota: pods 6/6)`],
				['CPU / pod', `${Math.round(((served(s) / PODS) * 2.5) / 40)}% of 4 vCPU`],
				['Throughput / pod', `${Math.round(perPod(s))} req/s`],
				['Thread state (jstack)', `${Math.round((1 - perPod(s) / (n(s, 'threads') * MODES[String(s.lockMode)].x1)) * 100)}% BLOCKED on PriceCache.lock`]
			],
			status: (s) =>
				n(s, '_arr') > capacity(s) ? { label: 'Saturated', tone: 'crit' } : { label: 'Available', tone: 'ok' },
			fields: [
				{ key: 'threads', label: 'Worker threads', kind: 'number', min: 4, max: 64, unit: 'per pod', help: 'Rolling restart required.' },
				{
					key: 'lockMode',
					label: 'Price cache locking',
					kind: 'select',
					options: ['global mutex', 'read-write lock', 'striped (64 shards)'],
					help: 'Ships as a config flag; all three implementations are already in the build.'
				},
				{ key: 'cacheTtl', label: 'Price cache TTL', kind: 'select', options: ['30 s', '5 min', '30 min'] }
			]
		},
		{
			id: 'quota',
			service: 'Policy',
			name: 'pricing-quota',
			type: 'ResourceQuota',
			details: () => [
				['pods', '6 / 6'],
				['requests.cpu', '24 / 24'],
				['Owner', 'platform team (change request: 2 business days)']
			],
			status: () => ({ label: 'At limit', tone: 'warn' })
		},
		{
			id: 'db',
			service: 'Data',
			name: 'prices-db',
			type: 'PostgreSQL (managed)',
			details: (s) => [
				['CPU', `${Math.round(18 / TTL_FACTOR[String(s.cacheTtl)])}%`],
				['Connections', '60 / 400'],
				['p99 query', '4 ms']
			],
			status: () => ({ label: 'Healthy', tone: 'ok' })
		}
	],
	initial: { threads: 16, lockMode: 'global mutex', cacheTtl: '5 min', _arr: 2800, _backlog: 0, _errors: 0, _dropped: 0 },
	events: [{ at: 5, log: 'Sale started: arrivals 2,800 → 3,600 req/s', set: { _arr: 3600 } }],
	step: (s, { rand, t }): LabState => {
		const arr = (t >= 5 ? 3600 : 2800) * (0.98 + rand() * 0.04);
		const cap = capacity(s);
		const avail = n(s, '_backlog') + arr;
		const out = Math.min(cap, avail);
		let backlog = avail - out;
		const dropped = Math.max(0, backlog - cap * 2); // requests older than the 2 s timeout
		backlog -= dropped;
		return { _arr: arr, _backlog: backlog, _dropped: dropped, _errors: n(s, '_errors') + dropped };
	},
	metrics: [
		{ id: 'arr', label: 'Requests in /s', get: (s) => n(s, '_arr') },
		{ id: 'served', label: 'Served /s', get: (s) => served(s) },
		{ id: 'err', label: 'Timeouts', unit: '%', get: (s) => (n(s, '_dropped') / n(s, '_arr')) * 100, alarm: 1, max: 40 },
		{ id: 'p99', label: 'p99 latency', unit: ' ms', get: (s) => p99(s), alarm: 500, max: 3000 },
		{ id: 'cpu', label: 'CPU / pod', unit: '%', get: (s) => ((served(s) / PODS) * 2.5) / 40, max: 100 },
		{ id: 'failed', label: 'Failed requests (total)', get: (s) => n(s, '_errors') }
	],
	win: {
		text: 'Timeouts under 0.5% and p99 under 400 ms, held for 60 s.',
		check: (_s, m) => m.err < 0.5 && m.p99 < 400,
		hold: 60
	},
	lose: [
		{
			text: '250,000 checkouts showed "price unavailable". The sale is over for those customers.',
			check: (s) => n(s, '_errors') > 250_000
		}
	],
	timeLimit: 900,
	speed: 5,
	solution: [{ at: 15, set: { lockMode: 'striped (64 shards)' } }],
	trap: [{ at: 15, set: { threads: 32 } }]
};

export default lab;
