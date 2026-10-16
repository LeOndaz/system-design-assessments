import type { Lab, LabState } from '../types';

/**
 * A long-lived access key for `svc-billing-sync` was pushed to a public repo. The key is also what
 * production billing uses. Traps: delete the IAM user (kills billing, destroys attribution), or
 * deactivate the key and stop there (billing dies, and if you were slow the attacker already planted
 * a second key on another user). Winning: contain without breaking prod (an IP-conditioned deny lands
 * fast), move billing off static keys, deactivate the leaked key, read CloudTrail, and kill any
 * persistence the attacker created.
 */

const EXFIL_PER_PATH = 0.2; // GB/s per working attacker credential
const ATTACK_START = 25;
const BACKDOOR_AT = 90; // attacker creates a key on deploy-bot if still able to call IAM

const n = (s: LabState, k: string) => Number(s[k]);
const t = (s: LabState, k: string) => s[k] === true;

/** Attacker still able to use the leaked key from their own IPs. */
function leakedPathOpen(s: LabState) {
	return t(s, 'leakedActive') && !t(s, '_deleted') && !t(s, '_ipDeny') && !t(s, '_scp');
}

function backdoorPathOpen(s: LabState) {
	return t(s, '_backdoor') && t(s, '_backdoorActive') && !t(s, '_scp');
}

function exfilRate(s: LabState) {
	if (n(s, '_t') < ATTACK_START) return 0;
	return (leakedPathOpen(s) ? EXFIL_PER_PATH : 0) + (backdoorPathOpen(s) ? EXFIL_PER_PATH : 0);
}

function billingHealthy(s: LabState) {
	const src = String(s.credentialSource);
	if (src.startsWith('IAM task role')) return true;
	if (t(s, '_deleted')) return false;
	if (src.startsWith('leaked key')) return t(s, 'leakedActive');
	return t(s, '_newKey') && t(s, '_newKeyActive');
}

const lab: Lab = {
	title: 'Leaked access key in a public repo',
	console: 'cloud',
	scope: 'prod account 4417-…-9020',
	brief:
		'T+0: secret scanning flags `AKIA…7Q2V` in a commit pushed to a **public** repo 6 minutes ago. The key belongs to IAM user `svc-billing-sync`, and the `billing-sync` service in production authenticates with that same key (an env var). The user can read the `customer-exports` bucket. Contain the attacker **without** taking billing down for long, keep the evidence, and make sure they leave nothing behind. See [[incident-containment]] and [[access-key]].',
	resources: [
		{
			id: 'user',
			service: 'IAM',
			name: 'svc-billing-sync',
			type: 'IAM user',
			details: (s) => [
				['Access key AKIA…7Q2V', t(s, '_deleted') ? 'deleted with user' : t(s, 'leakedActive') ? 'Active · last used from 185.220.x.x (unknown)' : 'Inactive'],
				['Access key AKIA…N3WK', t(s, '_newKey') ? (t(s, '_newKeyActive') ? 'Active · created by you' : 'Inactive') : '—'],
				['Policies', `billing-s3-read${t(s, '_ipDeny') ? ', deny-outside-corp-nat (inline)' : ''}`],
				['Created', '2021-03-02 (before the "no static keys" rule)']
			],
			status: (s) =>
				t(s, '_deleted')
					? { label: 'Deleted', tone: 'crit' }
					: leakedPathOpen(s) && n(s, '_t') >= ATTACK_START
						? { label: 'Key in use externally', tone: 'crit' }
						: { label: t(s, 'leakedActive') ? 'Key active' : 'Contained', tone: t(s, 'leakedActive') ? 'warn' : 'ok' },
			actions: [
				{
					id: 'deny-ip',
					label: 'Attach inline deny: aws:SourceIp outside corp NAT',
					run: () => ({ set: { _ipDeny: true }, delay: 10, log: 'svc-billing-sync: PutUserPolicy deny-outside-corp-nat' })
				},
				{
					id: 'create-key',
					label: 'Create new access key',
					run: (s) =>
						t(s, '_newKey')
							? { log: 'CreateAccessKey: user already has a replacement key' }
							: { set: { _newKey: true, _newKeyActive: true }, log: 'svc-billing-sync: CreateAccessKey → AKIA…N3WK (store it in the secrets manager)' }
				},
				{
					id: 'deactivate-leaked',
					label: 'Deactivate key AKIA…7Q2V',
					run: () => ({ set: { leakedActive: false }, delay: 5, log: 'svc-billing-sync: UpdateAccessKey AKIA…7Q2V → Inactive' })
				},
				{
					id: 'delete-user',
					label: 'Delete IAM user',
					danger: true,
					confirm: 'Deletes the user, its keys and policies. Anything still using the user stops working.',
					run: () => ({ set: { _deleted: true, leakedActive: false }, delay: 5, log: 'DeleteUser svc-billing-sync' })
				}
			]
		},
		{
			id: 'billing',
			service: 'ECS',
			name: 'billing-sync',
			type: 'Service (Fargate)',
			applySeconds: 60,
			details: (s) => [
				['Credential source', String(s.credentialSource)],
				['Task role', 'billing-sync-task (has billing-s3-read attached; unused)'],
				['Calls from', 'corp NAT 52.18.0.0/28']
			],
			status: (s) => (billingHealthy(s) ? { label: 'Running', tone: 'ok' } : { label: 'AccessDenied errors', tone: 'crit' }),
			fields: [
				{
					key: 'credentialSource',
					label: 'Credentials',
					kind: 'select',
					options: ['leaked key AKIA…7Q2V (env var)', 'new key AKIA…N3WK (env var)', 'IAM task role (no static key)'],
					help: 'A redeploy takes ~60 s. The task role already has the same S3 permissions.'
				}
			]
		},
		{
			id: 'deploybot',
			service: 'IAM',
			name: 'deploy-bot',
			type: 'IAM user',
			details: (s) => [
				['Access key AKIA…OLD1', 'Active · used by the old CI runner (corp NAT)'],
				['Access key AKIA…X9ZQ', t(s, '_backdoor') ? (t(s, '_backdoorActive') ? `Active · created T+${String(BACKDOOR_AT).padStart(3, '0')}s by svc-billing-sync` : 'Inactive') : '—'],
				['Policies', 'AdministratorAccess (legacy)']
			],
			status: (s) =>
				backdoorPathOpen(s) ? { label: 'Unknown key in use', tone: 'crit' } : t(s, '_backdoor') ? { label: 'Extra key (inactive)', tone: 'warn' } : { label: 'OK', tone: 'ok' },
			actions: [
				{
					id: 'deactivate-backdoor',
					label: 'Deactivate key AKIA…X9ZQ',
					run: (s) =>
						t(s, '_backdoor')
							? { set: { _backdoorActive: false }, delay: 5, log: 'deploy-bot: UpdateAccessKey AKIA…X9ZQ → Inactive' }
							: { log: 'deploy-bot has no key AKIA…X9ZQ' }
				}
			]
		},
		{
			id: 'trail',
			service: 'CloudTrail',
			name: 'Event history',
			type: 'Trail (org, all regions)',
			details: (s) =>
				t(s, '_reviewed')
					? [
							['185.220.x.x', 'GetCallerIdentity, ListBuckets, GetObject ×' + Math.round(n(s, '_exfil') * 40)],
							['Persistence', t(s, '_backdoor') ? `CreateAccessKey on deploy-bot at T+${BACKDOOR_AT}s` : 'none so far'],
							['Evidence', t(s, '_deleted') ? 'user deleted: key ↔ actor mapping gone from IAM' : 'preserved']
						]
					: [['Status', 'Run a query to see what the key did']],
			actions: [
				{
					id: 'query',
					label: 'Query events for AKIA…7Q2V',
					run: (s) => ({
						set: { _reviewed: true },
						log: `CloudTrail: ${n(s, '_t') >= ATTACK_START ? 'calls from 185.220.x.x (ListBuckets, GetObject on customer-exports)' : 'no external calls yet'}${t(s, '_backdoor') ? '; CreateAccessKey on deploy-bot!' : ''}`
					})
				}
			]
		},
		{
			id: 'org',
			service: 'Organizations',
			name: 'prod account guardrails',
			type: 'Service control policy',
			details: (s) => [
				['IP-restriction SCP', t(s, '_scp') ? 'Attached' : 'Not attached'],
				['Effect', 'Deny every API call from outside corp NAT ranges, for every principal in the account'],
				['Side effect', 'SaaS CI runners and vendor integrations calling from their own IPs are blocked too']
			],
			actions: [
				{
					id: 'attach-scp',
					label: 'Attach IP-restriction SCP',
					confirm: 'Account-wide. Anything calling AWS from outside the corp NAT breaks, including vendors.',
					run: () => ({ set: { _scp: true }, delay: 30, log: 'Organizations: AttachPolicy ip-restrict → prod' })
				}
			]
		}
	],
	initial: {
		credentialSource: 'leaked key AKIA…7Q2V (env var)',
		leakedActive: true,
		_t: 0,
		_ipDeny: false,
		_scp: false,
		_newKey: false,
		_newKeyActive: false,
		_deleted: false,
		_reviewed: false,
		_backdoor: false,
		_backdoorActive: false,
		_exfil: 0,
		_billingDown: 0
	},
	events: [
		{ at: 1, log: 'Secret scanning: AWS access key AKIA…7Q2V exposed in public repo acme/billing-tools' },
		{ at: ATTACK_START, log: 'GuardDuty: UnauthorizedAccess:IAMUser/TorIPCaller for svc-billing-sync' }
	],
	step: (s): LabState => {
		const out: LabState = { _t: n(s, '_t') + 1 };
		if (n(s, '_t') + 1 === BACKDOOR_AT && leakedPathOpen(s) && !t(s, '_backdoor')) {
			out._backdoor = true;
			out._backdoorActive = true;
		}
		out._exfil = n(s, '_exfil') + exfilRate(s);
		out._billingDown = n(s, '_billingDown') + (billingHealthy(s) ? 0 : 1);
		return out;
	},
	metrics: [
		{ id: 'rate', label: 'Data leaving customer-exports', unit: ' GB/min', get: (s) => exfilRate(s) * 60, alarm: 0 },
		{ id: 'total', label: 'Exfiltrated so far', unit: ' GB', get: (s) => n(s, '_exfil'), thresholds: [{ value: 20, tone: 'warn' }, { value: 40, tone: 'crit' }], max: 50 },
		{ id: 'billing', label: 'billing-sync errors /min', get: (s) => (billingHealthy(s) ? 0 : 120), alarm: 0 },
		{ id: 'down', label: 'Billing downtime', unit: 's', get: (s) => n(s, '_billingDown'), thresholds: [{ value: 180, tone: 'crit' }], max: 240 },
		{ id: 'keys', label: 'Static keys an attacker could hold', get: (s) => (t(s, 'leakedActive') && !t(s, '_deleted') ? 1 : 0) + (t(s, '_backdoor') && t(s, '_backdoorActive') ? 1 : 0) }
	],
	win: {
		text: 'No data leaving, billing healthy, the leaked key inactive, no attacker-created keys left active, CloudTrail reviewed, and the user kept for forensics. Hold for 60 s.',
		check: (s, m) =>
			m.rate === 0 &&
			m.billing === 0 &&
			!t(s, 'leakedActive') &&
			!backdoorPathOpen(s) &&
			!(t(s, '_backdoor') && t(s, '_backdoorActive')) &&
			t(s, '_reviewed') &&
			!t(s, '_deleted'),
		hold: 60
	},
	lose: [
		{
			text: 'You deleted the IAM user. Billing broke immediately, and the user↔key mapping you need to attribute CloudTrail activity is gone. Deactivate keys; delete identities only after the investigation.',
			check: (s) => t(s, '_deleted')
		},
		{ text: 'Over 40 GB of customer exports left the account. This is now a notifiable breach of significant scale.', check: (_s, m) => m.total > 40 },
		{ text: 'Billing was down for over 3 minutes cumulatively: invoices failed and finance escalated.', check: (_s, m) => m.down > 180 }
	],
	timeLimit: 600,
	speed: 5,
	solution: [
		{ at: 3, action: { resource: 'user', id: 'deny-ip' } },
		{ at: 4, set: { credentialSource: 'IAM task role (no static key)' } },
		{ at: 6, action: { resource: 'trail', id: 'query' } },
		{ at: 70, action: { resource: 'user', id: 'deactivate-leaked' } }
	],
	trap: [{ at: 5, action: { resource: 'user', id: 'delete-user' } }]
};

export default lab;
