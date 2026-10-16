import { describe, expect, it } from 'vitest';
import { schedule } from './srs.svelte';

describe('SM-2', () => {
	const now = 0;
	it('grows intervals 1 → 6 → ~15 days on "good"', () => {
		let c = schedule(undefined, 4, now);
		expect(c.interval).toBe(1);
		c = schedule(c, 4, now);
		expect(c.interval).toBe(6);
		c = schedule(c, 4, now);
		expect(c.interval).toBe(15);
	});
	it('"again" resets reps, lowers ease, returns in 10 minutes', () => {
		const c = schedule(schedule(schedule(undefined, 4, now), 4, now), 0, now);
		expect(c.reps).toBe(0);
		expect(c.ease).toBeCloseTo(2.3);
		expect(c.due).toBe(600_000);
	});
	it('ease never drops below 1.3', () => {
		let c = schedule(undefined, 0, now);
		for (let i = 0; i < 20; i++) c = schedule(c, 0, now);
		expect(c.ease).toBe(1.3);
	});
});
