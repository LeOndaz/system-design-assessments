import type { Lab, LabState } from '../types';

/**
 * Print farm before a shipping deadline. One simulated second = one minute of factory time.
 * Tempting: switch on more printers. The bottleneck is the slicer, and scaling slicer workers past the
 * node's memory makes it crash-loop. Fix: dedupe identical STLs (slice cache) — then printers become the
 * constraint, so add printers too. Two levers, in that order of discovery.
 */

const JOBS = 300;
const DEADLINE = 420; // truck leaves 7 h after T+0
const PRINT_MIN = 60; // minutes per job on one printer
const SLICE_PER_WORKER = 0.5; // jobs/min per slicer worker (2 min each)
const WORKER_GB = 2.5;
const NODE_GB = 8;
const DUPLICATE_SHARE = 0.6; // 60% of jobs are reprints of the same STL + profile

const n = (s: LabState, k: string) => Number(s[k]);

const slicerHealthy = (s: LabState) => n(s, 'slicerWorkers') * WORKER_GB <= NODE_GB;

/** Jobs/min the slicer can hand to printers. */
function sliceRate(s: LabState) {
	if (!slicerHealthy(s)) return 0;
	const raw = n(s, 'slicerWorkers') * SLICE_PER_WORKER;
	return s.sliceCache ? raw / (1 - DUPLICATE_SHARE) : raw;
}

const printRate = (s: LabState) => n(s, 'printers') / PRINT_MIN;
/** Sustainable end-to-end jobs/min. */
const capacity = (s: LabState) => Math.min(printRate(s), sliceRate(s));
const remaining = (s: LabState) => Math.max(0, JOBS - n(s, '_done'));
const busyPrinters = (s: LabState) => n(s, '_printing');

const lab: Lab = {
	title: 'Print farm: 300 parts before the truck',
	console: 'cloud',
	scope: 'farm-2 · 1 tick = 1 minute',
	brief:
		'A customer order of **300 brackets** must be on the truck in **7 hours** (T+07:00). The farm has 40 printers; each part takes ~60 min to print. Jobs flow `upload → slicer → printer`. The ops lead says "we\'re short on printers, turn on the 40 spare ones in hall B". Check before you spend.',
	resources: [
		{
			id: 'printers',
			service: 'Printers',
			name: 'hall-a + hall-b',
			type: 'Printer pool',
			applySeconds: 20,
			details: (s) => [
				['Online', `${s.printers}`],
				['Printing now', `${Math.round(busyPrinters(s))}`],
				['Idle, waiting for G-code', `${Math.max(0, Math.round(n(s, 'printers') - busyPrinters(s)))}`],
				['Minutes per part', `${PRINT_MIN}`]
			],
			status: (s) =>
				n(s, 'printers') - busyPrinters(s) > 5 ? { label: 'Starved', tone: 'warn' } : { label: 'Busy', tone: 'ok' },
			fields: [{ key: 'printers', label: 'Printers online', kind: 'number', min: 10, max: 80, help: 'Hall B adds up to 40 more. Each costs ~$1.50/h in power and an operator.' }]
		},
		{
			id: 'slicer',
			service: 'Slicing',
			name: 'slicer-svc',
			type: 'Worker deployment (1 node, 8 GB)',
			applySeconds: 10,
			details: (s) => [
				['Queue (STL waiting)', `${Math.round(n(s, '_toSlice'))}`],
				['Ready G-code buffer', `${Math.round(n(s, '_sliced'))}`],
				['Memory per worker', `${WORKER_GB} GB`],
				['Node memory', `${NODE_GB} GB`],
				['Duplicate jobs in queue', `${Math.round(DUPLICATE_SHARE * 100)}% same STL + profile hash`],
				['Last event', slicerHealthy(s) ? 'slice ok' : 'OOMKilled: worker exceeded node memory, restarting']
			],
			status: (s) =>
				!slicerHealthy(s) ? { label: 'CrashLoop', tone: 'crit' } : n(s, '_toSlice') > 50 ? { label: 'Backlogged', tone: 'warn' } : { label: 'Healthy', tone: 'ok' },
			fields: [
				{ key: 'slicerWorkers', label: 'Slicer workers', kind: 'number', min: 1, max: 8, help: 'Each worker holds the mesh and toolpaths in memory (~2.5 GB).' },
				{ key: 'sliceCache', label: 'Reuse G-code for identical STL + profile', kind: 'toggle', help: 'Content-addressed cache keyed by hash(STL, printer profile, material).' }
			]
		}
	],
	initial: { printers: 40, slicerWorkers: 1, sliceCache: false, _toSlice: JOBS, _sliced: 0, _printing: 0, _done: 0 },
	events: [{ at: 5, log: 'farm-2: 300 jobs queued for slicing (order SO-77182)' }],
	step: (s): LabState => {
		const sliced = Math.min(n(s, '_toSlice'), sliceRate(s));
		const finish = n(s, '_printing') / PRINT_MIN;
		const free = Math.max(0, n(s, 'printers') - (n(s, '_printing') - finish));
		const start = Math.min(free, n(s, '_sliced') + sliced);
		return {
			_toSlice: n(s, '_toSlice') - sliced,
			_sliced: n(s, '_sliced') + sliced - start,
			_printing: n(s, '_printing') - finish + start,
			_done: n(s, '_done') + finish
		};
	},
	metrics: [
		{ id: 'done', label: 'Parts finished', get: (s) => n(s, '_done'), max: JOBS },
		{
			id: 'eta',
			label: 'Projected finish (min after T+0)',
			get: (s, { t }) => Math.min(2000, t + remaining(s) / Math.max(0.01, capacity(s))),
			alarm: DEADLINE,
			max: 1200
		},
		{ id: 'util', label: 'Printer utilisation', unit: '%', get: (s) => (busyPrinters(s) / n(s, 'printers')) * 100, max: 100 },
		{ id: 'queue', label: 'Slicer queue', get: (s) => n(s, '_toSlice') },
		{ id: 'slice', label: 'Slicer output /min', get: (s) => sliceRate(s) }
	],
	win: {
		text: 'Projected finish at or before T+07:00 with printers kept fed, held for 30 minutes.',
		check: (s, m) => m.eta <= DEADLINE && sliceRate(s) >= printRate(s),
		hold: 30
	},
	lose: [
		{ text: 'T+07:00 passed and the truck left with a partial order.', check: (s, _m, t) => t >= DEADLINE && n(s, '_done') < JOBS - 1 }
	],
	cost: (s) => n(s, 'printers') * 1.5 + n(s, 'slicerWorkers') * 0.2,
	timeLimit: 600,
	speed: 10,
	solution: [{ at: 15, set: { sliceCache: true, printers: 60 } }],
	trap: [{ at: 15, set: { printers: 80, slicerWorkers: 6 } }]
};

export default lab;
