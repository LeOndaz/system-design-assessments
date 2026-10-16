import type { Lab, LabState } from '../types';

/**
 * A search API's p99 sits around a second. GC logs show frequent full collections of a small old gen.
 * Request-scoped buffers live ~1.2 s, but young collections run every ~0.34 s, so those buffers survive
 * several collections and get promoted ("premature promotion"), filling the old gen.
 * Trap: a bigger heap. Fewer full GCs but each one is longer (p99 worse), and 16 GB doesn't fit the 10 GiB pod.
 * Fix: a young gen big enough that a young collection happens less often than the buffers' lifetime (2 GB),
 * or a concurrent collector with enough headroom (ZGC + 8 GB).
 */

const n = (s: LabState, k: string) => Number(s[k]);
const ALLOC = 1.5; // GB/s allocation rate
const LIFETIME = 1.2; // s, request-scoped buffers
const MEDIUM_SHARE = 0.3; // share of allocated bytes that are request-scoped (rest die instantly)
const LIVE_OLD = 1.5; // GB of long-lived data (index caches)
const NATIVE = 1.5; // GB outside the heap (metaspace, threads, direct buffers)
const POD_LIMIT = 10; // GiB

const heap = (s: LabState) => Number(String(s.heapGb));
const young = (s: LabState) => Number(String(s.youngGb));
const oldSize = (s: LabState) => heap(s) - young(s);
const youngInterval = (s: LabState) => young(s) / ALLOC;
/** Fraction of allocation that survives long enough to be promoted. */
const promotedShare = (s: LabState) => MEDIUM_SHARE * Math.min(1, Math.max(0, (LIFETIME - youngInterval(s)) / LIFETIME));
const promotionRate = (s: LabState) => ALLOC * promotedShare(s); // GB/s
const minorPauseMs = (s: LabState) => ALLOC * MEDIUM_SHARE * Math.min(LIFETIME, youngInterval(s)) * 120 + 5;
const fullInterval = (s: LabState) => (promotionRate(s) > 0 ? (oldSize(s) - LIVE_OLD) / promotionRate(s) : Infinity);
const fullPauseS = (s: LabState) => oldSize(s) * 0.35 * (s.gc === 'Parallel' ? 0.9 : 1);
const zgc = (s: LabState) => s.gc === 'ZGC';
const crashes = (s: LabState) => heap(s) + NATIVE > POD_LIMIT || oldSize(s) < LIVE_OLD + 0.25;

function gcTime(s: LabState) {
	if (zgc(s)) return heap(s) >= 6 ? 0.08 : 0.35; // concurrent: CPU cost, not pauses
	const minor = minorPauseMs(s) / 1000 / youngInterval(s);
	const full = Number.isFinite(fullInterval(s)) ? fullPauseS(s) / fullInterval(s) : 0;
	return minor + full;
}

function p99(s: LabState) {
	if (zgc(s)) return heap(s) >= 6 ? 95 : 1500; // too little headroom → allocation stalls
	const fi = fullInterval(s);
	if (Number.isFinite(fi) && fullPauseS(s) / fi > 0.01) return 80 + fullPauseS(s) * 1000 * 0.8;
	return 80 + minorPauseMs(s);
}

const lab: Lab = {
	title: 'The JVM that pauses for a second',
	console: 'kubernetes',
	scope: 'prod-us cluster · search namespace',
	brief:
		'`search-api` has p99 ≈ 1 s against a 300 ms [[slo|SLO]]; median is fine. Each pod has a 10 GiB memory limit. Traffic is steady; nothing was deployed. The error budget burns while p99 is over 500 ms. Fix the [[gc-pause|GC pauses]].',
	resources: [
		{
			id: 'deploy',
			service: 'Workloads',
			name: 'search-api',
			type: 'Deployment (JVM 21)',
			applySeconds: 60,
			details: (s) => [
				['JVM flags', `-Xmx${s.heapGb}g -Xmn${s.youngGb}g -XX:+Use${s.gc === 'Parallel' ? 'Parallel' : s.gc}GC`],
				['Memory limit', `${POD_LIMIT} GiB (heap ${s.heapGb} + ~${NATIVE} native)`],
				['Allocation rate', `${ALLOC * 1000} MB/s`],
				['Young GC every', zgc(s) ? 'n/a (concurrent)' : `${youngInterval(s).toFixed(2)} s`],
				['Old gen', `${oldSize(s).toFixed(1)} GB (live set ${LIVE_OLD} GB)`]
			],
			status: (s) => (crashes(s) ? { label: 'CrashLoopBackOff', tone: 'crit' } : p99(s) > 300 ? { label: 'Degraded', tone: 'warn' } : { label: 'Available', tone: 'ok' }),
			fields: [
				{ key: 'heapGb', label: 'Max heap (-Xmx)', kind: 'select', options: ['2', '4', '8', '16'], unit: 'GB' },
				{ key: 'youngGb', label: 'Young gen (-Xmn)', kind: 'select', options: ['0.5', '1', '2', '3'], unit: 'GB' },
				{ key: 'gc', label: 'Collector', kind: 'select', options: ['G1', 'Parallel', 'ZGC'] }
			]
		},
		{
			id: 'gclog',
			service: 'Diagnostics',
			name: 'gc.log (last minute)',
			type: 'Unified JVM logging',
			details: (s) =>
				zgc(s)
					? [['Collections', 'concurrent cycles, max pause < 1 ms'], ['Allocation stalls', heap(s) >= 6 ? '0' : 'frequent']]
					: [
							['Young collections / min', `${Math.round(60 / youngInterval(s))}`],
							['Avg young pause', `${Math.round(minorPauseMs(s))} ms`],
							['Promoted / min', `${Math.round(promotionRate(s) * 60 * 1000)} MB`],
							['Full collections / min', Number.isFinite(fullInterval(s)) ? (60 / fullInterval(s)).toFixed(1) : '0'],
							['Full pause', Number.isFinite(fullInterval(s)) ? `${fullPauseS(s).toFixed(2)} s` : '—']
						],
			status: (s) => (!zgc(s) && Number.isFinite(fullInterval(s)) ? { label: 'Full GCs', tone: 'crit' } : { label: 'Clean', tone: 'ok' })
		}
	],
	initial: { heapGb: '4', youngGb: '0.5', gc: 'G1', _bad: 0, _crashed: false },
	step: (s): LabState => ({
		_bad: n(s, '_bad') + (p99(s) > 500 || crashes(s) ? 1 : 0),
		_crashed: crashes(s)
	}),
	metrics: [
		{ id: 'p99', label: 'p99 latency', unit: ' ms', get: (s) => (crashes(s) ? 5000 : p99(s)), alarm: 300, max: 5000 },
		{ id: 'gc', label: 'Time in GC', unit: '%', get: (s) => gcTime(s) * 100, alarm: 10, max: 100 },
		{ id: 'fulls', label: 'Full GCs /min', get: (s) => (zgc(s) || !Number.isFinite(fullInterval(s)) ? 0 : 60 / fullInterval(s)) },
		{ id: 'promo', label: 'Promotion MB/s', get: (s) => (zgc(s) ? 0 : promotionRate(s) * 1000) },
		{ id: 'mem', label: 'Pod memory', unit: ' GiB', get: (s) => Math.min(POD_LIMIT, heap(s) + NATIVE), max: 12, thresholds: [{ value: POD_LIMIT, tone: 'crit', label: 'limit' }] },
		{ id: 'budget', label: 'Bad seconds (budget 600)', get: (s) => n(s, '_bad'), alarm: 450 }
	],
	win: {
		text: 'p99 under 300 ms and time in GC under 10%, held for 60 s.',
		check: (s, m) => !crashes(s) && m.p99 < 300 && m.gc < 10,
		hold: 60
	},
	lose: [
		{ text: 'Pods were OOMKilled: the heap plus native memory exceeded the 10 GiB limit, and search went down.', check: (s) => heap(s) + NATIVE > POD_LIMIT },
		{ text: 'The old generation is smaller than the live set: `OutOfMemoryError: Java heap space` on every pod.', check: (s) => oldSize(s) < LIVE_OLD + 0.25 },
		{ text: 'The month\'s error budget is gone (600 bad seconds).', check: (s) => n(s, '_bad') >= 600 }
	],
	timeLimit: 900,
	speed: 5,
	solution: [{ at: 20, set: { youngGb: '2' } }],
	trap: [{ at: 20, set: { heapGb: '16' } }]
};

export default lab;
