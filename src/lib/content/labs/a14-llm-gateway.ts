import type { Lab, LabState } from '../types';

/**
 * One tenant's batch job floods a shared inference pool. Adding replicas is the trap:
 * a new replica takes ~10 minutes to pull and load the weights, and the GPU quota caps you at 8 anyway.
 * The fix is per-tenant token limits at the gateway plus continuous batching on the pool.
 */

const INTERACTIVE = 18; // req/s from everyone else
const BATCH = 50; // req/s from acme-batch once the job starts
const BATCH_LIMIT = 10; // req/s acme is allowed under the per-tenant limit
const GPU_QUOTA = 8;

const n = (s: LabState, k: string) => Number(s[k]);

/** Requests/s one replica sustains. */
function perReplica(s: LabState) {
	let c = s.batching ? 15 : 6;
	if (s.prefixCache) c *= 1.25;
	if (n(s, 'maxTokens') > 1024) c *= 0.6; // longer generations hold KV memory and batch slots longer
	return c;
}
const liveReplicas = (s: LabState) => Math.min(n(s, '_live'), GPU_QUOTA);
const capacity = (s: LabState) => liveReplicas(s) * perReplica(s);
const batchArrivals = (s: LabState) => (s._flood ? (s.tenantLimit ? BATCH_LIMIT : BATCH) : 0);
const arrivals = (s: LabState) => INTERACTIVE + batchArrivals(s);
const ttft = (s: LabState) => (s.prefixCache ? 0.25 : 0.4) + n(s, '_queue') / Math.max(1, capacity(s));

const lab: Lab = {
	title: 'LLM gateway: one tenant floods the pool',
	console: 'kubernetes',
	scope: 'inference · eu-central',
	brief:
		'Your assistant runs on a self-hosted model behind an [[llm-gateway|LLM gateway]]. At T+5 the tenant `acme` starts a backfill job that sends ~50 requests/s with long prompts into the same pool everyone else uses (~18 requests/s of chat). Chat users see the spinner forever. Get chat [[ttft|time to first token]] back under 2 s and keep it there. Model replicas need ~10 minutes to pull and load weights.',
	resources: [
		{
			id: 'gateway',
			service: 'Gateway',
			name: 'llm-gateway',
			type: 'Routing & limits',
			applySeconds: 15,
			details: (s) => [
				['acme request rate', `${s._flood ? BATCH : 0} req/s`],
				['acme admitted', `${batchArrivals(s)} req/s`],
				['Other tenants', `${INTERACTIVE} req/s`],
				['Queue policy', 'single FIFO per pool']
			],
			status: (s) => (s.tenantLimit ? { label: 'Limits on', tone: 'ok' } : { label: 'No tenant limits', tone: 'warn' }),
			fields: [
				{
					key: 'tenantLimit',
					label: 'Per-tenant token limit',
					kind: 'toggle',
					help: 'Token-bucket per tenant (≈10 req/s for acme\'s prompt size). Excess gets 429 + Retry-After; acme\'s job retries with backoff.'
				}
			]
		},
		{
			id: 'pool',
			service: 'Workloads',
			name: 'vllm-pool',
			type: 'Deployment (1 GPU per replica)',
			applySeconds: 60,
			details: (s) => [
				['Replicas ready', `${liveReplicas(s)}`],
				['Replicas requested', `${s.replicas}`],
				['GPU quota (cluster)', `${GPU_QUOTA}`],
				['Per replica', `${perReplica(s).toFixed(1)} req/s`],
				['Pool capacity', `${capacity(s).toFixed(0)} req/s`]
			],
			status: (s) =>
				n(s, 'replicas') > GPU_QUOTA
					? { label: `${n(s, 'replicas') - GPU_QUOTA} Pending (quota)`, tone: 'warn' }
					: n(s, '_queue') > 500
						? { label: 'Saturated', tone: 'crit' }
						: { label: 'Running', tone: 'ok' },
			fields: [
				{ key: 'replicas', label: 'Replicas', kind: 'number', min: 1, max: 16, help: 'New replicas pull ~16 GB of weights and warm up: ready ~10 min after scaling.' },
				{
					key: 'batching',
					label: 'Continuous batching',
					kind: 'toggle',
					help: 'Requests join and leave the running batch every step instead of waiting for the slowest one. Requires a rolling restart (~1 min).'
				},
				{ key: 'prefixCache', label: 'Prefix (prompt) caching', kind: 'toggle', help: 'Reuse prefill for the shared 3k-token system prompt.' },
				{ key: 'maxTokens', label: 'max_tokens default', kind: 'number', min: 256, max: 8192, step: 256, help: 'Upper bound on generated tokens per request.' }
			]
		}
	],
	initial: {
		tenantLimit: false,
		replicas: 4,
		batching: false,
		prefixCache: false,
		maxTokens: 1024,
		_live: 4,
		_queue: 0,
		_flood: false,
		_scaleAt: -1,
		_target: 4,
		_t: 0
	},
	events: [
		{ at: 5, log: 'acme: batch job "reindex-summaries" started (≈50 req/s)', set: { _flood: true } },
		{ at: 40, log: 'PagerDuty: chat TTFT p95 > 5 s' }
	],
	step: (s): LabState => {
		const out: LabState = {};
		// Scaling: requested replicas only become ready ~600 s after the change was applied.
		if (n(s, 'replicas') !== n(s, '_target')) {
			out._target = n(s, 'replicas');
			if (n(s, 'replicas') > n(s, '_live')) out._scaleAt = Number(s._t ?? 0);
			else out._live = n(s, 'replicas');
		}
		const t = Number(s._t ?? 0) + 1;
		out._t = t;
		const scaleAt = n(s, '_scaleAt');
		if (scaleAt >= 0 && t - scaleAt >= 600) {
			out._live = n(s, 'replicas');
			out._scaleAt = -1;
		}
		const q = Math.max(0, n(s, '_queue') + arrivals(s) - capacity(s));
		out._queue = q;
		return out;
	},
	metrics: [
		{ id: 'ttft', label: 'Chat TTFT p95', unit: 's', get: (s) => ttft(s), alarm: 5, max: 120 },
		{ id: 'queue', label: 'Requests waiting', get: (s) => n(s, '_queue') },
		{ id: 'cap', label: 'Pool capacity req/s', get: (s) => capacity(s) },
		{ id: 'arr', label: 'Admitted req/s', get: (s) => arrivals(s) },
		{ id: 'r429', label: 'acme 429s /s', get: (s) => (s._flood && s.tenantLimit ? BATCH - BATCH_LIMIT : 0) },
		{ id: 'gpu', label: 'GPU utilization', unit: '%', get: (s) => Math.min(100, (Math.min(arrivals(s), capacity(s)) / Math.max(1, capacity(s))) * 100), max: 100 }
	],
	win: {
		text: 'Chat TTFT p95 under 2 s and fewer than 200 requests waiting, held for 30 s.',
		check: (_s, m) => m.ttft < 2 && m.queue < 200
	},
	lose: [
		{
			text: 'The queue passed 20,000 requests: the gateway started timing out every chat request and the incident went company-wide.',
			check: (_s, m) => m.queue > 20000
		}
	],
	cost: (s) => n(s, '_live') * 4.1 + Math.max(0, Math.min(n(s, 'replicas'), GPU_QUOTA) - n(s, '_live')) * 4.1,
	timeLimit: 900,
	speed: 5,
	solution: [
		{ at: 10, set: { batching: true } },
		{ at: 15, set: { tenantLimit: true } }
	],
	trap: [{ at: 10, set: { replicas: 12 } }]
};

export default lab;
