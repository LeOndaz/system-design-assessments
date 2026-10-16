import type { Lab, LabState } from '../types';

/**
 * "No space left on device" with the disk 38% full. The filesystem ran out of inodes: a bot creates
 * one session file per request. Tempting: grow the EBS volume (the filesystem isn't resized, and even
 * if it were the bot refills it) or delete old logs (frees bytes, not inodes).
 * Fix: clear the session files AND stop the creation (rate-limit the bot or move sessions to Redis).
 */

const INODES = 4_000_000;
const BASE_FILES = 120_000;
const BOT_RATE = 12_000; // new session files per second fleet-wide while the bot runs
const HUMAN_RATE = 400;
const n = (s: LabState, k: string) => Number(s[k]);

function createRate(s: LabState) {
	if (s.sessionStore === 'redis') return 0;
	return HUMAN_RATE + (s.waf ? BOT_RATE * 0.05 : BOT_RATE);
}
const inodePct = (s: LabState) => Math.min(100, ((BASE_FILES + n(s, '_files')) / INODES) * 100);
const errRate = (s: LabState) => (s.sessionStore !== 'redis' && inodePct(s) >= 99.9 ? 100 : n(s, '_restart') > 0 ? 30 : 0.2);

const lab: Lab = {
	title: 'Disk full at 38%',
	console: 'cloud',
	scope: 'payments-callbacks · us-east-2',
	brief:
		'The payment provider\'s webhook calls into `callbacks` started failing at 03:10. Logs say `OSError: [Errno 28] No space left on device` when writing a session file. The disk graph says **38% used**. The provider disables webhooks after ~4 minutes of continuous failures.',
	resources: [
		{
			id: 'fleet',
			service: 'EC2',
			name: 'callbacks-fleet (6 × m7g.large)',
			type: 'Instances',
			details: (s) => [
				['df -h /var/lib/app', `38% used (62 GB free of ${s._volumeGrown ? '200 GB volume, 100 GB filesystem' : '100 GB'})`],
				['df -i /var/lib/app', `${inodePct(s).toFixed(1)}% inodes used`],
				['Largest dirs by file count', `/var/lib/app/sessions: ${(Math.round(n(s, '_files') / 1000) * 1000).toLocaleString('en')} files`],
				['/var/log/*.gz', s._logsDeleted ? 'deleted' : '41 GB'],
				['New files/s', `${Math.round(createRate(s)).toLocaleString('en')}`]
			],
			status: (s) => (inodePct(s) >= 99.9 ? { label: 'ENOSPC', tone: 'crit' } : inodePct(s) > 85 ? { label: 'Inodes high', tone: 'warn' } : { label: 'OK', tone: 'ok' }),
			actions: [
				{
					id: 'grow',
					label: 'Modify EBS volumes → 200 GB',
					run: () => ({ set: { _volumeGrown: true }, log: 'EC2: ModifyVolume 100 → 200 GiB (state: optimizing)', delay: 30 })
				},
				{
					id: 'logs',
					label: 'Delete /var/log/*.gz',
					run: () => ({ set: { _logsDeleted: true }, log: 'SSM RunCommand: rm /var/log/*.gz (freed 41 GB)', delay: 10 })
				},
				{
					id: 'clean',
					label: 'Delete session files older than 10 min',
					confirm: 'Logged-in users with sessions older than 10 min will have to sign in again.',
					run: () => ({ set: { _cleaning: 120 }, log: 'SSM RunCommand: find /var/lib/app/sessions -mmin +10 -delete', delay: 5 })
				},
				{
					id: 'restart',
					label: 'Restart app on all instances',
					danger: true,
					confirm: 'In-flight callbacks fail during restart.',
					run: () => ({ set: { _restart: 30 }, log: 'SSM RunCommand: systemctl restart callbacks' })
				}
			]
		},
		{
			id: 'app',
			service: 'EC2',
			name: 'callbacks config',
			type: 'Parameter Store',
			applySeconds: 60,
			details: (s) => [
				['SESSION_BACKEND', s.sessionStore === 'redis' ? 'redis://sessions.cache' : 'file:/var/lib/app/sessions'],
				['Sessions created for', 'every request without a cookie (incl. webhooks and bots)']
			],
			fields: [
				{ key: 'sessionStore', label: 'Session backend', kind: 'select', options: ['local files', 'redis'], help: 'Rolling config reload, ~60 s.' }
			]
		},
		{
			id: 'waf',
			service: 'WAF',
			name: 'edge-acl',
			type: 'Web ACL',
			applySeconds: 30,
			details: (s) => [
				['Top client (5 min)', 'UA "SEOCrawler/2.1", 41 IPs, 11.8k req/s to /callbacks/status'],
				['Rate-based rule', s.waf ? 'active: 100 req/5 min per IP on /callbacks/*' : 'none']
			],
			status: (s) => (s.waf ? { label: 'Blocking', tone: 'ok' } : { label: 'Count only', tone: 'info' }),
			fields: [{ key: 'waf', label: 'Rate-limit /callbacks/* per IP', kind: 'toggle' }]
		}
	],
	initial: { sessionStore: 'local files', waf: false, _files: INODES - BASE_FILES, _cleaning: 0, _volumeGrown: false, _logsDeleted: false, _restart: 0, _bad: 0 },
	events: [{ at: 1, log: 'Provider: webhook delivery failures 100% (callbacks.example.com)' }],
	step: (s) => {
		let files = n(s, '_files');
		let cleaning = n(s, '_cleaning');
		if (cleaning > 0) {
			// find -delete works through ~30k files/s across the fleet; only files older than 10 min go.
			files = Math.max(files * 0.15, files - 30_000);
			cleaning -= 1;
		}
		files = Math.min(INODES - BASE_FILES, files + createRate(s));
		const out: LabState = { _files: files, _cleaning: cleaning, _restart: Math.max(0, n(s, '_restart') - 1) };
		out._bad = errRate({ ...s, ...out }) > 50 ? n(s, '_bad') + 1 : 0;
		return out;
	},
	metrics: [
		{ id: 'err', label: 'Webhook 5xx', unit: '%', get: errRate, alarm: 1, max: 100 },
		{ id: 'inodes', label: 'Inodes used', unit: '%', get: inodePct, alarm: 90, max: 100 },
		{ id: 'disk', label: 'Disk bytes used', unit: '%', get: (s) => (s._logsDeleted ? 21 : 38), max: 100 },
		{ id: 'rate', label: 'New files /s', get: createRate }
	],
	win: {
		text: 'Webhook errors under 1% and inodes under 80%, held for 4 minutes.',
		check: (_s, m) => m.err < 1 && m.inodes < 80,
		hold: 240
	},
	lose: [{ text: 'The provider disabled the webhook after 4 minutes of failures. Payments are now reconciled by hand.', check: (s) => n(s, '_bad') > 240 }],
	timeLimit: 900,
	speed: 5,
	solution: [
		{ at: 15, set: { waf: true } },
		{ at: 20, action: { resource: 'fleet', id: 'clean' } }
	],
	trap: [
		{ at: 15, action: { resource: 'fleet', id: 'grow' } },
		{ at: 20, action: { resource: 'fleet', id: 'logs' } }
	]
};

export default lab;
