/**
 * Deterministic helpers for building realistic-looking chart data in content files.
 * Everything is seeded, so charts look identical on every build.
 *
 *   const x = timeAxis('13:00', 60, 1);              // 60 one-minute labels
 *   const p95 = shape(60, { base: 180, noise: 0.08, seed: 3 }, step(30, 6000), ramp(30, 40, 0, 400));
 */

/** Mulberry32 PRNG. */
export function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** "HH:MM" labels starting at `start`, `count` of them, `stepMin` minutes apart. */
export function timeAxis(start: string, count: number, stepMin = 1): string[] {
	const [h, m] = start.split(':').map(Number);
	const startMin = h * 60 + m;
	return Array.from({ length: count }, (_, i) => {
		const t = (startMin + i * stepMin) % (24 * 60);
		return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
	});
}

/** Day labels, e.g. dayAxis('Sep 01', 42) → "Sep 01", "Sep 02", … (uses a fixed non-leap year). */
export function dayAxis(start: string, count: number, stepDays = 1): string[] {
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const [mon, day] = start.split(' ');
	const d = new Date(Date.UTC(2026, months.indexOf(mon), Number(day)));
	return Array.from({ length: count }, (_, i) => {
		const x = new Date(d.getTime() + i * stepDays * 86_400_000);
		return `${months[x.getUTCMonth()]} ${String(x.getUTCDate()).padStart(2, '0')}`;
	});
}

/** A modifier receives index i and current value v and returns a new value. */
export type Mod = (i: number, v: number) => number;

/**
 * Build a series of length n: start at `base`, apply modifiers in order, then multiply by
 * (1 ± noise) using the seed. Values are rounded to `round` decimals (default 0).
 */
export function shape(
	n: number,
	opts: { base: number; noise?: number; seed?: number; round?: number; min?: number },
	...mods: Mod[]
): number[] {
	const r = rng(opts.seed ?? 1);
	const noise = opts.noise ?? 0.05;
	const p = 10 ** (opts.round ?? 0);
	return Array.from({ length: n }, (_, i) => {
		let v = opts.base;
		for (const mod of mods) v = mod(i, v);
		v *= 1 + (r() * 2 - 1) * noise;
		v = Math.max(opts.min ?? 0, v);
		return Math.round(v * p) / p;
	});
}

/** From index `at` onward, the value becomes `to`. */
export const step = (at: number, to: number): Mod => (i, v) => (i >= at ? to : v);

/** From index `at` onward, multiply by `factor`. */
export const scaleFrom = (at: number, factor: number): Mod => (i, v) => (i >= at ? v * factor : v);

/** Linear ramp from value `from` at index `a` to value `to` at index `b` (holds `to` after b). */
export const ramp = (a: number, b: number, from: number, to: number): Mod => (i, v) => {
	if (i < a) return v;
	if (i >= b) return to;
	return from + ((to - from) * (i - a)) / (b - a);
};

/** Add `amount` on [a, b). */
export const bump = (a: number, b: number, amount: number): Mod => (i, v) => (i >= a && i < b ? v + amount : v);

/** Set value to `to` on [a, b). */
export const window_ = (a: number, b: number, to: number): Mod => (i, v) => (i >= a && i < b ? to : v);

/** Spike of `height` added every `period` points, lasting `width` points, starting at `offset`. */
export const periodic = (period: number, width: number, height: number, offset = 0): Mod => (i, v) =>
	(i - offset) % period >= 0 && (i - offset) % period < width && i >= offset ? v + height : v;

/** Sawtooth: grows by `perStep` each point and resets to base every `period` points. */
export const sawtooth = (period: number, perStep: number, offset = 0): Mod => (i, v) =>
	v + (((i - offset) % period) + period) % period * perStep;

/** Gentle sine wave (daily traffic shape), `amp` as a fraction of v. */
export const wave = (period: number, amp: number, phase = 0): Mod => (i, v) =>
	v * (1 + amp * Math.sin(((i + phase) / period) * 2 * Math.PI));

/** Cumulative sum: turns per-step increments into a running total. */
export function cumulative(xs: number[]): number[] {
	let s = 0;
	return xs.map((x) => (s += x));
}

/** Replace [a, b) with nulls (gap / no data). */
export function gap<T>(xs: T[], a: number, b: number): (T | null)[] {
	return xs.map((x, i) => (i >= a && i < b ? null : x));
}
