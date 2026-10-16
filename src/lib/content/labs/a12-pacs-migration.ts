import type { Lab, LabState } from '../types';

/**
 * A hospital replays ten years of PACS archive into the research de-identification pipeline.
 * Tempting moves: scale the de-id workers (not the bottleneck), or switch burned-in-text OCR off
 * (leaks PHI). Winning: scope OCR to the modalities that actually burn text into pixels
 * (US, SC, OT, scanned documents ≈ 8% of instances) AND add OCR nodes to drain what is already queued.
 */

const DEID_PER_WORKER = 100; // instances/s per tag de-id worker
const OCR_PER_NODE = 45; // instances/s per GPU OCR node
const OCR_SHARE_SCOPED = 0.08; // share of instances from modalities that carry burned-in text
const SPOOL_LIMIT = 250_000; // router spool capacity, instances

const n = (s: LabState, k: string) => Number(s[k]);

const deidCap = (s: LabState) => n(s, 'deidWorkers') * DEID_PER_WORKER;
const ocrCap = (s: LabState) => n(s, 'ocrNodes') * OCR_PER_NODE;
const ocrShare = (s: LabState) => (s.ocrScope === 'All modalities' ? 1 : s.ocrScope === 'US, SC, OT, DOC only' ? OCR_SHARE_SCOPED : 0);

/** Instances leaving each stage this second (computed from queues before the step). */
function flows(s: LabState) {
	const deidOut = Math.min(n(s, '_deidQ') + n(s, '_arrivals'), deidCap(s));
	const toOcr = deidOut * ocrShare(s);
	const ocrOut = Math.min(n(s, '_ocrQ') + toOcr, ocrCap(s));
	return { deidOut, toOcr, ocrOut, direct: deidOut - toOcr };
}

const delivered = (s: LabState) => {
	const f = flows(s);
	return f.direct + f.ocrOut;
};

const backlog = (s: LabState) => n(s, '_deidQ') + n(s, '_ocrQ');

const lab: Lab = {
	title: 'PACS migration: de-identification backlog',
	console: 'cloud',
	scope: 'research-imaging · eu-central-1',
	brief:
		'Radiology started replaying its ten-year [[pacs|PACS]] archive into the research pipeline at T+0: about 600 [[dicom|DICOM]] instances per second instead of the usual 50. Every instance goes through tag [[de-identification]], and then through an OCR stage that looks for [[burned-in-phi|patient names burned into the pixels]]. The research team needs new studies within minutes, and the router\'s spool disk holds 250,000 instances before it starts rejecting sends from the scanners.',
	resources: [
		{
			id: 'router',
			service: 'Imaging',
			name: 'dicom-router',
			type: 'DICOM router (C-STORE SCP)',
			details: (s) => [
				['Receiving', `${Math.round(n(s, '_arrivals'))} inst/s`],
				['Spooled (awaiting de-id)', Math.round(n(s, '_deidQ')).toLocaleString('en')],
				['Spool capacity', SPOOL_LIMIT.toLocaleString('en')],
				['Modality mix (last 1 h)', 'CT 61% · MR 22% · CR/DX 9% · US 5% · SC/OT/DOC 3%']
			],
			status: (s) =>
				backlog(s) > SPOOL_LIMIT * 0.6 ? { label: 'Spool filling', tone: 'crit' } : backlog(s) > 20_000 ? { label: 'Backlogged', tone: 'warn' } : { label: 'Healthy', tone: 'ok' }
		},
		{
			id: 'deid',
			service: 'Compute',
			name: 'deid-workers',
			type: 'Auto Scaling group',
			applySeconds: 30,
			details: (s) => [
				['Capacity', `${deidCap(s)} inst/s`],
				['Current throughput', `${Math.round(flows(s).deidOut)} inst/s`],
				['CPU (avg)', `${Math.round((flows(s).deidOut / Math.max(1, deidCap(s))) * 100)}%`],
				['Profile', 'PS3.15 Basic Profile + retain longitudinal (shifted dates)']
			],
			status: (s) => (flows(s).deidOut >= deidCap(s) * 0.98 ? { label: 'Saturated', tone: 'warn' } : { label: 'InService', tone: 'ok' }),
			fields: [{ key: 'deidWorkers', label: 'Desired capacity', kind: 'number', min: 1, max: 40, unit: 'workers', help: 'Each worker rewrites tags for ~100 instances/s.' }]
		},
		{
			id: 'ocr',
			service: 'Compute',
			name: 'burned-in-ocr',
			type: 'GPU node group',
			applySeconds: 90,
			details: (s) => [
				['Capacity', `${ocrCap(s)} inst/s`],
				['Queue', Math.round(n(s, '_ocrQ')).toLocaleString('en')],
				['GPU utilisation', `${Math.round((flows(s).ocrOut / Math.max(1, ocrCap(s))) * 100)}%`],
				['Detections (last 1 h)', 'US 31% · SC 44% · OT 12% · DOC 67% · CT 0.00% · MR 0.00%']
			],
			status: (s) =>
				s.ocrScope === 'Off' ? { label: 'Bypassed', tone: 'crit' } : n(s, '_ocrQ') > 5000 ? { label: 'Backlogged', tone: 'crit' } : { label: 'Healthy', tone: 'ok' },
			fields: [
				{ key: 'ocrNodes', label: 'GPU nodes', kind: 'number', min: 1, max: 6, unit: 'nodes', help: 'GPU quota in this region: 6 nodes. Each scans ~45 instances/s.' },
				{
					key: 'ocrScope',
					label: 'Scan scope',
					kind: 'select',
					options: ['All modalities', 'US, SC, OT, DOC only', 'Off'],
					help: 'Which instances are sent through pixel OCR before release.'
				}
			]
		}
	],
	initial: { deidWorkers: 8, ocrNodes: 2, ocrScope: 'All modalities', _deidQ: 0, _ocrQ: 0, _arrivals: 600, _leaked: 0 },
	events: [
		{ at: 3, log: 'dicom-router: inbound associations from PACS-ARCHIVE up 12× (migration replay)' },
		{ at: 1200, log: 'PACS-ARCHIVE: replay batch 1 complete, inbound back to ~50 inst/s', set: { _arrivals: 50 } }
	],
	step: (s, { rand }): LabState => {
		const f = flows(s);
		const arrivals = n(s, '_arrivals') * (0.95 + rand() * 0.1);
		return {
			_deidQ: Math.max(0, n(s, '_deidQ') + arrivals - f.deidOut),
			_ocrQ: Math.max(0, n(s, '_ocrQ') + f.toOcr - f.ocrOut),
			// With OCR off, the ~8% of instances that can carry burned-in text ship unchecked.
			_leaked: n(s, '_leaked') + (s.ocrScope === 'Off' ? f.deidOut * OCR_SHARE_SCOPED * 0.3 : 0)
		};
	},
	metrics: [
		{
			id: 'age',
			label: 'Oldest instance age',
			unit: 's',
			get: (s) => n(s, '_deidQ') / Math.max(1, flows(s).deidOut) + n(s, '_ocrQ') / Math.max(1, flows(s).ocrOut),
			alarm: 600,
			max: 3000
		},
		{ id: 'backlog', label: 'Instances waiting', get: (s) => backlog(s), thresholds: [{ value: SPOOL_LIMIT, tone: 'crit', label: 'spool full' }] },
		{ id: 'delivered', label: 'Released to research /s', get: (s) => delivered(s) },
		{ id: 'ocrq', label: 'OCR queue', get: (s) => n(s, '_ocrQ') },
		{ id: 'deidcpu', label: 'De-id CPU', unit: '%', get: (s) => (flows(s).deidOut / Math.max(1, deidCap(s))) * 100, max: 100 },
		{ id: 'leaked', label: 'Unscanned risky instances', get: (s) => n(s, '_leaked'), alarm: 0 }
	],
	win: {
		text: 'Fewer than 20,000 instances waiting and the oldest under 120 s, held for 30 s, with every risky instance still OCR-scanned.',
		check: (s, m) => m.backlog < 20_000 && m.age < 120 && n(s, '_leaked') === 0
	},
	lose: [
		{
			text: 'The router spool filled up. It started rejecting C-STORE from the scanners, and the emergency department\'s CT studies stopped reaching the clinical PACS.',
			check: (s) => backlog(s) > SPOOL_LIMIT
		},
		{
			text: 'You switched OCR off. Ultrasound and secondary-capture images with patient names burned into the pixels went to the research cloud. That is a reportable breach, whatever the tag de-identification did.',
			check: (s) => n(s, '_leaked') > 0
		}
	],
	cost: (s) => n(s, 'deidWorkers') * 0.17 + n(s, 'ocrNodes') * 1.21,
	timeLimit: 1500,
	speed: 5,
	solution: [
		{ at: 10, set: { ocrScope: 'US, SC, OT, DOC only', ocrNodes: 6 } }
	],
	trap: [{ at: 10, set: { deidWorkers: 30, ocrNodes: 6 } }]
};

export default lab;
