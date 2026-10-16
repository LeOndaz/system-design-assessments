/**
 * Helpers for writing terminal scenarios.
 *
 *   commands: {
 *     kubectl: routes([
 *       [/^get pods( -n prod)?$/, PODS_TABLE],
 *       [/^describe pod (\S+)/, (m) => describe(m[1])],
 *       [/^logs (\S+)( --previous)?/, (m, ctx) => ...],
 *     ], 'error: unknown command'),
 *   }
 */
import type { ScenarioCommand, TermCtx, TermResult } from '$lib/content/types';

type Handler = string | ((m: RegExpMatchArray, ctx: TermCtx) => string | TermResult);

/**
 * Route a command's argument string (args joined by single spaces, flags normalised) through regexes.
 * First match wins. `fallback` is printed to stderr (exit 1) when nothing matches.
 */
export function routes(table: [RegExp, Handler][], fallback = 'unsupported in this sandbox; try `help` or the hint chips'): ScenarioCommand {
	return (args, ctx) => {
		const line = args.join(' ').replace(/\s+/g, ' ').trim();
		for (const [re, h] of table) {
			const m = line.match(re);
			if (m) return typeof h === 'string' ? h : h(m, ctx);
		}
		return { err: fallback.endsWith('\n') ? fallback : fallback + '\n', code: 1 };
	};
}

/** Fixed outputs keyed by the exact argument string. */
export function fixed(map: Record<string, string>, fallback?: string): ScenarioCommand {
	return routes(
		Object.entries(map).map(([k, v]) => [new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), v] as [RegExp, Handler]),
		fallback
	);
}

/** Render rows as a left-aligned table like kubectl / psql -x off output. */
export function table(head: string[], rows: (string | number)[][], gap = 3): string {
	const all = [head, ...rows.map((r) => r.map(String))];
	const w = head.map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)));
	return all.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i] + gap))).join('')).join('\n') + '\n';
}

/** psql-style table with header rule and row count. */
export function pgTable(head: string[], rows: (string | number)[][]): string {
	const all = [head, ...rows.map((r) => r.map(String))];
	const w = head.map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)));
	const line = (r: string[]) => ' ' + r.map((c, i) => c.padEnd(w[i])).join(' | ');
	return [line(head), w.map((x) => '-'.repeat(x + 2)).join('+'), ...rows.map((r) => line(r.map(String))), `(${rows.length} row${rows.length === 1 ? '' : 's'})`].join('\n') + '\n';
}

/** Case/space-insensitive answer matcher accepting several spellings. */
export function oneOf(...accepted: string[]) {
	const norm = (s: string) => s.toLowerCase().replace(/[\s'"`]+/g, '');
	return (answer: string): true | string => (accepted.map(norm).includes(norm(answer)) ? true : 'Look again at the evidence.');
}

/** Generate N log lines from a template function (deterministic). */
export function genLines(n: number, f: (i: number) => string): string {
	return Array.from({ length: n }, (_, i) => f(i)).join('\n') + '\n';
}
