import type { Lab, LabState } from '../types';

/**
 * Order matters: create the new cluster, warm it (dual-write), THEN switch reads.
 * Switching reads to a cold cluster sends nearly every read to Postgres, which tips over.
 */

const READS = 60_000; // cache reads/s from the app
const DB_CAPACITY = 9_000; // reads/s the primary + replicas can serve at 100% CPU

const n = (s: LabState, k: string) => Number(s[k]);

/** Old cluster is full and evicting; its hit rate decays as the working set keeps growing. */
const oldHit = (s: LabState) => Math.max(0.78, 0.9 - n(s, '_growth') * 0.00012);
/** New cluster's hit rate tracks how much of the hot set it holds. */
const newHit = (s: LabState) => 0.97 * (n(s, '_warm') / 100);
const hitRate = (s: LabState) => (s.readFrom === 'cache-v2' && s._v2up ? newHit(s) : oldHit(s));
const dbReads = (s: LabState) => READS * (1 - hitRate(s)) + (s.dualWrite && s._v2up ? 300 : 0);
const dbCpu = (s: LabState) => Math.min(130, (dbReads(s) / DB_CAPACITY) * 100);

const lab: Lab = {
	title: 'Replace a cache cluster that is evicting',
	console: 'cloud',
	scope: 'prod · us-east-1',
	brief:
		'`cache-v1` (Redis, 26 GB) is at 100% memory and evicting hot keys: [[cache-hit-rate|hit rate]] has slid from 96% to ~90% and keeps falling as the catalogue grows, and Postgres read CPU is climbing. Finance approved a bigger cluster. Move the app onto it without an outage. The app reads ~60,000 keys/s; Postgres can absorb ~9,000 reads/s before it saturates.',
	resources: [
		{
			id: 'v2',
			service: 'ElastiCache',
			name: 'cache-v2',
			type: 'Redis cluster (r7g.2xlarge × 3)',
			applySeconds: 45,
			details: (s) => [
				['Status', s._v2up ? 'available' : s.createV2 ? 'creating' : 'not created'],
				['Memory', '3 × 52 GB'],
				['Hot set loaded', `${Math.round(n(s, '_warm'))}%`],
				['Keys written by app', s.dualWrite ? 'yes (dual-write)' : 'no']
			],
			status: (s) =>
				!s._v2up
					? { label: s.createV2 ? 'Creating' : 'Not created', tone: 'info' }
					: n(s, '_warm') < 80
						? { label: `Cold (${Math.round(n(s, '_warm'))}% warm)`, tone: 'warn' }
						: { label: 'Available, warm', tone: 'ok' },
			fields: [{ key: 'createV2', label: 'Provision cluster', kind: 'toggle', help: 'Creates the empty cluster.' }]
		},
		{
			id: 'app',
			service: 'ECS',
			name: 'catalog-api',
			type: 'Service config',
			applySeconds: 20,
			details: (s) => [
				['Reads from', String(s.readFrom)],
				['Dual-write to cache-v2', s.dualWrite ? 'on' : 'off'],
				['Read rate', '60k keys/s']
			],
			status: (s) => (dbCpu(s) > 95 ? { label: 'Timeouts', tone: 'crit' } : { label: 'Running', tone: 'ok' }),
			fields: [
				{
					key: 'dualWrite',
					label: 'Dual-write to cache-v2',
					kind: 'toggle',
					help: 'On every miss-fill and write, also SET the key in cache-v2. Warms v2 with exactly the keys traffic uses.'
				},
				{ key: 'readFrom', label: 'Read endpoint', kind: 'select', options: ['cache-v1', 'cache-v2'] }
			]
		},
		{
			id: 'v1',
			service: 'ElastiCache',
			name: 'cache-v1',
			type: 'Redis cluster (r7g.xlarge × 2)',
			details: (s) => [
				['Memory used', '100%'],
				['Evictions', `${Math.round(900 + n(s, '_growth') * 4)}/s`],
				['maxmemory-policy', 'allkeys-lru']
			],
			status: () => ({ label: 'Evicting', tone: 'warn' }),
			actions: [
				{
					id: 'flush',
					label: 'FLUSHALL',
					danger: true,
					confirm: 'Deletes every key in cache-v1 immediately.',
					run: () => ({ set: { _flushed: true }, log: 'cache-v1: FLUSHALL' })
				}
			]
		},
		{
			id: 'db',
			service: 'RDS',
			name: 'catalog-db',
			type: 'Aurora PostgreSQL (writer + 2 readers)',
			details: (s) => [
				['Reads/s', `${Math.round(dbReads(s)).toLocaleString('en')}`],
				['Capacity', '~9,000 reads/s']
			],
			status: (s) => (dbCpu(s) > 95 ? { label: 'Saturated', tone: 'crit' } : dbCpu(s) > 75 ? { label: 'High CPU', tone: 'warn' } : { label: 'Available', tone: 'ok' })
		}
	],
	initial: { createV2: false, dualWrite: false, readFrom: 'cache-v1', _v2up: false, _v2timer: 0, _warm: 0, _growth: 0, _hot: 0, _flushed: false },
	step: (s) => {
		const out: LabState = { _growth: n(s, '_growth') + 1 };
		// Provisioning takes ~90 s after the change lands.
		if (s.createV2 && !s._v2up) {
			const t = n(s, '_v2timer') + 1;
			out._v2timer = t;
			if (t >= 90) out._v2up = true;
		}
		// Dual-write warms v2 with the hot set; reading from v2 also fills it, but via DB misses.
		if (s._v2up && (s.dualWrite || s.readFrom === 'cache-v2')) out._warm = Math.min(100, n(s, '_warm') + (s.dualWrite ? 0.9 : 0.35));
		if (s._flushed) out._growth = n(s, '_growth') + 400;
		out._hot = dbCpu(s) >= 100 ? n(s, '_hot') + 1 : 0;
		return out;
	},
	metrics: [
		{ id: 'hit', label: 'Cache hit rate', unit: '%', get: (s) => hitRate(s) * 100, max: 100 },
		{ id: 'dbreads', label: 'DB reads /s', get: (s) => dbReads(s), thresholds: [{ value: DB_CAPACITY, tone: 'crit', label: 'capacity' }] },
		{ id: 'cpu', label: 'DB CPU', unit: '%', get: (s) => Math.min(100, dbCpu(s)), alarm: 90, max: 100 },
		{ id: 'warm', label: 'cache-v2 warm', unit: '%', get: (s) => n(s, '_warm'), max: 100 },
		{ id: 'p99', label: 'API p99', unit: ' ms', get: (s) => (dbCpu(s) < 70 ? 40 : dbCpu(s) < 100 ? 40 + (dbCpu(s) - 70) * 25 : 5000) }
	],
	win: {
		text: 'App reading from cache-v2, hit rate ≥ 94% and DB CPU under 60%, held for 30 s.',
		check: (s, m) => s.readFrom === 'cache-v2' && !!s._v2up && m.hit >= 94 && m.cpu < 60
	},
	lose: [
		{
			text: 'Postgres sat at 100% CPU for 15 s: connection pools filled, the API timed out, and the incident is now an outage. Reads moved to a cold cache, so nearly every request became a database query.',
			check: (s) => n(s, '_hot') >= 15 && s.readFrom === 'cache-v2'
		},
		{
			text: 'Postgres sat at 100% CPU for 15 s and the API is timing out. cache-v1 kept evicting as the working set grew, so the miss rate (and database load) rose until it crossed capacity. Waiting was not a plan.',
			check: (s) => n(s, '_hot') >= 15
		}
	],
	cost: (s) => 1.04 + (s._v2up ? 2.9 : 0) + 2.1,
	timeLimit: 900,
	speed: 5,
	solution: [
		{ at: 5, set: { createV2: true } },
		{ at: 150, set: { dualWrite: true } },
		{ at: 300, set: { readFrom: 'cache-v2' } }
	],
	trap: [
		{ at: 5, set: { createV2: true } },
		{ at: 150, set: { readFrom: 'cache-v2' } }
	]
};

export default lab;
