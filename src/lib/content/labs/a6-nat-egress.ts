import type { Lab, LabState } from '../types';

/**
 * NAT egress bill. A data pipeline pulls ~1.8 TB/h from S3 through one NAT gateway in AZ-a.
 * Tempting: buy a Savings Plan (compute isn't the problem). Fix: S3 gateway endpoint on ALL private route tables.
 */

const S3_GBH = 1800; // GB/h pulled from S3, evenly across 3 AZs
const OTHER_GBH = 90; // GB/h to the internet (APIs, package mirrors)
const COMPUTE = 30; // $/h
const NAT_GB = 0.045;
const NAT_HOUR = 0.045;
const XAZ_GB = 0.02; // $0.01 each direction
const BUDGET = 60;

const n = (s: LabState, k: string) => Number(s[k]);
const coverage = (s: LabState) => (s.s3Endpoint === 'all private route tables' ? 1 : s.s3Endpoint === 'rtb-private-a only' ? 1 / 3 : 0);

/** S3 GB/h still flowing through NAT, split by whether it crosses AZs to reach the NAT in az-a. */
function s3ViaNat(s: LabState) {
	const perAz = S3_GBH / 3;
	if (s._routeRemoved) return { total: 0, crossAz: 0 };
	if (s.s3Endpoint === 'all private route tables') return { total: 0, crossAz: 0 };
	if (s.s3Endpoint === 'rtb-private-a only') return { total: perAz * 2, crossAz: s.natPerAz ? 0 : perAz * 2 };
	return { total: S3_GBH, crossAz: s.natPerAz ? 0 : perAz * 2 };
}

function breakdown(s: LabState) {
	const s3 = s3ViaNat(s);
	const other = s._routeRemoved ? 0 : OTHER_GBH;
	const otherCross = s.natPerAz || s._routeRemoved ? 0 : (OTHER_GBH * 2) / 3;
	const compute = COMPUTE * (s._savingsPlan ? 0.66 : 1);
	const natBytes = (s3.total + other) * NAT_GB;
	const natHours = (s.natPerAz ? 3 : 1) * NAT_HOUR;
	const xaz = (s3.crossAz + otherCross) * XAZ_GB;
	return { compute, natBytes, natHours, xaz, total: compute + natBytes + natHours + xaz, natGb: s3.total + other };
}

/** Pipeline throughput (GB/h): S3 must be reachable (NAT route or endpoint); 10% of jobs also need internet. */
function throughput(s: LabState) {
	if (!s._routeRemoved) return S3_GBH;
	return S3_GBH * coverage(s) * 0.9;
}

const usd = (v: number) => `$${v.toFixed(2)}/h`;

const lab: Lab = {
	title: 'The NAT gateway bill',
	console: 'cloud',
	scope: 'data-platform · eu-central-1',
	brief:
		"FinOps paged you: the data platform account is burning **~$140/h** against a **$60/h** budget since the new ingestion pipeline went live. Nothing is broken, but the forecast alarm escalates to the VP in 8 minutes. Get spend under budget **without** slowing the pipeline. Compute is a fixed fleet; don't touch it.",
	resources: [
		{
			id: 'billing',
			service: 'Billing',
			name: 'Cost Explorer (live)',
			type: 'Cost breakdown by usage type',
			details: (s) => {
				const b = breakdown(s);
				return [
					['EC2: BoxUsage', usd(b.compute)],
					['NatGateway-Bytes', usd(b.natBytes)],
					['NatGateway-Hours', usd(b.natHours)],
					['DataTransfer-Regional-Bytes', usd(b.xaz)],
					['Total', usd(b.total)]
				];
			},
			status: (s) => (breakdown(s).total > BUDGET ? { label: 'Over budget', tone: 'crit' } : { label: 'Within budget', tone: 'ok' }),
			actions: [
				{
					id: 'savings',
					label: 'Purchase 1-yr Compute Savings Plan',
					confirm: 'Commits $15/h for 12 months. Discounts EC2 compute by ~34%.',
					run: () => ({ set: { _savingsPlan: true }, log: 'Billing: purchased Compute Savings Plan ($15/h commitment)', delay: 5 })
				}
			]
		},
		{
			id: 'vpc',
			service: 'VPC',
			name: 'vpc-data (10.20.0.0/16)',
			type: 'VPC',
			applySeconds: 45,
			details: (s) => [
				['rtb-private-a (az-a)', `0.0.0.0/0 → ${s._routeRemoved ? 'none' : 'nat-0a1 (az-a)'}${coverage(s) > 0 ? ' · pl-s3 → vpce-s3' : ''}`],
				['rtb-private-b (az-b)', `0.0.0.0/0 → ${s._routeRemoved ? 'none' : s.natPerAz ? 'nat-0b2 (az-b)' : 'nat-0a1 (az-a)'}${coverage(s) === 1 ? ' · pl-s3 → vpce-s3' : ''}`],
				['rtb-private-c (az-c)', `0.0.0.0/0 → ${s._routeRemoved ? 'none' : s.natPerAz ? 'nat-0c3 (az-c)' : 'nat-0a1 (az-a)'}${coverage(s) === 1 ? ' · pl-s3 → vpce-s3' : ''}`],
				['Gateway endpoints', coverage(s) > 0 ? 'vpce-s3 (com.amazonaws.eu-central-1.s3)' : 'none']
			],
			fields: [
				{
					key: 's3Endpoint',
					label: 'S3 gateway endpoint associated with',
					kind: 'select',
					options: ['none', 'rtb-private-a only', 'all private route tables'],
					help: 'Gateway endpoints are free. They add a prefix-list route to each associated route table.'
				}
			]
		},
		{
			id: 'nat',
			service: 'VPC',
			name: 'NAT gateways',
			type: 'NAT gateway',
			applySeconds: 90,
			details: (s) => [
				['Gateways', s.natPerAz ? 'nat-0a1 (az-a), nat-0b2 (az-b), nat-0c3 (az-c)' : 'nat-0a1 (az-a)'],
				['Bytes processed', `${Math.round(breakdown(s).natGb)} GB/h`],
				['Top destinations', s._routeRemoved ? '—' : coverage(s) === 1 ? 'api.vendor.io, pypi mirrors' : 's3.eu-central-1.amazonaws.com (95%)']
			],
			status: (s) => (s._routeRemoved ? { label: 'No routes', tone: 'crit' } : { label: 'Available', tone: 'ok' }),
			fields: [{ key: 'natPerAz', label: 'One NAT gateway per AZ', kind: 'toggle', help: 'Keeps egress AZ-local. Each gateway costs $0.045/h plus $0.045/GB.' }],
			actions: [
				{
					id: 'remove-route',
					label: 'Remove 0.0.0.0/0 → NAT routes',
					danger: true,
					confirm: 'Private subnets lose internet access. Anything not covered by an endpoint stops working.',
					run: () => ({ set: { _routeRemoved: true }, log: 'VPC: deleted default routes from rtb-private-a/b/c', delay: 5 })
				}
			]
		},
		{
			id: 'pipeline',
			service: 'ECS',
			name: 'ingest-pipeline',
			type: 'Service (18 tasks across 3 AZs)',
			details: (s) => [
				['Throughput', `${Math.round(throughput(s))} GB/h`],
				['Tasks', '6 per AZ'],
				['Reads from', 's3://raw-events-eu (same region)']
			],
			status: (s) => (throughput(s) < S3_GBH * 0.95 ? { label: 'Degraded', tone: 'crit' } : { label: 'Running', tone: 'ok' })
		}
	],
	initial: { s3Endpoint: 'none', natPerAz: false, _savingsPlan: false, _routeRemoved: false, _over: 0, _slow: 0 },
	events: [{ at: 1, log: 'Budgets: forecast $3,360/day vs $1,440 budget (data-platform)' }],
	step: (s) => ({
		_over: breakdown(s).total > BUDGET ? n(s, '_over') + 1 : 0,
		_slow: throughput(s) < S3_GBH * 0.5 ? n(s, '_slow') + 1 : 0
	}),
	metrics: [
		{ id: 'spend', label: 'Spend rate', unit: ' $/h', get: (s) => breakdown(s).total, alarm: BUDGET },
		{ id: 'nat', label: 'NAT bytes processed', unit: ' GB/h', get: (s) => breakdown(s).natGb },
		{ id: 'xaz', label: 'Cross-AZ transfer', unit: ' $/h', get: (s) => breakdown(s).xaz },
		{ id: 'tput', label: 'Pipeline throughput', unit: ' GB/h', get: (s) => throughput(s), thresholds: [{ value: 1710, tone: 'ok' }] }
	],
	win: {
		text: 'Spend under $60/h with the pipeline at ≥95% throughput, held for 60 s.',
		check: (_s, m) => m.spend < BUDGET && m.tput >= S3_GBH * 0.95,
		hold: 60
	},
	lose: [
		{ text: 'The forecast alarm escalated to the VP with spend still over budget.', check: (s) => n(s, '_over') > 480 },
		{ text: 'The pipeline stalled for a minute and the hourly ingestion SLA was missed.', check: (s) => n(s, '_slow') > 60 }
	],
	cost: (s) => breakdown(s).total,
	timeLimit: 720,
	speed: 5,
	solution: [{ at: 20, set: { s3Endpoint: 'all private route tables' } }],
	trap: [
		{ at: 20, action: { resource: 'billing', id: 'savings' } },
		{ at: 25, set: { natPerAz: true } }
	]
};

export default lab;
