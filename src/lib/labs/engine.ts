/**
 * Deterministic lab simulator. Shared by the console UI and the content validator,
 * so every lab's reference solution is proven to win (and its trap proven not to).
 */
import { rng } from '$lib/content/series';
import type { Lab, LabCtx, LabState } from '$lib/content/types';

export interface Pending {
	/** Sim time at which the change lands. */
	at: number;
	set: LabState;
	log: string;
}

export interface LogEntry {
	t: number;
	text: string;
	tone: 'info' | 'warn' | 'crit' | 'ok' | 'user';
}

export type Outcome = { kind: 'running' } | { kind: 'won'; t: number } | { kind: 'lost'; t: number; reason: string } | { kind: 'timeout' };

export interface Sim {
	lab: Lab;
	t: number;
	state: LabState;
	metrics: Record<string, number>;
	history: Record<string, number[]>;
	pending: Pending[];
	log: LogEntry[];
	winStreak: number;
	cost: number;
	actions: number;
	outcome: Outcome;
	alarmsOn: Set<string>;
	rand: () => number;
}

const HISTORY = 120;

export function createSim(lab: Lab, seed = 7): Sim {
	const sim: Sim = {
		lab,
		t: 0,
		state: { ...lab.initial },
		metrics: {},
		history: Object.fromEntries(lab.metrics.map((m) => [m.id, []])),
		pending: [],
		log: [],
		winStreak: 0,
		cost: 0,
		actions: 0,
		outcome: { kind: 'running' },
		alarmsOn: new Set(),
		rand: rng(seed)
	};
	measure(sim);
	return sim;
}

function ctx(sim: Sim): LabCtx {
	return { t: sim.t, rand: sim.rand };
}

function measure(sim: Sim) {
	for (const m of sim.lab.metrics) {
		const v = m.get(sim.state, ctx(sim));
		sim.metrics[m.id] = Number.isFinite(v) ? v : 0;
	}
}

/** Queue a change made by the reader (field edit or action). */
export function schedule(sim: Sim, set: LabState, delay: number, log: string) {
	sim.actions++;
	sim.log.push({ t: sim.t, text: log, tone: 'user' });
	sim.pending.push({ at: sim.t + Math.max(0, delay), set, log });
}

export function runAction(sim: Sim, resourceId: string, actionId: string) {
	const action = sim.lab.resources.find((r) => r.id === resourceId)?.actions?.find((a) => a.id === actionId);
	if (!action) throw new Error(`Unknown action ${resourceId}.${actionId}`);
	const res = action.run(sim.state, ctx(sim));
	schedule(sim, res.set ?? {}, res.delay ?? 0, res.log);
}

export function applyFields(sim: Sim, resourceId: string, set: LabState) {
	const r = sim.lab.resources.find((x) => x.id === resourceId);
	const changed = Object.entries(set).filter(([k, v]) => sim.state[k] !== v);
	if (!changed.length) return;
	const desc = changed.map(([k, v]) => `${r?.fields?.find((f) => f.key === k)?.label ?? k} → ${v}`).join(', ');
	schedule(sim, Object.fromEntries(changed), r?.applySeconds ?? 20, `${r?.name ?? resourceId}: ${desc}`);
}

/** Advance one simulated second. */
export function tick(sim: Sim) {
	if (sim.outcome.kind !== 'running') return;
	sim.t++;
	const lab = sim.lab;

	for (const e of lab.events ?? [])
		if (e.at === sim.t) {
			if (e.set) Object.assign(sim.state, e.set);
			sim.log.push({ t: sim.t, text: e.log, tone: 'warn' });
		}

	const due = sim.pending.filter((p) => p.at <= sim.t);
	if (due.length) {
		sim.pending = sim.pending.filter((p) => p.at > sim.t);
		for (const p of due) {
			Object.assign(sim.state, p.set);
			sim.log.push({ t: sim.t, text: `✓ applied: ${p.log}`, tone: 'ok' });
		}
	}

	Object.assign(sim.state, lab.step(sim.state, ctx(sim)));
	measure(sim);

	for (const m of lab.metrics) {
		const h = sim.history[m.id];
		h.push(sim.metrics[m.id]);
		if (h.length > HISTORY) h.shift();
		if (m.alarm !== undefined) {
			const on = sim.metrics[m.id] > m.alarm;
			if (on && !sim.alarmsOn.has(m.id)) sim.log.push({ t: sim.t, text: `ALARM ${m.label} > ${m.alarm}${m.unit ?? ''}`, tone: 'crit' });
			if (!on && sim.alarmsOn.has(m.id)) sim.log.push({ t: sim.t, text: `OK ${m.label} back under ${m.alarm}${m.unit ?? ''}`, tone: 'ok' });
			if (on) sim.alarmsOn.add(m.id);
			else sim.alarmsOn.delete(m.id);
		}
	}

	sim.cost += (lab.cost?.(sim.state) ?? 0) / 3600;

	for (const l of lab.lose ?? [])
		if (l.check(sim.state, sim.metrics, sim.t)) {
			sim.outcome = { kind: 'lost', t: sim.t, reason: l.text };
			sim.log.push({ t: sim.t, text: 'Incident escalated: you lost this one.', tone: 'crit' });
			return;
		}

	sim.winStreak = lab.win.check(sim.state, sim.metrics, sim.t) ? sim.winStreak + 1 : 0;
	if (sim.winStreak >= (lab.win.hold ?? 30)) {
		sim.outcome = { kind: 'won', t: sim.t };
		sim.log.push({ t: sim.t, text: 'Resolved: metrics stable.', tone: 'ok' });
		return;
	}
	if (sim.t >= (lab.timeLimit ?? 600)) sim.outcome = { kind: 'timeout' };
}

/** Headless replay of a scripted move list (used by the validator). */
export function replay(lab: Lab, moves: Lab['solution']): Outcome {
	const sim = createSim(lab);
	const todo = [...moves].sort((a, b) => a.at - b.at);
	while (sim.outcome.kind === 'running') {
		while (todo.length && todo[0].at <= sim.t) {
			const m = todo.shift()!;
			if (m.set) {
				// Group keys by owning resource so each gets its own applySeconds.
				const byRes = new Map<string, LabState>();
				for (const [k, v] of Object.entries(m.set)) {
					const owner = lab.resources.find((r) => r.fields?.some((f) => f.key === k))?.id ?? '_direct';
					byRes.set(owner, { ...(byRes.get(owner) ?? {}), [k]: v });
				}
				for (const [rid, set] of byRes) {
					if (rid === '_direct') schedule(sim, set, 0, 'direct');
					else applyFields(sim, rid, set);
				}
			}
			if (m.action) runAction(sim, m.action.resource, m.action.id);
		}
		tick(sim);
	}
	return sim.outcome;
}
