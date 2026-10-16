import type { Lab, LabState } from '../types';

/**
 * Swap the embedding model behind a live RAG assistant. Order matters:
 * create the new index, turn on dual-write, backfill within the provider's rate limit, verify, then switch reads.
 * Switching reads early collapses recall; skipping dual-write leaves every new document invisible;
 * pushing the backfill past the provider's limit gets it throttled to a crawl.
 */

const CORPUS = 1000; // thousands of chunks at T+0
const NEW_DOCS = 1; // k-chunks ingested per simulated second (compressed time)
const OLD_RECALL = 0.71;
const NEW_RECALL = 0.86;
const RATE: Record<string, number> = { '50 req/s': 1.5, '200 req/s': 6, '800 req/s': 0.6 }; // k-chunks/s actually embedded

const n = (s: LabState, k: string) => Number(s[k]);

const total = (s: LabState) => CORPUS + n(s, '_ingested');
const coverage = (s: LabState) => (s._indexUp ? Math.min(1, n(s, '_indexed') / total(s)) : 0);
const readRecall = (s: LabState) => (s.readFrom === 'v2' ? NEW_RECALL * coverage(s) : OLD_RECALL);

const lab: Lab = {
	title: 'Embedding model upgrade on a live assistant',
	console: 'cloud',
	scope: 'search · eu-west-1',
	brief:
		'The support assistant retrieves from `kb-v1`, embedded with a model the provider retires soon. Offline evals say the new model lifts [[recall-at-k|recall@10]] from 0.71 to 0.86. About 1M chunks are indexed and ~1k new chunks arrive every second of this exercise (compressed time). Move reads to the new model without a quality dip. The embedding provider allows ~300 requests/s on your key.',
	resources: [
		{
			id: 'v2',
			service: 'Vector DB',
			name: 'kb-v2',
			type: 'HNSW index (new model, 1,024 dims)',
			applySeconds: 30,
			details: (s) => [
				['Status', s._indexUp ? 'ready' : s.createIndex ? 'creating' : 'not created'],
				['Chunks indexed', `${Math.round(n(s, '_indexed'))}k / ${Math.round(total(s))}k`],
				['Coverage', `${(coverage(s) * 100).toFixed(1)}%`],
				['Backfill', s._backfill ? `running at ${s.backfillRate}` : 'stopped']
			],
			status: (s) =>
				!s._indexUp
					? { label: s.createIndex ? 'Creating' : 'Not created', tone: 'info' }
					: coverage(s) < 0.98
						? { label: `Incomplete (${(coverage(s) * 100).toFixed(0)}%)`, tone: 'warn' }
						: { label: 'Complete', tone: 'ok' },
			fields: [
				{ key: 'createIndex', label: 'Create index', kind: 'toggle', help: 'Creates the empty index with the new model\'s dimension and metric.' },
				{
					key: 'backfillRate',
					label: 'Backfill concurrency',
					kind: 'select',
					options: ['50 req/s', '200 req/s', '800 req/s'],
					help: 'Embedding API requests per second used by the backfill job.'
				}
			],
			actions: [
				{
					id: 'backfill',
					label: 'Start backfill',
					run: (s) =>
						s._indexUp
							? {
									// Snapshot: everything that exists now and wasn't already dual-written.
									set: { _backfill: true, _bfTarget: total(s) - n(s, '_dw') },
									log: 'kb-v2: backfill job started (re-embedding every chunk that exists now)'
								}
							: { log: 'kb-v2: backfill failed to start: index does not exist yet' }
				}
			]
		},
		{
			id: 'app',
			service: 'ECS',
			name: 'assistant-api',
			type: 'Service config',
			applySeconds: 20,
			details: (s) => [
				['Reads from', String(s.readFrom)],
				['Writes new chunks to v2', s.dualWrite ? 'yes' : 'no'],
				['Shadow comparison', s._indexUp ? `v2 recall on sample: ${(NEW_RECALL * coverage(s)).toFixed(2)}` : 'n/a']
			],
			status: (s) => (readRecall(s) < 0.6 ? { label: 'Degraded answers', tone: 'crit' } : { label: 'Running', tone: 'ok' }),
			fields: [
				{ key: 'dualWrite', label: 'Dual-write new chunks to kb-v2', kind: 'toggle', help: 'Embed every newly ingested chunk with both models.' },
				{ key: 'readFrom', label: 'Read index', kind: 'select', options: ['v1', 'v2'] }
			]
		},
		{
			id: 'provider',
			service: 'Embeddings API',
			name: 'embed-api key',
			type: 'Third-party quota',
			details: (s) => [
				['Rate limit', '300 req/s'],
				['Current backfill demand', s._backfill ? String(s.backfillRate) : '0'],
				['429s', s._backfill && s.backfillRate === '800 req/s' ? 'sustained (client retrying with no backoff)' : 'none']
			],
			status: (s) => (s._backfill && s.backfillRate === '800 req/s' ? { label: 'Throttling', tone: 'crit' } : { label: 'OK', tone: 'ok' })
		}
	],
	initial: {
		createIndex: false,
		backfillRate: '50 req/s',
		dualWrite: false,
		readFrom: 'v1',
		_indexUp: false,
		_backfill: false,
		_indexed: 0,
		_ingested: 0,
		_backfilled: 0,
		_bfTarget: 0,
		_dw: 0,
		_lowFor: 0
	},
	step: (s): LabState => {
		const out: LabState = {};
		if (s.createIndex && !s._indexUp) out._indexUp = true;
		const ingested = n(s, '_ingested') + NEW_DOCS;
		out._ingested = ingested;
		let indexed = n(s, '_indexed');
		if (s._indexUp && s.dualWrite) {
			indexed += NEW_DOCS;
			out._dw = n(s, '_dw') + NEW_DOCS;
		}
		if (s._backfill && n(s, '_backfilled') < n(s, '_bfTarget')) {
			const add = Math.min(RATE[String(s.backfillRate)], n(s, '_bfTarget') - n(s, '_backfilled'));
			out._backfilled = n(s, '_backfilled') + add;
			indexed += add;
		}
		out._indexed = indexed;
		const low = (s.readFrom === 'v2' ? NEW_RECALL * coverage(s) : OLD_RECALL) < 0.45;
		out._lowFor = low ? n(s, '_lowFor') + 1 : 0;
		return out;
	},
	metrics: [
		{ id: 'recall', label: 'Live recall@10 (sampled)', get: (s) => readRecall(s), max: 1 },
		{ id: 'coverage', label: 'kb-v2 coverage', unit: '%', get: (s) => coverage(s) * 100, max: 100 },
		{ id: 'backfill', label: 'Backfill progress', unit: '%', get: (s) => (s._backfill ? (n(s, '_backfilled') / Math.max(1, n(s, '_bfTarget'))) * 100 : 0), max: 100 },
		{
			id: 'r429',
			label: 'Embedding API 429s /s',
			get: (s) => (s._backfill && n(s, '_backfilled') < n(s, '_bfTarget') && s.backfillRate === '800 req/s' ? 500 : 0),
			alarm: 0
		},
		{ id: 'thumbs', label: 'Thumbs-down rate', unit: '%', get: (s) => Math.max(2, (0.9 - readRecall(s)) * 30), alarm: 10, max: 30 }
	],
	win: {
		text: 'Reads served from kb-v2 with live recall@10 ≥ 0.84, held for 30 s.',
		check: (s, m) => s.readFrom === 'v2' && m.recall >= 0.84
	},
	lose: [
		{
			text: 'Recall stayed under 0.45 for 20 s: the assistant answered from an almost empty index, support escalated and the cutover was rolled back by the on-call lead.',
			check: (s) => n(s, '_lowFor') >= 20
		}
	],
	timeLimit: 900,
	speed: 5,
	solution: [
		{ at: 5, set: { createIndex: true, dualWrite: true, backfillRate: '200 req/s' } },
		{ at: 60, action: { resource: 'v2', id: 'backfill' } },
		{ at: 300, set: { readFrom: 'v2' } }
	],
	trap: [
		{ at: 5, set: { createIndex: true } },
		{ at: 50, set: { readFrom: 'v2' } }
	]
};

export default lab;
