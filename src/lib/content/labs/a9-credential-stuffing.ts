import type { Lab, LabState } from '../types';

/**
 * Credential stuffing against /login. The tempting move (scale login-api so real users get in)
 * hands the attacker more password checks per second and multiplies account takeovers.
 * Per-account lockout is a second trap: stuffing tries each account once.
 * Winning: challenge bots at the edge (bot control), step-up MFA for new devices, keep humans served.
 */

const HUMANS = 50; // legit login attempts /s
const BOTS = 3000; // stuffing attempts /s
const PER_TASK = 40; // bcrypt-bound logins /s per task
const HIT_RATE = 0.002; // fraction of stuffed credentials that are valid (reused passwords)

const n = (s: LabState, k: string) => Number(s[k]);

function botsPassingEdge(s: LabState) {
	let b = n(s, '_bots');
	if (s.rateRule) b *= 0.85; // 40k residential IPs: a per-IP limit barely dents it
	if (s.botControl) b *= 0.08;
	return b;
}

function humansPassingEdge(s: LabState) {
	// Bot control challenges a small share of humans (old browsers, some VPNs).
	return HUMANS * (s.botControl ? 0.98 : 1) * (s.rateRule && s._officeNat ? 0.97 : 1);
}

function servedFraction(s: LabState) {
	const demand = botsPassingEdge(s) + humansPassingEdge(s);
	return Math.min(1, (n(s, 'tasks') * PER_TASK) / Math.max(1, demand));
}

/** Account takeovers per second. Lockout does nothing: each credential pair is tried once. */
function atoRate(s: LabState) {
	const processed = botsPassingEdge(s) * servedFraction(s);
	return processed * HIT_RATE * (s.stepUpMfa ? 0.05 : 1);
}

function humanSuccess(s: LabState) {
	const lockoutPenalty = s.lockout ? 0.97 : 1; // real users who fat-finger get locked out
	return servedFraction(s) * lockoutPenalty * (s.botControl ? 0.98 : 1) * 100;
}

function latencyMs(s: LabState) {
	const demand = botsPassingEdge(s) + humansPassingEdge(s);
	const util = demand / (n(s, 'tasks') * PER_TASK);
	return util < 0.8 ? 180 : Math.min(30_000, 180 + (util - 0.8) * 2500);
}

const lab: Lab = {
	title: 'Monday 08:55: login is melting',
	console: 'cloud',
	scope: 'prod · us-east-1',
	brief:
		'Login p95 is climbing and CPU on `login-api` is pinned. Sales says customers "can\'t log in". Traffic to `/login` is up 60×, spread across ~40,000 IPs, almost all with valid-looking user agents. Each login costs a bcrypt check (~25 ms of CPU). Get real users in **and** stop the bleeding: every bot login that succeeds is an [[credential-stuffing|account takeover]].',
	resources: [
		{
			id: 'waf',
			service: 'WAF',
			name: 'edge-acl',
			type: 'Web ACL',
			applySeconds: 60,
			details: (s) => [
				['Requests /s', Math.round(n(s, '_bots') + HUMANS).toLocaleString('en')],
				['Unique source IPs (5 min)', '41,207'],
				['Top ASN share', '3.1% (residential ISPs)'],
				['Allowed after rules', Math.round(botsPassingEdge(s) + humansPassingEdge(s)).toLocaleString('en') + ' /s']
			],
			status: (s) => (s.botControl ? { label: 'Challenging bots', tone: 'ok' } : { label: 'Allow all', tone: 'warn' }),
			fields: [
				{ key: 'rateRule', label: 'Rate-based rule (100 req / 5 min per IP)', kind: 'toggle', help: 'Blocks any single IP over the limit.' },
				{ key: 'botControl', label: 'Bot control: challenge on /login', kind: 'toggle', help: 'Managed rule group. JS/browser challenge for suspected automation. $10/M requests.' }
			]
		},
		{
			id: 'api',
			service: 'ECS',
			name: 'login-api',
			type: 'Service (Fargate)',
			applySeconds: 45,
			details: (s) => [
				['Running tasks', `${s.tasks}`],
				['Capacity', `${n(s, 'tasks') * PER_TASK} logins/s`],
				['Hash', 'bcrypt cost 11 (~25 ms)']
			],
			status: (s) => (servedFraction(s) < 0.95 ? { label: 'Saturated', tone: 'crit' } : { label: 'Steady', tone: 'ok' }),
			fields: [{ key: 'tasks', label: 'Desired tasks', kind: 'number', min: 1, max: 120, help: 'Each task handles ~40 logins/s.' }]
		},
		{
			id: 'auth',
			service: 'Cognito-like auth',
			name: 'auth-policy',
			type: 'Sign-in policy',
			applySeconds: 30,
			details: (s) => [
				['Failed logins /s', Math.round(botsPassingEdge(s) * servedFraction(s) * (1 - HIT_RATE)).toLocaleString('en')],
				['Distinct usernames tried (5 min)', '412,880'],
				['Attempts per username', '1.0']
			],
			status: (s) => (atoRate(s) > 0.1 ? { label: 'Takeovers detected', tone: 'crit' } : { label: 'Normal', tone: 'ok' }),
			fields: [
				{ key: 'lockout', label: 'Lock account after 5 failed attempts', kind: 'toggle' },
				{ key: 'stepUpMfa', label: 'Step-up MFA on new device / IP', kind: 'toggle', help: 'Email or app code before a session is issued from an unrecognised device.' }
			]
		}
	],
	initial: { tasks: 10, rateRule: false, botControl: false, lockout: false, stepUpMfa: false, _bots: 0, _ato: 0, _officeNat: true },
	events: [
		{ at: 3, log: 'GuardDuty-like: anomalous volume of failed sign-ins from many IPs', set: { _bots: BOTS } },
		{ at: 40, log: 'Support: 14 customers report "password changed" emails they did not request' }
	],
	step: (s) => ({ _ato: n(s, '_ato') + atoRate(s) }),
	metrics: [
		{ id: 'p95', label: 'Login p95', unit: 'ms', get: latencyMs, alarm: 1000, max: 6000 },
		{ id: 'human', label: 'Real-user login success', unit: '%', get: humanSuccess, max: 100 },
		{ id: 'cpu', label: 'login-api CPU', unit: '%', get: (s) => Math.min(100, ((botsPassingEdge(s) + humansPassingEdge(s)) / (n(s, 'tasks') * PER_TASK)) * 100), alarm: 85, max: 100 },
		{ id: 'atoRate', label: 'Account takeovers /min', get: (s) => atoRate(s) * 60, alarm: 3 },
		{ id: 'ato', label: 'Accounts taken over (total)', get: (s) => Math.floor(n(s, '_ato')), thresholds: [{ value: 250, tone: 'crit', label: 'limit' }] }
	],
	win: {
		text: 'Real-user login success ≥ 95%, p95 under 800 ms, and fewer than 3 takeovers per minute, held for 30 s.',
		check: (_s, m) => m.human >= 95 && m.p95 < 800 && m.atoRate < 3
	},
	lose: [
		{
			text: '300 accounts were taken over. Scaling the login service made the attacker faster: every extra bcrypt check you paid for was one more password guess they got to try. Availability was never the real objective.',
			check: (s, m) => m.ato >= 300 && n(s, 'tasks') > 20
		},
		{
			text: '300 accounts were taken over. Per-IP rate limits and account lockout barely touch credential stuffing: 40,000 IPs, one attempt per username. The attack has to be stopped by telling bots from humans, and stolen passwords have to stop being enough.',
			check: (_s, m) => m.ato >= 300
		}
	],
	cost: (s) => n(s, 'tasks') * 0.1 + (s.botControl ? (BOTS * 3600 * 10) / 1e6 : 0) + 0.6,
	timeLimit: 600,
	speed: 5,
	solution: [
		{ at: 5, set: { botControl: true, stepUpMfa: true } },
		{ at: 5, set: { tasks: 12 } }
	],
	trap: [{ at: 5, set: { tasks: 80, lockout: true } }]
};

export default lab;
