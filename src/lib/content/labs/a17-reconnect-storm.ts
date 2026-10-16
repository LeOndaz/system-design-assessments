import type { Lab, LabState } from '../types';

/**
 * Reconnect storm after a gateway deploy. 400k WebSocket clients retry every second with no jitter.
 * Tempting: scale the gateways. More gateways accept more handshakes, which floods the auth service
 * harder, so goodput collapses further (metastable failure).
 * Fix: admission control at the gateway, admitting below auth capacity and rejecting the rest with a
 * jittered Retry-After, so the herd spreads out and every admitted handshake succeeds.
 */

const CLIENTS = 400_000;
const HANDSHAKES_PER_POD = 3000; // TLS handshakes/s one gateway pod can complete
const AUTH_PER_REPLICA = 1000; // token validations/s per auth replica
const SESSION_STORE_CAP = 12_000; // Redis session lookups/s: auth's hard ceiling
const RETRY_AFTER_MEAN = 10; // seconds, jittered 0–20 s when admission control rejects

const n = (s: LabState, k: string) => Number(s[k]);

const gwCap = (s: LabState) => n(s, 'gwReplicas') * HANDSHAKES_PER_POD;
const authCap = (s: LabState) => Math.min(n(s, 'authReplicas') * AUTH_PER_REPLICA, SESSION_STORE_CAP);

/** One second of reconnect traffic, computed from current pools. */
function flow(s: LabState) {
	const admission = !!s.admission;
	const returning = admission ? n(s, '_backoff') / RETRY_AFTER_MEAN : 0;
	const attempts = n(s, '_disc') + returning;
	const handled = Math.min(attempts, gwCap(s));
	const admitted = admission ? Math.min(handled, n(s, 'admitPerSec')) : handled;
	const rejected = handled - admitted;
	const q = authCap(s);
	// Past capacity, auth requests queue until they time out: goodput collapses instead of plateauing.
	const success = admitted <= q ? admitted : q * Math.max(0.1, 1 - (admitted - q) / q);
	const fail = admitted - success;
	return { returning, attempts, handled, admitted, rejected, success, fail };
}

function gwCpu(s: LabState) {
	const f = flow(s);
	const handshakeLoad = (f.admitted + 0.2 * f.rejected) / Math.max(1, gwCap(s));
	const keepalive = n(s, '_conn') / (n(s, 'gwReplicas') * 50_000);
	return Math.min(100, handshakeLoad * 100 + keepalive * 40);
}

const lab: Lab = {
	title: 'Reconnect storm after a gateway deploy',
	console: 'kubernetes',
	scope: 'prod-eu · namespace realtime',
	brief:
		'A routine [[rolling-update|rolling deploy]] of `ws-gateway` finished at T+0 and dropped every [[websocket|WebSocket]] at once: **400,000 clients** are now reconnecting. The mobile and web clients retry every **1 s with no [[jitter]]** (fixed in the next app release, which doesn\'t help today). Each reconnect needs a TLS handshake at the gateway and a token check in `auth`, which looks up the session in Redis. Users see "Reconnecting…" forever.',
	resources: [
		{
			id: 'gw',
			service: 'Workloads',
			name: 'ws-gateway',
			type: 'Deployment',
			applySeconds: 45,
			details: (s) => [
				['Ready pods', `${s.gwReplicas}/${s.gwReplicas}`],
				['TLS handshakes/s per pod', HANDSHAKES_PER_POD.toLocaleString('en')],
				['Handshake capacity', `${gwCap(s).toLocaleString('en')}/s`],
				['Open sockets', Math.round(n(s, '_conn')).toLocaleString('en')]
			],
			status: (s) => (gwCpu(s) >= 95 ? { label: 'CPU saturated', tone: 'crit' } : { label: 'Running', tone: 'ok' }),
			fields: [{ key: 'gwReplicas', label: 'Replicas', kind: 'number', min: 1, max: 80, help: 'Each pod completes ~3,000 TLS handshakes/s.' }]
		},
		{
			id: 'gwcfg',
			service: 'Config',
			name: 'ws-gateway-config',
			type: 'ConfigMap (hot-reloaded)',
			applySeconds: 15,
			details: (s) => [
				['Admission control', s.admission ? 'on' : 'off'],
				['Rejected handshakes get', s.admission ? '503 + Retry-After: random(0–20 s)' : 'n/a'],
				['Admit budget', s.admission ? `${n(s, 'admitPerSec').toLocaleString('en')}/s across the fleet` : 'unlimited']
			],
			status: (s) => (s.admission ? { label: 'Admission on', tone: 'info' } : { label: 'Admit all', tone: 'warn' }),
			fields: [
				{
					key: 'admission',
					label: 'Admission control',
					kind: 'toggle',
					help: 'Accept at most the admit budget per second; reject the rest with a jittered Retry-After, which every client version honours.'
				},
				{ key: 'admitPerSec', label: 'Admit budget', kind: 'number', min: 500, max: 100_000, step: 500, unit: 'per s' }
			]
		},
		{
			id: 'auth',
			service: 'Workloads',
			name: 'auth',
			type: 'Deployment',
			applySeconds: 45,
			details: (s) => [
				['Replicas', `${s.authReplicas}`],
				['Validations/s per replica', AUTH_PER_REPLICA.toLocaleString('en')],
				['Session store limit', `${SESSION_STORE_CAP.toLocaleString('en')} lookups/s (Redis, single shard)`],
				['Effective capacity', `${authCap(s).toLocaleString('en')}/s`]
			],
			status: (s) => (flow(s).admitted > authCap(s) ? { label: 'Timeouts', tone: 'crit' } : { label: 'Healthy', tone: 'ok' }),
			fields: [{ key: 'authReplicas', label: 'Replicas', kind: 'number', min: 1, max: 60, help: 'Capacity stops growing at the session store limit.' }]
		},
		{
			id: 'clients',
			service: 'Clients',
			name: 'app retry policy',
			type: 'Remote config (read-only)',
			details: () => [
				['Retry interval', '1 s fixed, no jitter'],
				['Honours Retry-After', 'yes (all versions)'],
				['Min app version with backoff', '5.2 (rolling out next week)']
			],
			status: () => ({ label: 'Can\'t change today', tone: 'warn' })
		}
	],
	initial: { gwReplicas: 10, authReplicas: 8, admission: false, admitPerSec: 20_000, _disc: CLIENTS, _backoff: 0, _conn: 0 },
	events: [
		{ at: 1, log: 'ws-gateway rollout complete: 10/10 pods replaced in 90 s. 400k sockets closed (code 1001).' },
		{ at: 45, log: 'Support: "App stuck on Reconnecting… for everyone in EU."' }
	],
	step: (s): LabState => {
		const f = flow(s);
		const admission = !!s.admission;
		const backToBackoff = admission ? f.rejected + f.fail : 0;
		let disc = n(s, '_disc') + f.returning - f.success - backToBackoff;
		const backoff = n(s, '_backoff') - f.returning + backToBackoff;
		let conn = n(s, '_conn') + f.success;
		// Saturated gateways miss heartbeats: established sockets start timing out too.
		if (gwCpu(s) >= 95) {
			const dropped = conn * 0.01;
			conn -= dropped;
			disc += dropped;
		}
		return { _disc: Math.max(0, disc), _backoff: Math.max(0, backoff), _conn: Math.min(CLIENTS, conn) };
	},
	metrics: [
		{ id: 'connected', label: 'Connected clients', get: (s) => n(s, '_conn'), max: CLIENTS },
		{ id: 'attempts', label: 'Reconnect attempts /s', get: (s) => flow(s).attempts },
		{ id: 'authok', label: 'Auth successes /s', get: (s) => flow(s).success },
		{
			id: 'autherr',
			label: 'Auth error rate',
			unit: '%',
			get: (s) => {
				const f = flow(s);
				return f.admitted > 0 ? (f.fail / f.admitted) * 100 : 0;
			},
			alarm: 5,
			max: 100
		},
		{ id: 'gwcpu', label: 'Gateway CPU', unit: '%', get: (s) => gwCpu(s), alarm: 90, max: 100 },
		{
			id: 'authp99',
			label: 'Auth p99',
			unit: 'ms',
			get: (s) => {
				const f = flow(s);
				const q = authCap(s);
				return f.admitted <= q ? 40 * (1 + f.admitted / q) : 5000;
			},
			thresholds: [{ value: 1000, tone: 'crit', label: 'timeout' }]
		}
	],
	win: {
		text: 'At least 95% of clients connected and auth errors under 5%, held for 30 s.',
		check: (s, m) => m.connected >= CLIENTS * 0.95 && m.autherr < 5
	},
	lose: [
		{
			text: 'Eight minutes in, under 60% of users are connected. The incident blew through the SLO window and the status page went red. Throwing capacity at a herd that retries in lockstep never converges.',
			check: (_s, m, t) => t >= 480 && m.connected < CLIENTS * 0.6
		}
	],
	timeLimit: 600,
	speed: 5,
	solution: [{ at: 10, set: { admission: true, admitPerSec: 7000 } }],
	trap: [{ at: 10, set: { gwReplicas: 40, authReplicas: 30 } }]
};

export default lab;
