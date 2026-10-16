import type { Lab, LabState } from '../types';

/**
 * Reference lab. Flash sale floods the order queue; the obvious move (scale workers) hits the
 * database connection ceiling. Winning needs a connection pooler first, then scale-out within DB capacity.
 */

const PER_WORKER = 20; // msgs/s per healthy worker
const POOL_PER_WORKER = 25; // DB connections each worker opens without a pooler
const DB_CAPACITY: Record<string, number> = { 'db.r6g.large': 1500, 'db.r6g.xlarge': 3000 };
const DB_PRICE: Record<string, number> = { 'db.r6g.large': 0.48, 'db.r6g.xlarge': 0.96 };

const n = (s: LabState, k: string) => Number(s[k]);

/** Workers that actually hold a DB connection. */
function connectedWorkers(s: LabState) {
	const workers = n(s, 'workers');
	if (s.proxy) return workers; // proxy multiplexes: connection count no longer scales with workers
	return Math.min(workers, Math.floor(n(s, 'maxConnections') / POOL_PER_WORKER));
}

function throughput(s: LabState) {
	const cap = DB_CAPACITY[String(s.dbClass)];
	// A DB pushed past ~90% CPU degrades: lock waits and context switching eat into throughput.
	const demand = connectedWorkers(s) * PER_WORKER;
	return demand <= cap * 0.9 ? demand : cap * 0.9 - (demand - cap * 0.9) * 0.15;
}

function connections(s: LabState) {
	return s.proxy ? Math.min(200, n(s, 'workers') * 2) : Math.min(n(s, 'workers') * POOL_PER_WORKER, n(s, 'maxConnections'));
}

const lab: Lab = {
	title: 'Flash sale: order queue backlog',
	console: 'cloud',
	scope: 'prod · eu-west-1',
	brief:
		'Marketing launched a flash sale at T+0 without warning. Orders arrive at ~1,200/s into the `orders` queue; workers normally see ~200/s. Customers get confirmation emails only after a worker processes their order. Keep the [[queue-age|age of the oldest message]] from blowing past 30 minutes, then drain it.',
	resources: [
		{
			id: 'asg',
			service: 'EC2',
			name: 'order-workers',
			type: 'Auto Scaling group',
			applySeconds: 30,
			details: (s) => [
				['Instance type', 'c7g.large'],
				['Running', `${s.workers}`],
				['Connected to DB', `${connectedWorkers(s)}`],
				['Pool size per worker', s.proxy ? 'via proxy' : `${POOL_PER_WORKER}`]
			],
			status: (s) =>
				connectedWorkers(s) < n(s, 'workers') ? { label: `${n(s, 'workers') - connectedWorkers(s)} failing`, tone: 'crit' } : { label: 'InService', tone: 'ok' },
			fields: [{ key: 'workers', label: 'Desired capacity', kind: 'number', min: 1, max: 200, unit: 'instances', help: 'Each worker processes ~20 orders/s.' }]
		},
		{
			id: 'queue',
			service: 'SQS',
			name: 'orders',
			type: 'Standard queue',
			details: (s) => [
				['Messages available', Math.round(n(s, '_backlog')).toLocaleString('en')],
				['Visibility timeout', '60 s'],
				['DLQ', 'orders-dlq (maxReceive 5)']
			],
			status: (s) => (n(s, '_backlog') > 50_000 ? { label: 'Backlogged', tone: 'crit' } : { label: 'Healthy', tone: 'ok' }),
			actions: [
				{
					id: 'purge',
					label: 'Purge queue',
					danger: true,
					confirm: 'Deletes every message in the queue. Purged orders are gone for good.',
					run: () => ({ set: { _backlog: 0, _purged: true }, log: 'orders: PurgeQueue' })
				}
			]
		},
		{
			id: 'db',
			service: 'RDS',
			name: 'orders-db',
			type: 'DB instance (PostgreSQL)',
			applySeconds: 120,
			details: (s) => [
				['Class', String(s.dbClass)],
				['max_connections', `${s.maxConnections}`],
				['Connections in use', `${Math.round(connections(s))}`],
				['Multi-AZ', 'yes']
			],
			status: (s) => (connections(s) >= n(s, 'maxConnections') ? { label: 'Connection limit', tone: 'crit' } : { label: 'Available', tone: 'ok' }),
			fields: [
				{
					key: 'dbClass',
					label: 'Instance class',
					kind: 'select',
					options: ['db.r6g.large', 'db.r6g.xlarge'],
					help: 'Changing class triggers a failover (~2 min of reduced throughput).'
				},
				{ key: 'maxConnections', label: 'max_connections', kind: 'number', min: 100, max: 5000, step: 50, help: 'Each Postgres backend costs ~10 MB RAM plus CPU for context switching.' }
			]
		},
		{
			id: 'proxy',
			service: 'RDS',
			name: 'orders-db-proxy',
			type: 'RDS Proxy',
			applySeconds: 60,
			details: (s) => [
				['Status', s.proxy ? 'Available' : 'Not attached'],
				['Mode', 'transaction pooling'],
				['Target', 'orders-db']
			],
			status: (s) => (s.proxy ? { label: 'Attached', tone: 'ok' } : { label: 'Detached', tone: 'info' }),
			fields: [{ key: 'proxy', label: 'Route workers through proxy', kind: 'toggle', help: 'Workers share a small pool of DB connections instead of 25 each.' }]
		}
	],
	initial: { workers: 10, maxConnections: 500, dbClass: 'db.r6g.large', proxy: false, _backlog: 0, _arrivals: 1200, _purged: false, _failover: 0, _lastClass: 'db.r6g.large' },
	events: [
		{ at: 2, log: 'CloudWatch: NumberOfMessagesSent up 6× in 60 s (orders)' },
		{ at: 420, log: 'Flash sale ended: arrivals back to ~300/s', set: { _arrivals: 300 } }
	],
	step: (s, { rand }): LabState => {
		// A class change is a failover: ~2 min at reduced throughput.
		if (s.dbClass !== s._lastClass) return { _lastClass: s.dbClass, _failover: 120 };
		const out = throughput(s) * (n(s, '_failover') > 0 ? 0.3 : 1);
		const arrivals = n(s, '_arrivals') * (0.95 + rand() * 0.1);
		return {
			_backlog: Math.max(0, n(s, '_backlog') + arrivals - out),
			_failover: Math.max(0, n(s, '_failover') - 1)
		};
	},
	metrics: [
		{
			id: 'age',
			label: 'Oldest message age',
			unit: 's',
			get: (s) => n(s, '_backlog') / Math.max(1, throughput(s)),
			alarm: 300,
			max: 2000
		},
		{ id: 'backlog', label: 'Messages visible', get: (s) => n(s, '_backlog') },
		{ id: 'tput', label: 'Orders processed /s', get: (s) => Math.max(0, throughput(s)) },
		{
			id: 'conns',
			label: 'DB connections',
			get: (s) => connections(s),
			thresholds: [{ value: 500, tone: 'crit', label: 'max' }]
		},
		{
			id: 'cpu',
			label: 'DB CPU',
			unit: '%',
			get: (s) => Math.min(100, (Math.max(0, throughput(s)) / DB_CAPACITY[String(s.dbClass)]) * 100 + (s.proxy ? 0 : connections(s) / 25)),
			alarm: 90,
			max: 100
		},
		{
			id: 'errors',
			label: 'Worker errors /s',
			get: (s) => (n(s, 'workers') - connectedWorkers(s)) * 3,
			alarm: 0
		}
	],
	win: {
		text: 'Backlog under 5,000 and oldest message under 60 s, held for 30 s, without purging orders.',
		check: (s, m) => m.backlog < 5000 && m.age < 60 && !s._purged
	},
	lose: [
		{ text: 'Orders waited over 30 minutes; the payment holds expired and customers were charged for orders never confirmed.', check: (_s, m) => m.age > 1800 },
		{ text: 'You purged the queue: tens of thousands of paid orders vanished. Purge is never an incident fix for business data.', check: (s) => !!s._purged }
	],
	cost: (s) => n(s, 'workers') * 0.072 + DB_PRICE[String(s.dbClass)] + (s.proxy ? 0.36 : 0),
	timeLimit: 900,
	speed: 5,
	solution: [
		{ at: 10, set: { proxy: true } },
		{ at: 75, set: { workers: 70 } }
	],
	trap: [{ at: 10, set: { workers: 80 } }]
};

export default lab;
