import type { Lab, LabAction, LabState } from '../types';

type ActionResult = ReturnType<LabAction['run']>;

/**
 * Rotate the DB credential before the compliance deadline without an outage.
 * Traps: single-user rotation (old password dies instantly; pods keep it until restart) and
 * restarting all 30 pods at once (a SCRAM-auth connection storm that crash-loops the fleet).
 * Fix: alternating users (two valid credentials), staged rollout, then retire the old one.
 */

const n = (s: LabState, k: string) => Number(s[k]);
const REPLICAS = 30;
const NEEDED = 24; // pods worth of capacity the traffic needs
const POOL = 20;
const MAX_LIFETIME = 300; // pool recycles connections after 5 min

const staleFrac = (s: LabState, t: number) => (s._oldValid ? 0 : Math.min(1, (t - n(s, '_invalidSince')) / MAX_LIFETIME));

function healthy(s: LabState, t: number) {
	return n(s, '_onNew') + n(s, '_onOld') * (1 - staleFrac(s, t));
}
const errorRate = (s: LabState, t: number) => Math.max(0, ((NEEDED - healthy(s, t)) / NEEDED) * 100);
const opening = (s: LabState) => (n(s, '_batchT') >= 1 && n(s, '_batchT') <= 5 ? (n(s, '_batch') * POOL) / 5 : 0);
const dbCpu = (s: LabState) => 34 + opening(s) * 0.6;

const lab: Lab = {
	title: 'Rotate orders-db credentials before the audit deadline',
	console: 'cloud',
	scope: 'prod · eu-west-1 · deadline T+15:00',
	brief:
		'Audit finding: the `orders` DB password is 400 days old and must be rotated, with the old one revoked, today. `orders-api` runs 30 pods; each reads the credential **once at startup** and holds a pool of 20 connections (recycled every 5 min). Last quarter\'s rotation caused a 40-minute outage. Do it with no customer impact. See [[secret-rotation]].',
	resources: [
		{
			id: 'secret',
			service: 'Secrets Manager',
			name: 'orders-db-credentials',
			type: 'Secret (rotation via Lambda)',
			applySeconds: 10,
			details: (s) => [
				['Strategy', String(s.strategy)],
				['Current user', s._rotated ? (s.strategy === 'alternating users' ? 'orders_app_b (new)' : 'orders_app (new password)') : 'orders_app'],
				['Previous credential', s._rotated ? (s._oldValid ? 'still valid (AWSPREVIOUS)' : 'revoked') : '—'],
				['Last rotated', s._rotated ? 'just now' : '412 days ago']
			],
			status: (s) => (!s._rotated ? { label: 'Rotation overdue', tone: 'warn' } : s._oldValid ? { label: 'Rotated · previous active', tone: 'info' } : { label: 'Rotated', tone: 'ok' }),
			fields: [
				{
					key: 'strategy',
					label: 'Rotation strategy',
					kind: 'select',
					options: ['single user', 'alternating users'],
					help: 'Single user changes the password of the one DB user. Alternating creates/updates a second user, so two credentials are valid at once.'
				}
			],
			actions: [
				{
					id: 'rotate',
					label: 'Rotate secret now',
					run: (s, { t }): ActionResult => {
						if (s.strategy === 'single user')
							return { set: { _rotated: true, _oldValid: false, _invalidSince: t }, log: 'RotateSecret (single user): ALTER USER orders_app PASSWORD …' };
						return { set: { _rotated: true }, log: 'RotateSecret (alternating): orders_app_b created, AWSCURRENT → orders_app_b' };
					}
				},
				{
					id: 'retire',
					label: 'Revoke previous credential',
					danger: true,
					confirm: 'Pods still using the previous credential will fail to open new connections.',
					run: (s, { t }): ActionResult => {
						if (s._rotated && s._oldValid) return { set: { _oldValid: false, _invalidSince: t }, log: 'ALTER USER orders_app NOLOGIN; AWSPREVIOUS removed' };
						return { log: 'Nothing to revoke' };
					}
				}
			]
		},
		{
			id: 'deploy',
			service: 'EKS',
			name: 'orders-api',
			type: 'Deployment',
			applySeconds: 5,
			details: (s) => [
				['Pods', `${REPLICAS} (${s._onOld} on previous credential, ${s._onNew} on current, ${s._batch} restarting)`],
				['Rollout', n(s, '_left') + n(s, '_batch') > 0 ? `in progress · ${n(s, '_left')} pods queued` : 'idle'],
				['Last restart', n(s, '_batchT') < 0 ? 'CrashLoopBackOff: FATAL: remaining connection slots / auth timeout' : 'OK'],
				['Traffic needs', `${NEEDED} healthy pods`]
			],
			status: (s, m) => (n(s, '_batchT') < 0 ? { label: 'CrashLoopBackOff', tone: 'crit' } : m.errors > 1 ? { label: 'Degraded', tone: 'crit' } : { label: 'Available', tone: 'ok' }),
			fields: [
				{
					key: 'maxUnavailable',
					label: 'Rolling update maxUnavailable',
					kind: 'number',
					min: 1,
					max: 100,
					unit: '%',
					help: 'Someone set 100% last month "to make deploys faster".'
				}
			],
			actions: [
				{
					id: 'restart',
					label: 'Rollout restart',
					run: () => ({ set: { _left: REPLICAS }, log: 'kubectl rollout restart deploy/orders-api' })
				}
			]
		},
		{
			id: 'db',
			service: 'RDS',
			name: 'orders-db',
			type: 'DB instance (PostgreSQL 16, scram-sha-256)',
			details: (s) => [
				['max_connections', '800'],
				['Connections', `${Math.round((n(s, '_onOld') + n(s, '_onNew')) * POOL)}`],
				['New connections /s', `${Math.round(opening(s))}`]
			],
			status: (s) => (dbCpu(s) > 100 ? { label: 'CPU saturated', tone: 'crit' } : { label: 'Available', tone: 'ok' })
		}
	],
	initial: {
		strategy: 'single user',
		maxUnavailable: 100,
		_rotated: false,
		_oldValid: true,
		_invalidSince: 0,
		_onOld: REPLICAS,
		_onNew: 0,
		_left: 0,
		_batch: 0,
		_batchT: 0,
		_batchNew: false,
		_errRun: 0
	},
	step: (s, { t }) => {
		const out: LabState = {};
		let left = n(s, '_left');
		let batch = n(s, '_batch');
		let bt = n(s, '_batchT');
		let onOld = n(s, '_onOld');
		let onNew = n(s, '_onNew');

		if (batch === 0 && left > 0) {
			batch = Math.min(left, Math.max(1, Math.ceil((REPLICAS * n(s, 'maxUnavailable')) / 100)));
			left -= batch;
			// Terminate the batch (oldest-credential pods first).
			const fromOld = Math.min(onOld, batch);
			onOld -= fromOld;
			onNew -= batch - fromOld;
			bt = 0;
			out._batchNew = !!s._rotated;
		}
		if (batch > 0) {
			bt++;
			// SCRAM auth is CPU-heavy: a burst of new connections saturates the DB; pods fail readiness and crash-loop.
			if (bt >= 1 && bt <= 5 && dbCpu({ ...s, _batch: batch, _batchT: bt }) > 100) bt = -10;
			if (bt >= 20) {
				const pickedNew = out._batchNew ?? s._batchNew;
				// A pod that starts on a revoked credential cannot connect at all.
				if (pickedNew) onNew += batch;
				else onOld += batch;
				batch = 0;
				bt = 0;
			}
		}
		Object.assign(out, { _left: left, _batch: batch, _batchT: bt, _onOld: onOld, _onNew: onNew });
		// Seconds spent above 2% errors, cumulative: dips between restart batches don't reset it.
		out._errRun = n(s, '_errRun') + (errorRate({ ...s, ...out }, t) > 2 ? 1 : 0);
		return out;
	},
	metrics: [
		{ id: 'errors', label: 'orders-api 5xx', unit: '%', get: (s, { t }) => errorRate(s, t), alarm: 1, max: 100 },
		{ id: 'auth', label: 'DB auth failures /s', get: (s, { t }) => n(s, '_onOld') * POOL * staleFrac(s, t) * 0.2 + (n(s, '_batchT') < 0 ? n(s, '_batch') * 4 : 0) },
		{ id: 'cpu', label: 'DB CPU', unit: '%', get: (s) => Math.min(100, dbCpu(s)), alarm: 90, max: 100 },
		{ id: 'onOld', label: 'Pods on previous credential', get: (s) => n(s, '_onOld'), max: 30 }
	],
	win: {
		text: 'Secret rotated, previous credential revoked, every pod on the new one, 5xx under 1%, held for 30 s.',
		check: (s, m) => !!s._rotated && !s._oldValid && n(s, '_onOld') === 0 && n(s, '_batch') === 0 && m.errors < 1
	},
	lose: [
		{
			text: 'orders-api spent over 60 s above 2% errors. Customers saw failed checkouts: exactly the outage the last rotation caused.',
			check: (s) => n(s, '_errRun') > 60
		}
	],
	timeLimit: 900,
	speed: 5,
	solution: [
		{ at: 5, set: { strategy: 'alternating users', maxUnavailable: 10 } },
		{ at: 20, action: { resource: 'secret', id: 'rotate' } },
		{ at: 25, action: { resource: 'deploy', id: 'restart' } },
		{ at: 300, action: { resource: 'secret', id: 'retire' } }
	],
	trap: [
		{ at: 5, action: { resource: 'secret', id: 'rotate' } },
		{ at: 10, action: { resource: 'deploy', id: 'restart' } }
	]
};

export default lab;
