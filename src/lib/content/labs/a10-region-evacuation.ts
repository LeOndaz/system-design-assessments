import type { Lab, LabState } from '../types';

/**
 * Two levers, order matters: raise capacity in the healthy region, THEN shift traffic.
 * Shifting first overloads the healthy region, which falls over (cascading failure) and the lab is lost.
 */

const TOTAL_RPS = 10_000;
const RPS_PER_INSTANCE = 250;

const n = (s: LabState, k: string) => Number(s[k]);

/** Share of traffic each region receives right now (DNS caching makes the shift lag behind the setting). */
const shareB = (s: LabState) => n(s, '_effB') / 100;

function loadA(s: LabState) {
	return TOTAL_RPS * (1 - shareB(s));
}
function loadB(s: LabState) {
	return TOTAL_RPS * shareB(s);
}
function capB(s: LabState) {
	return n(s, '_runningB') * RPS_PER_INSTANCE;
}
/** Region A is degraded: a bad AZ makes ~35% of its requests fail regardless of load. */
function errorsA(s: LabState) {
	return loadA(s) * 0.35;
}
function errorsB(s: LabState) {
	const load = loadB(s);
	const cap = capB(s);
	if (s._meltdown) return load;
	if (load <= cap * 0.85) return load * 0.002;
	// Past ~85% utilization, queueing pushes requests past client timeouts.
	return Math.min(load, (load - cap * 0.85) * 1.6 + load * 0.002);
}
function errorRate(s: LabState) {
	return ((errorsA(s) + errorsB(s)) / TOTAL_RPS) * 100;
}

const lab: Lab = {
	title: 'Evacuate a degraded region',
	console: 'cloud',
	scope: 'global · eu-west-1 → eu-central-1',
	brief:
		'An [[availability-zone]] problem in **eu-west-1** is failing ~35% of requests there, and the provider gives no ETA. The plan is to move traffic to **eu-central-1**, which normally runs a small warm standby. You control the standby\'s Auto Scaling group and the weighted DNS records. Traffic is ~10,000 req/s.',
	resources: [
		{
			id: 'asgB',
			service: 'EC2 · eu-central-1',
			name: 'api-central',
			type: 'Auto Scaling group',
			applySeconds: 5,
			details: (s) => [
				['Desired', `${s.desiredB}`],
				['InService', `${Math.round(n(s, '_runningB'))}`],
				['Capacity', `${(capB(s) / 1000).toFixed(1)}k req/s`],
				['Current load', `${(loadB(s) / 1000).toFixed(1)}k req/s`],
				['Instance warm-up', '~90 s (AMI boot + JIT + health checks)']
			],
			status: (s) =>
				s._meltdown
					? { label: 'Unhealthy: all targets failing', tone: 'crit' }
					: loadB(s) > capB(s) * 0.85
						? { label: 'Overloaded', tone: 'crit' }
						: n(s, '_runningB') < n(s, 'desiredB')
							? { label: 'Scaling out', tone: 'info' }
							: { label: 'Healthy', tone: 'ok' },
			fields: [
				{ key: 'desiredB', label: 'Desired capacity', kind: 'number', min: 2, max: 80, unit: 'instances', help: 'Each instance serves ~250 req/s comfortably. New instances need ~90 s before they take traffic.' }
			]
		},
		{
			id: 'asgA',
			service: 'EC2 · eu-west-1',
			name: 'api-west',
			type: 'Auto Scaling group',
			details: (s) => [
				['InService', '44'],
				['Current load', `${(loadA(s) / 1000).toFixed(1)}k req/s`],
				['Failing AZ', 'eu-west-1b (elevated network errors)']
			],
			status: () => ({ label: 'Degraded', tone: 'warn' }),
			actions: [
				{
					id: 'restart',
					label: 'Instance refresh (replace all)',
					danger: true,
					confirm: 'Replaces every instance in the group. New instances still land in eu-west-1b about a third of the time.',
					run: () => ({ set: { _refreshing: 120 }, log: 'api-west: StartInstanceRefresh (MinHealthy 50%)' })
				}
			]
		},
		{
			id: 'dns',
			service: 'Route 53',
			name: 'api.example.com',
			type: 'Weighted record set',
			applySeconds: 0,
			details: (s) => [
				['Weight eu-west-1', `${100 - n(s, 'weightB')}`],
				['Weight eu-central-1', `${s.weightB}`],
				['TTL', '60 s'],
				['Clients following new weight', `${Math.round(n(s, '_effB'))}% to central`]
			],
			status: () => ({ label: 'Serving', tone: 'ok' }),
			fields: [
				{ key: 'weightB', label: 'Weight to eu-central-1', kind: 'number', min: 0, max: 100, step: 5, unit: '%', help: 'Takes effect as client DNS caches expire: most clients follow within ~60 s.' }
			]
		}
	],
	initial: { desiredB: 6, weightB: 0, _runningB: 6, _effB: 0, _meltdown: false, _overload: 0, _refreshing: 0, _ready: 0 },
	events: [{ at: 1, log: 'Health: eu-west-1b elevated connection errors (no ETA)' }],
	step: (s) => {
		const out: LabState = {};
		// Instances come up linearly over a ~90 s warm-up once desired is raised.
		const running = n(s, '_runningB');
		const desired = n(s, 'desiredB');
		if (running < desired) out._runningB = Math.min(desired, running + desired / 90 + 0.05);
		else if (running > desired) out._runningB = desired;
		// DNS: effective share drifts toward the configured weight as caches expire (~60 s).
		const eff = n(s, '_effB');
		const target = n(s, 'weightB');
		if (eff !== target) out._effB = Math.abs(target - eff) < 1 ? target : eff + (target - eff) / 20;
		// Sustained overload on B tips it into meltdown: retries + health-check failures pull all targets.
		const over = loadB(s) > capB(s) * 1.05 && !s._meltdown;
		out._overload = over ? n(s, '_overload') + 1 : Math.max(0, n(s, '_overload') - 1);
		if (n(s, '_overload') >= 20) out._meltdown = true;
		out._refreshing = Math.max(0, n(s, '_refreshing') - 1);
		return out;
	},
	metrics: [
		{ id: 'err', label: 'Global error rate', unit: '%', get: (s) => errorRate(s), alarm: 5, max: 100 },
		{ id: 'loadB', label: 'eu-central-1 load', unit: ' rps', get: (s) => loadB(s) },
		{ id: 'capB', label: 'eu-central-1 capacity', unit: ' rps', get: (s) => capB(s) },
		{ id: 'utilB', label: 'eu-central-1 utilization', unit: '%', get: (s) => (capB(s) ? (loadB(s) / capB(s)) * 100 : 0), alarm: 85, max: 200 },
		{ id: 'share', label: 'Traffic on central', unit: '%', get: (s) => n(s, '_effB'), max: 100 }
	],
	win: {
		text: 'Global error rate under 1%, held for 30 s.',
		check: (_s, m) => m.err < 1
	},
	lose: [
		{
			text: 'eu-central-1 took more traffic than it could serve for 20 s. Health checks failed, the load balancer pulled every target, and both regions are now down: a [[cascading-failure]] you triggered by moving traffic before capacity.',
			check: (s) => !!s._meltdown
		}
	],
	cost: (s) => (44 + n(s, '_runningB')) * 0.17,
	timeLimit: 600,
	speed: 5,
	solution: [
		{ at: 5, set: { desiredB: 50 } },
		{ at: 110, set: { weightB: 100 } }
	],
	trap: [
		{ at: 5, set: { weightB: 100 } },
		{ at: 6, set: { desiredB: 50 } }
	]
};

export default lab;
