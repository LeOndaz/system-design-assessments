/** Shared helpers for Assessment 19 terminal scenarios. */
import type { ScenarioCommand, TermResult } from '../types';

/** "HH:MM:SS" for a second offset from a start hour. */
export function clock(startHour: number, sec: number): string {
	const t = startHour * 3600 + Math.floor(sec);
	const h = Math.floor(t / 3600) % 24;
	const m = Math.floor((t % 3600) / 60);
	const s = t % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Human size like du -h / df -h. */
export function human(bytes: number): string {
	const u = ['B', 'K', 'M', 'G', 'T'];
	let v = bytes;
	let i = 0;
	while (v >= 1024 && i < u.length - 1) {
		v /= 1024;
		i++;
	}
	return i === 0 ? `${bytes}` : `${v < 10 ? v.toFixed(1) : Math.round(v)}${u[i]}`;
}

/**
 * A `du` that reports fake on-disk sizes (the sandbox stores tiny files).
 * `sizes` maps absolute file paths to bytes; directory totals are summed by prefix.
 * Supports -s, -h, -d N / --max-depth=N, -a (ignored), -c, multiple paths.
 */
export function fakeDu(sizes: Record<string, number>): ScenarioCommand {
	return (args, ctx) => {
		let summarize = false;
		let hum = false;
		let total = false;
		let depth = Infinity;
		const paths: string[] = [];
		for (let i = 0; i < args.length; i++) {
			const a = args[i];
			if (a.startsWith('--max-depth=')) depth = Number(a.split('=')[1]);
			else if (a === '-d' || a === '--max-depth') depth = Number(args[++i]);
			else if (a.startsWith('-') && a.length > 1) {
				if (a.includes('s')) summarize = true;
				if (a.includes('h')) hum = true;
				if (a.includes('c')) total = true;
				const m = /d(\d+)/.exec(a);
				if (m) depth = Number(m[1]);
			} else paths.push(a);
		}
		if (!paths.length) paths.push('.');
		const size = (abs: string) =>
			Object.entries(sizes)
				.filter(([p]) => p === abs || p.startsWith(abs === '/' ? '/' : abs + '/'))
				.reduce((n, [, b]) => n + b, 0);
		const fmt = (b: number) => (hum ? human(b) : String(Math.ceil(b / 1024)));
		const out: string[] = [];
		let err = '';
		let grand = 0;
		for (const p of paths) {
			const abs = ctx.fs.resolve(p);
			if (!ctx.fs.exists(abs)) {
				err += `du: cannot access '${p}': No such file or directory\n`;
				continue;
			}
			const s = size(abs);
			grand += s;
			if (summarize || !ctx.fs.isDir(abs)) {
				out.push(`${fmt(s)}\t${p}`);
				continue;
			}
			// directories under abs up to depth, deepest first like real du
			const dirs = new Set<string>([abs]);
			for (const f of Object.keys(sizes)) {
				if (!f.startsWith(abs === '/' ? '/' : abs + '/')) continue;
				const rel = f.slice(abs.length).split('/').filter(Boolean);
				for (let d = 1; d < rel.length && d <= depth; d++) dirs.add(abs + (abs === '/' ? '' : '/') + rel.slice(0, d).join('/').replace(/^\//, ''));
			}
			const sorted = [...dirs].sort((a, b) => b.split('/').length - a.split('/').length || a.localeCompare(b));
			for (const d of sorted) out.push(`${fmt(size(d))}\t${p.replace(/\/$/, '') + d.slice(abs.length)}`);
		}
		if (total) out.push(`${fmt(grand)}\ttotal`);
		return { out: out.join('\n') + (out.length ? '\n' : ''), err, code: err ? 1 : 0 };
	};
}

/**
 * Strip namespace flags so kubectl routes can match on the rest.
 * Returns [namespace, normalized argument string].
 */
export function kubeArgs(args: string[]): [string, string] {
	let ns = 'default';
	const rest: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === '-n' || a === '--namespace') ns = args[++i] ?? ns;
		else if (a.startsWith('--namespace=')) ns = a.split('=')[1];
		else if (a.startsWith('-n') && a.length > 2 && !a.startsWith('--')) ns = a.slice(2);
		else if (a === '-A' || a === '--all-namespaces') ns = '*';
		else rest.push(a);
	}
	return [ns, rest.join(' ')];
}

export const err = (msg: string, code = 1): TermResult => ({ err: msg.endsWith('\n') ? msg : msg + '\n', code });
