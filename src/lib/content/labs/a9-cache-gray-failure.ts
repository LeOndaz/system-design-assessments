import type { Lab, LabState } from '../types';

/**
 * A Redis cluster shard is "available" but its single engine thread is pinned by a big-key command
 * from a feature flag rolled out at T+10. Clients with a 5 s timeout hold workers (Little's law),
 * so the whole API fails. Scaling the API is the trap; failing over moves the problem to the replica.
 * The root cause is in the flag service: the console's activity log says what changed.
 */

const RPS = 3000;
const WORKERS_PER_TASK = 50;
const DB_CAP = 1000; // DB reads/s before latency explodes
const SHARE = 1 / 3; // keys on the sick shard

const n = (s: LabState, k: string) => Number(s[k]);

function shardSick(s: LabState) {
	if (n(s, '_failover') > 0) return 'down'; // promoting replica: connection refused, fails fast
	return s.bulkExport ? 'slow' : 'ok';
}

function missRate(s: LabState) {
	const sick = shardSick(s) !== 'ok';
	return 0.05 + (sick ? SHARE : 0);
}

function dbQps(s: LabState) {
	const misses = RPS * missRate(s);
	return s.coalesce ? RPS * 0.05 + (misses - RPS * 0.05) * 0.2 : misses;
}

function dbLatency(s: LabState) {
	const q = dbQps(s);
	return q <= DB_CAP ? 0.005 : 0.005 + ((q - DB_CAP) / DB_CAP) * 2;
}

/** Mean seconds a worker is held per request. */
function holdTime(s: LabState) {
	const state = shardSick(s);
	const cacheWait = state === 'slow' ? SHARE * Math.min(n(s, 'timeoutMs') / 1000, 0.4 + n(s, 'timeoutMs') / 1000) : state === 'down' ? SHARE * 0.002 : 0;
	return 0.04 + cacheWait + missRate(s) * dbLatency(s);
}

function served(s: LabState) {
	const workers = n(s, 'tasks') * WORKERS_PER_TASK;
	return Math.min(RPS, workers / holdTime(s));
}

const lab: Lab = {
	title: 'Wednesday 14:02: everything 503s, cache says "available"',
	console: 'cloud',
	scope: 'prod · us-east-1',
	brief:
		'At 14:02 the API started returning 503s on every route. The cache cluster console shows all nodes **available** and passing health checks. The database is fine. Restore the API, then make sure it stays fixed. The activity log is evidence, not noise.',
	resources: [
		{
			id: 'api',
			service: 'ECS',
			name: 'api',
			type: 'Service (Fargate)',
			applySeconds: 45,
			details: (s) => [
				['Tasks', `${s.tasks}`],
				['Workers', `${n(s, 'tasks') * WORKERS_PER_TASK}`],
				['Avg worker hold time', `${Math.round(holdTime(s) * 1000)} ms`],
				['Redis client timeout', `${s.timeoutMs} ms`]
			],
			status: (s) => (served(s) < RPS * 0.99 ? { label: 'Shedding requests', tone: 'crit' } : { label: 'Steady', tone: 'ok' }),
			fields: [
				{ key: 'tasks', label: 'Desired tasks', kind: 'number', min: 1, max: 200 },
				{ key: 'timeoutMs', label: 'Redis command timeout', kind: 'number', min: 10, max: 10000, step: 10, unit: 'ms', help: 'On timeout the client treats the key as a cache miss and reads the DB.' },
				{ key: 'coalesce', label: 'Coalesce concurrent misses (single-flight)', kind: 'toggle' }
			]
		},
		{
			id: 'redis',
			service: 'ElastiCache',
			name: 'sessions-cache',
			type: 'Redis cluster (3 shards × 2)',
			details: (s) => [
				['Shard 0001 engine CPU', '18%'],
				['Shard 0002 engine CPU', shardSick(s) === 'slow' ? '100%' : shardSick(s) === 'down' ? '— (failing over)' : '21%'],
				['Shard 0003 engine CPU', '17%'],
				['Shard 0002 SLOWLOG top', s.bulkExport ? 'HGETALL session:bulk:* (412 ms, 9.8 MB reply)' : 'GET session:… (0.2 ms)'],
				['Node health checks', 'passing']
			],
			status: (s) => (shardSick(s) === 'slow' ? { label: 'Available', tone: 'ok' } : shardSick(s) === 'down' ? { label: 'Failing over', tone: 'warn' } : { label: 'Available', tone: 'ok' }),
			actions: [
				{
					id: 'failover',
					label: 'Fail over shard 0002',
					confirm: 'Promotes the replica. Shard 0002 refuses connections for ~40 s.',
					run: () => ({ set: { _failover: 40 }, log: 'sessions-cache: TestFailover shard 0002' })
				}
			]
		},
		{
			id: 'flags',
			service: 'Feature flags',
			name: 'bulk-session-export',
			type: 'Flag',
			applySeconds: 10,
			details: (s) => [
				['Owner', 'growth-team'],
				['Rollout', s.bulkExport ? '100% (changed 14:01 by j.okafor)' : '0%'],
				['Description', 'Nightly CSV of active sessions; moved to on-demand in admin UI']
			],
			status: (s) => (s.bulkExport ? { label: 'ON', tone: 'warn' } : { label: 'OFF', tone: 'info' }),
			fields: [{ key: 'bulkExport', label: 'Enabled', kind: 'toggle' }]
		},
		{
			id: 'db',
			service: 'RDS',
			name: 'core-db',
			type: 'DB instance (PostgreSQL)',
			details: (s) => [
				['Reads /s', `${Math.round(dbQps(s))}`],
				['Comfortable capacity', `${DB_CAP} reads/s`]
			],
			status: (s) => (dbQps(s) > DB_CAP ? { label: 'Overloaded', tone: 'crit' } : { label: 'Available', tone: 'ok' })
		}
	],
	initial: { tasks: 12, timeoutMs: 5000, coalesce: false, bulkExport: false, _failover: 0, _bad: 0 },
	events: [
		{ at: 10, log: 'flags: bulk-session-export rollout 0% → 100% (growth-team)', set: { bulkExport: true } },
		{ at: 14, log: 'ALB: HTTPCode_ELB_503 > 1000/min' },
		{ at: 30, log: 'sessions-cache: all nodes healthy (health check 200 OK)' }
	],
	step: (s) => ({
		_failover: Math.max(0, n(s, '_failover') - 1),
		_bad: (RPS - served(s)) / RPS > 0.3 ? n(s, '_bad') + 1 : 0
	}),
	metrics: [
		{ id: 'err', label: '5xx rate', unit: '%', get: (s) => ((RPS - served(s)) / RPS) * 100, alarm: 5, max: 100 },
		{ id: 'lat', label: 'API latency (mean)', unit: 'ms', get: (s) => holdTime(s) * 1000, alarm: 300, max: 3000 },
		{ id: 'db', label: 'DB reads /s', get: dbQps, thresholds: [{ value: DB_CAP, tone: 'crit', label: 'cap' }] },
		{ id: 'miss', label: 'Cache miss rate', unit: '%', get: (s) => missRate(s) * 100, max: 100 },
		{ id: 'redisTimeouts', label: 'Redis timeouts /s', get: (s) => (shardSick(s) === 'slow' ? served(s) * SHARE : 0), alarm: 10 }
	],
	win: {
		text: '5xx under 1% and latency under 200 ms, held for 45 s, with the cause removed (not just masked).',
		check: (s, m) => m.err < 1 && m.lat < 200 && !s.bulkExport,
		hold: 45
	},
	lose: [{ text: 'The API was mostly down for 4 straight minutes. Scaling added workers that also waited 5 s on the same pinned shard.', check: (s) => n(s, '_bad') >= 240 }],
	cost: (s) => n(s, 'tasks') * 0.12 + 2.2,
	timeLimit: 600,
	speed: 5,
	solution: [
		{ at: 20, set: { timeoutMs: 50, coalesce: true } },
		{ at: 25, set: { bulkExport: false } }
	],
	trap: [
		{ at: 20, set: { tasks: 60 } },
		{ at: 25, action: { resource: 'redis', id: 'failover' } }
	]
};

export default lab;
