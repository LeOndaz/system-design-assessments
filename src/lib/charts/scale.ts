/** Small, dependency-free chart math. */

export interface Scale {
	(v: number): number;
	ticks: number[];
	domain: [number, number];
}

/** "Nice" tick step for a range, e.g. 0–5300 → 1000. */
export function niceStep(range: number, target = 4): number {
	if (range <= 0 || !Number.isFinite(range)) return 1;
	const raw = range / target;
	const mag = 10 ** Math.floor(Math.log10(raw));
	const norm = raw / mag;
	const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
	return step * mag;
}

export function linearScale(min: number, max: number, outMin: number, outMax: number, target = 4): Scale {
	if (max === min) max = min + 1;
	const step = niceStep(max - min, target);
	const lo = Math.floor(min / step) * step;
	const hi = Math.ceil(max / step) * step;
	const f = ((v: number) => outMin + ((v - lo) / (hi - lo)) * (outMax - outMin)) as Scale;
	f.ticks = [];
	for (let t = lo; t <= hi + step / 2; t += step) f.ticks.push(Number(t.toPrecision(12)));
	f.domain = [lo, hi];
	return f;
}

export function logScale(min: number, max: number, outMin: number, outMax: number): Scale {
	const lo = 10 ** Math.floor(Math.log10(Math.max(min, 1e-9)));
	const hi = 10 ** Math.ceil(Math.log10(Math.max(max, lo * 10)));
	const f = ((v: number) =>
		outMin + ((Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (outMax - outMin)) as Scale;
	f.ticks = [];
	for (let t = lo; t <= hi * 1.0001; t *= 10) f.ticks.push(t);
	f.domain = [lo, hi];
	return f;
}

/** Compact number: 1234 → "1.2k", 0.0042 → "0.0042". */
export function fmt(v: number | null | undefined, unit = ''): string {
	if (v == null || Number.isNaN(v)) return '–';
	const a = Math.abs(v);
	let s: string;
	if (a >= 1e9) s = trim(v / 1e9) + 'B';
	else if (a >= 1e6) s = trim(v / 1e6) + 'M';
	else if (a >= 1e4) s = trim(v / 1e3) + 'k';
	else if (a >= 100 || Number.isInteger(v)) s = String(Math.round(v));
	else if (a >= 1) s = trim(v, 2);
	else s = String(Number(v.toPrecision(2)));
	return s + unit;
}

function trim(v: number, digits = 1): string {
	return String(Number(v.toFixed(digits)));
}

/** Indices of ~`count` evenly spaced x labels to show. */
export function tickIndices(n: number, count = 6): number[] {
	if (n <= count) return Array.from({ length: n }, (_, i) => i);
	const step = Math.ceil((n - 1) / (count - 1));
	const out: number[] = [];
	for (let i = 0; i < n; i += step) out.push(i);
	return out;
}

/** Build an SVG path from points, breaking at nulls. */
export function linePath(xs: number[], ys: (number | null)[]): string {
	let d = '';
	let pen = false;
	ys.forEach((y, i) => {
		if (y == null) {
			pen = false;
			return;
		}
		d += `${pen ? 'L' : 'M'}${xs[i].toFixed(1)},${y.toFixed(1)}`;
		pen = true;
	});
	return d;
}

/** Closed area path from a top line down to a baseline (or lower line), breaking at nulls. */
export function areaPath(xs: number[], top: (number | null)[], bottom: number[] | number): string {
	const segs: number[][] = [];
	let cur: number[] = [];
	top.forEach((y, i) => {
		if (y == null) {
			if (cur.length) segs.push(cur);
			cur = [];
		} else cur.push(i);
	});
	if (cur.length) segs.push(cur);
	const base = (i: number) => (typeof bottom === 'number' ? bottom : bottom[i]);
	return segs
		.map((seg) => {
			const up = seg.map((i, k) => `${k ? 'L' : 'M'}${xs[i].toFixed(1)},${(top[i] as number).toFixed(1)}`).join('');
			const down = [...seg].reverse().map((i) => `L${xs[i].toFixed(1)},${base(i).toFixed(1)}`).join('');
			return up + down + 'Z';
		})
		.join('');
}
