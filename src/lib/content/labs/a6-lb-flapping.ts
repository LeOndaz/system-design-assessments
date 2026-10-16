import type { Lab, LabState } from '../types';

/**
 * Rolling deploy behind a load balancer. New targets are cold (JIT, empty caches) and the health check is a
 * "deep" check that shares the request thread pool with a 2 s timeout. Cold targets fail it under full traffic,
 * get pulled, push their load onto the rest, which then fail too: flapping and a cascade.
 * Tempting: roll back (also launches cold targets) or crank the timeout (overloaded targets still 5xx).
 * Fix: shallow liveness check for the LB + slow start so new targets ramp their share.
 */

const N = 10;
const RPS = 2200;
const WARM_CAP = 400;
const WARMUP = 90; // seconds for JIT/caches to warm

interface Target {
	v: 'old' | 'new';
	age: number; // seconds since boot
	warm: number; // seconds of real traffic served (JIT + caches only warm under load)
	inService: boolean;
	failFor: number; // consecutive seconds failing checks
	passFor: number; // consecutive seconds passing checks
	since: number; // seconds since (re)entering service, for slow start
}

const n = (s: LabState, k: string) => Number(s[k]);
const targets = (s: LabState): Target[] => JSON.parse(String(s._targets));
const cap = (t: Target) => (t.warm >= WARMUP ? WARM_CAP : 120 + (280 * t.warm) / WARMUP);

/** Per-target load given current weights. */
function loads(s: LabState, ts: Target[]) {
	const slow = n(s, 'slowStart');
	const w = ts.map((t) => (!t.inService ? 0 : slow > 0 ? Math.min(1, Math.max(0.05, t.since / slow)) : 1));
	const sum = w.reduce((a, b) => a + b, 0);
	return ts.map((_, i) => (sum ? (RPS * w[i]) / sum : 0));
}

function errorRate(s: LabState) {
	const ts = targets(s);
	if (!ts.some((t) => t.inService)) return 100;
	const ls = loads(s, ts);
	const dropped = ts.reduce((acc, t, i) => acc + Math.max(0, ls[i] - cap(t)), 0);
	return Math.min(100, (dropped / RPS) * 100);
}

const initialTargets: Target[] = Array.from({ length: N }, () => ({ v: 'old', age: 3600, warm: 3600, inService: true, failFor: 0, passFor: 0, since: 3600 }));

const lab: Lab = {
	title: 'Deploy that flaps itself to death',
	console: 'cloud',
	scope: 'search-api · ap-southeast-2',
	brief:
		'A routine rolling deploy of `search-api` v2.31 just started: one of 10 targets is replaced every 15 s. Within a minute, targets start bouncing between *healthy* and *unhealthy* and 5xx is climbing. The code is fine (it passed the canary at 1% traffic). Finish the deploy without an outage.',
	resources: [
		{
			id: 'tg',
			service: 'EC2',
			name: 'tg-search-api',
			type: 'Target group',
			applySeconds: 10,
			details: (s) => {
				const ts = targets(s);
				const ls = loads(s, ts);
				return [
					['Healthy targets', `${ts.filter((t) => t.inService).length}/${N}`],
					['New version targets', `${ts.filter((t) => t.v === 'new').length}`],
					['Health check', `${s.healthPath} · timeout ${s.timeout}s · interval 5s · unhealthy after ${s.unhealthyThreshold}`],
					['Busiest target', `${Math.round(Math.max(...ls))} rps (warm capacity ${WARM_CAP})`],
					['Flaps (last 60 s)', `${n(s, '_flaps')}`],
					['/health/deep does', 'SELECT 1 on Postgres + Redis PING, on the request thread pool']
				];
			},
			status: (s) => {
				const up = targets(s).filter((t) => t.inService).length;
				return up < N ? { label: `${N - up} unhealthy`, tone: up < 7 ? 'crit' : 'warn' } : { label: 'All healthy', tone: 'ok' };
			},
			fields: [
				{ key: 'healthPath', label: 'Health check path', kind: 'select', options: ['/health/deep', '/healthz'], help: '`/healthz` answers from a dedicated thread: "is the process alive and ready".' },
				{ key: 'timeout', label: 'Health check timeout', kind: 'number', min: 2, max: 30, unit: 's' },
				{ key: 'unhealthyThreshold', label: 'Unhealthy threshold', kind: 'number', min: 2, max: 10, unit: 'checks' },
				{ key: 'slowStart', label: 'Slow start duration', kind: 'number', min: 0, max: 600, step: 30, unit: 's', help: 'New targets ramp from a small share of traffic to full over this window.' }
			]
		},
		{
			id: 'deploy',
			service: 'CodeDeploy',
			name: 'search-api v2.31',
			type: 'Rolling deployment',
			details: (s) => [
				['Progress', `${targets(s).filter((t) => t.v === 'new').length}/${N} targets replaced`],
				['Batch', '1 target / 15 s'],
				['State', s._paused ? 'paused' : s._rollback ? 'rolling back' : 'in progress']
			],
			status: (s) => (s._paused ? { label: 'Paused', tone: 'warn' } : s._rollback ? { label: 'Rolling back', tone: 'warn' } : { label: 'In progress', tone: 'info' }),
			actions: [
				{ id: 'pause', label: 'Pause deployment', run: (s) => ({ set: { _paused: !s._paused }, log: s._paused ? 'CodeDeploy: resumed' : 'CodeDeploy: paused' }) },
				{
					id: 'rollback',
					label: 'Roll back to v2.30',
					danger: true,
					confirm: 'Replaces new targets with freshly launched v2.30 targets.',
					run: () => ({ set: { _rollback: true, _paused: false }, log: 'CodeDeploy: rollback started' })
				}
			]
		}
	],
	initial: {
		healthPath: '/health/deep',
		timeout: 2,
		unhealthyThreshold: 2,
		slowStart: 0,
		_targets: JSON.stringify(initialTargets),
		_next: 0,
		_paused: false,
		_rollback: false,
		_flaps: 0,
		_bad: 0
	},
	step: (s, { t }) => {
		const ts = targets(s);
		let next = n(s, '_next');
		// Deployment: replace one target every 15 s (rollback replaces new ones with cold old ones).
		if (!s._paused && t % 15 === 0) {
			const want = s._rollback ? 'old' : 'new';
			const idx = ts.findIndex((x) => x.v !== want);
			if (idx >= 0) {
				ts[idx] = { v: want, age: 0, warm: 0, inService: false, failFor: 0, passFor: 0, since: 0 };
				next++;
			}
		}
		const ls = loads(s, ts);
		const deep = s.healthPath === '/health/deep';
		let flaps = n(s, '_flaps') * 0.98;
		ts.forEach((x, i) => {
			x.age += 1;
			if (x.inService) x.warm += Math.min(1, ls[i] / 100);
			if (x.age < 10) return; // booting
			const util = x.inService ? ls[i] / cap(x) : 0.3;
			// Deep check rides the same pool: latency explodes past saturation.
			const latency = deep ? (util < 0.85 ? 0.06 : util < 1 ? 0.06 + (util - 0.85) * 12 : 2 + (util - 1) * 20) : 0.005;
			const fail = latency > n(s, 'timeout');
			if (fail) {
				x.failFor += 1;
				x.passFor = 0;
			} else {
				x.passFor += 1;
				x.failFor = 0;
			}
			if (x.inService && x.failFor >= n(s, 'unhealthyThreshold') * 5) {
				x.inService = false;
				flaps += 1;
			} else if (!x.inService && x.passFor >= 10) {
				x.inService = true;
				x.since = 0;
			}
			if (x.inService) x.since += 1;
		});
		const out: LabState = { _targets: JSON.stringify(ts), _next: next, _flaps: flaps };
		out._bad = errorRate({ ...s, ...out }) > 15 ? n(s, '_bad') + 1 : 0;
		return out;
	},
	metrics: [
		{ id: 'err', label: 'LB 5xx', unit: '%', get: errorRate, alarm: 1, max: 100 },
		{ id: 'healthy', label: 'Healthy targets', get: (s) => targets(s).filter((t) => t.inService).length, max: N },
		{ id: 'new', label: 'Targets on v2.31', get: (s) => targets(s).filter((t) => t.v === 'new').length, max: N },
		{ id: 'flaps', label: 'Health flaps (decaying)', get: (s) => n(s, '_flaps') }
	],
	win: {
		text: 'All 10 targets on v2.31 and healthy, LB 5xx under 1%, held for 60 s.',
		check: (s, m) => m.new === N && m.healthy === N && m.err < 1 && !s._rollback,
		hold: 60
	},
	lose: [{ text: '5xx above 15% for 90 s: search is effectively down and the deploy is now an incident.', check: (s) => n(s, '_bad') > 90 }],
	timeLimit: 900,
	speed: 5,
	solution: [{ at: 20, set: { healthPath: '/healthz', slowStart: 60 } }],
	trap: [{ at: 70, action: { resource: 'deploy', id: 'rollback' } }]
};

export default lab;
