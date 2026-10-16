import type { Lab, LabState } from '../types';

/**
 * Aurora failover succeeded, the app didn't notice. Pools hold connections to the old writer (now a reader),
 * and the JVM caches DNS forever. A planned maintenance failover follows at T+7:00.
 * Tempting: restart every pod at once (storefront outage) or reboot the DB. Fix: ship DNS TTL + pool
 * maxLifetime via a rolling deploy, so this and the next failover heal on their own.
 */

const PODS = 12;
const n = (s: LabState, k: string) => Number(s[k]);
const goodConfig = (s: LabState) => s.dnsTtl === '30 s' && s.maxLifetime !== 'none';

const writeErr = (s: LabState) => (n(s, '_down') > 0 ? 100 : Math.min(100, n(s, '_stale') * 100 + (n(s, '_dbReboot') > 0 ? 100 : 0)));
const readErr = (s: LabState) => (n(s, '_down') > 0 ? 100 : n(s, '_rolling') > 0 ? 3 : 0.1);

const lab: Lab = {
	title: 'The failover nobody noticed',
	console: 'cloud',
	scope: 'shop · eu-west-1',
	brief:
		'At T+0:05 the [[amazon-rds|Aurora]] writer `shop-db-a` lost its host. The cluster [[failover|failed over]] to `shop-db-b` in ~30 s, as designed. The storefront still loads, but **every order write fails**. Platform reminds you a **planned maintenance failover happens at T+7:00**.',
	resources: [
		{
			id: 'cluster',
			service: 'RDS',
			name: 'shop-db (Aurora PostgreSQL)',
			type: 'DB cluster',
			details: (s) => [
				['Writer endpoint', 'shop-db.cluster-c9x.eu-west-1.rds.amazonaws.com'],
				['Current writer', n(s, '_failovers') % 2 === 1 ? 'shop-db-b (10.0.2.41)' : 'shop-db-a (10.0.1.23)'],
				['Reader', n(s, '_failovers') % 2 === 1 ? 'shop-db-a (10.0.1.23), rejoined' : 'shop-db-b (10.0.2.41)'],
				['Writer connections', `${Math.round((1 - n(s, '_stale')) * PODS * 20)}`]
			],
			status: (s) => (n(s, '_dbReboot') > 0 ? { label: 'Rebooting', tone: 'crit' } : { label: 'Available', tone: 'ok' }),
			actions: [
				{
					id: 'reboot',
					label: 'Reboot writer',
					danger: true,
					confirm: 'Writer is unavailable for ~60 s.',
					run: () => ({ set: { _dbReboot: 60 }, log: 'RDS: RebootDBInstance shop-db-b' })
				}
			]
		},
		{
			id: 'app',
			service: 'EKS',
			name: 'storefront (Deployment)',
			type: `${PODS} pods · Java 17`,
			applySeconds: 5,
			details: (s) => [
				['Pool target', n(s, '_stale') > 0.5 ? '10.0.1.23 (shop-db-a) for most pods' : 'writer endpoint, resolved fresh'],
				['Sample error', n(s, '_stale') > 0 ? 'ERROR: cannot execute INSERT in a read-only transaction' : '—'],
				['JVM networkaddress.cache.ttl', s.dnsTtl === '30 s' ? '30' : '-1 (cache forever)'],
				['Hikari maxLifetime', String(s.maxLifetime)],
				['Rollout', n(s, '_rolling') > 0 ? `in progress, ${Math.ceil(n(s, '_rolling') / 6)} pods left` : 'idle']
			],
			status: (s) =>
				n(s, '_down') > 0 ? { label: 'Down', tone: 'crit' } : n(s, '_stale') > 0.05 ? { label: 'Write errors', tone: 'crit' } : { label: 'Healthy', tone: 'ok' },
			fields: [
				{ key: 'dnsTtl', label: 'JVM DNS cache TTL', kind: 'select', options: ['forever (-1)', '30 s'], help: 'Shipping config changes triggers a rolling deploy.' },
				{ key: 'maxLifetime', label: 'Pool connection maxLifetime', kind: 'select', options: ['none', '30 min', '60 s'], help: 'Connections older than this are closed and re-opened.' }
			],
			actions: [
				{
					id: 'rolling',
					label: 'Rolling restart',
					run: () => ({ set: { _rolling: PODS * 6 }, log: 'kubectl rollout restart deploy/storefront' })
				},
				{
					id: 'all',
					label: 'Delete all pods',
					danger: true,
					confirm: 'All 12 pods restart at once. JIT warm-up + 240 new DB connections arrive together.',
					run: () => ({ set: { _down: 45, _stale: 0 }, log: 'kubectl delete pods -l app=storefront' })
				}
			]
		}
	],
	initial: {
		dnsTtl: 'forever (-1)',
		maxLifetime: 'none',
		_stale: 0,
		_failovers: 0,
		_rolling: 0,
		_down: 0,
		_dbReboot: 0,
		_lastCfg: 'forever (-1)|none',
		_bad: 0,
		_readBad: 0
	},
	events: [
		{ at: 5, log: 'RDS event: shop-db-a host failure; failover to shop-db-b started' },
		{ at: 35, log: 'RDS event: failover completed, shop-db-b is the writer; shop-db-a rejoined as reader', set: { _stale: 1, _failovers: 1 } },
		{ at: 420, log: 'RDS event: planned maintenance failover to shop-db-a started', set: { _failovers: 2 } },
		{ at: 450, log: 'RDS event: failover completed, shop-db-a is the writer', set: { _stale: 1 } }
	],
	step: (s) => {
		const out: LabState = {};
		const cfg = `${s.dnsTtl}|${s.maxLifetime}`;
		let rolling = n(s, '_rolling');
		if (cfg !== s._lastCfg) {
			out._lastCfg = cfg;
			rolling = PODS * 6; // config change ships as a rolling deploy
		}
		let stale = n(s, '_stale');
		if (rolling > 0) {
			// One pod replaced every 6 s; a fresh pod resolves DNS at startup.
			if (rolling % 6 === 0) stale = Math.max(0, stale - 1 / PODS);
			rolling -= 1;
		} else if (goodConfig(s) && stale > 0) {
			// With short DNS TTL and bounded connection lifetime, pools drift back to the real writer.
			stale = Math.max(0, stale - (s.maxLifetime === '60 s' ? 1 / 90 : 1 / 1800));
		}
		out._rolling = rolling;
		out._stale = stale;
		out._down = Math.max(0, n(s, '_down') - 1);
		out._dbReboot = Math.max(0, n(s, '_dbReboot') - 1);
		const next = { ...s, ...out };
		out._bad = writeErr(next) > 50 ? n(s, '_bad') + 1 : 0;
		out._readBad = readErr(next) > 50 ? n(s, '_readBad') + 1 : 0;
		return out;
	},
	metrics: [
		{ id: 'write', label: 'Order write errors', unit: '%', get: writeErr, alarm: 1, max: 100 },
		{ id: 'read', label: 'Storefront read errors', unit: '%', get: readErr, alarm: 5, max: 100 },
		{ id: 'stale', label: 'Pods on wrong host', get: (s) => Math.round(n(s, '_stale') * PODS), max: PODS },
		{ id: 'conns', label: 'Writer connections', get: (s) => Math.round((1 - n(s, '_stale')) * PODS * 20) }
	],
	win: {
		text: 'Survive the T+7:00 maintenance failover: order write errors under 1% for 60 s after T+8:00.',
		check: (_s, m, t) => t > 480 && m.write < 1 && m.read < 5,
		hold: 60
	},
	lose: [
		{ text: 'Order writes failed for 5 straight minutes. Payments captured, orders lost: finance now has a reconciliation project.', check: (s) => n(s, '_bad') > 300 },
		{ text: 'The whole storefront was down for over 30 s: you turned a write outage into a full outage.', check: (s) => n(s, '_readBad') > 30 }
	],
	timeLimit: 900,
	speed: 5,
	solution: [{ at: 45, set: { dnsTtl: '30 s', maxLifetime: '60 s' } }],
	trap: [{ at: 45, action: { resource: 'app', id: 'all' } }]
};

export default lab;
