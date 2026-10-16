import type { Lab, LabState } from '../types';

/**
 * Spot reclaim takes out three zone-a nodes. The search StatefulSet's pods are pinned to zone a by their
 * EBS-backed PVCs, and zone-a spot capacity for that single instance type is gone. Adding nodes in zone b
 * (where capacity exists) is the obvious move and does nothing. Fix the zone-a node group's capacity source.
 */

const n = (s: LabState, k: string) => Number(s[k]);
const SPOT_SINGLE = 'spot · m6i.4xlarge only';
const SPOT_DIVERSE = 'spot · m6i / m6a / m7i / r6i.4xlarge';
const ON_DEMAND = 'on-demand · m6i.4xlarge';

/** One search pod per node (each requests 14 of 16 vCPU). */
const readyA = (s: LabState) => Math.min(6, n(s, 'aNodes'));
const readyB = (s: LabState) => Math.min(2, n(s, 'bNodes'));
const pending = (s: LabState) => 10 - readyA(s) - readyB(s) - 2;
const zoneACapacity = (s: LabState) => s.aCapacity !== SPOT_SINGLE;
const price = (cap: string) => (cap === ON_DEMAND ? 0.77 : 0.27);

const lab: Lab = {
	title: 'search-prod: pods stuck Pending after spot reclaim',
	console: 'kubernetes',
	scope: 'prod-eu cluster · eu-west-1',
	brief:
		'`search` is a 10-pod StatefulSet (Elasticsearch-style, one shard copy per pod, one pod per node). Each pod owns an EBS-backed [[persistent-volume-claim|PVC]]. At T+3 the spot pool reclaims nodes. Customers see search errors while pods are Pending. The [[cluster-autoscaler]] is running.',
	resources: [
		{
			id: 'sts',
			service: 'Workloads',
			name: 'search',
			type: 'StatefulSet',
			details: (s) => [
				['Replicas', `${10 - pending(s)}/10 ready`],
				['Pending', pending(s) ? `search-0, search-3, search-6`.split(', ').slice(0, pending(s)).join(', ') : 'none'],
				['PVC zones', 'search-{0,3,6,1,4,7}: eu-west-1a · {2,5}: 1b · {8,9}: 1c'],
				[
					'Pod events',
					pending(s)
						? '0/13 nodes are available: 4 node(s) had volume node affinity conflict, 9 Insufficient cpu. preemption: not helpful'
						: 'Scheduled'
				]
			],
			status: (s) => (pending(s) ? { label: `${pending(s)} Pending`, tone: 'crit' } : { label: 'Ready', tone: 'ok' }),
			actions: [
				{
					id: 'delete-pvcs',
					label: 'Delete PVCs of Pending pods',
					danger: true,
					confirm: 'The StatefulSet will recreate empty volumes wherever the pods can schedule. Existing data on those volumes is destroyed.',
					run: () => ({ set: { _dataLoss: true }, log: 'kubectl delete pvc data-search-0 data-search-3 data-search-6' })
				}
			]
		},
		{
			id: 'nga',
			service: 'Node groups',
			name: 'ng-search-1a',
			type: 'Managed node group · eu-west-1a',
			applySeconds: 30,
			details: (s) => [
				['Nodes', `${s.aNodes} / max 6`],
				['Capacity', String(s.aCapacity)],
				['Autoscaler', pending(s) && !zoneACapacity(s) ? 'Scale-up failed: InsufficientInstanceCapacity (spot, m6i.4xlarge, eu-west-1a). Retrying with backoff.' : n(s, '_aBoot') > 0 ? `Launching ${6 - n(s, 'aNodes')} node(s) · ${s._aBoot}s` : 'Idle']
			],
			status: (s) =>
				n(s, '_aBoot') > 0
					? { label: 'Scaling', tone: 'info' }
					: pending(s) && !zoneACapacity(s)
						? { label: 'Scale-up failing', tone: 'crit' }
						: { label: 'Active', tone: 'ok' },
			fields: [
				{
					key: 'aCapacity',
					label: 'Capacity / instance types',
					kind: 'select',
					options: [SPOT_SINGLE, SPOT_DIVERSE, ON_DEMAND],
					help: 'Changes the launch template; new nodes only.'
				}
			]
		},
		{
			id: 'ngb',
			service: 'Node groups',
			name: 'ng-search-1b',
			type: 'Managed node group · eu-west-1b',
			applySeconds: 90,
			details: (s) => [
				['Nodes', `${s.bNodes}`],
				['Capacity', SPOT_SINGLE],
				['Spare search slots', `${Math.max(0, n(s, 'bNodes') - 2)}`]
			],
			status: (s) => (n(s, 'bNodes') > 2 ? { label: `${n(s, 'bNodes') - 2} idle node(s)`, tone: 'warn' } : { label: 'Active', tone: 'ok' }),
			fields: [{ key: 'bNodes', label: 'Desired size', kind: 'number', min: 2, max: 12, unit: 'nodes' }]
		}
	],
	initial: { aCapacity: SPOT_SINGLE, aNodes: 6, bNodes: 2, _aBoot: 0, _dataLoss: false },
	events: [
		{ at: 3, log: 'Spot interruption: 3 nodes in eu-west-1a reclaimed (2-minute notice elapsed)', set: { aNodes: 3 } },
		{ at: 20, log: 'Alert: search error rate > 5% (shards unassigned)' }
	],
	step: (s) => {
		const out: LabState = {};
		const boot = n(s, '_aBoot');
		if (boot > 0) {
			out._aBoot = boot - 1;
			if (boot === 1) out.aNodes = 6;
		} else if (n(s, 'aNodes') < 6 && zoneACapacity(s)) {
			out._aBoot = 90; // node launch + kubelet ready
		}
		return out;
	},
	metrics: [
		{ id: 'pending', label: 'Pods Pending', get: (s) => pending(s), alarm: 0, max: 6 },
		{ id: 'errors', label: 'Search error rate', unit: '%', get: (s) => pending(s) * 3.2, alarm: 5, max: 25 },
		{ id: 'p99', label: 'Search p99', unit: ' ms', get: (s) => 140 + pending(s) * 260, max: 1500 },
		{ id: 'nodes', label: 'Cluster nodes', get: (s) => n(s, 'aNodes') + n(s, 'bNodes') + 2 + 3 }
	],
	win: { text: 'All 10 search pods Running with their data, held for 30 s.', check: (s) => pending(s) === 0 && !s._dataLoss },
	lose: [
		{
			text: 'You deleted the volumes of three shard copies. Their other copies were on the reclaimed nodes\' volumes, also unattached, so two shards now exist nowhere: a full reindex from source takes ~14 h.',
			check: (s) => !!s._dataLoss
		}
	],
	cost: (s) => n(s, 'aNodes') * price(String(s.aCapacity)) + (n(s, 'bNodes') + 2) * 0.27 + 3 * 0.19,
	timeLimit: 600,
	speed: 5,
	solution: [{ at: 15, set: { aCapacity: SPOT_DIVERSE } }],
	trap: [{ at: 15, set: { bNodes: 6 } }]
};

export default lab;
