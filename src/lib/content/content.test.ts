/**
 * Content validator. Run with `npm run validate`.
 * Catches broken glossary links, duplicate ids and malformed chart data before they ship.
 */
import { describe, expect, it } from 'vitest';
import { assessments, assessmentFilesMissingExport, glossary } from './index';
import { termRefs } from './inline';
import type { Block, CodeDiff, Lab, MockEl, Panel, Rich, TerminalScenario } from './types';
import { richIn } from './walk';
import { replay } from '$lib/labs/engine';
import { Shell } from '$lib/terminal/shell';
import { parsePatch } from '$lib/review/patch';

const termIds = new Set(glossary.map((t) => t.id));

function panelProblems(p: Panel): string[] {
	const errs: string[] = [];
	if (p.kind === 'timeseries' || p.kind === 'bars') {
		for (const s of p.series)
			if (s.points.length !== p.x.length)
				errs.push(`"${p.title}" series "${s.name}" has ${s.points.length} points for ${p.x.length} x labels`);
		for (const m of p.markers ?? [])
			if (m.at < 0 || m.at >= p.x.length) errs.push(`"${p.title}" marker "${m.label}" out of range`);
	}
	if (p.kind === 'heatmap') {
		if (p.values.length !== p.y.length) errs.push(`"${p.title}" heatmap has ${p.values.length} rows for ${p.y.length} y labels`);
		p.values.forEach((row, i) => {
			if (row.length !== p.x.length) errs.push(`"${p.title}" heatmap row ${i} has ${row.length} cols for ${p.x.length} x labels`);
		});
	}
	if (p.kind === 'table') {
		p.rows.forEach((r, i) => {
			if (r.length !== p.head.length) errs.push(`"${p.title}" table row ${i} has ${r.length} cells for ${p.head.length} columns`);
		});
	}
	return errs;
}

/** Every lab must be winnable by its reference solution, unwinnable idle, and its trap must not win. */
function labProblems(lab: Lab): string[] {
	const errs: string[] = [];
	const keys = new Set(Object.keys(lab.initial));
	for (const r of lab.resources) for (const f of r.fields ?? []) if (!keys.has(f.key)) errs.push(`lab "${lab.title}": field ${f.key} not in initial state`);
	try {
		const idle = replay(lab, []);
		if (idle.kind === 'won') errs.push(`lab "${lab.title}": wins with no action`);
		const sol = replay(lab, lab.solution);
		if (sol.kind !== 'won') errs.push(`lab "${lab.title}": reference solution does not win (${sol.kind}${sol.kind === 'lost' ? `: ${sol.reason}` : ''})`);
		if (lab.trap) {
			const trap = replay(lab, lab.trap);
			if (trap.kind === 'won') errs.push(`lab "${lab.title}": trap move wins`);
		}
	} catch (e) {
		errs.push(`lab "${lab.title}": simulation threw ${(e as Error).message}`);
	}
	return errs;
}

/** Replay the scenario's reference commands: none may hit "command not found", and a final submit must pass. */
function terminalProblems(t: TerminalScenario): string[] {
	const errs: string[] = [];
	const sh = new Shell(t);
	for (const cmd of t.solution) {
		const out = sh.run(cmd).text;
		if (/command not found|unsupported in this sandbox/.test(out)) errs.push(`terminal "${t.title ?? ''}": \`${cmd}\` → ${out.trim().slice(0, 80)}`);
	}
	if (t.answer && !sh.solved) errs.push(`terminal "${t.title ?? ''}": solution never reaches a passing submit`);
	if (t.answer && new Shell(t).run('submit wrong-answer-xyz').text.includes('Correct')) errs.push(`terminal "${t.title ?? ''}": accepts any answer`);
	return errs;
}

/** Every note must anchor to exactly one line; review diffs need ≥2 issues. */
function diffProblems(d: CodeDiff): string[] {
	const errs: string[] = [];
	let issues = 0;
	for (const f of d.files) {
		const rows = parsePatch(f);
		for (const n of f.notes ?? []) {
			const hits = rows.filter((r) => r.kind !== 'hunk' && r.text.includes(n.match)).length;
			if (hits !== 1) errs.push(`diff "${d.title}" ${f.path}: note "${n.match}" matches ${hits} lines`);
			if (n.issue) issues++;
		}
	}
	if (d.mode !== 'view' && issues < 2) errs.push(`diff "${d.title}": review mode needs ≥2 issues`);
	return errs;
}

function blockProblems(blocks: Block[] | undefined): string[] {
	const errs: string[] = [];
	for (const b of blocks ?? []) {
		if (b.type === 'dashboard') for (const p of b.dashboard.panels) errs.push(...panelProblems(p));
		if (b.type === 'logs' && b.logs.histogram) {
			const h = b.logs.histogram;
			if (h.counts.length !== h.x.length) errs.push(`log histogram has ${h.counts.length} counts for ${h.x.length} labels`);
			if (h.errors && h.errors.length !== h.x.length) errs.push(`log histogram errors length mismatch`);
		}
		if (b.type === 'trace') {
			const ids = new Set(b.trace.spans.map((s) => s.id));
			for (const s of b.trace.spans) if (s.parent && !ids.has(s.parent)) errs.push(`span ${s.id} has unknown parent ${s.parent}`);
		}
		if (b.type === 'table')
			b.rows.forEach((r, i) => {
				if (r.length !== b.head.length) errs.push(`table row ${i} has ${r.length} cells for ${b.head.length} columns`);
			});
		if (b.type === 'columns') for (const c of b.columns) errs.push(...blockProblems(c.blocks));
		if (b.type === 'lab') errs.push(...labProblems(b.lab));
		if (b.type === 'terminal') errs.push(...terminalProblems(b.terminal));
		if (b.type === 'diff') errs.push(...diffProblems(b.diff));
		if (b.type === 'mock' && b.mock.mode === 'spot') {
			const flat: MockEl[] = [];
			const walk = (els: MockEl[]) => els.forEach((e) => (flat.push(e), e.children && walk(e.children)));
			walk(b.mock.elements);
			if (flat.filter((e) => e.issue).length < 3) errs.push(`spot mock "${b.mock.url ?? ''}" needs ≥3 planted issues`);
		}
	}
	return errs;
}

describe('glossary', () => {
	it('has unique ids', () => {
		const seen = new Map<string, number>();
		for (const t of glossary) seen.set(t.id, (seen.get(t.id) ?? 0) + 1);
		expect([...seen].filter(([, n]) => n > 1).map(([id]) => id)).toEqual([]);
	});

	it('ids are kebab-case', () => {
		expect(glossary.filter((t) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.id)).map((t) => t.id)).toEqual([]);
	});

	it('only links to terms that exist', () => {
		const broken: string[] = [];
		for (const t of glossary) {
			const rich = [t.short, t.analogy ?? '', ...richIn(t.page)];
			for (const r of rich) for (const id of termRefs(r)) if (!termIds.has(id)) broken.push(`${t.id} → ${id}`);
			for (const id of t.related ?? []) if (!termIds.has(id)) broken.push(`${t.id} related → ${id}`);
		}
		expect(broken).toEqual([]);
	});

	it('wiki links point at known terms and English Wikipedia', async () => {
		const wiki: Record<string, string> = (await import('./wiki.json')).default;
		expect(Object.keys(wiki).filter((id) => !termIds.has(id))).toEqual([]);
		expect(Object.values(wiki).filter((u) => !u.startsWith('https://en.wikipedia.org/wiki/'))).toEqual([]);
	});

	it('has well-formed dedicated pages', () => {
		expect(glossary.flatMap((t) => blockProblems(t.page).map((e) => `${t.id}: ${e}`))).toEqual([]);
	});
});

describe('assessments', () => {
	it('every assessment file default-exports an Assessment', () => {
		expect(assessmentFilesMissingExport).toEqual([]);
	});

	it('have unique ids and numbers', () => {
		expect(new Set(assessments.map((a) => a.id)).size).toBe(assessments.length);
		expect(new Set(assessments.map((a) => a.number)).size).toBe(assessments.length);
	});

	for (const a of assessments) {
		describe(`#${a.number} ${a.id}`, () => {
			const questions = a.parts.flatMap((p) => p.questions);

			it('has unique part and question ids', () => {
				expect(new Set(a.parts.map((p) => p.id)).size).toBe(a.parts.length);
				const dupes = questions.map((q) => q.id).filter((id, i, all) => all.indexOf(id) !== i);
				expect(dupes).toEqual([]);
			});

			it('only links to glossary terms that exist', () => {
				const broken: string[] = [];
				const check = (where: string, rich: Rich[]) => {
					for (const r of rich) for (const id of termRefs(r)) if (!termIds.has(id)) broken.push(`${where} → ${id}`);
				};
				check('description', [a.description]);
				check('overview', richIn(a.overview));
				for (const p of a.parts) {
					check(p.id, [p.title, p.meta ?? '', ...richIn(p.intro), ...richIn(p.outro)]);
					for (const q of p.questions)
						check(q.id, [q.title, ...(q.hints ?? []), ...richIn(q.prompt), ...richIn(q.answer)]);
				}
				expect(broken).toEqual([]);
			});

			it('has well-formed charts, tables and traces', () => {
				const errs: string[] = [];
				errs.push(...blockProblems(a.overview));
				for (const p of a.parts) {
					errs.push(...blockProblems(p.intro), ...blockProblems(p.outro));
					for (const q of p.questions)
						errs.push(...[...blockProblems(q.prompt), ...blockProblems(q.answer)].map((e) => `${q.id}: ${e}`));
				}
				expect(errs).toEqual([]);
			});

			it('time budget adds up to the stated minutes', () => {
				const budget = a.overview?.find((b) => b.type === 'budget');
				if (budget?.type === 'budget') expect(budget.items.reduce((s, i) => s + i.minutes, 0)).toBe(a.minutes);
			});

			it('every question has a prompt and an answer', () => {
				expect(questions.filter((q) => q.answer.length === 0).map((q) => q.id)).toEqual([]);
			});
		});
	}
});
