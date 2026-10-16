import type { TerminalScenario } from '../types';
import { rng } from '../series';
import { oneOf } from '$lib/terminal/scenario';

/**
 * Structured request logs as a JSON array. /api/reports has by far the worst *average* (bimodal
 * 0.9 s / 1.8 s batch endpoint, expected), but /api/checkout has the worst p99: ~2% of calls hit a
 * ~4 s fraud-check timeout. The SLO is on p99, so averages point at the wrong route.
 */

type Req = { ts: string; route: string; status: number; ms: number; region: string };

function gen(): Req[] {
	const r = rng(1909);
	const out: Req[] = [];
	for (let i = 0; i < 2400; i++) {
		const sec = i * 1.5;
		const ts = `2026-10-14T09:${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}Z`;
		const x = r();
		const region = r() < 0.7 ? 'eu-west-1' : 'us-east-1';
		let route: string;
		let ms: number;
		let status = 200;
		if (x < 0.35) {
			route = '/api/orders';
			ms = 35 + Math.floor(r() * 60);
		} else if (x < 0.65) {
			route = '/api/search';
			ms = r() < 0.97 ? 50 + Math.floor(r() * 120) : 200 + Math.floor(r() * 140);
		} else if (x < 0.9) {
			route = '/api/checkout';
			if (r() < 0.025) {
				ms = 3950 + Math.floor(r() * 300);
				status = r() < 0.5 ? 200 : 504;
			} else ms = 90 + Math.floor(r() * 110);
		} else {
			route = '/api/reports';
			ms = r() < 0.5 ? 850 + Math.floor(r() * 150) : 1700 + Math.floor(r() * 250);
		}
		out.push({ ts, route, status, ms, region });
	}
	return out;
}

const REQS = gen();

const scenario: TerminalScenario = {
	title: 'ssh ops@log-box',
	user: 'ops',
	host: 'log-box',
	cwd: '/home/ops',
	motd: 'Exported request logs for 09:00-10:00 UTC are in /var/log/api/requests.json (a single JSON array).',
	task: 'SLO alert: **"API p99 latency above 2 s."** The dashboard only shows the average per route. Using the exported logs, find the route with the **highest p99 latency** and `submit` it.',
	files: {
		'/var/log/api/requests.json': '[\n' + REQS.map((q) => JSON.stringify(q)).join(',\n') + '\n]\n',
		'/var/log/api/README': 'Fields: ts (UTC), route, status, ms (server time), region.\nNote: jq here has no --slurp; the file is already one array, so start filters with .[] or use it as-is.\n',
		'/home/ops/dash-export.csv': 'route,avg_ms\n/api/orders,63\n/api/search,115\n/api/checkout,233\n/api/reports,1379\n'
	},
	answer: {
		prompt: 'route',
		check: (a) => (a.trim().replace(/\/$/, '') === '/api/checkout' ? true : a.includes('reports') ? 'That is the worst average. Compare p99s.' : 'Compute the 99th percentile per route.'),
		success: '/api/checkout: ~2.5% of requests hit a ~4 s fraud-check timeout, so p99 ≈ 4 s while its average still looks healthy.'
	},
	hints: ["jq '.[0]' /var/log/api/requests.json", "jq -r '.[] | .route' /var/log/api/requests.json | sort | uniq -c", "jq -r '.[] | select(.route==\"/api/checkout\") | .ms' /var/log/api/requests.json | sort -n | tail -30"],
	solution: [
		"jq '.[0]' /var/log/api/requests.json",
		"jq -c 'group_by(.route) | map({route: .[0].route, n: length, avg: ((map(.ms) | add) / length | floor), p99: (map(.ms) | sort | .[(length * 0.99 | floor)])})' /var/log/api/requests.json",
		'submit /api/checkout'
	]
};

/** Exported for the assessment answer table (computed, not hand-typed). */
export const P99 = (() => {
	const by = new Map<string, number[]>();
	for (const q of REQS) by.set(q.route, [...(by.get(q.route) ?? []), q.ms]);
	return [...by].map(([route, ms]) => {
		const s = [...ms].sort((a, b) => a - b);
		return { route, n: s.length, avg: Math.floor(s.reduce((a, b) => a + b, 0) / s.length), p99: s[Math.floor(s.length * 0.99)] };
	});
})();

export default scenario;
