import type { Lab, LabState } from '../types';

/**
 * Cluster upgrade: the drain hangs because payments-api's PDB allows zero disruptions (minAvailable == replicas).
 * Deleting the PDB or lowering it evicts pods the service needs to carry traffic. Surge capacity first,
 * then let the drain evict one pod at a time.
 */

const n = (s: LabState, k: string) => Number(s[k]);
const RPS = 520;
const PER_POD = 300;

const ready = (s: LabState) => n(s, '_old') + n(s, '_new');
const disruptionsAllowed = (s: LabState) => (s.pdb ? Math.max(0, ready(s) - n(s, 'minAvailable')) : 99);
const errorRate = (s: LabState) => Math.max(0, ((RPS - ready(s) * PER_POD) / RPS) * 100);
const oldNodes = (s: LabState) => n(s, '_old') + (n(s, '_otherDrained') ? 0 : 1);

const lab: Lab = {
	title: 'Node upgrade 1.28 → 1.29: drain stuck',
	console: 'kubernetes',
	scope: 'prod-eu cluster · maintenance window 10 min',
	brief:
		'The managed upgrade is draining the three 1.28 nodes. Two of them run `payments-api` (2 replicas, ~520 req/s, each pod handles ~300 req/s). The drain has been retrying evictions for a while. The window closes at T+10:00; after that the provider force-drains, ignoring [[pod-disruption-budget|PDBs]].',
	resources: [
		{
			id: 'deploy',
			service: 'Workloads',
			name: 'payments-api',
			type: 'Deployment',
			applySeconds: 5,
			details: (s) => [
				['Ready', `${ready(s)} (${s._old} on 1.28 nodes, ${s._new} on 1.29)`],
				['Starting', `${s._boot ? `${s._booting} pod(s), ready in ${s._boot}s` : 'none'}`],
				['Readiness', 'warms JIT + connection pools: ~45 s'],
				['Capacity', `${ready(s) * PER_POD} req/s for ${RPS} req/s of traffic`]
			],
			status: (s) => (errorRate(s) > 0 ? { label: 'Degraded', tone: 'crit' } : { label: 'Available', tone: 'ok' }),
			fields: [{ key: 'replicas', label: 'Replicas', kind: 'number', min: 1, max: 6 }]
		},
		{
			id: 'pdb',
			service: 'Policy',
			name: 'payments-api-pdb',
			type: 'PodDisruptionBudget',
			applySeconds: 5,
			details: (s) => [
				['Selector', 'app=payments-api'],
				['Current healthy', `${ready(s)}`],
				['Disruptions allowed', s.pdb ? `${disruptionsAllowed(s)}` : 'n/a (deleted)']
			],
			status: (s) => (!s.pdb ? { label: 'Deleted', tone: 'warn' } : disruptionsAllowed(s) === 0 ? { label: '0 disruptions allowed', tone: 'crit' } : { label: 'OK', tone: 'ok' }),
			fields: [{ key: 'minAvailable', label: 'minAvailable', kind: 'number', min: 0, max: 6 }],
			actions: [
				{
					id: 'delete',
					label: 'Delete PDB',
					danger: true,
					confirm: 'Without a PDB the drain evicts every matching pod immediately.',
					run: () => ({ set: { pdb: false }, log: 'kubectl delete pdb payments-api-pdb' })
				}
			]
		},
		{
			id: 'upgrade',
			service: 'Cluster',
			name: 'ng-general (1.28 → 1.29)',
			type: 'Node group upgrade',
			details: (s) => [
				['1.28 nodes remaining', `${oldNodes(s)} / 3`],
				[
					'Drain',
					n(s, '_old') === 0
						? 'complete'
						: disruptionsAllowed(s) === 0
							? 'Cannot evict pod as it would violate the pod\'s disruption budget. Retrying in 5s'
							: 'evicting'
				],
				['1.29 nodes', '3 Ready (room for 6 payments pods)']
			],
			status: (s) => (oldNodes(s) === 0 ? { label: 'Upgraded', tone: 'ok' } : disruptionsAllowed(s) === 0 ? { label: 'Drain blocked', tone: 'warn' } : { label: 'Draining', tone: 'info' })
		}
	],
	initial: { replicas: 2, minAvailable: 2, pdb: true, _old: 2, _new: 0, _booting: 0, _boot: 0, _otherDrained: 0, _errRun: 0 },
	events: [{ at: 20, log: 'Node ip-10-0-3-17 drained (no protected pods)', set: { _otherDrained: 1 } }],
	step: (s, { t }) => {
		const out: LabState = {};
		let old = n(s, '_old');
		let fresh = n(s, '_new');
		let booting = n(s, '_booting');
		let boot = n(s, '_boot');

		// Booting pods become ready together.
		if (boot > 0) {
			boot--;
			if (boot === 0) {
				fresh += booting;
				booting = 0;
			}
		}
		// Deployment controller reconciles towards `replicas`.
		const want = n(s, 'replicas');
		const have = old + fresh + booting;
		if (have < want) {
			booting += want - have;
			boot = 45;
		} else if (have > want) {
			let extra = have - want;
			const cut = Math.min(extra, booting);
			booting -= cut;
			extra -= cut;
			fresh -= Math.min(extra, fresh);
		}
		// The drain retries an eviction every 5 s.
		const st = { ...s, _old: old, _new: fresh };
		if (t % 5 === 0 && old > 0 && disruptionsAllowed(st) >= 1) {
			const evict = s.pdb ? 1 : old;
			old -= evict;
			booting += evict; // ReplicaSet replaces evicted pods on 1.29 nodes
			boot = 45;
		}
		out._old = old;
		out._new = fresh;
		out._booting = booting;
		out._boot = boot;
		out._errRun = errorRate({ ...s, ...out }) > 5 ? n(s, '_errRun') + 1 : 0;
		return out;
	},
	metrics: [
		{ id: 'errors', label: 'payments 5xx', unit: '%', get: (s) => errorRate(s), alarm: 1, max: 100 },
		{ id: 'ready', label: 'payments pods ready', get: (s) => ready(s), max: 6 },
		{ id: 'old', label: '1.28 nodes left', get: (s) => oldNodes(s), max: 3 },
		{ id: 'allowed', label: 'Disruptions allowed', get: (s) => (s.pdb ? disruptionsAllowed(s) : 0), max: 4 }
	],
	win: {
		text: 'All 1.28 nodes drained with payments 5xx at 0%, held for 30 s.',
		check: (s) => oldNodes(s) === 0 && errorRate(s) === 0
	},
	lose: [
		{
			text: 'payments-api ran below the capacity it needs for over 20 s: checkout failed for thousands of customers during the "zero-downtime" upgrade.',
			check: (s) => n(s, '_errRun') > 20
		},
		{
			text: 'The window closed. The provider force-drained the nodes, ignoring the PDB, and evicted both payments pods at once.',
			check: (_s, _m, t) => t >= 600
		}
	],
	cost: (s) => (n(s, '_old') + n(s, '_new') + n(s, '_booting')) * 0.12 + 6 * 0.38,
	timeLimit: 610,
	speed: 5,
	solution: [{ at: 25, set: { replicas: 3 } }],
	trap: [{ at: 25, action: { resource: 'pdb', id: 'delete' } }]
};

export default lab;
