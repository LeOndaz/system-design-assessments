import { describe, expect, it } from 'vitest';
import lab from '$lib/content/labs/flash-sale-backlog';
import { createSim, replay, tick } from './engine';

describe('lab engine', () => {
	it('reference lab: solution wins, idle and trap do not', () => {
		expect(replay(lab, lab.solution).kind).toBe('won');
		expect(replay(lab, []).kind).not.toBe('won');
		expect(replay(lab, lab.trap!).kind).not.toBe('won');
	});

	it('applies field changes only after the rollout delay', () => {
		const sim = createSim(lab);
		replay; // eslint quiet
		sim.pending.push({ at: 5, set: { workers: 50 }, log: 'x' });
		for (let i = 0; i < 4; i++) tick(sim);
		expect(sim.state.workers).toBe(10);
		tick(sim);
		expect(sim.state.workers).toBe(50);
	});

	it('is deterministic', () => {
		expect(JSON.stringify(replay(lab, lab.solution))).toBe(JSON.stringify(replay(lab, lab.solution)));
	});
});
